import { UnauthorizedException, UseGuards } from '@nestjs/common';
import { Args, Context, Mutation, Resolver, Query } from '@nestjs/graphql';
import { Request } from 'express';
import { Types } from 'mongoose';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { ProductsService } from './products.service';
import { Product } from './product.model';
import { ProductDocument } from './product.schema';

interface ProductRequest extends Request {
  user?: { _id: Types.ObjectId };
}

@Resolver(() => Product)
export class ProductsResolver {
  constructor(private readonly productsService: ProductsService) {}

  @UseGuards(JwtAuthGuard)
  @Mutation(() => Product)
  async createProduct(
    @Args('name') name: string,
    @Context('req') request: ProductRequest,
  ): Promise<ProductDocument> {
    return this.productsService.create(name, this.getMemberId(request));
  }

  @UseGuards(JwtAuthGuard)
  @Query(() => [Product])
  async myProducts(
    @Context('req') request: ProductRequest,
  ): Promise<ProductDocument[]> {
    return this.productsService.findByOwner(this.getMemberId(request));
  }

  private getMemberId(request: ProductRequest): string {
    if (!request.user?._id) {
      throw new UnauthorizedException();
    }

    return request.user._id.toString();
  }
}
