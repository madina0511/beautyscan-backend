import { ExecutionContextHost } from '@nestjs/core/helpers/execution-context-host';
import { Request } from 'express';
import { JwtAuthGuard } from './jwt-auth.guard';

// No app bootstrap, database connection, or JWT secrets are needed to test
// transport extraction. Passport and the JWT strategy are not mocked or changed.
describe('JwtAuthGuard request extraction', () => {
  const guard = new JwtAuthGuard();

  it('returns the original REST HTTP request', () => {
    const request = { headers: {} } as Request;
    const context = new ExecutionContextHost([request, {}]);
    context.setType('http');

    expect(guard.getRequest(context)).toBe(request);
  });

  it('returns the HTTP request inside the GraphQL context', () => {
    const request = { headers: {} } as Request;
    const context = new ExecutionContextHost([
      undefined,
      {},
      { req: request, res: {} },
      undefined,
    ]);
    context.setType('graphql');

    expect(guard.getRequest(context)).toBe(request);
  });
});
