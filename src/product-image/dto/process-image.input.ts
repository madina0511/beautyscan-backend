import { Field, InputType } from '@nestjs/graphql';

@InputType()
export class ProcessImageInput {
  @Field()
  image: string;

  @Field()
  productId: string;
}
