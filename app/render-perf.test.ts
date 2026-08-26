import { describe, expect, it } from "vitest";

import type { DrawingObjectV1 } from "../shared/drawing-document";
import { getRenderedObject } from "./satellite-overlay";

// Structural equivalents of the overlay's private MapPoint/Point aliases.
type PerfMapPoint = { lat: number; lng: number };
type PerfPoint = { x: number; y: number };

/**
 * Task 30 performance budgets — regression guards for large proposals.
 *
 * Budgets (explicit, per .hermes/plans Task 30):
 * - Render-plan generation for a 500-object proposal: < 400 ms (typical ~40 ms)
 * - Projection work must stay linear in object count
 *
 * These are pure-CPU budgets measured in CI; interactive frame budgets are
 * documented in .hermes/reports/render-perf.md.
 */

const identityProject = (point: PerfMapPoint): PerfPoint => ({ x: point.lng, y: point.lat });

const converter = {
  metresPerPixel: () => 1,
  metresToPixels: (metres: number) => metres,
  pixelsToMetres: (pixels: number) => pixels
};

function makeObjects(count: number): DrawingObjectV1[] {
  return Array.from({ length: count }, (_, index): DrawingObjectV1 => {
    const kind = index % 4;

    if (kind === 0) {
      return {
        geometry: { points: [{ lat: 12.97 + index / 1e6, lng: 77.59 }, { lat: 12.98, lng: 77.6 }], type: "LineString" as const },
        id: `road-${index}`,
        properties: { lanes: 2, direction: "two-way" as const },
        type: "road" as const
      } as DrawingObjectV1;
    }

    if (kind === 1) {
      return {
        geometry: { points: [{ lat: 12.97 + index / 1e6, lng: 77.59 }, { lat: 12.985, lng: 77.605 }], type: "LineString" as const },
        id: `bike-${index}`,
        properties: { direction: "one-way" as const, protection: "painted" as const },
        type: "cycleway" as const
      } as DrawingObjectV1;
    }

    if (kind === 2) {
      return {
        geometry: { point: { lat: 12.97 + index / 1e6, lng: 77.59 }, type: "Point" as const },
        id: `crossing-${index}`,
        properties: { bearingDegrees: 0, control: "zebra" as const },
        type: "crossing" as const
      } as DrawingObjectV1;
    }

    return {
      geometry: { point: { lat: 12.97 + index / 1e6, lng: 77.59 }, type: "Point" as const },
      id: `signal-${index}`,
      properties: { kind: "mixed" as const },
      type: "traffic-signal" as const
    } as DrawingObjectV1;
  });
}

describe("render performance budgets (Task 30)", () => {
  it("generates render plans for 500 objects within budget", () => {
    const objects = makeObjects(500);

    const start = performance.now();
    const rendered = objects.map((object) => getRenderedObject(object, identityProject, converter));
    const elapsedMs = performance.now() - start;

    expect(rendered).toHaveLength(500);
    // Explicit budget; generous for CI variance but catches order-of-magnitude regressions.
    expect(elapsedMs).toBeLessThan(400);
  });

  it("scales linearly — doubling objects roughly doubles the work", () => {
    const measure = (count: number) => {
      const objects = makeObjects(count);
      const start = performance.now();

      for (const object of objects) {
        getRenderedObject(object, identityProject, converter);
      }

      return performance.now() - start;
    };

    const single = Math.max(measure(250), 0.001);
    const double = measure(500);

    // Linear scaling means the doubled batch stays well under 3x the smaller one.
    expect(double).toBeLessThan(single * 3);
  });
});
