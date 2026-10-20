import {
  Body,
  Controller,
  BadRequestException,
  Post,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { diskStorage } from 'multer';
import { extname } from 'path';
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

  @Post('upload')
  @UseInterceptors(
    FileInterceptor('image', {
      storage: diskStorage({
        destination: './uploads/products',
        filename: (req, file, callback) => {
          const uniqueName = `${Date.now()}-${Math.round(Math.random() * 1e9)}`;

          callback(null, `${uniqueName}${extname(file.originalname)}`);
        },
      }),
    }),
  )
  async uploadImage(
    @UploadedFile() file: UploadedImage,
    @Body('productId') productId: string,
  ) {
    if (!file) {
      throw new BadRequestException(
        'Image file was not received. Use form-data key: image',
      );
    }

    // 1. Original rasmni product history'ga saqlaymiz
    await this.productImageService.saveOriginalImage(productId, file.path);

    // 2. Original rasmni Photoroom /v2/edit orqali
    // professional product image'ga aylantiramiz
    const finalImageBuffer =
      await this.productImageService.createFinalEditedImage(file.path);

    // 3. Tayyor final rasmni saqlaymiz
    const finalEditedImage =
      await this.productImageService.saveFinalEditedImage(
        productId,
        finalImageBuffer,
      );

    return {
      productId,
      originalImage: file.path,
      finalEditedImage,
      message: 'Product image processed successfully',
    };
  }
}
