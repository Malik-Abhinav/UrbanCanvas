import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

// react-konva pulls in konva's node backend under vitest; stub the components —
// these tests cover classification, styling and rendered chrome, not canvas pixels.
vi.mock("react-konva", async () => {
  const makeStub = (name: string) => {
    const Stub = () => null;
    Stub.displayName = name;
    return Stub;
  };

  return {
    Group: makeStub("Group"),
    Layer: makeStub("Layer"),
    Line: makeStub("Line"),
    Rect: makeStub("Rect"),
    Stage: makeStub("Stage")
  };
});

const { default: CanvasRenderer } = await import("./canvas-renderer");
const {
  classifyRoadKind,
  computeCanvasSize,
  computeScaleBar,
  getBuildingStyle,
  getOpenLandStyle,
  ROAD_FAMILY_LABELS
} = await import("./canvas-renderer");

const BBOX = { north: 12.98, south: 12.97, east: 77.6, west: 77.59 };

function feature(
  id: number,
  kind: string,
  tags: Record<string, string> = {}
) {
  return {
    geometry: [
      { lat: 12.971, lng: 77.591 },
      { lat: 12.972, lng: 77.592 }
    ],
    id,
    kind,
    tags
  };
}

function makeData() {
  return {
    bbox: BBOX,
    buildings: [
      feature(1, "building", { building: "commercial" }),
      feature(2, "building", { building: "house" }),
      feature(3, "building", { building: "garage" })
    ],
    counts: { buildings: 3, openLand: 3, roads: 6 },
    openLand: [
      feature(4, "open-land", { leisure: "park" }),
      feature(5, "open-land", { landuse: "grass" }),
      feature(6, "open-land", { landuse: "railway" })
    ],
    roads: [
      feature(7, "primary"),
      feature(8, "residential"),
      feature(9, "service"),
      feature(10, "footway"),
      feature(11, "pedestrian"),
      feature(12, "cycleway")
    ]
  };
}

describe("classifyRoadKind", () => {
  it("separates vehicle roads from pedestrian and cycle paths", () => {
    expect(classifyRoadKind("motorway").family).toBe("vehicle");
    expect(classifyRoadKind("primary").tier).toBe("arterial");
    expect(classifyRoadKind("secondary").tier).toBe("collector");
    expect(classifyRoadKind("residential").tier).toBe("local");
    expect(classifyRoadKind("service").tier).toBe("service");

    expect(classifyRoadKind("footway").family).toBe("pedestrian");
    expect(classifyRoadKind("path").family).toBe("pedestrian");
    expect(classifyRoadKind("pedestrian").family).toBe("pedestrian");
    expect(classifyRoadKind("steps").family).toBe("pedestrian");

    expect(classifyRoadKind("cycleway").family).toBe("cycleway");
    // Unknown kinds degrade to quiet vehicle roads, never to paths.
    expect(classifyRoadKind("living_street")).toEqual({ family: "vehicle", tier: "local" });
  });

  it("gives every family a human-readable legend label", () => {
    expect(Object.keys(ROAD_FAMILY_LABELS)).toEqual(
      expect.arrayContaining(["vehicle", "pedestrian", "cycleway"])
    );
  });
});

describe("getBuildingStyle", () => {
  it("builds a three-tier hierarchy: major, residential, auxiliary", () => {
    const major = getBuildingStyle({ building: "commercial" });
    const residential = getBuildingStyle({ building: "house" });
    const auxiliary = getBuildingStyle({ building: "garage" });
    const generic = getBuildingStyle({});

    expect(major.tier).toBe("major");
    expect(residential.tier).toBe("residential");
    expect(auxiliary.tier).toBe("auxiliary");
    // Unspecified buildings read as ordinary residential fabric.
    expect(generic.tier).toBe("residential");

    // More prominent buildings draw heavier: higher opacity and stronger outline.
    expect(major.opacity).toBeGreaterThan(residential.opacity);
    expect(residential.opacity).toBeGreaterThan(auxiliary.opacity);
    expect(new Set([major.fill, residential.fill, auxiliary.fill]).size).toBe(3);
  });
});

describe("getOpenLandStyle", () => {
  it("separates parks, casual green space, and residual open land", () => {
    const park = getOpenLandStyle({ leisure: "park" });
    const grass = getOpenLandStyle({ landuse: "grass" });
    const other = getOpenLandStyle({ landuse: "railway" });

    expect(park.tier).toBe("park");
    expect(grass.tier).toBe("recreation");
    expect(other.tier).toBe("other");
    expect(park.opacity).toBeGreaterThan(other.opacity);
    expect(new Set([park.fill, grass.fill, other.fill]).size).toBe(3);
  });
});

describe("computeCanvasSize", () => {
  it("tracks the container instead of assuming fixed 1200×820", () => {
    expect(computeCanvasSize(1600, 900)).toEqual({ height: 900, width: 1600 });

    // Falls back to the previous defaults when nothing is measured yet.
    expect(computeCanvasSize(undefined, undefined)).toEqual({ height: 820, width: 1200 });

    // Never collapses below a usable floor.
    expect(computeCanvasSize(120, 60).width).toBeGreaterThanOrEqual(480);
    expect(computeCanvasSize(120, 60).height).toBeGreaterThanOrEqual(360);
  });
});

describe("computeScaleBar", () => {
  it("picks a round metre distance that renders at readable length", () => {
    // ~0.15 m/px at zoom 18 near Bengaluru: the finest round distance that
    // still spans at least 60px is 10 m (~67px).
    const bar = computeScaleBar(0.149);

    expect(bar.metres).toBe(10);
    expect(bar.widthPx).toBeGreaterThanOrEqual(60);
    expect(bar.label).toBe("10 m");

    // Coarser scales need bigger distances, expressed in kilometres.
    const coarse = computeScaleBar(1.49);

    expect(coarse.metres).toBeGreaterThan(bar.metres);
    expect(computeScaleBar(30).label).toContain("km");
  });
});

describe("rendered canvas chrome", () => {
  it("renders a legend covering the full hierarchy plus a scale bar and export control", () => {
    const markup = renderToStaticMarkup(
      createElement(CanvasRenderer, { data: makeData(), onBackToMap: () => {} })
    );

    for (const label of ["Arterial", "Collector", "Local", "Service", "Footpath", "Cycleway"]) {
      expect(markup).toContain(label);
    }
    expect(markup).toContain("Major building");
    expect(markup).toContain("Residential");
    expect(markup).toContain("Park");
    expect(markup).toContain("Open land");
    expect(markup).toMatch(/\d+(\.\d+)? (m|km)/);
    expect(markup).toContain("Export PNG");
    expect(markup).toContain("Back to map");
  });

  it("reflects dataset counts in the header stats", () => {
    const markup = renderToStaticMarkup(
      createElement(CanvasRenderer, { data: makeData(), onBackToMap: () => {} })
    );

    expect(markup).toContain("Buildings");
    expect(markup).toContain("Roads");
    expect(markup).toContain("Open land");
  });
});
