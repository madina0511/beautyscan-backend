import {
  MemberRole,
  MemberStatus,
  MemberPlan,
} from '../../members/schemas/member.schema';

export interface AuthMemberResponse {
  id: string;
  name: string;
  email?: string;
  phone?: string;
  profileImage?: string;

  role: MemberRole;
  status: MemberStatus;
  plan: MemberPlan;
  credits: number;

  isEmailVerified: boolean;
  isPhoneVerified: boolean;
}

export interface JwtPayload {
  sub: string;
}

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
}

export interface LoginResponse {
  member: AuthMemberResponse;
  accessToken: string;
  refreshToken: string;
}

export interface CreateAuthSessionData {
  memberId: string;
  tokenHash: string;
  expiresAt: Date;
  userAgent?: string;
  ipAddress?: string;
}

export interface RefreshResponse {
  accessToken: string;
  refreshToken: string;
}
