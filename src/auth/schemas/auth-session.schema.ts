import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export type AuthSessionDocument = HydratedDocument<AuthSession>;

@Schema({
  timestamps: true,
  collection: 'auth_sessions',
})
export class AuthSession {
  @Prop({
    type: Types.ObjectId,
    required: true,
    index: true,
  })
  memberId: Types.ObjectId;

  @Prop({
    required: true,
    unique: true,
    index: true,
  })
  tokenHash: string;

  @Prop({
    required: true,
  })
  expiresAt: Date;

  @Prop({
    default: null,
  })
  revokedAt?: Date | null;

  @Prop({
    type: Types.ObjectId,
    default: null,
  })
  replacedBySessionId?: Types.ObjectId | null;

  @Prop({
    trim: true,
  })
  userAgent?: string;

  @Prop({
    trim: true,
  })
  ipAddress?: string;
}

export const AuthSessionSchema = SchemaFactory.createForClass(AuthSession);
AuthSessionSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
