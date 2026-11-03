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
  Header,
  HttpException,
  Logger,
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
  private readonly logger = new Logger(OcrController.name);
  constructor(
    private readonly ocrService: OcrService,
    private readonly aiDescriptionService: AiDescriptionService,
    private readonly productsService: ProductsService,
    private readonly normalization: ImageNormalizationService,
  ) {}

  @UseGuards(JwtAuthGuard)
  @Post('upload')
  @Header('Cache-Control', 'private, no-store')
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
    let stage = 'ownership';
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

      stage = 'normalization';
      normalized = await this.normalization.normalize(file.path, 'ocr');
      stage = 'ocr';
      const extractedText = await this.ocrService.extractText(normalized.path);

      stage = 'description';
      const description = await this.aiDescriptionService.generateDescription(
        extractedText,
        language,
      );
      stage = 'storage';
      const outputDir = join('uploads', 'packages', 'final');
      await mkdir(outputDir, { recursive: true });
      packageImage = join(
        outputDir,
        `${randomUUID()}.${normalized.format === 'jpeg' ? 'jpg' : 'png'}`,
      );
      await copyFile(normalized.path, packageImage);
      stage = 'database_save';
      await this.productsService.updatePackagingDescription(
        productId,
        memberId,
        language,
        description,
        packageImage,
      );

      saved = true;
      return {
        productId,
        packageImage,
        extractedText,
        description,
        language,
        message:
          'Package text extracted and selected-language description saved successfully',
      };
    } catch (error) {
      // Do not serialize errors, request bodies, product IDs or file paths.
      this.logger.warn({
        event: 'packaging_generation_failed',
        stage,
        status: error instanceof HttpException ? error.getStatus() : 500,
      });
      throw error;
    } finally {
      await cleanupUpload(file.path);
      if (normalized) await cleanupUpload(normalized.path);
      if (!saved && packageImage) await cleanupUpload(packageImage);
    }
  }
}
