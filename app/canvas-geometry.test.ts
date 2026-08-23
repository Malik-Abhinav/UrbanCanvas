import { describe, expect, it } from "vitest";
import {
  getClosestPointOnSegment,
  getDistance,
  getMapDistanceMeters,
  interpolateMapPoint,
  normalizePoint
} from "../app/canvas-geometry";

describe("getClosestPointOnSegment", () => {
  it("projects onto the middle of a segment", () => {
    const closest = getClosestPointOnSegment({ x: 50, y: 30 }, { x: 0, y: 0 }, { x: 100, y: 0 });

    expect(closest.point).toEqual({ x: 50, y: 0 });
    expect(closest.distance).toBe(30);
    expect(closest.t).toBe(0.5);
  });

  it("clamps to segment endpoints", () => {
    const before = getClosestPointOnSegment({ x: -40, y: 0 }, { x: 0, y: 0 }, { x: 100, y: 0 });
    const after = getClosestPointOnSegment({ x: 140, y: 0 }, { x: 0, y: 0 }, { x: 100, y: 0 });

    expect(before.point).toEqual({ x: 0, y: 0 });
    expect(after.point).toEqual({ x: 100, y: 0 });
  });

  it("handles zero-length segments without dividing by zero", () => {
    const closest = getClosestPointOnSegment({ x: 3, y: 4 }, { x: 10, y: 10 }, { x: 10, y: 10 });

    expect(closest.point).toEqual({ x: 10, y: 10 });
    expect(closest.distance).toBe(getDistance({ x: 3, y: 4 }, { x: 10, y: 10 }));
  });
});

describe("getMapDistanceMeters", () => {
  it("measures a known Delhi distance within tolerance", () => {
    // Roughly 1 minute of latitude (~1.85 km).
    const meters = getMapDistanceMeters({ lat: 28.6, lng: 77.2 }, { lat: 28.6167, lng: 77.2 });

    expect(meters).toBeGreaterThan(1700);
    expect(meters).toBeLessThan(2000);
  });

  it("returns 0 for identical points", () => {
    expect(getMapDistanceMeters({ lat: 28.6, lng: 77.2 }, { lat: 28.6, lng: 77.2 })).toBe(0);
  });
});

describe("interpolateMapPoint", () => {
  it("interpolates linearly between two points", () => {
    const mid = interpolateMapPoint({ lat: 0, lng: 0 }, { lat: 10, lng: 20 }, 0.5);

    expect(mid).toEqual({ lat: 5, lng: 10 });
  });

  it("extrapolates beyond the range when t is outside [0, 1]", () => {
    const past = interpolateMapPoint({ lat: 0, lng: 0 }, { lat: 10, lng: 20 }, -0.5);

    expect(past.lat).toBe(-5);
  });
});

describe("normalizePoint", () => {
  it("produces unit vectors", () => {
    const normalized = normalizePoint({ x: 3, y: 4 });

    expect(normalized.x).toBeCloseTo(0.6);
    expect(normalized.y).toBeCloseTo(0.8);
  });

  it("falls back to +x for zero vectors instead of producing NaN", () => {
    expect(normalizePoint({ x: 0, y: 0 })).toEqual({ x: 1, y: 0 });
  });
});
