import { Field, ObjectType } from '@nestjs/graphql';
import {
  MemberPlan,
  MemberRole,
  MemberStatus,
} from '../../members/schemas/member.schema';

@ObjectType()
export class SignupOutput {
  @Field()
  id: string;

  @Field()
  name: string;

  @Field({ nullable: true })
  email?: string;

  @Field({ nullable: true })
  phone?: string;

  @Field({ nullable: true })
  profileImage?: string;

  @Field(() => String)
  role: MemberRole;

  @Field(() => String)
  status: MemberStatus;

  @Field(() => String)
  plan: MemberPlan;

  @Field()
  credits: number;

  @Field()
  isEmailVerified: boolean;

  @Field()
  isPhoneVerified: boolean;
}
