import { IsMongoId, IsNotEmpty, IsString } from 'class-validator';
import { Field, InputType } from '@nestjs/graphql';

@InputType()
export class ProcessImageInput {
  @Field()
  @IsString()
  @IsNotEmpty()
  image: string;

  @Field()
  @IsMongoId()
  productId: string;
}
