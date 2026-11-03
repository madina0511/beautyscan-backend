import { Field, ID, ObjectType } from '@nestjs/graphql';

@ObjectType()
export class MemberProfile {
  @Field(() => ID)
  id: string;

  @Field()
  name: string;

  @Field({ nullable: true })
  email?: string;

  @Field({ nullable: true })
  phone?: string;

  @Field()
  isEmailVerified: boolean;

  @Field()
  isPhoneVerified: boolean;
}
