import { Field, ObjectType } from '@nestjs/graphql';

@ObjectType()
export class ResetPasswordOutput {
  @Field()
  success: boolean;
}
