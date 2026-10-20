import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Types, Model, ClientSession } from 'mongoose';
import { CreateAuthSessionData } from '../types/auth/auth';
import {
  AuthSession,
  AuthSessionDocument,
} from './schemas/auth-session.schema';

@Injectable()
export class AuthSessionsService {
  constructor(
    @InjectModel(AuthSession.name)
    private readonly authSessionModel: Model<AuthSessionDocument>,
  ) {}

  async create(data: CreateAuthSessionData): Promise<AuthSessionDocument> {
    const session = new this.authSessionModel({
      memberId: new Types.ObjectId(data.memberId),
      tokenHash: data.tokenHash,
      expiresAt: data.expiresAt,
      userAgent: data.userAgent,
      ipAddress: data.ipAddress,
    });

    return session.save();
  }

  async findByTokenHash(
    tokenHash: string,
  ): Promise<AuthSessionDocument | null> {
    return this.authSessionModel.findOne({ tokenHash }).exec();
  }

  async revoke(
    session: AuthSessionDocument,
    replacedBySessionId?: string,
  ): Promise<void> {
    session.revokedAt = new Date();

    if (replacedBySessionId) {
      session.replacedBySessionId = new Types.ObjectId(replacedBySessionId);
    }

    await session.save();
  }

  async revokeAllByMemberId(
    memberId: string,
    session?: ClientSession,
  ): Promise<void> {
    await this.authSessionModel.updateMany(
      {
        memberId: new Types.ObjectId(memberId),
        revokedAt: null,
      },
      {
        $set: {
          revokedAt: new Date(),
        },
      },
      {
        session,
      },
    );
  }
}
