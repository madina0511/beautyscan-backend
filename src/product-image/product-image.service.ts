import { Injectable } from '@nestjs/common';
import { ProcessImageInput } from './dto/process-image.input';
import { ProcessImageOutput } from './dto/process-image.output';
import { ProductsService } from '../products/products.service';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import FormData = require('form-data');
import * as path from 'path';
import * as fs from 'fs';

@Injectable()
export class ProductImageService {
  constructor(
    private readonly productsService: ProductsService,
    private readonly httpService: HttpService,
    private readonly configService: ConfigService,
  ) {}

  async removeBackground(
    input: ProcessImageInput,
  ): Promise<ProcessImageOutput> {
    const { productId, image } = input;

    await this.productsService.updateOriginalImage(productId, image);

    return {
      image,
      message: 'Image received and saved to product successfully',
    };
  }

  async saveOriginalImage(productId: string, imagePath: string) {
    return this.productsService.updateOriginalImage(productId, imagePath);
  }

  async createFinalEditedImage(imagePath: string): Promise<Buffer> {
    const apiKey = this.configService.get<string>('PHOTOROOM_API_KEY');

    if (!apiKey) {
      throw new Error('PHOTOROOM_API_KEY is missing');
    }

    const form = new FormData();

    form.append('imageFile', fs.createReadStream(imagePath));

    form.append('removeBackground', 'true');

    form.append(
      'background.prompt',
      'elegant minimal luxury skincare product photography, warm ivory and soft beige studio background, clean cosmetic advertising style, subtle pedestal, soft natural lighting, premium beauty brand aesthetic',
    );

    form.append('padding', '0.15');
    form.append('shadow.mode', 'ai.soft');

    const response = await this.httpService.axiosRef.post(
      'https://image-api.photoroom.com/v2/edit',
      form,
      {
        headers: {
          ...form.getHeaders(),
          'x-api-key': apiKey,
          'pr-ai-background-model-version': 'background-studio-beta-2025-03-17',
        },
        responseType: 'arraybuffer',
      },
    );

    return Buffer.from(response.data);
  }

  async saveFinalEditedImage(
    productId: string,
    imageBuffer: Buffer,
  ): Promise<string> {
    const outputDir = path.join(process.cwd(), 'uploads', 'products', 'final');

    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }

    const filename = `${Date.now()}-${productId}.png`;
    const outputPath = path.join(outputDir, filename);

    fs.writeFileSync(outputPath, imageBuffer);

    const imagePath = `uploads/products/final/${filename}`;

    await this.productsService.updateFinalEditedImage(productId, imagePath);

    return imagePath;
  }
}
