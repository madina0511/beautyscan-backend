import { Request } from 'express';
import express from 'express';
import { Reflector } from '@nestjs/core';
import { ExecutionContextHost } from '@nestjs/core/helpers/execution-context-host';
import { ThrottlerException, ThrottlerStorageService } from '@nestjs/throttler';
import { AuthResolver } from '../auth.resolver';
import { GqlThrottlerGuard } from './gql-throttler.guard';

// Exercise the real resolver metadata, GraphQL guard, Express IP policy, and
// in-memory storage without starting AppModule or connecting to providers/DB.
describe('GraphQL auth throttling behind the Docker bridge', () => {
  let storage: ThrottlerStorageService;
  let guard: GqlThrottlerGuard;

  beforeEach(async () => {
    jest.useFakeTimers();
    storage = new ThrottlerStorageService();
    guard = new GqlThrottlerGuard(
      [{ ttl: 60_000, limit: 60 }],
      storage,
      new Reflector(),
    );
    await guard.onModuleInit();
  });

  afterEach(() => {
    storage.onApplicationShutdown();
    jest.useRealTimers();
  });

  function request(peer = '172.21.0.1', forwardedFor?: string): Request {
    const app = express();
    app.set('trust proxy', 'loopback');
    return Object.create(express.request, {
      app: { value: app },
      socket: { value: { remoteAddress: peer } },
      connection: { value: { remoteAddress: peer } },
      headers: {
        value: forwardedFor ? { 'x-forwarded-for': forwardedFor } : {},
      },
    }) as Request;
  }

  function context(
    req: Request,
    method: 'signup' | 'login' = 'signup',
  ): ExecutionContextHost {
    const ctx = new ExecutionContextHost(
      [undefined, {}, { req, res: { header: jest.fn() } }, undefined],
      AuthResolver,
      AuthResolver.prototype[method],
    );
    ctx.setType('graphql');
    return ctx;
  }

  async function exhaustSignup(req: Request): Promise<void> {
    for (let attempt = 0; attempt < 3; attempt++) {
      await expect(guard.canActivate(context(req))).resolves.toBe(true);
    }
  }

  it('allows three signup attempts and blocks the fourth for one hour', async () => {
    const req = request();
    const increment = jest.spyOn(storage, 'increment');
    await exhaustSignup(req);
    await expect(guard.canActivate(context(req))).rejects.toBeInstanceOf(
      ThrottlerException,
    );
    expect(increment).toHaveBeenLastCalledWith(
      expect.any(String),
      3_600_000,
      3,
      3_600_000,
      'default',
    );
    jest.advanceTimersByTime(3_600_001);
    await expect(guard.canActivate(context(req))).resolves.toBe(true);
  });

  it('counts guarded attempts even when downstream signup never succeeds', async () => {
    const req = request();
    const downstreamSignup = jest.fn().mockRejectedValue(new Error('Rejected'));
    for (let attempt = 0; attempt < 3; attempt++) {
      await guard.canActivate(context(req));
      await expect(downstreamSignup()).rejects.toThrow('Rejected');
    }
    await expect(guard.canActivate(context(req))).rejects.toBeInstanceOf(
      ThrottlerException,
    );
    expect(downstreamSignup).toHaveBeenCalledTimes(3);
  });

  it('shares the bucket across browser requests with the same Docker peer IP', async () => {
    await exhaustSignup(request());
    await expect(guard.canActivate(context(request()))).rejects.toBeInstanceOf(
      ThrottlerException,
    );
  });

  it('keeps different peer IPs and login in independent buckets', async () => {
    const req = request();
    await exhaustSignup(req);
    await expect(
      guard.canActivate(context(request('172.21.0.2'))),
    ).resolves.toBe(true);
    for (let attempt = 0; attempt < 5; attempt++) {
      await expect(guard.canActivate(context(req, 'login'))).resolves.toBe(
        true,
      );
    }
    await expect(
      guard.canActivate(context(req, 'login')),
    ).rejects.toBeInstanceOf(ThrottlerException);
  });

  it('does not let spoofed forwarding headers bypass a Docker peer limit', async () => {
    await exhaustSignup(request());
    const spoofed = request('172.21.0.1', '203.0.113.42');
    expect(spoofed.ip).toBe('172.21.0.1');
    await expect(guard.canActivate(context(spoofed))).rejects.toBeInstanceOf(
      ThrottlerException,
    );
  });

  it('uses the forwarded client IP only for an already trusted loopback proxy', () => {
    expect(request('127.0.0.1', '203.0.113.42').ip).toBe('203.0.113.42');
  });
});
