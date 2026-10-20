import { Field, ObjectType } from '@nestjs/graphql';

@ObjectType()
export class ProcessImageOutput {
  @Field()
  image: string;

  @Field()
  message: string;
}
