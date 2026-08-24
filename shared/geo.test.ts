import { describe, expect, it } from "vitest";
import { distanceMetres, interpolateLatLng, offsetLatLngMetres } from "./geo";

describe("shared geo helpers", () => {
  it("measures a known Delhi latitude distance", () => {
    expect(distanceMetres({ lat: 28.6, lng: 77.2 }, { lat: 28.6167, lng: 77.2 })).toBeGreaterThan(1_800);
    expect(distanceMetres({ lat: 28.6, lng: 77.2 }, { lat: 28.6167, lng: 77.2 })).toBeLessThan(1_900);
  });

  it("interpolates coordinates without mutating inputs", () => {
    const start = { lat: 10, lng: 20 };
    expect(interpolateLatLng(start, { lat: 12, lng: 24 }, 0.25)).toEqual({ lat: 10.5, lng: 21 });
    expect(start).toEqual({ lat: 10, lng: 20 });
  });

  it("offsets a coordinate in local east/north metres", () => {
    const origin = { lat: 28.6139, lng: 77.209 };
    const offset = offsetLatLngMetres(origin, { eastMetres: 30, northMetres: 40 });
    expect(distanceMetres(origin, offset)).toBeCloseTo(50, 0);
    expect(offset.lat).toBeGreaterThan(origin.lat);
    expect(offset.lng).toBeGreaterThan(origin.lng);
  });

  it("keeps near-antipodal distances finite despite floating-point overshoot", () => {
    const distance = distanceMetres(
      { lat: -65.60000000000139, lng: 17 },
      { lat: 65.60000001000138, lng: -162.99999999 }
    );

    expect(Number.isFinite(distance)).toBe(true);
    expect(distance).toBeGreaterThan(20_000_000);
  });

  it("interpolates across the shortest longitude arc", () => {
    expect(interpolateLatLng({ lat: 0, lng: 179 }, { lat: 0, lng: -179 }, 0.5)).toEqual({
      lat: 0,
      lng: -180
    });
  });

  it("rejects east-west offsets at the poles", () => {
    expect(() => offsetLatLngMetres({ lat: 90, lng: 0 }, { eastMetres: 1, northMetres: 0 })).toThrow(
      /poles/i
    );
  });
});
