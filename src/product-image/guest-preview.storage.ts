import { Injectable, HttpException } from '@nestjs/common';
import {
  chmod,
  copyFile,
  link,
  lstat,
  mkdir,
  readdir,
  realpath,
  rm,
  stat,
  unlink,
} from 'fs/promises';
import { constants, createReadStream } from 'fs';
import { createHash, randomUUID } from 'crypto';
import { resolve, relative, isAbsolute, join } from 'path';
import sharp from 'sharp';
import {
  MAX_IMAGE_DIMENSION,
  MAX_IMAGE_PIXELS,
  MAX_NORMALIZED_BYTES,
} from './image-upload.config';

export const GUEST_TTL_MS = 60 * 60 * 1000;
// High-quality web rendition; CSS can size it responsively in the future UI.
export const GUEST_PREVIEW_MAX_EDGE = 1600;
export const GUEST_ID =
  /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;

@Injectable()
export class GuestPreviewStorage {
  readonly root = resolve('uploads', 'guest-private');
  readonly originalRoot = resolve('uploads', 'products', 'original');
  readonly finalRoot = resolve('uploads', 'products', 'final');

  private async checkedFile(root: string, name: string): Promise<string> {
    const file = await realpath(join(root, name));
    const actualRoot = await realpath(root);
    const info = await stat(file);
    if (
      relative(actualRoot, file) !== name ||
      !info.isFile() ||
      info.size <= 0 ||
      info.size > MAX_NORMALIZED_BYTES
    )
      throw new Error('Invalid private image');
    return file;
  }

  private async digest(file: string): Promise<string> {
    const hash = createHash('sha256');
    for await (const chunk of createReadStream(file)) hash.update(chunk);
    return hash.digest('hex');
  }

  private async copyImmutable(
    source: string,
    root: string,
    name: string,
  ): Promise<string> {
    await mkdir(root, { recursive: true, mode: 0o700 });
    const destination = join(root, name);
    const temporary = `${destination}.${randomUUID()}.tmp`;
    try {
      await copyFile(source, temporary, constants.COPYFILE_EXCL);
      await chmod(temporary, 0o600);
      // Linking a completed temp file publishes it atomically without replacing
      // an existing destination, even if a crashed worker resumes concurrently.
      try {
        await link(temporary, destination);
      } catch (error: unknown) {
        if (!(
          typeof error === 'object' &&
          error !== null &&
          'code' in error &&
          error.code === 'EEXIST'
        ))
          throw error;
        const existing = await this.checkedFile(root, name);
        if ((await this.digest(existing)) !== (await this.digest(temporary)))
          throw new Error('Conflicting claim image');
      }
      return relative(process.cwd(), destination);
    } finally {
      try {
        await unlink(temporary);
      } catch (error: unknown) {
        if (!(
          typeof error === 'object' &&
          error !== null &&
          'code' in error &&
          error.code === 'ENOENT'
        ))
          throw error;
      }
    }
  }

  async attachClaim(
    id: string,
    productId: string,
  ): Promise<{ originalImage: string; finalEditedImage: string }> {
    if (!/^[a-f0-9]{24}$/.test(productId))
      throw new Error('Invalid claimed product ID');
    const directory = this.directory(id);
    let original: string;
    if (relative(await realpath(this.root), await realpath(directory)) !== id)
      throw new Error('Invalid claim source directory');
    let extension = 'jpg';
    try {
      original = await this.checkedFile(directory, 'original.jpg');
    } catch (error: unknown) {
      if (!(
        typeof error === 'object' &&
        error !== null &&
        'code' in error &&
        error.code === 'ENOENT'
      ))
        throw error;
      original = await this.checkedFile(directory, 'original.png');
      extension = 'png';
    }
    const final = await this.checkedFile(directory, 'final.png');
    const originalImage = await this.copyImmutable(
      original,
      this.originalRoot,
      `guest-claim-${productId}.${extension}`,
    );
    const finalEditedImage = await this.copyImmutable(
      final,
      this.finalRoot,
      `guest-claim-${productId}.png`,
    );
    return { originalImage, finalEditedImage };
  }

  async cleanupClaimTemps(now = Date.now()): Promise<void> {
    for (const root of [this.originalRoot, this.finalRoot]) {
      await mkdir(root, { recursive: true, mode: 0o700 });
      for (const entry of await readdir(root, { withFileTypes: true })) {
        if (
          !entry.isFile() ||
          !/^guest-claim-[a-f0-9]{24}\.(?:jpg|png)\.[a-f0-9-]{36}\.tmp$/.test(
            entry.name,
          )
        )
          continue;
        const file = join(root, entry.name);
        if ((await stat(file)).mtimeMs <= now - GUEST_TTL_MS)
          await unlink(file);
      }
    }
  }

  directory(id: string): string {
    if (!GUEST_ID.test(id))
      throw new Error('Invalid private storage identifier');
    const directory = resolve(this.root, id);
    const within = relative(this.root, directory);
    if (!within || within.startsWith('..') || isAbsolute(within))
      throw new Error('Invalid private storage path');
    return directory;
  }

  async prepare(id: string): Promise<string> {
    const directory = this.directory(id);
    await mkdir(directory, { recursive: true, mode: 0o700 });
    return directory;
  }

  async remove(id: string): Promise<void> {
    const directory = this.directory(id);
    try {
      if ((await lstat(directory)).isSymbolicLink())
        throw new Error('Refused private storage symlink');
      const root = await realpath(this.root);
      const actual = await realpath(directory);
      if (relative(root, actual) !== id)
        throw new Error('Refused private storage escape');
      await rm(directory, { recursive: true, force: true });
    } catch (error: unknown) {
      if (!(
        typeof error === 'object' &&
        error !== null &&
        'code' in error &&
        error.code === 'ENOENT'
      ))
        throw error;
    }
  }

  async render(id: string, bytes: Buffer): Promise<void> {
    const options = {
      limitInputPixels: MAX_IMAGE_PIXELS,
      failOn: 'warning' as const,
    };
    const metadata = await sharp(bytes, options).metadata();
    if (
      !metadata.width ||
      !metadata.height ||
      metadata.width > MAX_IMAGE_DIMENSION ||
      metadata.height > MAX_IMAGE_DIMENSION ||
      (metadata.pages ?? 1) !== 1 ||
      !['png', 'jpeg', 'webp', 'heif'].includes(metadata.format ?? '') ||
      (metadata.format === 'heif' && metadata.compression !== 'av1')
    ) {
      throw new HttpException({ code: 'PHOTOROOM_UNAVAILABLE' }, 502);
    }
    const directory = this.directory(id);
    const final = join(directory, 'final.png');
    await sharp(bytes, options)
      .rotate()
      .toColourspace('srgb')
      .timeout({ seconds: 15 })
      .png()
      .toFile(final);
    if ((await stat(final)).size > MAX_NORMALIZED_BYTES)
      throw new HttpException({ code: 'PHOTOROOM_UNAVAILABLE' }, 502);
    // Preserve provider pixels (including any provider watermark). No retouching
    // or application-added overlays; the private full-size PNG stays unchanged.
    await sharp(bytes, options)
      .rotate()
      .toColourspace('srgb')
      .resize({
        width: GUEST_PREVIEW_MAX_EDGE,
        height: GUEST_PREVIEW_MAX_EDGE,
        fit: 'inside',
        withoutEnlargement: true,
      })
      .flatten({ background: '#fff' })
      .timeout({ seconds: 15 })
      .jpeg({ quality: 90, chromaSubsampling: '4:4:4', progressive: true })
      .toFile(join(directory, 'preview.jpg'));
  }

  async preview(id: string): Promise<string> {
    const directory = this.directory(id);
    const expected = join(directory, 'preview.jpg');
    const file = await realpath(expected);
    const root = await realpath(this.root);
    if (
      relative(root, file) !== join(id, 'preview.jpg') ||
      !(await stat(file)).isFile()
    )
      throw new Error('Invalid preview path');
    return file;
  }
}
