import { ImageNormalizationModule } from './image-normalization.module';
import { Module } from '@nestjs/common';
import { ProductImageService } from './product-image.service';
import { ProductImageResolver } from './product-image.resolver';
import { ProductImageController } from './product-image.controller';
import { ProductsModule } from 'src/products/products.module';
import { HttpModule } from '@nestjs/axios';
import { ProviderAdmissionModule } from './provider-admission.module';
import { MongooseModule } from '@nestjs/mongoose';
import {
  GuestPreview,
  GuestPreviewSchema,
  GuestRequestLimit,
  GuestRequestLimitSchema,
} from './guest-preview.schema';
import { GuestPreviewService } from './guest-preview.service';
import { GuestPreviewStorage } from './guest-preview.storage';
import { GuestClaimController } from './guest-claim.controller';
import { GuestClaimService } from './guest-claim.service';
import {
  GuestPreviewController,
  GuestUploadGuard,
  GuestUploadLifecycle,
} from './guest-preview.controller';

@Module({
  imports: [
    ProductsModule,
    HttpModule,
    ImageNormalizationModule,
    ProviderAdmissionModule,
    MongooseModule.forFeature([
      { name: GuestPreview.name, schema: GuestPreviewSchema },
      { name: GuestRequestLimit.name, schema: GuestRequestLimitSchema },
    ]),
  ],
  providers: [
    ProductImageService,
    ProductImageResolver,
    GuestPreviewService,
    GuestPreviewStorage,
    GuestUploadGuard,
    GuestUploadLifecycle,
    GuestClaimService,
  ],
  controllers: [
    ProductImageController,
    GuestPreviewController,
    GuestClaimController,
  ],
})
export class ProductImageModule {}
