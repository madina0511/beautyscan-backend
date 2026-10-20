import { Module } from '@nestjs/common';
import { ImageNormalizationService } from './image-normalization.service';

@Module({
  providers: [ImageNormalizationService],
  exports: [ImageNormalizationService],
})
export class ImageNormalizationModule {}
