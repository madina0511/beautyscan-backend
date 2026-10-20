import { Field, ID, ObjectType } from '@nestjs/graphql';

@ObjectType()
export class ProductDescriptions {
  @Field({ nullable: true })
  uz?: string;

  @Field({ nullable: true })
  en?: string;

  @Field({ nullable: true })
  ru?: string;

  @Field({ nullable: true })
  ko?: string;
}

@ObjectType()
export class Product {
  @Field(() => ID)
  _id: string;

  @Field()
  name: string;

  @Field()
  ownerId: string;

  @Field({ nullable: true })
  originalImage?: string;

  @Field({ nullable: true })
  finalEditedImage?: string;

  @Field({ nullable: true })
  packageImage?: string;

  @Field(() => ProductDescriptions, { nullable: true })
  descriptions?: ProductDescriptions;

  @Field()
  createdAt: Date;

  @Field()
  updatedAt: Date;
}
