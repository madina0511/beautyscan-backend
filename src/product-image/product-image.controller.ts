import {
  temporaryImageStorage,
  UploadFailureCleanupInterceptor,
} from './upload-storage';
import { IMAGE_UPLOAD_LIMITS } from './image-upload.config';
import { Req, UseGuards } from '@nestjs/common';
import { Request } from 'express';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { authenticatedMemberId } from '../products/product-request.util';
import { cleanupUpload } from './upload-cleanup.util';
import {
  Body,
  Controller,
  BadRequestException,
  Post,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ProductImageService } from './product-image.service';

interface UploadedImage {
  filename: string;
  path: string;
  originalname: string;
  mimetype: string;
  size: number;
  buffer: Buffer;
}

@Controller('product-image')
export class ProductImageController {
  constructor(private readonly productImageService: ProductImageService) {}

  @UseGuards(JwtAuthGuard)
  @Post('upload')
  @UseInterceptors(
    UploadFailureCleanupInterceptor,
    FileInterceptor('image', {
      limits: IMAGE_UPLOAD_LIMITS,
      storage: temporaryImageStorage('uploads/products'),
    }),
  )
  async uploadImage(
    @UploadedFile() file: UploadedImage,
    @Body('productId') productId: string,
    @Req() request: Request,
  ) {
    if (!file) {
      throw new BadRequestException(
        'Image file was not received. Use form-data key: image',
      );
    }

    try {
      const memberId = authenticatedMemberId(request);
      const processed = await this.productImageService.processUpload(
        productId,
        memberId,
        file.path,
      );
      return {
        productId,
        originalImage: processed.originalImage,
        finalEditedImage: processed.finalEditedImage,
        message: 'Product image processed successfully',
      };
    } finally {
      await cleanupUpload(file.path);
    }
  }
}
