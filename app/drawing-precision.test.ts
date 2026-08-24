import { describe, expect, it } from "vitest";

import type { DrawingObjectV1 } from "../shared/drawing-document";
import type { LatLng } from "../shared/geo";
import {
  ANGLE_SNAP_DEGREES,
  GRID_SPACING_SERIES,
  coerceNumericEntry,
  constrainSegmentDelta,
  duplicateLineObjectLatLng,
  filterCommands,
  offsetLineLatLng,
  resolveCommand,
  resolveGridSpacing,
  scalePolylineLength
} from "./drawing-precision";

describe("angle constraints", () => {
  it("snaps a near-horizontal drag to exactly horizontal", () => {
    const snapped = constrainSegmentDelta({ x: 0, y: 0 }, { x: 100, y: -6 }, true);

    expect(snapped.y).toBeCloseTo(0, 6);
    expect(snapped.x).toBeCloseTo(100.18, 1);
    // Length is preserved by the constraint.
    expect(Math.hypot(snapped.x, snapped.y)).toBeCloseTo(Math.hypot(100, -6), 5);
  });

  it("snaps to the nearest 45 degree direction", () => {
    const snapped = constrainSegmentDelta({ x: 0, y: 0 }, { x: 30, y: 28 }, true);

    expect(Math.atan2(snapped.y, snapped.x)).toBeCloseTo(Math.PI / 4, 6);
  });

  it("is a no-op when the constraint is disabled", () => {
    const pointer = { x: 100, y: -6 };

    expect(constrainSegmentDelta({ x: 0, y: 0 }, pointer, false)).toEqual(pointer);
  });

  it("keeps the constant at 45 degrees", () => {
    expect(ANGLE_SNAP_DEGREES).toBe(45);
  });
});

describe("offset parallel geometry", () => {
  const createRoadObject = (): DrawingObjectV1 => ({
    geometry: {
      points: [
        { lat: 52.1, lng: -1.2 },
        { lat: 52.1, lng: -1.19 }
      ] satisfies LatLng[],
      type: "LineString"
    },
    id: "road-1",
    properties: { direction: "two-way", highwayFunction: "local", lanes: 2, laneWidthMetres: 3.5 },
    type: "road"
  });

  it("offsets an axis-aligned line to the left by the given metres", () => {
    const offset = offsetLineLatLng(
      [
        { lat: 0, lng: 0 },
        { lat: 0, lng: 100 }
      ],
      5
    ) as LatLng[];

    // Heading east (+lng), left is north (+lat): 5 m ≈ 4.52e-5 degrees.
    expect(offset[0].lat).toBeCloseTo(5 / 110_574, 9);
    expect(offset[1].lng).toBeCloseTo(100, 9);
  });

  it("offsets to the right for negative distances", () => {
    const offset = offsetLineLatLng(
      [
        { lat: 10, lng: 10 },
        { lat: 12, lng: 10 }
      ],
      -3
    ) as LatLng[];

    // Heading north, right is east (+lng): the whole line shifts east.
    expect(offset[0].lng - 10).toBeGreaterThan(0);
    expect(offset[0].lat).toBeCloseTo(10, 9);
  });

  it("preserves vertex count on bends", () => {
    const source = [
      { lat: 0, lng: 0 },
      { lat: 0, lng: 50 },
      { lat: 25, lng: 50 }
    ];

    expect(offsetLineLatLng(source, 8)).toHaveLength(3);
  });

  it("returns null for degenerate input", () => {
    expect(offsetLineLatLng([{ lat: 0, lng: 0 }], 5)).toBeNull();
  });

  it("duplicates a line object with offset geometry and a new id", () => {
    const road = createRoadObject();
    const roadPoints = (road.geometry as { points: LatLng[] }).points;
    const copy = duplicateLineObjectLatLng(road, "copy-1", 6) as Extract<
      DrawingObjectV1,
      { geometry: { type: "LineString" } }
    >;

    expect(copy?.id).toBe("copy-1");
    expect(copy?.type).toBe(road.type);
    expect(copy.geometry.points).not.toBe((road.geometry as { points: unknown }).points);
  });

  it("refuses to duplicate non-line objects", () => {
    const point = {
      geometry: { point: { lat: 1, lng: 2 }, type: "Point" },
      id: "s1",
      properties: { kind: "vehicle" },
      type: "traffic-signal"
    } as DrawingObjectV1;

    expect(duplicateLineObjectLatLng(point, "copy-2", 0)).toBeNull();
  });
});

describe("numeric entry coercion", () => {
  it("parses plain numbers", () => {
    expect(coerceNumericEntry("42")).toBe(42);
  });

  it("accepts decimal comma and unit suffixes", () => {
    expect(coerceNumericEntry("7,5")).toBe(7.5);
    expect(coerceNumericEntry("12 m")).toBe(12);
    expect(coerceNumericEntry(" 3.25m ")).toBe(3.25);
  });

  it("clamps into range", () => {
    expect(coerceNumericEntry("99", { max: 20, min: 0 })).toBe(20);
    expect(coerceNumericEntry("-4", { max: 20, min: 0 })).toBe(0);
  });

  it("rejects garbage with null", () => {
    expect(coerceNumericEntry("wide")).toBeNull();
    expect(coerceNumericEntry("")).toBeNull();
  });
});

describe("polyline length scaling", () => {
  it("scales a two-point line to the target length in metres", () => {
    const scaled = scalePolylineLength(
      [
        { lat: 0, lng: 0 },
        { lat: 0, lng: 100 }
      ],
      55
    ) as LatLng[];

    expect(scaled[0]).toEqual({ lat: 0, lng: 0 });
    expect(Math.abs(scaled[1].lng) * 110_574 * Math.cos(0)).toBeCloseTo(55, 6);
  });

  it("returns null when the target length is not positive", () => {
    expect(scalePolylineLength([{ lat: 0, lng: 0 }, { lat: 0, lng: 1 }], 0)).toBeNull();
  });
});

describe("shortcut map", () => {
  it("resolves single-letter tool shortcuts without modifiers", () => {
    expect(resolveCommand({ ctrlKey: false, key: "r", metaKey: false, shiftKey: false })).toBe("tool.road");
  });

  it("ignores tool letters when a modifier is held", () => {
    expect(resolveCommand({ ctrlKey: true, key: "r", metaKey: false, shiftKey: false })).toBeNull();
  });

  it("resolves meta/ctrl+k to the palette", () => {
    expect(resolveCommand({ ctrlKey: true, key: "k", metaKey: false, shiftKey: false })).toBe("palette.open");
    expect(resolveCommand({ ctrlKey: false, key: "k", metaKey: true, shiftKey: false })).toBe("palette.open");
  });

  it("resolves duplicate and offset commands", () => {
    expect(resolveCommand({ ctrlKey: false, key: "d", metaKey: true, shiftKey: false })).toBe("object.duplicate");
    expect(resolveCommand({ ctrlKey: false, key: "o", metaKey: false, shiftKey: true })).toBe("object.offset");
  });

  it("resolves grid toggle and undo/redo", () => {
    expect(resolveCommand({ ctrlKey: false, key: "g", metaKey: false, shiftKey: false })).toBe("view.toggle-grid");
    expect(resolveCommand({ ctrlKey: false, key: "z", metaKey: true, shiftKey: false })).toBe("edit.undo");
    expect(resolveCommand({ ctrlKey: true, key: "z", metaKey: false, shiftKey: true })).toBe("edit.redo");
  });
});

describe("command filtering", () => {
  const commands = [
    { id: "tool.road", title: "Draw road" },
    { id: "tool.roundabout", title: "Draw roundabout" },
    { id: "view.toggle-grid", title: "Toggle grid" }
  ];

  it("matches title or id case-insensitively", () => {
    expect(filterCommands(commands, "road").map((command) => command.id)).toEqual(["tool.road"]);
    expect(filterCommands(commands, "GRID")).toEqual([commands[2]]);
  });

  it("returns everything for an empty query", () => {
    expect(filterCommands(commands, "")).toHaveLength(3);
  });
});

describe("scale-aware grid", () => {
  it("picks the smallest spacing that stays readable", () => {
    const oneMetrePerPixel = resolveGridSpacing({ metresPerPixel: 1, minSpacingPx: 24 });

    expect(oneMetrePerPixel?.spacingMetres).toBe(50);
    expect(oneMetrePerPixel?.spacingPx).toBe(50);
  });

  it("steps up through the series as the camera pulls back", () => {
    expect(resolveGridSpacing({ metresPerPixel: 10, minSpacingPx: 24 })?.spacingMetres).toBe(500);
  });

  it("hides the grid when even the largest spacing is too dense", () => {
    expect(resolveGridSpacing({ metresPerPixel: 5000, minSpacingPx: 24 })).toBeNull();
  });

  it("exposes a 1-2-5 series", () => {
    expect(GRID_SPACING_SERIES.slice(-3)).toEqual([200, 500, 1000]);
  });
});
