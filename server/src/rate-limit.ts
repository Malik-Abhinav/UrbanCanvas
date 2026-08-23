import type { NextFunction, Request, Response } from "express";

type Bucket = {
  count: number;
  resetAt: number;
};

const buckets = new Map<string, Bucket>();

// Periodically drop expired buckets so the map cannot grow unbounded.
const cleanupIntervalMs = 5 * 60 * 1000;

let lastCleanup = Date.now();

export type RateLimitOptions = {
  /** Requests allowed per window per client. */
  limit: number;
  /** Window length in milliseconds. */
  windowMs: number;
};

/**
 * Minimal in-memory fixed-window rate limiter. Good enough for a
 * single-instance deployment; swap for a shared store if the API ever
 * runs multi-instance.
 */
export function createRateLimiter({ limit, windowMs }: RateLimitOptions) {
  return function rateLimit(req: Request, res: Response, next: NextFunction) {
    const now = Date.now();

    maybeCleanup(now);

    const key = getClientKey(req);
    const bucket = buckets.get(key);

    if (!bucket || bucket.resetAt <= now) {
      buckets.set(key, { count: 1, resetAt: now + windowMs });
      next();
      return;
    }

    bucket.count += 1;

    if (bucket.count > limit) {
      const retryAfterSeconds = Math.max(1, Math.ceil((bucket.resetAt - now) / 1000));

      res.set("retry-after", String(retryAfterSeconds));
      res.status(429).json({
        status: "error",
        message: `Too many requests. Try again in about ${Math.ceil(retryAfterSeconds / 60)} minute${retryAfterSeconds >= 120 ? "s" : ""}.`
      });
      return;
    }

    next();
  };
}

function getClientKey(req: Request) {
  // trust proxy is enabled, so req.ip reflects the real client address.
  return req.ip ?? req.socket.remoteAddress ?? "unknown";
}

function maybeCleanup(now: number) {
  if (now - lastCleanup < cleanupIntervalMs) {
    return;
  }

  lastCleanup = now;

  for (const [key, bucket] of buckets) {
    if (bucket.resetAt <= now) {
      buckets.delete(key);
    }
  }
}
