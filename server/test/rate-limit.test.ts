import { afterEach, describe, expect, it } from "vitest";
import type { Request, Response } from "express";
import { createRateLimiter } from "../src/rate-limit.js";

function makeReq(ip: string): Request {
  return { ip } as unknown as Request;
}

function makeRes(): Response & { statusCode: number; headers: Record<string, string>; body?: unknown } {
  const res = {
    body: undefined as unknown,
    headers: {} as Record<string, string>,
    set(name: string, value: string) {
      this.headers[name] = value;
      return this;
    },
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    json(payload: unknown) {
      this.body = payload;
      return this;
    },
    statusCode: 0
  };

  return res as unknown as Response & { statusCode: number; headers: Record<string, string>; body?: unknown };
}

afterEach(() => {
  // Limiter instances are per-call; nothing global to reset.
});

describe("createRateLimiter", () => {
  it("allows requests under the limit", () => {
    const middleware = createRateLimiter({ limit: 3, windowMs: 60_000 });
    let passed = 0;

    for (let index = 0; index < 3; index += 1) {
      const res = makeRes();
      middleware(makeReq("1.2.3.4"), res as unknown as Response, () => passed++);
      expect(res.statusCode).toBe(0);
    }

    expect(passed).toBe(3);
  });

  it("returns 429 with retry-after once the limit is exceeded", () => {
    const middleware = createRateLimiter({ limit: 2, windowMs: 60_000 });

    middleware(makeReq("1.2.3.4"), makeRes() as unknown as Response, () => {});
    middleware(makeReq("1.2.3.4"), makeRes() as unknown as Response, () => {});

    const blocked = makeRes();
    let nextCalled = false;
    middleware(makeReq("1.2.3.4"), blocked as unknown as Response, () => nextCalled++);

    expect(nextCalled).toBe(false);
    expect(blocked.statusCode).toBe(429);
    expect(Number(blocked.headers["retry-after"])).toBeGreaterThan(0);
    expect((blocked.body as { status?: string }).status).toBe("error");
  });

  it("tracks clients independently", () => {
    const middleware = createRateLimiter({ limit: 1, windowMs: 60_000 });

    middleware(makeReq("1.1.1.1"), makeRes() as unknown as Response, () => {});

    let secondClientPassed = false;
    middleware(makeReq("2.2.2.2"), makeRes() as unknown as Response, () => (secondClientPassed = true));

    expect(secondClientPassed).toBe(true);
  });

  it("resets after the window elapses", () => {
    const middleware = createRateLimiter({ limit: 1, windowMs: 5 });

    middleware(makeReq("9.9.9.9"), makeRes() as unknown as Response, () => {});

    const duringWindow = makeRes();
    let nextDuringWindow = false;
    middleware(makeReq("9.9.9.9"), duringWindow as unknown as Response, () => (nextDuringWindow = true));
    expect(nextDuringWindow).toBe(false);

    return new Promise<void>((resolve) => {
      setTimeout(() => {
        let nextAfterWindow = false;
        middleware(makeReq("9.9.9.9"), makeRes() as unknown as Response, () => (nextAfterWindow = true));
        expect(nextAfterWindow).toBe(true);
        resolve();
      }, 10);
    });
  });
});
