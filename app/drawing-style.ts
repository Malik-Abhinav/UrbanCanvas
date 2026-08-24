import type {
  CrossingObject,
  CyclewayObject,
  FootpathObject,
  RoundaboutObject,
  RoadObject,
  TrafficSignalObject
} from "../shared/drawing-document";

import { metresPerPixelAt } from "./drawing-document-bridge";

/**
 * Scale-aware visual styling for V1 drawing objects.
 *
 * Geometry lives in map coordinates / real-world units; every pixel value
 * produced here is a render output derived from metres-per-pixel at draw time.
 * Selection and draft states use a dedicated accent that is independent of any
 * infrastructure colour so object identity never carries interaction state.
 */

// Minimum rendered widths (px) so real-metre widths remain visible zoomed out.
const MIN_ROAD_WIDTH_PX = 4;
const MIN_PATH_WIDTH_PX = 2;
// Upper bound keeps dense multi-lane arterials legible instead of cartoonish.
const MAX_ROAD_CARRIAGEWAY_PX = 480;

export const SELECTION_ACCENT_COLOR = "#f5c542";
export const DRAFT_OPACITY = 0.72;

export type ScaleContext = {
  metresPerPixel: number;
  metresToPixels(metres: number): number;
};

export function scaleContextAtZoom(latitudeDegrees: number, zoom: number): ScaleContext {
  const metresPerPixel = metresPerPixelAt(latitudeDegrees, zoom);

  return {
    metresPerPixel,
    metresToPixels(metres) {
      return metres / metresPerPixel;
    }
  };
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

/* ------------------------------- Roads ---------------------------------- */

const ROAD_HIERARCHY_TREATMENT: Record<
  RoadObject["properties"]["highwayFunction"],
  { casingWidthPx: number; carriagewayFill: string; casingColor: string }
> = {
  arterial: { carriagewayFill: "#1d2224", casingColor: "#0e1112", casingWidthPx: 3 },
  collector: { carriagewayFill: "#222729", casingColor: "#141819", casingWidthPx: 2 },
  local: { carriagewayFill: "#262b2d", casingColor: "#181c1d", casingWidthPx: 1.5 },
  service: { carriagewayFill: "#2a2f31", casingColor: "#1a1e1f", casingWidthPx: 1.25 }
};

const LANE_SEPARATOR_COLOR = "#8f9a94";
export const CENTERLINE_COLOR = "#d8d2c4";
export const ONEWAY_MARKER_COLOR = "#d8d2c4";

export type RoadVisualStyle = {
  casing: { color: string; widthPx: number };
  carriageway: { color: string; metresPerPixel: number; widthPx: number };
  laneSeparatorColor: string;
  /** Offsets from the centreline as ratios of half the carriageway width. */
  laneSeparatorOffsetRatios: number[];
  oneWayMarkers: boolean;
  showCenterline: boolean;
};

export function computeRoadStyle(object: RoadObject, context: ScaleContext): RoadVisualStyle {
  const { direction, highwayFunction, laneWidthMetres, lanes } = object.properties;
  const treatment = ROAD_HIERARCHY_TREATMENT[highwayFunction];
  const realCarriagewayPx = context.metresToPixels(lanes * laneWidthMetres);
  const carriagewayWidthPx = clamp(realCarriagewayPx, MIN_ROAD_WIDTH_PX, MAX_ROAD_CARRIAGEWAY_PX);
  // Lane separator offsets stay proportional to the real geometry, so at any
  // zoom they sit between true lane boundaries of the rendered width.
  const laneSeparatorOffsetRatios = Array.from({ length: Math.max(0, lanes - 1) }, (_, index) => {
    const lanesFromCenter = index + 1 - lanes / 2;

    return lanesFromCenter / (lanes / 2);
  });

  return {
    casing: {
      color: treatment.casingColor,
      widthPx: carriagewayWidthPx + treatment.casingWidthPx * 2
    },
    carriageway: {
      color: treatment.carriagewayFill,
      metresPerPixel: context.metresPerPixel,
      widthPx: carriagewayWidthPx
    },
    laneSeparatorColor: LANE_SEPARATOR_COLOR,
    laneSeparatorOffsetRatios,
    oneWayMarkers: direction !== "two-way",
    showCenterline: direction === "two-way"
  };
}

/* ------------------------------ Footpaths -------------------------------- */

export type FootpathVisualStyle = {
  alignment: "attached" | "separate";
  clearWidthPx: number;
  continuityIndicator: boolean;
  curbColor: string;
  curbWidthPx: number;
  edgeStyle: "curb" | "dashed-edge";
  surfaceFill: string;
};

const FOOTPATH_SURFACE_FILL: Record<FootpathObject["properties"]["surface"], string> = {
  paved: "#e5e7eb",
  unpaved: "#c9bfa8",
  unknown: "#dcdfe3"
};

export function computeFootpathStyle(object: FootpathObject, context: ScaleContext): FootpathVisualStyle {
  const { accessibility, alignment, clearWidthMetres, surface } = object.properties;

  return {
    alignment,
    clearWidthPx: Math.max(MIN_PATH_WIDTH_PX, context.metresToPixels(clearWidthMetres)),
    continuityIndicator: accessibility === "step-free",
    curbColor: alignment === "attached" ? "#9aa3aa" : "#6b7480",
    curbWidthPx: 1,
    edgeStyle: alignment === "attached" ? "curb" : "dashed-edge",
    surfaceFill: FOOTPATH_SURFACE_FILL[surface]
  };
}

/* ------------------------------ Cycleways -------------------------------- */

export type CyclewayVisualStyle = {
  bufferWidthPx: number;
  directionalMarkSpacingPx: number;
  directionalMarks: boolean;
  edgeStyle: "solid" | "dashed" | "none";
  fill: string;
  markKind: "single-arrow" | "double-arrow";
  totalWidthPx: number;
  widthPx: number;
};

const CYCLEWAY_FILL: Record<CyclewayObject["properties"]["protection"], string> = {
  "mixed-traffic": "#86efac",
  painted: "#34d27b",
  protected: "#22c55e"
};
const CYCLEWAY_EDGE_DASH: Record<CyclewayObject["properties"]["protection"], CyclewayVisualStyle["edgeStyle"]> = {
  "mixed-traffic": "none",
  painted: "dashed",
  protected: "solid"
};

export function computeCyclewayStyle(object: CyclewayObject, context: ScaleContext): CyclewayStyleInput {
  const { bufferMetres, direction, protection, widthMetres } = object.properties;
  const widthPx = Math.max(MIN_PATH_WIDTH_PX, context.metresToPixels(widthMetres));
  const bufferWidthPx = Math.max(0, context.metresToPixels(bufferMetres));
  // Marks spaced far enough to read but never dense enough to become noise.
  const directionalMarkSpacingPx = clamp(widthPx * 6, 48, 220);

  return {
    bufferWidthPx,
    directionalMarkSpacingPx,
    directionalMarks: true,
    edgeStyle: CYCLEWAY_EDGE_DASH[protection],
    fill: CYCLEWAY_FILL[protection],
    markKind: direction === "one-way" ? "single-arrow" : "double-arrow",
    totalWidthPx: widthPx + bufferWidthPx * 2,
    widthPx
  };
}

type CyclewayStyleInput = CyclewayVisualStyle;

/* ------------------------------ Crossings -------------------------------- */

export type CrossingStripeLayout = {
  count: number;
  /** Fraction of the crossing length covered by stripes (zebra ≈ 1). */
  coverageRatio: number;
  stripeWidthPx: number;
  style: "zebra" | "continental" | "plain";
};

const ZEBRA_STRIPE_PITCH_PX = 12;
const CONTINENTAL_STRIPE_PITCH_PX = 18;

export function computeCrossingStripes(
  properties: Pick<CrossingObject["properties"], "control">,
  size: { lengthPx: number; widthPx: number }
): CrossingStripeLayout {
  if (properties.control === "uncontrolled") {
    return { count: 0, coverageRatio: 0, stripeWidthPx: 0, style: "plain" };
  }

  const isZebra = properties.control === "zebra";
  const pitch = isZebra ? ZEBRA_STRIPE_PITCH_PX : CONTINENTAL_STRIPE_PITCH_PX;
  // Stripes run the full crossing length with even gaps; no fixed cap.
  const count = Math.max(3, Math.floor(size.lengthPx / pitch));

  return {
    count,
    // Stripes plus gaps span the full crossing length evenly.
    coverageRatio: 1,
    stripeWidthPx: (size.lengthPx / count) * 0.5,
    style: isZebra ? "zebra" : "continental"
  };
}

/* ----------------------------- Roundabouts ------------------------------- */

export type RoundaboutVisualStyle = {
  /** Ring radii as ratios of the outer (inscribed-circle) radius. */
  laneRingRadiiRatios: number[];
  ringColor: string;
};

export function computeRoundaboutStyle(object: RoundaboutObject, context: ScaleContext): RoundaboutVisualStyle {
  void context;
  const { inscribedCircleDiameterMetres, lanes } = object.properties;
  const islandRadiusRatio = 0.42;
  const usableSpan = 1 - islandRadiusRatio;
  const laneRingRadiiRatios = Array.from({ length: Math.max(0, lanes) }, (_, index) => {
    // Each ring centred inside its lane band between island and outer edge.
    const bandCenter = islandRadiusRatio + (usableSpan * (index + 0.5)) / lanes;

    return bandCenter * clamp(inscribedCircleDiameterMetres > 0 ? 1 : 1, 0, 1);
  });

  return { laneRingRadiiRatios, ringColor: "#d8d2c4" };
}

/* ------------------------- Context (OSM) roads --------------------------- */

const CONTEXT_ROAD_HIERARCHY: Record<string, RoadObject["properties"]["highwayFunction"]> = {
  motorway: "arterial",
  motorway_link: "arterial",
  trunk: "arterial",
  primary: "arterial",
  secondary: "collector",
  tertiary: "collector",
  residential: "local",
  unclassified: "local",
  service: "service"
};

export type ContextRoadStyle = {
  casingColor: string;
  casingWidthPx: number;
  color: string;
  widthPx: number;
};

/**
 * Scale-aware styling for existing OSM context roads. Widths come from real
 * metres through the current metres-per-pixel so proportions stay stable as
 * the view scale changes.
 */
export function computeContextRoadStyle(kind: string, context: ScaleContext): ContextRoadStyle {
  const highwayFunction = CONTEXT_ROAD_HIERARCHY[kind] ?? "service";
  const treatment = ROAD_HIERARCHY_TREATMENT[highwayFunction];
  // Typical carriageway widths per hierarchy class (metres).
  const typicalCarriagewayMetres = { arterial: 28, collector: 14, local: 9, service: 6 }[highwayFunction];
  const widthPx = Math.max(MIN_ROAD_WIDTH_PX, context.metresToPixels(typicalCarriagewayMetres));

  return {
    casingColor: treatment.casingColor,
    casingWidthPx: widthPx + treatment.casingWidthPx * 2,
    color: treatment.carriagewayFill,
    widthPx
  };
}


const SIGNAL_LABELS: Record<TrafficSignalObject["properties"]["kind"], string> = {
  cycle: "C",
  mixed: "M",
  pedestrian: "P",
  vehicle: "T"
};

export type SignalVisualStyle = {
  fill: string;
  label: string;
  radiusPx: number;
};

export function computeSignalStyle(object: TrafficSignalObject, context: ScaleContext): SignalVisualStyle {
  void object.geometry;
  // Heads scale gently with zoom but stay readable at both extremes.
  const zoomScale = clamp(Math.sqrt(0.3 / context.metresPerPixel), 0.75, 1.45);

  return {
    fill: "#60a5fa",
    label: SIGNAL_LABELS[object.properties.kind],
    radiusPx: clamp(13 * zoomScale, 9, 20)
  };
}
