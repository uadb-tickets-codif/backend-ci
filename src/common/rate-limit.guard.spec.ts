import { HttpException, type ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { describe, expect, it, vi } from 'vitest';
import { RATE_LIMIT_KEY, RateLimitGuard } from './rate-limit.guard';

class DummyController {
  handler() {}
}

function contextFor(request: Record<string, unknown>): ExecutionContext {
  return {
    getHandler: () => DummyController.prototype.handler,
    getClass: () => DummyController,
    switchToHttp: () => ({ getRequest: () => request }),
  } as unknown as ExecutionContext;
}

function guardWith(options: unknown) {
  const reflector = new Reflector();
  vi.spyOn(reflector, 'get').mockImplementation((key) =>
    key === RATE_LIMIT_KEY ? options : undefined,
  );
  return new RateLimitGuard(reflector);
}

describe('RateLimitGuard', () => {
  it('lets every request through when the route has no limit', () => {
    const guard = guardWith(undefined);
    for (let i = 0; i < 50; i += 1) {
      expect(guard.canActivate(contextFor({ ip: '1.1.1.1' }))).toBe(true);
    }
  });

  it('blocks with a 429 once the limit is reached in the window', () => {
    const guard = guardWith({ limit: 3, windowMs: 60_000 });
    const context = contextFor({ ip: '1.1.1.1' });

    expect(guard.canActivate(context)).toBe(true);
    expect(guard.canActivate(context)).toBe(true);
    expect(guard.canActivate(context)).toBe(true);
    try {
      guard.canActivate(context);
      expect.unreachable('la 4e requête aurait dû être refusée');
    } catch (error) {
      expect(error).toBeInstanceOf(HttpException);
      expect((error as HttpException).getStatus()).toBe(429);
    }
  });

  it('counts each identifier separately, so one account cannot lock out another', () => {
    const guard = guardWith({
      limit: 1,
      windowMs: 60_000,
      identifierField: 'email',
    });
    const sameIp = '10.0.0.1';

    expect(guard.canActivate(contextFor({ ip: sameIp, body: { email: 'A@x.sn' } }))).toBe(true);
    expect(() =>
      guard.canActivate(contextFor({ ip: sameIp, body: { email: 'a@x.sn' } })),
    ).toThrow(HttpException);
    expect(guard.canActivate(contextFor({ ip: sameIp, body: { email: 'b@x.sn' } }))).toBe(true);
  });

  it('keys authenticated requests by user and forgets old attempts', () => {
    vi.useFakeTimers();
    try {
      const guard = guardWith({ limit: 1, windowMs: 1000 });
      const alice = contextFor({ ip: '10.0.0.1', user: { id: 'alice' } });
      const bob = contextFor({ ip: '10.0.0.1', user: { id: 'bob' } });

      expect(guard.canActivate(alice)).toBe(true);
      expect(guard.canActivate(bob)).toBe(true);
      expect(() => guard.canActivate(alice)).toThrow(HttpException);

      vi.advanceTimersByTime(1001);
      expect(guard.canActivate(alice)).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });
});
