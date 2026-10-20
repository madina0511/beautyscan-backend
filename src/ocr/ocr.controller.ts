import {
  temporaryImageStorage,
  UploadFailureCleanupInterceptor,
} from '../product-image/upload-storage';
import { randomUUID } from 'crypto';
import { copyFile, mkdir } from 'fs/promises';
import { join } from 'path';
import {
  ImageNormalizationService,
  NormalizedImage,
} from '../product-image/image-normalization.service';
import { IMAGE_UPLOAD_LIMITS } from '../product-image/image-upload.config';
import { Req, UseGuards } from '@nestjs/common';
import { Request } from 'express';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { authenticatedMemberId } from '../products/product-request.util';
import { cleanupUpload } from '../product-image/upload-cleanup.util';
import {
  BadRequestException,
  Body,
  Controller,
  Post,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { OcrService } from './ocr.service';
import {
  AiDescriptionService,
  DescriptionLanguage,
} from '../ai-description/ai-description.service';
import { ProductsService } from '../products/products.service';

interface UploadedPackageImage {
  originalname: string;
  filename: string;
  path: string;
  mimetype: string;
  size: number;
}

@Controller('ocr')
export class OcrController {
  constructor(
    private readonly ocrService: OcrService,
    private readonly aiDescriptionService: AiDescriptionService,
    private readonly productsService: ProductsService,
    private readonly normalization: ImageNormalizationService,
  ) {}

  @UseGuards(JwtAuthGuard)
  @Post('upload')
  @UseInterceptors(
    UploadFailureCleanupInterceptor,
    FileInterceptor('image', {
      limits: IMAGE_UPLOAD_LIMITS,
      storage: temporaryImageStorage('uploads/packages'),
    }),
  )
  async uploadPackageImage(
    @UploadedFile() file: UploadedPackageImage,
    @Body('productId') productId: string,
    @Body('language') language: DescriptionLanguage,
    @Req() request: Request,
  ) {
    if (!file) {
      throw new BadRequestException('Package image is required');
    }

    let normalized: NormalizedImage | undefined;
    let packageImage: string | undefined;
    let saved = false;
    try {
      const memberId = authenticatedMemberId(request);
      await this.productsService.requireOwnedProduct(productId, memberId);
      if (!productId) {
        throw new BadRequestException('productId is required');
      }

      if (!language) {
        throw new BadRequestException('Language is required');
      }

      if (!['uz', 'en', 'ru', 'ko'].includes(language)) {
        throw new BadRequestException('Language must be uz, en, ru, or ko');
      }

      normalized = await this.normalization.normalize(file.path, 'ocr');
      const extractedText = await this.ocrService.extractText(normalized.path);

      const description = await this.aiDescriptionService.generateDescription(
        extractedText,
        language,
      );
      const outputDir = join('uploads', 'packages', 'final');
      await mkdir(outputDir, { recursive: true });
      packageImage = join(
        outputDir,
        `${randomUUID()}.${normalized.format === 'jpeg' ? 'jpg' : 'png'}`,
      );
      await copyFile(normalized.path, packageImage);
      await this.productsService.updateDescription(
        productId,
        memberId,
        language,
        description,
      );

      saved = true;
      return {
        productId,
        packageImage,
        extractedText,
        description,
        language,
        message:
          'Package text extracted and descriptions generated successfully',
      };
    } finally {
      await cleanupUpload(file.path);
      if (normalized) await cleanupUpload(normalized.path);
      if (!saved && packageImage) await cleanupUpload(packageImage);
    }
  }
}
