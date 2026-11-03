import {
  BadRequestException,
  Injectable,
  PayloadTooLargeException,
} from '@nestjs/common';
import { randomUUID } from 'crypto';
import { mkdir, readFile, stat } from 'fs/promises';
import { join } from 'path';
import sharp, { SharpOptions } from 'sharp';
import { cleanupUpload } from './upload-cleanup.util';
import {
  MAX_IMAGE_DIMENSION,
  MAX_IMAGE_PIXELS,
  MAX_NORMALIZED_BYTES,
  MAX_OCR_IMAGE_BYTES,
  MAX_UPLOAD_BYTES,
} from './image-upload.config';

export interface NormalizedImage {
  path: string;
  format: 'png' | 'jpeg';
  size: number;
}

@Injectable()
export class ImageNormalizationService {
  async normalize(
    inputPath: string,
    purpose: 'product' | 'ocr',
    temporaryDirectory?: string,
  ): Promise<NormalizedImage> {
    let outputPath: string | undefined;
    try {
      const inputSize = (await stat(inputPath)).size;
      if (inputSize > MAX_UPLOAD_BYTES)
        throw new PayloadTooLargeException(
          'Image must not exceed 10,000,000 bytes',
        );
      // A bounded buffer avoids libvips retaining Windows file handles in its cache.
      const bytes = await readFile(inputPath);
      if (bytes.length > MAX_UPLOAD_BYTES) throw new PayloadTooLargeException();
      const format = this.detectFormat(bytes);
      const options: SharpOptions = {
        limitInputPixels: MAX_IMAGE_PIXELS,
        failOn: 'warning',
      };
      const metadata = await sharp(bytes, options).metadata();
      if ((metadata.pages ?? 1) !== 1)
        throw new BadRequestException(
          'Animated and multipage images are not supported',
        );
      if (metadata.compression === 'hevc')
        throw new BadRequestException('HEIC and HEIF images are not supported');
      if (
        !metadata.width ||
        !metadata.height ||
        metadata.width > MAX_IMAGE_DIMENSION ||
        metadata.height > MAX_IMAGE_DIMENSION ||
        metadata.width * metadata.height > MAX_IMAGE_PIXELS
      ) {
        throw new BadRequestException(
          'Image exceeds the 25 megapixel or 10,000 pixel dimension limit',
        );
      }
      const decodedFormat =
        metadata.format === 'heif' && metadata.compression === 'av1'
          ? 'avif'
          : metadata.format;
      if (decodedFormat !== format)
        throw new BadRequestException(
          'Image content does not match its detected format',
        );
      const outputFormat = metadata.hasAlpha ? 'png' : 'jpeg';
      const outputDir =
        temporaryDirectory ?? join(process.cwd(), 'uploads', 'temporary');
      await mkdir(outputDir, { recursive: true });
      outputPath = join(
        outputDir,
        `${randomUUID()}.${outputFormat === 'jpeg' ? 'jpg' : 'png'}`,
      );
      // Encoding forces a full decode; metadata or a magic header alone is insufficient.
      const pipeline = sharp(bytes, options)
        .rotate()
        .toColourspace('srgb')
        .timeout({ seconds: 15 });
      if (outputFormat === 'png') await pipeline.png().toFile(outputPath);
      else
        await pipeline
          .jpeg({ quality: 90, chromaSubsampling: '4:4:4' })
          .toFile(outputPath);
      const size = (await stat(outputPath)).size;
      const budget =
        purpose === 'ocr' ? MAX_OCR_IMAGE_BYTES : MAX_NORMALIZED_BYTES;
      if (size > budget)
        throw new PayloadTooLargeException(
          purpose === 'ocr'
            ? 'Normalized image exceeds the OCR base64 request budget'
            : 'Normalized image exceeds the processing budget',
        );
      return { path: outputPath, format: outputFormat, size };
    } catch (error: unknown) {
      if (outputPath) await cleanupUpload(outputPath);
      if (
        error instanceof BadRequestException ||
        error instanceof PayloadTooLargeException
      )
        throw error;
      if (
        error instanceof Error &&
        error.message.includes('Input image exceeds pixel limit')
      ) {
        throw new BadRequestException(
          'Image exceeds the 25 megapixel or 10,000 pixel dimension limit',
        );
      }
      throw new BadRequestException(
        'Invalid or corrupt image, or image exceeds decoding limits',
      );
    }
  }

  private detectFormat(bytes: Buffer): 'jpeg' | 'png' | 'webp' | 'avif' {
    if (
      bytes.length >= 3 &&
      bytes[0] === 0xff &&
      bytes[1] === 0xd8 &&
      bytes[2] === 0xff
    )
      return 'jpeg';
    if (
      bytes.length >= 8 &&
      bytes
        .subarray(0, 8)
        .equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
    ) {
      let position = 8;
      while (position + 8 <= bytes.length) {
        const type = bytes.toString('ascii', position + 4, position + 8);
        if (type === 'acTL')
          throw new BadRequestException(
            'Animated and multipage images are not supported',
          );
        if (type === 'IDAT' || type === 'IEND') break;
        position += 12 + bytes.readUInt32BE(position);
      }
      return 'png';
    }
    if (
      bytes.length >= 12 &&
      bytes.toString('ascii', 0, 4) === 'RIFF' &&
      bytes.toString('ascii', 8, 12) === 'WEBP'
    )
      return 'webp';
    if (bytes.length >= 16 && bytes.toString('ascii', 4, 8) === 'ftyp') {
      const boxSize = bytes.readUInt32BE(0);
      const brands = [bytes.toString('ascii', 8, 12)];
      for (
        let offset = 16;
        offset + 4 <= Math.min(boxSize, bytes.length);
        offset += 4
      )
        brands.push(bytes.toString('ascii', offset, offset + 4));
      if (brands.includes('avis'))
        throw new BadRequestException(
          'Animated and multipage images are not supported',
        );
      if (brands.includes('avif')) return 'avif';
      if (
        brands.some((brand) =>
          [
            'heic',
            'heix',
            'hevc',
            'hevx',
            'heim',
            'heis',
            'hevm',
            'hevs',
            'mif1',
            'msf1',
          ].includes(brand),
        )
      )
        throw new BadRequestException(
          'HEIC and HEIF images are not supported; use JPEG, PNG, WebP or AVIF',
        );
    }
    throw new BadRequestException(
      'Unsupported image format; use JPEG, PNG, WebP or AVIF. HEIC and HEIF are not supported',
    );
  }
}
