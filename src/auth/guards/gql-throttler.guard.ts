import { ExecutionContext, Injectable } from '@nestjs/common';
import { GqlExecutionContext } from '@nestjs/graphql';
import { ThrottlerGuard } from '@nestjs/throttler';

@Injectable()
export class GqlThrottlerGuard extends ThrottlerGuard {
  getRequestResponse(context: ExecutionContext) {
    const gqlContext = GqlExecutionContext.create(context);
    const { req, res } = gqlContext.getContext();

    if (!req || !res) {
      throw new Error('GraphQL request context is missing');
    }
    return {
      req,
      res,
    };
  }
}
