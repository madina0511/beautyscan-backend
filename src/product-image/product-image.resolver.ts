import { Args, Mutation, Resolver } from '@nestjs/graphql';
import { ProductImageService } from './product-image.service';
import { ProcessImageInput } from './dto/process-image.input';
import { ProcessImageOutput } from './dto/process-image.output';

@Resolver()
export class ProductImageResolver {
  constructor(private readonly productImageService: ProductImageService) {}

  @Mutation(() => ProcessImageOutput)
  async removeBackground(
    @Args('input') input: ProcessImageInput,
  ): Promise<ProcessImageOutput> {
    return this.productImageService.removeBackground(input);
  }
}
