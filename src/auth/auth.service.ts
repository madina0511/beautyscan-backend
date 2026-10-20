import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  UnauthorizedException,
  Injectable,
  Logger,
} from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { InjectConnection } from '@nestjs/mongoose';
import { Connection } from 'mongoose';
import { LoginInput } from './dto/login.input';
import { MembersService } from '../members/members.service';
import { MemberDocument, MemberStatus } from '../members/schemas/member.schema';
import { CreateMemberData } from '../types/members/member';
import { SignupDto } from './dto/signup.dto';

import { JwtService } from '@nestjs/jwt';
import {
  JwtPayload,
  LoginResponse,
  AuthMemberResponse,
  RefreshResponse,
} from '../types/auth/auth';
import { PasswordResetTokensService } from './password-reset-tokens.service';
import { ForgotPasswordInput } from './dto/forgot-password.input';
import { ForgotPasswordOutput } from './dto/forgot-password.output';
import { ResetPasswordInput } from './dto/reset-password.input';
import { createHash, randomBytes } from 'crypto';
import { AuthSessionsService } from './auth-sessions.service';
import { ConfigService } from '@nestjs/config';
import { parseTokenExpiryToMilliseconds } from './utils/token-expiry.util';
import { EmailService } from '../email/email.service';

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    @InjectConnection()
    private readonly connection: Connection,
    private readonly membersService: MembersService,
    private readonly jwtService: JwtService,
    private readonly authSessionsService: AuthSessionsService,
    private readonly configService: ConfigService,
    private readonly passwordResetTokensService: PasswordResetTokensService,
    private readonly emailService: EmailService,
  ) {}

  async signup(dto: SignupDto): Promise<AuthMemberResponse> {
    const { name, email, phone, password } = dto;

    if (!email && !phone) {
      throw new BadRequestException('Email or phone number is required');
    }

    if (email) {
      const existingMember = await this.membersService.findByEmail(email);

      if (existingMember) {
        throw new ConflictException('Email is already registered');
      }
    }

    if (phone) {
      const existingMember = await this.membersService.findByPhone(phone);

      if (existingMember) {
        throw new ConflictException('Phone number is already registered');
      }
    }

    const passwordHash = await bcrypt.hash(password, 12);

    const member = await this.createMember({
      name,
      email,
      phone,
      password: passwordHash,
    });

    this.logger.log(`New member registered: ${member._id.toString()}`);

    return this.toAuthMemberResponse(member);
  }

  async login(input: LoginInput): Promise<LoginResponse> {
    const { member, password } = input;

    const normalizedMember = member.trim();

    let existingMember: MemberDocument | null;

    if (normalizedMember.includes('@')) {
      existingMember = await this.membersService.findByEmail(normalizedMember);
    } else {
      existingMember = await this.membersService.findByPhone(normalizedMember);
    }

    if (!existingMember || !existingMember.password) {
      throw new UnauthorizedException('Invalid credentials');
    }

    if (existingMember.status === MemberStatus.BLOCKED) {
      throw new ForbiddenException('Account is blocked');
    }

    if (existingMember.status === MemberStatus.DELETED) {
      throw new ForbiddenException('Account is deleted');
    }

    const passwordMatches = await bcrypt.compare(
      password,
      existingMember.password,
    );

    if (!passwordMatches) {
      throw new UnauthorizedException('Invalid credentials');
    }

    this.logger.log(`Member logged in: ${existingMember._id.toString()}`);

    const accessToken = await this.generateAccessToken(existingMember);

    const refreshToken = await this.createRefreshSession(existingMember);

    return {
      member: this.toAuthMemberResponse(existingMember),
      accessToken,
      refreshToken,
    };
  }

  async refresh(refreshToken: string): Promise<RefreshResponse> {
    if (!refreshToken) {
      throw new UnauthorizedException('Refresh token is required');
    }

    const tokenHash = this.hashRefreshToken(refreshToken);

    const session = await this.authSessionsService.findByTokenHash(tokenHash);

    if (!session) {
      throw new UnauthorizedException('Invalid refresh token');
    }

    if (session.revokedAt) {
      await this.authSessionsService.revokeAllByMemberId(
        session.memberId.toString(),
      );

      this.logger.warn(
        `Refresh token reuse detected for member: ${session.memberId.toString()}`,
      );

      throw new UnauthorizedException('Invalid refresh token');
    }

    if (session.expiresAt.getTime() <= Date.now()) {
      throw new UnauthorizedException('Refresh token expired');
    }

    const member = await this.membersService.findById(
      session.memberId.toString(),
    );

    if (!member) {
      throw new UnauthorizedException('Invalid refresh token');
    }

    if (member.status !== MemberStatus.ACTIVE) {
      throw new UnauthorizedException('Account is not active');
    }
    const newAccessToken = await this.generateAccessToken(member);

    const newRefreshToken = this.generateRefreshToken();

    const newTokenHash = this.hashRefreshToken(newRefreshToken);

    const expiresAt = this.getRefreshTokenExpiresAt();

    const newSession = await this.authSessionsService.create({
      memberId: member._id.toString(),
      tokenHash: newTokenHash,
      expiresAt,
    });

    await this.authSessionsService.revoke(session, newSession._id.toString());

    return {
      accessToken: newAccessToken,
      refreshToken: newRefreshToken,
    };
  }

  async logout(refreshToken: string): Promise<void> {
    if (!refreshToken) {
      return;
    }

    const tokenHash = this.hashRefreshToken(refreshToken);

    const session = await this.authSessionsService.findByTokenHash(tokenHash);

    if (!session) {
      return;
    }

    if (session.revokedAt) {
      return;
    }

    await this.authSessionsService.revoke(session);

    this.logger.log(`Member logged out: ${session.memberId.toString()}`);
  }

  async forgotPassword(
    input: ForgotPasswordInput,
  ): Promise<ForgotPasswordOutput> {
    const message =
      'If the email is registered, a password reset link will be sent.';

    const email = input.email.trim().toLowerCase();

    this.logger.debug('Forgot password request received');

    try {
      const member = await this.membersService.findByEmail(email);

      if (!member || member.status !== MemberStatus.ACTIVE) {
        this.logger.debug('Forgot password request completed');
        return { message };
      }

      const memberId = member._id.toString();

      await this.passwordResetTokensService.invalidateAllByMemberId(memberId);

      this.logger.debug('Existing password reset tokens invalidated');

      const resetToken = await this.passwordResetTokensService.create(memberId);

      const frontendUrl = this.configService.get<string>('FRONTEND_URL');

      if (!frontendUrl) {
        throw new Error('FRONTEND_URL is not configured');
      }

      const resetUrl = new URL('/reset-password', frontendUrl);
      resetUrl.searchParams.set('token', resetToken);

      await this.emailService.sendPasswordResetEmail(
        email,
        resetUrl.toString(),
      );

      this.logger.debug('Password reset email dispatched');

      return { message };
    } catch (error: unknown) {
      this.logger.error(
        'Forgot password processing failed',
        error instanceof Error ? error.stack : undefined,
      );

      throw error;
    }
  }

  async resetPassword(input: ResetPasswordInput): Promise<boolean> {
    this.logger.debug('Password reset request received');

    if (Buffer.byteLength(input.newPassword, 'utf8') > 72) {
      throw new BadRequestException('Password must not exceed 72 bytes');
    }

    if (!/^[a-f0-9]{64}$/i.test(input.token)) {
      throw new BadRequestException('Invalid or expired reset token');
    }

    const passwordHash = await bcrypt.hash(input.newPassword, 12);

    const session = await this.connection.startSession();

    try {
      await session.withTransaction(async () => {
        const resetToken = await this.passwordResetTokensService.consumeToken(
          input.token,
          session,
        );

        if (!resetToken) {
          throw new BadRequestException('Invalid or expired reset token');
        }

        const memberId = resetToken.memberId.toString();

        const updated = await this.membersService.updatePassword(
          memberId,
          passwordHash,
          session,
        );

        if (!updated) {
          throw new BadRequestException('Unable to reset password');
        }

        await this.authSessionsService.revokeAllByMemberId(memberId, session);
      });

      this.logger.log('Password reset completed');

      return true;
    } catch (error: unknown) {
      this.logger.error(
        'Password reset failed',
        error instanceof Error ? error.stack : undefined,
      );

      throw error;
    } finally {
      await session.endSession();
    }
  }

  private async createMember(data: CreateMemberData): Promise<MemberDocument> {
    try {
      return await this.membersService.create(data);
    } catch (error: unknown) {
      if (
        typeof error === 'object' &&
        error !== null &&
        'code' in error &&
        error.code === 11000
      ) {
        throw new ConflictException(
          'Email or phone number is already registered',
        );
      }

      this.logger.error(
        'Failed to create member',
        error instanceof Error ? error.stack : undefined,
      );

      throw error;
    }
  }

  private toAuthMemberResponse(member: MemberDocument): AuthMemberResponse {
    return {
      id: member._id.toString(),
      name: member.name,
      email: member.email,
      phone: member.phone,
      profileImage: member.profileImage,
      role: member.role,
      status: member.status,
      plan: member.plan,
      credits: member.credits,
      isEmailVerified: member.isEmailVerified,
      isPhoneVerified: member.isPhoneVerified,
    };
  }
  private async generateAccessToken(member: MemberDocument): Promise<string> {
    const payload: JwtPayload = {
      sub: member._id.toString(),
    };

    return this.jwtService.signAsync(payload);
  }
  private generateRefreshToken(): string {
    return randomBytes(64).toString('base64url');
  }

  private async createRefreshSession(member: MemberDocument): Promise<string> {
    const refreshToken = this.generateRefreshToken();

    const tokenHash = this.hashRefreshToken(refreshToken);

    const expiresAt = this.getRefreshTokenExpiresAt();

    await this.authSessionsService.create({
      memberId: member._id.toString(),
      tokenHash,
      expiresAt,
    });

    return refreshToken;
  }

  private hashRefreshToken(refreshToken: string): string {
    return createHash('sha256').update(refreshToken).digest('hex');
  }

  private getRefreshTokenExpiresAt(): Date {
    const expiresIn = this.configService.get<string>('JWT_REFRESH_EXPIRES_IN');

    if (!expiresIn) {
      throw new Error('JWT_REFRESH_EXPIRES_IN is not configured');
    }

    const milliseconds = parseTokenExpiryToMilliseconds(expiresIn);

    return new Date(Date.now() + milliseconds);
  }
}
