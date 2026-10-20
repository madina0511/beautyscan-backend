import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { JwtStrategy } from './strategies/jwt.strategy';
import { MembersModule } from '../members/members.module';
import { AuthResolver } from './auth.resolver';
import { AuthService } from './auth.service';
import { AuthSessionsService } from './auth-sessions.service';
import {
  PasswordResetToken,
  PasswordResetTokenSchema,
} from './schemas/password-reset-token.schema';
import { AuthSession, AuthSessionSchema } from './schemas/auth-session.schema';
import { MongooseModule } from '@nestjs/mongoose';
import { PasswordResetTokensService } from './password-reset-tokens.service';
import { EmailModule } from '../email/email.module';

@Module({
  imports: [
    MembersModule,
    EmailModule,
    MongooseModule.forFeature([
      {
        name: AuthSession.name,
        schema: AuthSessionSchema,
      },
      {
        name: PasswordResetToken.name,
        schema: PasswordResetTokenSchema,
      },
    ]),
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],

      useFactory: (configService: ConfigService) => {
        const accessSecret = configService.get<string>('JWT_ACCESS_SECRET');

        if (!accessSecret) {
          throw new Error('JWT_ACCESS_SECRET is not configured');
        }

        if (Buffer.byteLength(accessSecret, 'utf8') < 32) {
          throw new Error('JWT_ACCESS_SECRET must be at least 32 bytes long');
        }

        return {
          secret: accessSecret,
          signOptions: {
            expiresIn: '15m',
          },
        };
      },
    }),
  ],

  providers: [
    AuthService,
    AuthResolver,
    JwtStrategy,
    AuthSessionsService,
    PasswordResetTokensService,
  ],

  exports: [AuthService, JwtModule],
})
export class AuthModule {}
