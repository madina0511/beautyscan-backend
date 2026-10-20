import { UseGuards } from '@nestjs/common';
import { Request } from 'express';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { authenticatedMemberId } from '../products/product-request.util';
import { Args, Context, Mutation, Resolver } from '@nestjs/graphql';
import { ProductImageService } from './product-image.service';
import { ProcessImageInput } from './dto/process-image.input';
import { ProcessImageOutput } from './dto/process-image.output';

@Resolver()
export class ProductImageResolver {
  constructor(private readonly productImageService: ProductImageService) {}

  @UseGuards(JwtAuthGuard)
  @Mutation(() => ProcessImageOutput)
  async removeBackground(
    @Args('input') input: ProcessImageInput,
    @Context('req') request: Request,
  ): Promise<ProcessImageOutput> {
    return this.productImageService.removeBackground(
      input,
      authenticatedMemberId(request),
    );
  }
}
