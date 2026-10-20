import { Field, ObjectType } from '@nestjs/graphql';

@ObjectType()
export class ForgotPasswordOutput {
  @Field()
  message: string;
}
