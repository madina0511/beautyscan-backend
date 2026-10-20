import {
  ImageNormalizationService,
  NormalizedImage,
} from './image-normalization.service';
import { finished } from 'stream/promises';
import { randomUUID } from 'crypto';
import { cleanupUpload } from './upload-cleanup.util';
import { Injectable } from '@nestjs/common';
import { ProcessImageInput } from './dto/process-image.input';
import { ProcessImageOutput } from './dto/process-image.output';
import { ProductsService } from '../products/products.service';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import FormData from 'form-data';
import * as path from 'path';
import * as fs from 'fs';

@Injectable()
export class ProductImageService {
  constructor(
    private readonly productsService: ProductsService,
    private readonly httpService: HttpService,
    private readonly configService: ConfigService,
    private readonly normalization: ImageNormalizationService,
  ) {}

  async removeBackground(
    input: ProcessImageInput,
    memberId: string,
  ): Promise<ProcessImageOutput> {
    const { productId, image } = input;

    await this.productsService.updateOriginalImage(productId, memberId, image);

    return {
      image,
      message: 'Image received and saved to product successfully',
    };
  }

  async createFinalEditedImage(imagePath: string): Promise<Buffer> {
    const apiKey = this.configService.get<string>('PHOTOROOM_API_KEY');

    if (!apiKey) {
      throw new Error('PHOTOROOM_API_KEY is missing');
    }

    const form = new FormData();

    const imageStream = fs.createReadStream(imagePath);
    form.append('imageFile', imageStream);

    form.append('removeBackground', 'true');

    form.append(
      'background.prompt',
      'elegant minimal luxury skincare product photography, warm ivory and soft beige studio background, clean cosmetic advertising style, subtle pedestal, soft natural lighting, premium beauty brand aesthetic',
    );

    form.append('padding', '0.15');
    form.append('shadow.mode', 'ai.soft');

    try {
      const response = await this.httpService.axiosRef.post(
        'https://image-api.photoroom.com/v2/edit',
        form,
        {
          headers: {
            ...form.getHeaders(),
            'x-api-key': apiKey,
            'pr-ai-background-model-version':
              'background-studio-beta-2025-03-17',
          },
          responseType: 'arraybuffer',
        },
      );

      return Buffer.from(response.data);
    } finally {
      imageStream.destroy();
      await finished(imageStream).catch(() => undefined);
    }
  }

  async processUpload(
    productId: string,
    memberId: string,
    uploadPath: string,
  ): Promise<{ originalImage: string; finalEditedImage: string }> {
    await this.productsService.requireOwnedProduct(productId, memberId);
    let normalized: NormalizedImage | undefined;
    let originalPath: string | undefined;
    let finalPath: string | undefined;
    let saved = false;
    try {
      normalized = await this.normalization.normalize(uploadPath, 'product');
      const imageBuffer = await this.createFinalEditedImage(normalized.path);
      const originalDir = path.join('uploads', 'products', 'original');
      const finalDir = path.join('uploads', 'products', 'final');
      await Promise.all([
        fs.promises.mkdir(originalDir, { recursive: true }),
        fs.promises.mkdir(finalDir, { recursive: true }),
      ]);
      originalPath = path.join(
        originalDir,
        `${randomUUID()}.${normalized.format === 'jpeg' ? 'jpg' : 'png'}`,
      );
      finalPath = path.join(finalDir, `${randomUUID()}.png`);
      await fs.promises.copyFile(normalized.path, originalPath);
      await fs.promises.writeFile(finalPath, imageBuffer);
      await this.productsService.updateProcessedImages(
        productId,
        memberId,
        originalPath,
        finalPath,
      );
      saved = true;
      return { originalImage: originalPath, finalEditedImage: finalPath };
    } finally {
      if (normalized) await cleanupUpload(normalized.path);
      if (!saved) {
        if (originalPath) await cleanupUpload(originalPath);
        if (finalPath) await cleanupUpload(finalPath);
      }
    }
  }
}
