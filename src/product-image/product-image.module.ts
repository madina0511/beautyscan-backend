import { Module } from '@nestjs/common';
import { ProductImageService } from './product-image.service';
import { ProductImageResolver } from './product-image.resolver';
import { ProductImageController } from './product-image.controller';
import { ProductsModule } from 'src/products/products.module';
import { HttpModule } from '@nestjs/axios';

@Module({
  imports: [ProductsModule, HttpModule],
  providers: [ProductImageService, ProductImageResolver],
  controllers: [ProductImageController],
})
export class ProductImageModule {}
