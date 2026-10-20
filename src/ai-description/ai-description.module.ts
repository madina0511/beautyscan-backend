import { Module } from '@nestjs/common';
import { AiDescriptionService } from './ai-description.service';

@Module({
  providers: [AiDescriptionService],
  exports: [AiDescriptionService],
})
export class AiDescriptionModule {}
