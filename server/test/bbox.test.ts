import { describe, expect, it } from "vitest";
import { getApproximateAreaKm2, isBoundingBox } from "../src/bbox.js";

const validBbox = { north: 28.615, south: 28.605, east: 77.215, west: 77.205 };

describe("isBoundingBox", () => {
  it("accepts an object with four numeric corners", () => {
    expect(isBoundingBox(validBbox)).toBe(true);
  });

  it("rejects null, non-objects, and missing or non-numeric corners", () => {
    expect(isBoundingBox(null)).toBe(false);
    expect(isBoundingBox("bbox")).toBe(false);
    expect(isBoundingBox({ ...validBbox, north: "28.7" })).toBe(false);
    expect(isBoundingBox({ north: validBbox.north, south: validBbox.south })).toBe(false);
  });
});

describe("getApproximateAreaKm2", () => {
  it("returns ~1 km2 for a 0.01 x 0.01 degree box near the equator", () => {
    const area = getApproximateAreaKm2({
      north: 0.005,
      south: -0.005,
      east: 0.005,
      west: -0.005
    });

    expect(area).toBeGreaterThan(1.1);
    expect(area).toBeLessThan(1.3);
  });

  it("shrinks with longitude at higher latitudes for the same degree span", () => {
    const equator = getApproximateAreaKm2({
      north: 0.05,
      south: -0.05,
      east: 0.05,
      west: -0.05
    });
    const delhi = getApproximateAreaKm2({
      north: 28.65,
      south: 28.55,
      east: 77.25,
      west: 77.15
    });

    expect(delhi).toBeLessThan(equator);
  });

  it("never returns negative values for inverted boxes", () => {
    const area = getApproximateAreaKm2({
      north: 28.6,
      south: 28.7,
      east: 77.2,
      west: 77.3
    });

    expect(area).toBeGreaterThanOrEqual(0);
  });
});
