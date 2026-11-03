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

  async findClaimedProduct(
    productId: string,
    memberId: string,
  ): Promise<ProductDocument | null> {
    return this.productModel
      .findOne(this.ownershipFilter(productId, memberId))
      .exec();
  }

  async createClaimedProduct(
    productId: string,
    memberId: string,
    originalImage: string,
    finalEditedImage: string,
  ): Promise<ProductDocument> {
    // The reserved _id is the idempotency key. Publish both media references in
    // one insert after their files are durable; retries never overwrite a product.
    const product = await this.productModel
      .findOneAndUpdate(
        this.ownershipFilter(productId, memberId),
        {
          $setOnInsert: {
            name: `Enhanced Product ${productId.slice(-6).toUpperCase()}`,
            ownerId: memberId,
            originalImage,
            finalEditedImage,
          },
        },
        {
          new: true,
          upsert: true,
          runValidators: true,
          setDefaultsOnInsert: true,
        },
      )
      .exec();
    if (!product) throw new NotFoundException('Product not found');
    return product;
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

  async updatePackagingDescription(
    productId: string,
    memberId: string,
    language: 'uz' | 'en' | 'ru' | 'ko',
    description: string,
    packageImage: string,
  ): Promise<ProductDocument> {
    if (!['uz', 'en', 'ru', 'ko'].includes(language)) {
      throw new BadRequestException('Language must be uz, en, ru, or ko');
    }
    return this.updateOwned(productId, memberId, {
      $set: { packageImage, [`descriptions.${language}`]: description },
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
