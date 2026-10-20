import {
  BadRequestException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, UpdateQuery } from 'mongoose';
import { Product, ProductDocument } from './product.schema';

@Injectable()
export class ProductsService {
  constructor(
    @InjectModel(Product.name)
    private readonly productModel: Model<ProductDocument>,
  ) {}

  private validateMemberId(memberId: string): void {
    if (typeof memberId !== 'string' || !/^[a-f0-9]{24}$/i.test(memberId)) {
      throw new UnauthorizedException();
    }
  }

  private ownershipFilter(
    productId: string,
    memberId: string,
  ): { _id: string; ownerId: string } {
    this.validateMemberId(memberId);
    if (typeof productId !== 'string' || !/^[a-f0-9]{24}$/i.test(productId)) {
      throw new BadRequestException('Invalid product ID');
    }
    return { _id: productId, ownerId: memberId };
  }

  async create(name: string, memberId: string): Promise<ProductDocument> {
    this.validateMemberId(memberId);
    return new this.productModel({ name, ownerId: memberId }).save();
  }

  async findByOwner(memberId: string): Promise<ProductDocument[]> {
    this.validateMemberId(memberId);
    return this.productModel
      .find({ ownerId: memberId })
      .sort({ createdAt: -1 })
      .exec();
  }

  async requireOwnedProduct(
    productId: string,
    memberId: string,
  ): Promise<ProductDocument> {
    const product = await this.productModel
      .findOne(this.ownershipFilter(productId, memberId))
      .exec();
    if (!product) throw new NotFoundException('Product not found');
    return product;
  }

  private async updateOwned(
    productId: string,
    memberId: string,
    update: UpdateQuery<ProductDocument>,
  ): Promise<ProductDocument> {
    const product = await this.productModel
      .findOneAndUpdate(this.ownershipFilter(productId, memberId), update, {
        new: true,
      })
      .exec();
    if (!product) throw new NotFoundException('Product not found');
    return product;
  }

  async updateOriginalImage(
    productId: string,
    memberId: string,
    imageUrl: string,
  ): Promise<ProductDocument> {
    return this.updateOwned(productId, memberId, {
      $set: { originalImage: imageUrl },
    });
  }

  async updateFinalEditedImage(
    productId: string,
    memberId: string,
    imageUrl: string,
  ): Promise<ProductDocument> {
    return this.updateOwned(productId, memberId, {
      $set: { finalEditedImage: imageUrl },
    });
  }

  async updateProcessedImages(
    productId: string,
    memberId: string,
    originalImage: string,
    finalEditedImage: string,
  ): Promise<ProductDocument> {
    return this.updateOwned(productId, memberId, {
      $set: { originalImage, finalEditedImage },
    });
  }

  async updateDescription(
    productId: string,
    memberId: string,
    language: 'uz' | 'en' | 'ru' | 'ko',
    description: string,
  ): Promise<ProductDocument> {
    return this.updateOwned(productId, memberId, {
      $set: { [`descriptions.${language}`]: description },
    });
  }
}
