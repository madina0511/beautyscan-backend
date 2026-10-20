import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, ClientSession, Types } from 'mongoose';
import { randomBytes, createHash } from 'crypto';

import {
  PasswordResetToken,
  PasswordResetTokenDocument,
} from './schemas/password-reset-token.schema';

@Injectable()
export class PasswordResetTokensService {
  constructor(
    @InjectModel(PasswordResetToken.name)
    private readonly resetTokenModel: Model<PasswordResetTokenDocument>,
  ) {}

  async findByTokenHash(
    tokenHash: string,
  ): Promise<PasswordResetTokenDocument | null> {
    return this.resetTokenModel.findOne({ tokenHash }).exec();
  }

  async create(memberId: string): Promise<string> {
    const rawToken = randomBytes(32).toString('hex');

    const tokenHash = createHash('sha256').update(rawToken).digest('hex');

    const expiresAt = new Date(Date.now() + 15 * 60 * 1000);

    await this.resetTokenModel.create({
      memberId: new Types.ObjectId(memberId),
      tokenHash,
      expiresAt,
      usedAt: null,
    });

    return rawToken;
  }

  async invalidateAllByMemberId(memberId: string): Promise<void> {
    await this.resetTokenModel.updateMany(
      {
        memberId: new Types.ObjectId(memberId),
        usedAt: null,
      },
      {
        $set: {
          usedAt: new Date(),
        },
      },
    );
  }

  async consumeToken(
    rawToken: string,
    session: ClientSession,
  ): Promise<PasswordResetTokenDocument | null> {
    const tokenHash = createHash('sha256').update(rawToken).digest('hex');

    return this.resetTokenModel
      .findOneAndUpdate(
        {
          tokenHash,
          usedAt: null,
          expiresAt: { $gt: new Date() },
        },
        {
          $set: {
            usedAt: new Date(),
          },
        },
        {
          new: true,
          session,
        },
      )
      .exec();
  }
}
