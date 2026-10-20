import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export type ProductDocument = HydratedDocument<Product>;

@Schema({ timestamps: true })
export class Product {
  @Prop({ required: true, trim: true })
  name: string;

  @Prop({ required: true, index: true })
  ownerId: string;

  @Prop()
  originalImage?: string;

  @Prop()
  packageImage?: string;

  @Prop()
  finalEditedImage?: string;

  @Prop({
    type: {
      uz: String,
      en: String,
      ru: String,
      ko: String,
    },
    default: {},
  })
  descriptions?: {
    uz?: string;
    en?: string;
    ru?: string;
    ko?: string;
  };
}

export const ProductSchema = SchemaFactory.createForClass(Product);
