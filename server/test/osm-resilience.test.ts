import type { NextFunction, Request, Response } from "express";
import { describe, expect, it } from "vitest";
import {
  DEFAULT_OSM_RATE_LIMIT,
  createOsmRequestGuard,
  parseOsmRateLimit
} from "../src/osm-request-guard.js";
import { OSM_UPSTREAM_TIMEOUT_MS, validateBoundingBox } from "../src/osm.js";

const validBbox = { north: 28.615, south: 28.605, east: 77.215, west: 77.205 };

function makeReq(bbox: unknown, ip = "1.2.3.4"): Request {
  return { body: { bbox }, ip } as unknown as Request;
}

function makeRes(): Response & { body?: unknown; headers: Record<string, string>; statusCode: number } {
  const res = {
    body: undefined as unknown,
    headers: {} as Record<string, string>,
    statusCode: 0,
    set(name: string, value: string) {
      this.headers[name.toLowerCase()] = value;
      return this;
    },
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    json(payload: unknown) {
      this.body = payload;
      return this;
    }
  };

  return res as unknown as Response & { body?: unknown; headers: Record<string, string>; statusCode: number };
}

function runGuard(
  guard: ReturnType<typeof createOsmRequestGuard>,
  req: Request,
  res: Response,
  done: NextFunction
) {
  guard[0](req, res, (error?: unknown) => {
    if (error) {
      done(error);
      return;
    }
    guard[1](req, res, done);
  });
}

describe("OSM request resilience", () => {
  it("exports the existing bbox validator without changing its messages", () => {
    expect(() => validateBoundingBox(null)).toThrow(
      "Request body must include bbox with north, south, east, and west numbers."
    );
    expect(() => validateBoundingBox({ ...validBbox, north: Number.POSITIVE_INFINITY })).toThrow(
      "Bounding box coordinates must be finite numbers."
    );
    expect(() => validateBoundingBox({ ...validBbox, south: validBbox.north })).toThrow(
      "Bounding box coordinates are invalid."
    );
  });

  it("uses a practical default and safely falls back for malformed OSM_RATE_LIMIT values", () => {
    expect(DEFAULT_OSM_RATE_LIMIT).toBe(30);
    expect(parseOsmRateLimit(undefined)).toBe(30);
    expect(parseOsmRateLimit("")).toBe(30);
    expect(parseOsmRateLimit("nope")).toBe(30);
    expect(parseOsmRateLimit("0")).toBe(30);
    expect(parseOsmRateLimit("-2")).toBe(30);
    expect(parseOsmRateLimit("2.5")).toBe(30);
    expect(parseOsmRateLimit("31")).toBe(31);
  });

  it("rejects malformed bbox requests before they consume the client quota", () => {
    const guard = createOsmRequestGuard({ limit: 1, windowMs: 60_000 });
    const malformed = makeRes();
    let malformedPassed = false;

    runGuard(guard, makeReq(null), malformed, () => {
      malformedPassed = true;
    });

    expect(malformedPassed).toBe(false);
    expect(malformed.statusCode).toBe(400);

    const firstValid = makeRes();
    let firstValidPassed = false;
    runGuard(guard, makeReq(validBbox), firstValid, () => {
      firstValidPassed = true;
    });

    expect(firstValidPassed).toBe(true);

    const secondValid = makeRes();
    runGuard(guard, makeReq(validBbox), secondValid, () => {});
    expect(secondValid.statusCode).toBe(429);
    expect(secondValid.headers["retry-after"]).toBeDefined();
  });

  it("allows the server more time than the 35 second Overpass query budget", () => {
    expect(OSM_UPSTREAM_TIMEOUT_MS).toBe(55_000);
    expect(OSM_UPSTREAM_TIMEOUT_MS).toBeGreaterThan(35_000);
  });
});
