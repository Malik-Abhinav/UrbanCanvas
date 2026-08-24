import type { NextFunction, Request, Response } from "express";
import { validateBoundingBox } from "./osm.js";
import { createRateLimiter, type RateLimitOptions } from "./rate-limit.js";

export const DEFAULT_OSM_RATE_LIMIT = 30;

export function parseOsmRateLimit(value: string | undefined) {
  if (!value) {
    return DEFAULT_OSM_RATE_LIMIT;
  }

  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : DEFAULT_OSM_RATE_LIMIT;
}

export function createOsmRequestGuard(options: RateLimitOptions) {
  return [validateOsmRequest, createRateLimiter(options)] as const;
}

function validateOsmRequest(req: Request, res: Response, next: NextFunction) {
  try {
    validateBoundingBox(req.body?.bbox);
    next();
  } catch (error) {
    res.status(400).json({
      status: "error",
      message: error instanceof Error ? error.message : "Invalid bounding box"
    });
  }
}
