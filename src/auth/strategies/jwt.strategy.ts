import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { Types } from 'mongoose';
import {
  MemberDocument,
  MemberStatus,
} from '../../members/schemas/member.schema';
import { MembersService } from '../../members/members.service';
import { JwtPayload } from '../../types/auth/auth';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy, 'jwt') {
  constructor(
    configService: ConfigService,
    private readonly membersService: MembersService,
  ) {
    const accessSecret = configService.get<string>('JWT_ACCESS_SECRET');

    if (!accessSecret) {
      throw new Error('JWT_ACCESS_SECRET is not configured');
    }
    if (Buffer.byteLength(accessSecret, 'utf8') < 32) {
      throw new Error('JWT_ACCESS_SECRET must be at least 32 bytes long');
    }

    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),

      ignoreExpiration: false,

      secretOrKey: accessSecret,

      algorithms: ['HS256'],
    });
  }

  async validate(payload: JwtPayload): Promise<MemberDocument> {
    if (
      typeof payload?.sub !== 'string' ||
      !/^[a-fA-F0-9]{24}$/.test(payload.sub) ||
      !Types.ObjectId.isValid(payload.sub)
    ) {
      throw new UnauthorizedException('Invalid authentication token');
    }

    const member = await this.membersService.findById(payload.sub);

    if (!member) {
      throw new UnauthorizedException('Invalid authentication token');
    }

    if (member.status !== MemberStatus.ACTIVE) {
      throw new UnauthorizedException('Account is not active');
    }

    return member;
  }
}
