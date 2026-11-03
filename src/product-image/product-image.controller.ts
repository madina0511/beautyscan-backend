import { Types } from 'mongoose';
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
import { createReadStream } from 'fs';
import { ProductImageErrorFilter } from './product-image-error.filter';
import {
  Body,
  Controller,
  BadRequestException,
  Post,
  UploadedFile,
  UseInterceptors,
  Get,
  Param,
  Header,
  StreamableFile,
  UseFilters,
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
  @Get(':productId/media/:kind')
  @Header('Cache-Control', 'private, no-store')
  @Header('X-Content-Type-Options', 'nosniff')
  async savedImage(
    @Param('productId') productId: string,
    @Param('kind') kind: string,
    @Req() request: Request,
  ): Promise<StreamableFile> {
    const image = await this.productImageService.getSavedImage(
      productId,
      authenticatedMemberId(request),
      kind,
    );
    return new StreamableFile(createReadStream(image.path), {
      type: image.type,
      length: image.size,
      disposition: `inline; filename="product-${kind}.${image.type === 'image/png' ? 'png' : 'jpg'}"`,
    });
  }

  @UseGuards(JwtAuthGuard)
  @Post('enhance')
  @Header('Cache-Control', 'private, no-store')
  @UseFilters(ProductImageErrorFilter)
  @UseInterceptors(
    UploadFailureCleanupInterceptor,
    FileInterceptor('image', {
      limits: { ...IMAGE_UPLOAD_LIMITS, fields: 0, parts: 2 },
      storage: temporaryImageStorage('uploads/products'),
    }),
  )
  async enhanceImage(
    @UploadedFile() file: UploadedImage,
    @Req() request: Request,
  ) {
    if (!file) throw new BadRequestException('Image file is required');
    try {
      const memberId = authenticatedMemberId(request);
      const productId = new Types.ObjectId().toHexString();
      const images = await this.productImageService.processUpload(
        productId,
        memberId,
        file.path,
        true,
      );
      return { productId, ...images };
    } finally {
      await cleanupUpload(file.path);
    }
  }

  @UseGuards(JwtAuthGuard)
  @Post('upload')
  @UseFilters(ProductImageErrorFilter)
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
