import { Args, Mutation, Resolver, Query } from '@nestjs/graphql';

import { ProductsService } from './products.service';
import { Product } from './product.model';

@Resolver(() => Product)
export class ProductsResolver {
  constructor(private readonly productsService: ProductsService) {}

  @Mutation(() => Product)
  async createProduct(
    @Args('name') name: string,
    @Args('ownerId') ownerId: string,
  ) {
    return this.productsService.create(name, ownerId);
  }

  @Query(() => [Product])
  async myProducts(@Args('ownerId') ownerId: string) {
    return this.productsService.findByOwner(ownerId);
  }
}
