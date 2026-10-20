import {
  BadRequestException,
  Body,
  Controller,
  Post,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { diskStorage } from 'multer';
import { extname } from 'path';
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
  ) {}

  @Post('upload')
  @UseInterceptors(
    FileInterceptor('image', {
      storage: diskStorage({
        destination: './uploads/packages',

        filename: (req, file, callback) => {
          const uniqueName = `${Date.now()}-${Math.round(Math.random() * 1e9)}`;

          callback(null, `${uniqueName}${extname(file.originalname)}`);
        },
      }),
    }),
  )
  async uploadPackageImage(
    @UploadedFile() file: UploadedPackageImage,
    @Body('productId') productId: string,
    @Body('language') language: DescriptionLanguage,
  ) {
    if (!file) {
      throw new BadRequestException('Package image is required');
    }

    if (!productId) {
      throw new BadRequestException('productId is required');
    }

    if (!language) {
      throw new BadRequestException('Language is required');
    }

    if (!['uz', 'en', 'ru', 'ko'].includes(language)) {
      throw new BadRequestException('Language must be uz, en, ru, or ko');
    }

    const extractedText = await this.ocrService.extractText(file.path);

    const description = await this.aiDescriptionService.generateDescription(
      extractedText,
      language,
    );
    const updatedProduct = await this.productsService.updateDescription(
      productId,
      language,
      description,
    );

    console.log('PRODUCT ID:', productId);
    console.log('LANGUAGE:', language);
    console.log('UPDATED PRODUCT:', updatedProduct);

    return {
      productId,
      packageImage: file.path,
      extractedText,
      description,
      language,
      message: 'Package text extracted and descriptions generated successfully',
    };
  }
}
