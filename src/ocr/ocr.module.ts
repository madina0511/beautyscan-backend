import { Module } from '@nestjs/common';
import { OcrService } from './ocr.service';
import { OcrController } from './ocr.controller';
import { AiDescriptionModule } from '../ai-description/ai-description.module';
import { ProductsModule } from '../products/products.module';

@Module({
  imports: [AiDescriptionModule, ProductsModule],

  providers: [OcrService],
  controllers: [OcrController],
})
export class OcrModule {}
