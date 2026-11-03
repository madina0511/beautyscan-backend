import { UnauthorizedException, UseGuards } from '@nestjs/common';
import { Context, Query, Resolver } from '@nestjs/graphql';
import { Request } from 'express';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { MemberDocument, MemberStatus } from './schemas/member.schema';
import { MemberProfile } from './dto/member-profile.output';

interface MemberRequest extends Request {
  user?: MemberDocument;
}

@Resolver()
export class MembersResolver {
  @UseGuards(JwtAuthGuard)
  @Query(() => MemberProfile)
  me(@Context('req') request: MemberRequest): MemberProfile {
    // JwtStrategy loads this member from the database and validates ACTIVE status.
    const member = request.user;
    if (!member?._id || member.status !== MemberStatus.ACTIVE) {
      throw new UnauthorizedException();
    }

    // Explicit projection: never return or spread the full Mongoose document.
    return {
      id: member._id.toString(),
      name: member.name,
      email: member.email,
      phone: member.phone,
      isEmailVerified: member.isEmailVerified,
      isPhoneVerified: member.isPhoneVerified,
    };
  }
}
