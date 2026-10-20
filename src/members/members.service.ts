import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, ClientSession, Types } from 'mongoose';
import { CreateMemberData } from '../types/members/member';
import { Member, MemberDocument, MemberStatus } from './schemas/member.schema';

@Injectable()
export class MembersService {
  constructor(
    @InjectModel(Member.name)
    private readonly memberModel: Model<MemberDocument>,
  ) {}

  async create(data: CreateMemberData): Promise<MemberDocument> {
    const member = new this.memberModel({
      name: data.name.trim(),
      email: data.email?.toLowerCase().trim(),
      phone: data.phone?.trim(),
      password: data.password,
    });

    return member.save();
  }

  async findByEmail(email: string): Promise<MemberDocument | null> {
    return this.memberModel
      .findOne({
        email: email.toLowerCase().trim(),
      })
      .exec();
  }

  async findByPhone(phone: string): Promise<MemberDocument | null> {
    return this.memberModel
      .findOne({
        phone: phone.trim(),
      })
      .exec();
  }

  async findById(memberId: string): Promise<MemberDocument | null> {
    // findById()da noto‘g‘ri MongoDB ObjectId kelsa Mongoose CastError handling
    if (!Types.ObjectId.isValid(memberId)) {
      return null;
    }

    return this.memberModel.findById(memberId).exec();
  }

  async updatePassword(
    memberId: string,
    passwordHash: string,
    session: ClientSession,
  ): Promise<boolean> {
    const result = await this.memberModel.updateOne(
      {
        _id: new Types.ObjectId(memberId),
        status: MemberStatus.ACTIVE,
      },
      {
        $set: {
          password: passwordHash,
        },
      },
      { session },
    );

    return result.modifiedCount === 1;
  }
}
