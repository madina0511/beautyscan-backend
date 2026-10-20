import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';

import { Product, ProductDocument } from './product.schema';

@Injectable()
export class ProductsService {
  constructor(
    @InjectModel(Product.name)
    private readonly productModel: Model<ProductDocument>,
  ) {}

  async create(name: string, ownerId: string): Promise<ProductDocument> {
    const product = new this.productModel({
      name,
      ownerId,
    });

    return product.save();
  }

  async findByOwner(ownerId: string): Promise<ProductDocument[]> {
    return this.productModel.find({ ownerId }).sort({ createdAt: -1 }).exec();
  }

  async updateOriginalImage(
    productId: string,
    imageUrl: string,
  ): Promise<ProductDocument | null> {
    return this.productModel
      .findByIdAndUpdate(productId, { originalImage: imageUrl }, { new: true })
      .exec();
  }

  async updateFinalEditedImage(
    productId: string,
    imageUrl: string,
  ): Promise<ProductDocument | null> {
    return this.productModel
      .findByIdAndUpdate(
        productId,
        { finalEditedImage: imageUrl },
        { new: true },
      )
      .exec();
  }
  async updateDescription(
    productId: string,
    language: 'uz' | 'en' | 'ru' | 'ko',
    description: string,
  ) {
    return this.productModel
      .findByIdAndUpdate(
        productId,
        {
          $set: {
            [`descriptions.${language}`]: description,
          },
        },
        { new: true },
      )
      .exec();
  }
}
