import { Args, Mutation, Resolver } from '@nestjs/graphql';
import { UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { GqlThrottlerGuard } from './guards/gql-throttler.guard';
import { LoginInput } from './dto/login.input';
import { LoginOutput } from './dto/login.output';
import { AuthService } from './auth.service';
import { SignupDto } from './dto/signup.dto';
import { SignupOutput } from './dto/signup.output';
import { Context } from '@nestjs/graphql';
import { Response, Request } from 'express';
import { ConfigService } from '@nestjs/config';
import { parseTokenExpiryToMilliseconds } from './utils/token-expiry.util';
import { RefreshOutput } from './dto/refresh.output';
import { UnauthorizedException } from '@nestjs/common';
import { LogoutOutput } from './dto/logout.output';
import { ForgotPasswordInput } from './dto/forgot-password.input';
import { ForgotPasswordOutput } from './dto/forgot-password.output';
import { ResetPasswordInput } from './dto/reset-password.input';
import { ResetPasswordOutput } from './dto/reset-password.output';

@Resolver()
export class AuthResolver {
  constructor(
    private readonly authService: AuthService,
    private readonly configService: ConfigService,
  ) {}

  @UseGuards(GqlThrottlerGuard)
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Mutation(() => LoginOutput)
  async login(
    @Args('input') input: LoginInput,
    @Context('res') response: Response,
  ): Promise<LoginOutput> {
    const { member, accessToken, refreshToken } =
      await this.authService.login(input);

    const refreshExpiresIn = this.configService.get<string>(
      'JWT_REFRESH_EXPIRES_IN',
    );

    if (!refreshExpiresIn) {
      throw new Error('JWT_REFRESH_EXPIRES_IN is not configured');
    }

    const refreshMaxAge = parseTokenExpiryToMilliseconds(refreshExpiresIn);

    response.cookie('refreshToken', refreshToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      path: '/graphql',
      maxAge: refreshMaxAge,
    });
    //console.log('SET-COOKIE:', response.getHeader('Set-Cookie'));

    return {
      member,
      accessToken,
    };
  }

  @UseGuards(GqlThrottlerGuard)
  @Throttle({
    default: {
      limit: 3,
      ttl: 3_600_000,
    },
  })
  @Mutation(() => SignupOutput)
  async signup(@Args('input') input: SignupDto): Promise<SignupOutput> {
    return this.authService.signup(input);
  }

  @Mutation(() => RefreshOutput)
  async refresh(
    @Context('req') request: Request,
    @Context('res') response: Response,
  ): Promise<RefreshOutput> {
    const refreshToken = request.cookies?.refreshToken;

    if (!refreshToken) {
      throw new UnauthorizedException('Invalid refresh token');
    }

    const { accessToken, refreshToken: newRefreshToken } =
      await this.authService.refresh(refreshToken);

    const refreshExpiresIn = this.configService.get<string>(
      'JWT_REFRESH_EXPIRES_IN',
    );

    if (!refreshExpiresIn) {
      throw new Error('JWT_REFRESH_EXPIRES_IN is not configured');
    }

    const refreshMaxAge = parseTokenExpiryToMilliseconds(refreshExpiresIn);

    response.cookie('refreshToken', newRefreshToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      path: '/graphql',
      maxAge: refreshMaxAge,
    });

    return {
      accessToken,
    };
  }

  @Mutation(() => LogoutOutput)
  async logout(
    @Context('req') request: Request,
    @Context('res') response: Response,
  ): Promise<LogoutOutput> {
    const refreshToken = request.cookies?.refreshToken;

    if (refreshToken) {
      await this.authService.logout(refreshToken);
    }

    response.clearCookie('refreshToken', {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      path: '/graphql',
    });

    return {
      success: true,
    };
  }

  @UseGuards(GqlThrottlerGuard)
  @Throttle({
    default: {
      limit: 5,
      ttl: 900_000,
    },
  })
  @Mutation(() => ForgotPasswordOutput)
  async forgotPassword(
    @Args('input') input: ForgotPasswordInput,
  ): Promise<ForgotPasswordOutput> {
    return this.authService.forgotPassword(input);
  }

  @UseGuards(GqlThrottlerGuard)
  @Throttle({
    default: {
      limit: 10,
      ttl: 900_000,
    },
  })
  @Mutation(() => ResetPasswordOutput)
  async resetPassword(
    @Args('input') input: ResetPasswordInput,
  ): Promise<ResetPasswordOutput> {
    const success = await this.authService.resetPassword(input);

    return { success };
  }
}
