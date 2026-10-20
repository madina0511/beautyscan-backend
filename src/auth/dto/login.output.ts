import { Field, ObjectType } from '@nestjs/graphql';
import { SignupOutput } from './signup.output';

@ObjectType()
export class LoginOutput {
  @Field(() => SignupOutput)
  member: SignupOutput;

  @Field()
  accessToken: string;
}
