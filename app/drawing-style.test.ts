import { describe, expect, it } from "vitest";

import type {
  CyclewayObject,
  RoundaboutObject,
  RoadObject,
  TrafficSignalObject
} from "../shared/drawing-document";

import {
  DRAFT_OPACITY,
  SELECTION_ACCENT_COLOR,
  computeCrossingStripes,
  computeCyclewayStyle,
  computeFootpathStyle,
  computeRoadStyle,
  computeRoundaboutStyle,
  computeSignalStyle,
  scaleContextAtZoom
} from "./drawing-style";

// Bengaluru-ish latitude; ~0.149 m/px at zoom 18.
const LAT = 12.9716;

function makeRoad(overrides: Partial<RoadObject["properties"]> = {}): RoadObject {
  return {
    geometry: { points: [], type: "LineString" },
    id: "road-1",
    properties: {
      direction: "two-way",
      highwayFunction: "collector",
      laneWidthMetres: 3.5,
      lanes: 4,
      ...overrides
    },
    type: "road"
  };
}

describe("scaleContextAtZoom", () => {
  it("converts real metres to screen pixels using web-mercator scale", () => {
    const context = scaleContextAtZoom(LAT, 18);
    const pixelsForTenMetres = context.metresToPixels(10);

    expect(pixelsForTenMetres).toBeCloseTo(10 / context.metresPerPixel, 6);
    // Zooming in doubles on-screen size for the same real-world width.
    const zoomedIn = scaleContextAtZoom(LAT, 19);
    expect(zoomedIn.metresToPixels(10)).toBeCloseTo(pixelsForTenMetres * 2, 3);
  });
});

describe("computeRoadStyle", () => {
  it("scales carriageway from real lane widths and keeps casing outside it", () => {
    const style = computeRoadStyle(makeRoad(), scaleContextAtZoom(LAT, 18));
    const expectedCarriageway = (4 * 3.5) / style.carriageway.metresPerPixel;

    expect(style.carriageway.widthPx).toBeGreaterThan(0);
    expect(style.carriageway.widthPx).toBeCloseTo(expectedCarriageway, 6);
    expect(style.casing.widthPx).toBeGreaterThan(style.carriageway.widthPx);
  });

  it("enforces minimum visible width without cartoonish growth", () => {
    const far = computeRoadStyle(makeRoad({ laneWidthMetres: 0.01 }), scaleContextAtZoom(LAT, 10));

    expect(far.carriageway.widthPx).toBeGreaterThanOrEqual(4);

    const near = computeRoadStyle(makeRoad(), scaleContextAtZoom(LAT, 22));
    const arterialNear = computeRoadStyle(
      makeRoad({ highwayFunction: "arterial", lanes: 8 }),
      scaleContextAtZoom(LAT, 22)
    );

    // Hierarchy affects treatment, not runaway widths.
    expect(near.casing.widthPx - near.carriageway.widthPx).toBeLessThan(
      arterialNear.casing.widthPx - arterialNear.carriageway.widthPx
    );
    expect(arterialNear.carriageway.widthPx).toBeLessThan(600);
  });

  it("derives lane separators from lane count and shows a centreline only for two-way roads", () => {
    const twoWay = computeRoadStyle(makeRoad({ lanes: 4 }), scaleContextAtZoom(LAT, 18));

    expect(twoWay.laneSeparatorOffsetRatios).toHaveLength(3);
    expect(twoWay.showCenterline).toBe(true);
    expect(twoWay.oneWayMarkers).toBe(false);

    const oneWay = computeRoadStyle(
      makeRoad({ direction: "one-way-forward", lanes: 2 }),
      scaleContextAtZoom(LAT, 18)
    );

    expect(oneWay.laneSeparatorOffsetRatios).toHaveLength(1);
    expect(oneWay.showCenterline).toBe(false);
    expect(oneWay.oneWayMarkers).toBe(true);
  });

  it("gives arterials a heavier casing treatment than service roads", () => {
    const context = scaleContextAtZoom(LAT, 18);
    const arterial = computeRoadStyle(makeRoad({ highwayFunction: "arterial" }), context);
    const service = computeRoadStyle(makeRoad({ highwayFunction: "service" }), context);

    expect(arterial.casing.widthPx - arterial.carriageway.widthPx).toBeGreaterThan(
      service.casing.widthPx - service.carriageway.widthPx
    );
  });
});

describe("computeFootpathStyle", () => {
  it("converts real clear width to screen width with a visibility floor", () => {
    const context = scaleContextAtZoom(LAT, 20);
    const style = computeFootpathStyle(
      {
        geometry: { points: [], type: "LineString" },
        id: "fp",
        properties: { accessibility: "step-free", alignment: "attached", clearWidthMetres: 2, surface: "paved" },
        type: "footpath"
      },
      context
    );

    expect(style.clearWidthPx).toBeCloseTo(2 / context.metresPerPixel, 6);
    expect(style.clearWidthPx).toBeGreaterThanOrEqual(2);
  });

  it("distinguishes attached sidewalks from independent paths and flags step-free continuity", () => {
    const context = scaleContextAtZoom(LAT, 19);
    const attached = computeFootpathStyle(
      {
        geometry: { points: [], type: "LineString" },
        id: "a",
        properties: { accessibility: "step-free", alignment: "attached", clearWidthMetres: 2, surface: "paved" },
        type: "footpath"
      },
      context
    );
    const separate = computeFootpathStyle(
      {
        geometry: { points: [], type: "LineString" },
        id: "s",
        properties: { accessibility: "step-free", alignment: "separate", clearWidthMetres: 2, surface: "unpaved" },
        type: "footpath"
      },
      context
    );

    expect(attached.alignment).toBe("attached");
    expect(separate.alignment).toBe("separate");
    expect(attached.edgeStyle).not.toBe(separate.edgeStyle);
    expect(attached.continuityIndicator).toBe(true);
    expect(separate.surfaceFill).not.toBe(attached.surfaceFill);
  });
});

describe("computeCyclewayStyle", () => {
  const base: CyclewayObject["properties"] = {
    alignment: "attached",
    bufferMetres: 0,
    direction: "one-way",
    protection: "protected",
    widthMetres: 2.5
  };

  function cycleway(properties: Partial<CyclewayObject["properties"]>): CyclewayObject {
    return { geometry: { points: [], type: "LineString" }, id: "cw", properties: { ...base, ...properties }, type: "cycleway" };
  }

  it("renders distinct treatments for protected, painted, and shared facilities", () => {
    const context = scaleContextAtZoom(LAT, 19);
    const protectedStyle = computeCyclewayStyle(cycleway({}), context);
    const painted = computeCyclewayStyle(cycleway({ protection: "painted" }), context);
    const shared = computeCyclewayStyle(cycleway({ protection: "mixed-traffic" }), context);

    expect(new Set([protectedStyle.fill, painted.fill, shared.fill]).size).toBe(3);
    expect(protectedStyle.edgeStyle).toBe("solid");
    expect(painted.edgeStyle).toBe("dashed");
    expect(shared.edgeStyle).toBe("none");
  });

  it("adds a buffer band on each side when physical separation is configured", () => {
    const context = scaleContextAtZoom(LAT, 19);
    const buffered = computeCyclewayStyle(cycleway({ bufferMetres: 1 }), context);
    const unbuffered = computeCyclewayStyle(cycleway({}), context);

    expect(buffered.bufferWidthPx).toBeCloseTo(1 / context.metresPerPixel, 6);
    expect(buffered.totalWidthPx).toBeGreaterThan(unbuffered.totalWidthPx);
  });

  it("spaces directional marks at readable, non-noisy intervals", () => {
    const context = scaleContextAtZoom(LAT, 18);
    const oneWay = computeCyclewayStyle(cycleway({}), context);
    const twoWay = computeCyclewayStyle(cycleway({ direction: "two-way" }), context);

    expect(oneWay.directionalMarkSpacingPx).toBeGreaterThanOrEqual(48);
    expect(oneWay.directionalMarkSpacingPx).toBeLessThanOrEqual(220);
    expect(oneWay.directionalMarks).toBe(true);
    // Two-way cycleways use paired marks instead of single direction arrows.
    expect(twoWay.directionalMarks).toBe(true);
    expect(twoWay.markKind).not.toBe(oneWay.markKind);
  });
});

describe("computeCrossingStripes", () => {
  it("distributes zebra stripes across the full crossing length, not three fixed rectangles", () => {
    const long = computeCrossingStripes({ control: "zebra" }, { lengthPx: 300, widthPx: 30 });

    expect(long.count).toBeGreaterThan(8);
    expect(long.coverageRatio).toBeCloseTo(1, 5);
    expect(long.stripeWidthPx).toBeGreaterThan(0);

    const short = computeCrossingStripes({ control: "zebra" }, { lengthPx: 40, widthPx: 16 });

    expect(short.count).toBeGreaterThanOrEqual(3);
    expect(short.count).toBeLessThan(long.count);
  });

  it("keeps uncontrolled crossings plain and honours non-zebra controls", () => {
    expect(computeCrossingStripes({ control: "uncontrolled" }, { lengthPx: 200, widthPx: 24 }).count).toBe(0);

    const raised = computeCrossingStripes({ control: "raised" }, { lengthPx: 200, widthPx: 24 });

    expect(raised.count).toBeGreaterThan(0);
    expect(raised.style).not.toBe(computeCrossingStripes({ control: "zebra" }, { lengthPx: 200, widthPx: 24 }).style);
  });
});

describe("computeRoundaboutStyle", () => {
  it("draws one lane ring per roundabout lane between island and outer edge", () => {
    const object: RoundaboutObject = {
      geometry: { point: { lat: LAT, lng: 77.59 }, type: "Point" },
      id: "rb",
      properties: { inscribedCircleDiameterMetres: 26, lanes: 2 },
      type: "roundabout"
    };
    const context = scaleContextAtZoom(LAT, 18);
    const style = computeRoundaboutStyle(object, context);

    expect(style.laneRingRadiiRatios).toHaveLength(2);
    for (const ratio of style.laneRingRadiiRatios) {
      expect(ratio).toBeGreaterThan(0);
      expect(ratio).toBeLessThan(1);
    }
    expect(new Set(style.laneRingRadiiRatios).size).toBe(2);
  });
});

describe("computeSignalStyle", () => {
  it("keeps signal heads readable across zoom levels", () => {
    const zoomedOut = computeSignalStyle(signal(), scaleContextAtZoom(LAT, 15));
    const zoomedIn = computeSignalStyle(signal(), scaleContextAtZoom(LAT, 20));

    expect(zoomedOut.radiusPx).toBeGreaterThanOrEqual(9);
    expect(zoomedOut.radiusPx).toBeLessThanOrEqual(20);
    expect(zoomedIn.radiusPx).toBeGreaterThanOrEqual(zoomedOut.radiusPx);
    expect(zoomedIn.radiusPx).toBeLessThanOrEqual(20);
  });

  it("labels the controlled mode", () => {
    expect(computeSignalStyle(signal(), scaleContextAtZoom(LAT, 18)).label).toBe("T");
    expect(
      computeSignalStyle(
        { ...signal(), properties: { kind: "pedestrian" } },
        scaleContextAtZoom(LAT, 18)
      ).label
    ).toBe("P");
  });
});

function signal(): TrafficSignalObject {
  return {
    geometry: { point: { lat: LAT, lng: 77.59 }, type: "Point" },
    id: "sig",
    properties: { kind: "vehicle" },
    type: "traffic-signal"
  };
}

describe("selection and draft states", () => {
  it("uses an accent independent from any infrastructure colour", () => {
    expect(SELECTION_ACCENT_COLOR).toBe("#f5c542");
    expect(DRAFT_OPACITY).toBeLessThan(1);
    expect(DRAFT_OPACITY).toBeGreaterThan(0);
  });
});
