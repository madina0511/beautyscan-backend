import { BadRequestException, PayloadTooLargeException } from '@nestjs/common';
import { randomBytes } from 'crypto';
import {
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rmdir,
  unlink,
  writeFile,
} from 'fs/promises';
import { join } from 'path';
import sharp from 'sharp';
import { ImageNormalizationService } from './image-normalization.service';
import { cleanupUpload } from './upload-cleanup.util';
import {
  MAX_OCR_IMAGE_BYTES,
  OCR_ENVELOPE_BYTES,
  OCR_JSON_BYTES,
} from './image-upload.config';

describe('ImageNormalizationService (real codecs)', () => {
  const service = new ImageNormalizationService();
  let directory: string;
  let fixture: Buffer;
  const outputs: string[] = [];
  beforeAll(async () => {
    await mkdir('uploads/temporary', { recursive: true });
    directory = await mkdtemp('uploads/temporary/codec-test-');
    fixture = await sharp({
      create: {
        width: 3,
        height: 2,
        channels: 4,
        background: { r: 2, g: 4, b: 8, alpha: 0.5 },
      },
    })
      .png()
      .toBuffer();
  });
  afterEach(async () => {
    for (const output of outputs.splice(0)) await cleanupUpload(output);
    for (const name of await readdir(directory))
      await unlink(join(directory, name));
  });
  afterAll(async () => {
    await rmdir(directory);
  });
  async function input(bytes: Buffer, name = 'input.bin'): Promise<string> {
    const filePath = join(directory, name);
    await writeFile(filePath, bytes);
    return filePath;
  }
  async function normalize(
    bytes: Buffer,
    purpose: 'product' | 'ocr' = 'product',
  ) {
    const result = await service.normalize(await input(bytes), purpose);
    outputs.push(result.path);
    return result;
  }
  it.each(['jpeg', 'png', 'webp', 'avif'] as const)(
    'fully decodes and normalizes %s bytes despite a non-image filename',
    async (format) => {
      const bytes = await sharp(fixture).toFormat(format).toBuffer();
      const result = await normalize(bytes);
      const metadata = await sharp(await readFile(result.path)).metadata();
      expect(['jpeg', 'png']).toContain(metadata.format);
      await expect(
        sharp(await readFile(result.path))
          .raw()
          .toBuffer(),
      ).resolves.toBeInstanceOf(Buffer);
    },
  );
  it('preserves transparency', async () => {
    const result = await normalize(fixture);
    expect(result.format).toBe('png');
    const { data, info } = await sharp(await readFile(result.path))
      .raw()
      .toBuffer({ resolveWithObject: true });
    expect(info.channels).toBe(4);
    expect(data[3]).toBeGreaterThan(0);
    expect(data[3]).toBeLessThan(255);
  });
  it('corrects EXIF orientation and removes the orientation tag', async () => {
    const bytes = await sharp(fixture)
      .jpeg()
      .withMetadata({ orientation: 6 })
      .toBuffer();
    const result = await normalize(bytes);
    const metadata = await sharp(await readFile(result.path)).metadata();
    expect([metadata.width, metadata.height]).toEqual([2, 3]);
    expect(metadata.orientation).toBeUndefined();
  });
  it('rejects truncated image data after recognizing the header', async () => {
    await expect(
      normalize(fixture.subarray(0, fixture.length - 20)),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
  it.each(['heic', 'heix', 'mif1', 'msf1'])(
    'explicitly rejects unsupported HEIC/HEIF brand %s',
    async (brand) => {
      const bytes = Buffer.alloc(24);
      bytes.writeUInt32BE(24, 0);
      bytes.write('ftyp', 4);
      bytes.write(brand, 8);
      bytes.write(brand, 16);
      await expect(normalize(bytes)).rejects.toThrow('HEIC and HEIF');
    },
  );
  it('rejects other formats', async () => {
    await expect(normalize(Buffer.from('GIF89a'))).rejects.toThrow(
      'Unsupported image format',
    );
  });
  it('rejects animated WebP', async () => {
    const bytes = await sharp(
      Buffer.from([
        255, 0, 0, 255, 0, 0, 255, 0, 0, 255, 0, 0, 0, 255, 0, 0, 255, 0, 0,
        255, 0, 0, 255, 0,
      ]),
      {
        raw: { width: 2, height: 4, channels: 3, pageHeight: 2 },
      },
    )
      .webp({ loop: 0, delay: [100, 100] })
      .toBuffer();
    expect((await sharp(bytes).metadata()).pages).toBe(2);
    await expect(normalize(bytes)).rejects.toThrow('Animated and multipage');
  });
  it('rejects APNG animation control chunks before decoding', async () => {
    const chunk = Buffer.alloc(20);
    chunk.writeUInt32BE(8, 0);
    chunk.write('acTL', 4);
    await expect(
      normalize(
        Buffer.concat([fixture.subarray(0, 33), chunk, fixture.subarray(33)]),
      ),
    ).rejects.toThrow('Animated and multipage');
  });
  it.each([
    [10001, 1],
    [5001, 5000],
  ])('rejects excessive dimensions %sx%s', async (width, height) => {
    const bytes = await sharp({
      create: { width, height, channels: 3, background: 'white' },
    })
      .png()
      .toBuffer();
    await expect(normalize(bytes)).rejects.toBeInstanceOf(BadRequestException);
  });
  it('reserves room for base64 expansion and the OCR request envelope', () => {
    expect(
      4 * Math.ceil(MAX_OCR_IMAGE_BYTES / 3) + OCR_ENVELOPE_BYTES,
    ).toBeLessThanOrEqual(OCR_JSON_BYTES);
    expect(
      4 * Math.ceil((MAX_OCR_IMAGE_BYTES + 1) / 3) + OCR_ENVELOPE_BYTES,
    ).toBeGreaterThan(OCR_JSON_BYTES);
  });
  it('rejects oversized normalized OCR payloads and deletes the working output', async () => {
    const bytes = await sharp(randomBytes(1500 * 1500 * 4), {
      raw: { width: 1500, height: 1500, channels: 4 },
    })
      .png()
      .toBuffer();
    expect(bytes.length).toBeLessThan(10_000_000);
    const filePath = await input(bytes);
    const before = await readdir('uploads/temporary');
    await expect(service.normalize(filePath, 'ocr')).rejects.toBeInstanceOf(
      PayloadTooLargeException,
    );
    expect(await readdir('uploads/temporary')).toEqual(before);
  });
  it('rejects oversized files even when called without Multer', async () => {
    await expect(normalize(Buffer.alloc(10_000_001))).rejects.toBeInstanceOf(
      PayloadTooLargeException,
    );
  });
});
