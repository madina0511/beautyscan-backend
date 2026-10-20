import { UnauthorizedException } from '@nestjs/common';
import { Request } from 'express';
import { Types } from 'mongoose';

export function authenticatedMemberId(request: Request): string {
  const user: unknown = request.user;
  if (
    typeof user !== 'object' ||
    user === null ||
    !('_id' in user) ||
    !(user._id instanceof Types.ObjectId)
  ) {
    throw new UnauthorizedException();
  }
  return user._id.toHexString();
}
