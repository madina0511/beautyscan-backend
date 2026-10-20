import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export type MemberDocument = HydratedDocument<Member>;

export enum MemberRole {
  USER = 'USER',
  ADMIN = 'ADMIN',
}

export enum MemberStatus {
  ACTIVE = 'ACTIVE',
  BLOCKED = 'BLOCKED',
  DELETED = 'DELETED',
}

export enum MemberPlan {
  FREE = 'FREE',
  PAID = 'PAID',
}

@Schema({
  timestamps: true,
})
export class Member {
  @Prop({
    required: true,
    trim: true,
  })
  name: string;

  @Prop({
    unique: true,
    sparse: true,
    lowercase: true,
    trim: true,
  })
  email?: string;

  @Prop({
    unique: true,
    sparse: true,
    trim: true,
  })
  phone?: string;

  @Prop()
  password?: string;

  @Prop({
    unique: true,
    sparse: true,
  })
  googleId?: string;

  @Prop({
    unique: true,
    sparse: true,
  })
  telegramId?: string;

  @Prop()
  telegramUsername?: string;

  @Prop()
  profileImage?: string;

  @Prop({
    enum: MemberRole,
    default: MemberRole.USER,
  })
  role: MemberRole;

  @Prop({
    enum: MemberStatus,
    default: MemberStatus.ACTIVE,
  })
  status: MemberStatus;

  @Prop({
    enum: MemberPlan,
    default: MemberPlan.FREE,
  })
  plan: MemberPlan;

  @Prop({
    default: 0,
    min: 0,
  })
  credits: number;

  @Prop({
    default: false,
  })
  isEmailVerified: boolean;

  @Prop({
    default: false,
  })
  isPhoneVerified: boolean;

  @Prop()
  passwordResetToken?: string;

  @Prop()
  passwordResetExpires?: Date;

  @Prop()
  deletedAt?: Date;
}

export const MemberSchema = SchemaFactory.createForClass(Member);
