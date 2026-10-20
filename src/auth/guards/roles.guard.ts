import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { GqlExecutionContext } from '@nestjs/graphql';

import {
  MemberDocument,
  MemberRole,
} from '../../members/schemas/member.schema';
import { ROLES_KEY } from '../decorators/roles.decorator';

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const requiredRoles = this.reflector.getAllAndOverride<MemberRole[]>(
      ROLES_KEY,
      [context.getHandler(), context.getClass()],
    );

    if (!requiredRoles?.length) {
      return true;
    }

    const gqlContext = GqlExecutionContext.create(context);

    const request = gqlContext.getContext().req;

    const member = request.user as MemberDocument | undefined;

    if (!member) {
      return false;
    }

    return requiredRoles.includes(member.role);
  }
}
