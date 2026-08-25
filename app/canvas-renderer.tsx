"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { WheelEvent } from "react";
import { Layer, Line, Rect, Stage, Group } from "react-konva";
import type Konva from "konva";

import { computeContextRoadStyle, scaleContextAtZoom } from "./drawing-style";

export type BoundingBox = {
  north: number;
  south: number;
  east: number;
  west: number;
};

export type OsmFeature = {
  id: number;
  kind: string;
  tags: Record<string, string>;
  geometry: Array<{
    lat: number;
    lng: number;
  }>;
};

export type OsmData = {
  bbox: BoundingBox;
  counts: {
    buildings: number;
    roads: number;
    openLand: number;
  };
  buildings: OsmFeature[];
  roads: OsmFeature[];
  openLand: OsmFeature[];
};

type CanvasRendererProps = {
  data: OsmData;
  onBackToMap: () => void;
};

type ProjectedFeature = OsmFeature & {
  points: number[];
};

/* ------------------------- Responsive dimensions ------------------------- */

const FALLBACK_CANVAS_WIDTH = 1200;
const FALLBACK_CANVAS_HEIGHT = 820;
const MIN_CANVAS_WIDTH = 480;
const MIN_CANVAS_HEIGHT = 360;

/** Track the container rather than assuming a fixed stage size. */
export function computeCanvasSize(
  viewportWidth: number | undefined,
  viewportHeight: number | undefined
): { height: number; width: number } {
  const width = Math.max(MIN_CANVAS_WIDTH, Math.floor(viewportWidth ?? FALLBACK_CANVAS_WIDTH));
  const height = Math.max(MIN_CANVAS_HEIGHT, Math.floor(viewportHeight ?? FALLBACK_CANVAS_HEIGHT));

  return { height, width };
}

/* --------------------------- Road classification -------------------------- */

export type RoadFamily = "cycleway" | "pedestrian" | "vehicle";
export type RoadTier = "arterial" | "collector" | "local" | "service";

const PEDESTRIAN_KINDS = new Set(["footway", "path", "pedestrian", "steps"]);
const VEHICLE_TIER_BY_KIND: Record<string, RoadTier> = {
  motorway: "arterial",
  motorway_link: "arterial",
  primary: "arterial",
  residential: "local",
  secondary: "collector",
  service: "service",
  tertiary: "collector",
  trunk: "arterial",
  unclassified: "local"
};

export function classifyRoadKind(kind: string): { family: RoadFamily; tier: RoadTier } {
  if (kind === "cycleway") {
    return { family: "cycleway", tier: "service" };
  }

  if (PEDESTRIAN_KINDS.has(kind)) {
    return { family: "pedestrian", tier: "service" };
  }

  return { family: "vehicle", tier: VEHICLE_TIER_BY_KIND[kind] ?? "local" };
}

export const ROAD_FAMILY_LABELS: Record<RoadFamily, string> = {
  cycleway: "Cycleway",
  pedestrian: "Footpath",
  vehicle: "Roads"
};

// Graphite/charcoal carriageways with warm off-white casings; the amber accent
// is reserved for cycling infrastructure so it reads as one deliberate accent.
const VEHICLE_FILL_BY_TIER: Record<RoadTier, string> = {
  arterial: "#3b4241",
  collector: "#333938",
  local: "#2d3332",
  service: "#272c2b"
};

const PEDESTRIAN_COLOR = "#7d8481";
const CYCLEWAY_COLOR = "#f5c542";

function getPathStyle(family: RoadFamily) {
  if (family === "cycleway") {
    return { color: CYCLEWAY_COLOR, dash: [10, 7], minPx: 2 };
  }

  return { color: PEDESTRIAN_COLOR, dash: [6, 5], minPx: 1.4 };
}

/* -------------------------- Building hierarchy ---------------------------- */

export type BuildingTier = "auxiliary" | "major" | "residential";

const MAJOR_BUILDING_VALUES = new Set([
  "civic",
  "commercial",
  "hospital",
  "hotel",
  "industrial",
  "office",
  "public",
  "retail",
  "school",
  "train_station",
  "university"
]);
const AUXILIARY_BUILDING_VALUES = new Set([
  "garage",
  "garages",
  "hut",
  "roof",
  "shed"
]);

const BUILDING_STYLE_BY_TIER: Record<
  BuildingTier,
  { fill: string; opacity: number; stroke: string; strokeWidth: number }
> = {
  auxiliary: { fill: "#565c59", opacity: 0.62, stroke: "#767c79", strokeWidth: 0.5 },
  major: { fill: "#b9beb9", opacity: 0.92, stroke: "#e3e7e2", strokeWidth: 1 },
  residential: { fill: "#8c9190", opacity: 0.8, stroke: "#c1c7c4", strokeWidth: 0.7 }
};

export function getBuildingStyle(tags: Record<string, string>): {
  fill: string;
  opacity: number;
  stroke: string;
  strokeWidth: number;
  tier: BuildingTier;
} {
  const value = tags.building ?? "";
  let tier: BuildingTier = "residential";

  if (AUXILIARY_BUILDING_VALUES.has(value)) {
    tier = "auxiliary";
  } else if (MAJOR_BUILDING_VALUES.has(value)) {
    tier = "major";
  }

  return { ...BUILDING_STYLE_BY_TIER[tier], tier };
}

/* --------------------------- Open-land hierarchy --------------------------- */

export type OpenLandTier = "other" | "park" | "recreation";

const PARK_KEYS: Array<[key: string, value: string]> = [
  ["leisure", "garden"],
  ["leisure", "park"],
  ["natural", "wood"],
  ["boundary", "protected_area"]
];
const RECREATION_VALUES = new Set([
  "allotments",
  "forest",
  "grass",
  "greenfield",
  "meadow",
  "orchard",
  "recreation_ground",
  "village_green"
]);

const OPEN_LAND_STYLE_BY_TIER: Record<
  OpenLandTier,
  { fill: string; opacity: number; stroke: string }
> = {
  other: { fill: "#3a4239", opacity: 0.55, stroke: "#525c50" },
  park: { fill: "#4d7f58", opacity: 0.78, stroke: "#6ea978" },
  recreation: { fill: "#456e4c", opacity: 0.66, stroke: "#5f8f68" }
};

export function getOpenLandStyle(tags: Record<string, string>): {
  fill: string;
  opacity: number;
  stroke: string;
  tier: OpenLandTier;
} {
  for (const [key, value] of PARK_KEYS) {
    if (tags[key] === value) {
      return { ...OPEN_LAND_STYLE_BY_TIER.park, tier: "park" };
    }
  }

  const landuse = tags.landuse ?? tags.leisure ?? "";

  if (RECREATION_VALUES.has(landuse)) {
    return { ...OPEN_LAND_STYLE_BY_TIER.recreation, tier: "recreation" };
  }

  return { ...OPEN_LAND_STYLE_BY_TIER.other, tier: "other" };
}

/* -------------------------------- Scale bar -------------------------------- */

const SCALE_BAR_CANDIDATES_METRES = [10, 20, 50, 100, 200, 500, 1000, 2000, 5000];

export function computeScaleBar(metresPerPixel: number): {
  label: string;
  metres: number;
  widthPx: number;
} {
  let chosen = SCALE_BAR_CANDIDATES_METRES[SCALE_BAR_CANDIDATES_METRES.length - 1];

  for (const candidate of SCALE_BAR_CANDIDATES_METRES) {
    if (candidate / metresPerPixel >= 60) {
      chosen = candidate;
      break;
    }
  }

  const widthPx = Math.round(chosen / metresPerPixel);
  const label =
    chosen >= 1000 ? `${chosen / 1000} km` : `${chosen} m`;

  return { label, metres: chosen, widthPx };
}

/* -------------------------------- Legend data ------------------------------ */

type LegendItem = { color: string; dash?: number[]; label: string };

function buildLegendItems(): LegendItem[] {
  return [
    { color: VEHICLE_FILL_BY_TIER.arterial, label: "Arterial road" },
    { color: VEHICLE_FILL_BY_TIER.collector, label: "Collector road" },
    { color: VEHICLE_FILL_BY_TIER.local, label: "Local street" },
    { color: VEHICLE_FILL_BY_TIER.service, label: "Service road" },
    { color: PEDESTRIAN_COLOR, dash: [6, 5], label: "Footpath" },
    { color: CYCLEWAY_COLOR, dash: [10, 7], label: "Cycleway" },
    { color: BUILDING_STYLE_BY_TIER.major.fill, label: "Major building" },
    { color: BUILDING_STYLE_BY_TIER.residential.fill, label: "Residential building" },
    { color: BUILDING_STYLE_BY_TIER.auxiliary.fill, label: "Auxiliary building" },
    { color: OPEN_LAND_STYLE_BY_TIER.park.fill, label: "Park / woodland" },
    { color: OPEN_LAND_STYLE_BY_TIER.other.fill, label: "Open land" }
  ];
}

/* ------------------------------- Component -------------------------------- */

export default function CanvasRenderer({ data, onBackToMap }: CanvasRendererProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const stageRef = useRef<Konva.Stage | null>(null);
  const [scale, setScale] = useState(1);
  const [position, setPosition] = useState({ x: 0, y: 0 });
  const [viewport, setViewport] = useState<{ height?: number; width?: number }>({});

  useEffect(() => {
    const element = containerRef.current;
    if (!element || typeof ResizeObserver === "undefined") {
      return;
    }

    const observer = new ResizeObserver((entries) => {
      const rect = entries[0]?.contentRect;

      if (rect) {
        setViewport({ height: rect.height, width: rect.width });
      }
    });

    observer.observe(element);

    return () => observer.disconnect();
  }, []);

  const canvasSize = useMemo(
    () => computeCanvasSize(viewport.width, viewport.height),
    [viewport.height, viewport.width]
  );

  const projected = useMemo(
    () => projectOsmData(data, canvasSize),
    [data, canvasSize]
  );

  // Scale context derived from the fit-to-bbox projection so road widths stay
  // in real-world proportion regardless of the mapped extent.
  const contextRoadScale = useMemo(() => {
    const { bbox } = data;
    const midLat = (bbox.north + bbox.south) / 2;
    const lngSpan = Math.max(bbox.east - bbox.west, 0.000001);
    const latSpan = Math.max(bbox.north - bbox.south, 0.000001);
    const drawableWidth = canvasSize.width - CANVAS_PADDING * 2;
    const drawableHeight = canvasSize.height - CANVAS_PADDING * 2;
    const pxPerDegree = Math.min(drawableWidth / lngSpan, drawableHeight / latSpan);
    const metresPerDegree = 111_320 * Math.cos((midLat * Math.PI) / 180);

    return scaleContextAtZoom(0, Math.log2(metresPerDegree / Math.max(pxPerDegree, 1e-9)));
  }, [data, canvasSize.height, canvasSize.width]);

  const scaleBar = useMemo(
    () => computeScaleBar(contextRoadScale.metresPerPixel),
    [contextRoadScale]
  );
  const legendItems = useMemo(buildLegendItems, []);

  function handleWheel(event: WheelEvent<HTMLDivElement>) {
    event.preventDefault();

    const stage = stageRef.current;
    if (!stage) {
      return;
    }

    const pointer = stage.getPointerPosition();
    if (!pointer) {
      return;
    }

    const scaleBy = 1.08;
    const oldScale = stage.scaleX();
    const nextScale = event.deltaY > 0 ? oldScale / scaleBy : oldScale * scaleBy;
    const clampedScale = Math.min(6, Math.max(0.45, nextScale));
    const mousePointTo = {
      x: (pointer.x - stage.x()) / oldScale,
      y: (pointer.y - stage.y()) / oldScale
    };

    setScale(clampedScale);
    setPosition({
      x: pointer.x - mousePointTo.x * clampedScale,
      y: pointer.y - mousePointTo.y * clampedScale
    });
  }

  function handleExport() {
    const uri = stageRef.current?.toDataURL({ pixelRatio: 2 });

    if (!uri) {
      return;
    }

    const anchor = document.createElement("a");

    anchor.download = "urbancanvas-map.png";
    anchor.href = uri;
    anchor.click();
  }

  return (
    <div className="absolute inset-0 bg-[#101311]" onWheel={handleWheel} ref={containerRef}>
      <div className="absolute left-4 top-4 z-10 flex flex-wrap items-center gap-2 rounded border border-white/10 bg-[#161a18]/95 px-3 py-2 shadow-xl">
        <button
          className="rounded bg-[#f5c542] px-3 py-2 text-sm font-semibold text-[#111412] transition hover:bg-[#ffd85a]"
          onClick={onBackToMap}
          type="button"
        >
          Back to map
        </button>
        <button
          className="rounded border border-white/15 px-3 py-2 text-sm font-medium text-[#efeae0] transition hover:border-white/30"
          onClick={handleExport}
          type="button"
        >
          Export PNG
        </button>
        <CanvasStat label="Buildings" value={data.counts.buildings} />
        <CanvasStat label="Roads" value={data.counts.roads} />
        <CanvasStat label="Open land" value={data.counts.openLand} />
      </div>

      {/* Legend + scale bar: crisp 1px separators, no gradients. */}
      <div className="absolute bottom-4 right-4 z-10 w-56 rounded border border-white/10 bg-[#161a18]/95 px-3 py-2 shadow-xl">
        <p className="border-b border-white/10 pb-1 text-[10px] uppercase tracking-wide text-white/45">
          Legend
        </p>
        <ul className="mt-1 divide-y divide-white/[0.06]">
          {legendItems.map((item) => (
            <li className="flex items-center gap-2 py-1" key={item.label}>
              <span
                aria-hidden
                style={{
                  background: item.color,
                  borderBottom: item.dash ? undefined : `none`,
                  display: "inline-block",
                  height: 4,
                  width: 18,
                  ...(item.dash
                    ? {
                        backgroundImage: `repeating-linear-gradient(to right, ${item.color} 0 ${item.dash[0]}px, transparent ${item.dash[0]}px ${item.dash[0] + item.dash[1]}px)`
                      }
                    : {})
                }}
              />
              <span className="text-[11px] text-[#efeae0]/85">{item.label}</span>
            </li>
          ))}
        </ul>
        <div className="mt-1 border-t border-white/10 pt-1.5">
          <div
            className="h-[3px] border-x border-b border-white/70"
            style={{ width: scaleBar.widthPx }}
          />
          <p className="mt-0.5 text-right text-[10px] text-white/55">{scaleBar.label}</p>
        </div>
      </div>

      <Stage
        draggable
        height={canvasSize.height}
        onDragEnd={(event) => setPosition(event.currentTarget.position())}
        ref={stageRef}
        scaleX={scale}
        scaleY={scale}
        width={canvasSize.width}
        x={position.x}
        y={position.y}
      >
        <Layer>
          <Rect fill="#101311" height={canvasSize.height} width={canvasSize.width} x={0} y={0} />
          {projected.openLand.map((feature) => {
            const style = getOpenLandStyle(feature.tags);

            return (
              <Line
                closed
                fill={style.fill}
                key={`land-${feature.id}`}
                opacity={style.opacity}
                points={feature.points}
                stroke={style.stroke}
                strokeWidth={1}
              />
            );
          })}
          {projected.buildings.map((feature) => {
            const style = getBuildingStyle(feature.tags);

            return (
              <Line
                closed
                fill={style.fill}
                key={`building-${feature.id}`}
                opacity={style.opacity}
                points={feature.points}
                stroke={style.stroke}
                strokeWidth={style.strokeWidth}
              />
            );
          })}
          {projected.paths.map((entry) => {
            const style = getPathStyle(entry.family);
            const widthPx = Math.max(style.minPx, entry.widthPx);

            return (
              <Line
                dash={style.dash}
                key={`path-${entry.feature.id}`}
                lineCap="round"
                lineJoin="round"
                opacity={0.9}
                points={entry.feature.points}
                stroke={style.color}
                strokeWidth={widthPx}
              />
            );
          })}
          {projected.roads.map((feature) => {
            const style = computeContextRoadStyle(feature.kind, contextRoadScale);

            return (
              <Group key={`road-${feature.id}`}>
                <Line
                  lineCap="round"
                  lineJoin="round"
                  opacity={0.94}
                  points={feature.points}
                  stroke={style.casingColor}
                  strokeWidth={style.casingWidthPx}
                />
                <Line
                  lineCap="round"
                  lineJoin="round"
                  opacity={0.94}
                  points={feature.points}
                  stroke={style.color}
                  strokeWidth={style.widthPx}
                />
              </Group>
            );
          })}
        </Layer>
      </Stage>
    </div>
  );
}

const CANVAS_PADDING = 56;

function CanvasStat({ label, value }: { label: string; value: number }) {
  return (
    <div className="min-w-20 rounded border border-white/10 bg-white/[0.04] px-2 py-1.5">
      <p className="text-[10px] uppercase text-white/45">{label}</p>
      <p className="text-sm font-semibold text-white">{value}</p>
    </div>
  );
}

function projectOsmData(data: OsmData, canvasSize: { height: number; width: number }) {
  const projector = createProjector(data.bbox, canvasSize);

  const roads: ProjectedFeature[] = [];
  const paths: Array<{ family: RoadFamily; feature: ProjectedFeature; widthPx: number }> = [];

  for (const feature of data.roads) {
    const projectedFeature = projectFeature(feature, projector);
    const classification = classifyRoadKind(feature.kind);

    if (classification.family === "vehicle") {
      roads.push(projectedFeature);
    } else {
      paths.push({
        family: classification.family,
        feature: projectedFeature,
        widthPx: classification.family === "cycleway" ? 2.4 : 1.8
      });
    }
  }

  return {
    buildings: data.buildings.map((feature) => projectFeature(feature, projector)),
    openLand: data.openLand.map((feature) => projectFeature(feature, projector)),
    paths,
    roads
  };
}

function projectFeature(
  feature: OsmFeature,
  projector: (point: { lat: number; lng: number }) => { x: number; y: number }
): ProjectedFeature {
  return {
    ...feature,
    points: feature.geometry.flatMap((point) => {
      const projected = projector(point);

      return [projected.x, projected.y];
    })
  };
}

function createProjector(bounds: BoundingBox, canvasSize: { height: number; width: number }) {
  const lngSpan = Math.max(bounds.east - bounds.west, 0.000001);
  const latSpan = Math.max(bounds.north - bounds.south, 0.000001);
  const drawableWidth = canvasSize.width - CANVAS_PADDING * 2;
  const drawableHeight = canvasSize.height - CANVAS_PADDING * 2;
  const fitScale = Math.min(drawableWidth / lngSpan, drawableHeight / latSpan);
  const fittedWidth = lngSpan * fitScale;
  const fittedHeight = latSpan * fitScale;
  const offsetX = (canvasSize.width - fittedWidth) / 2;
  const offsetY = (canvasSize.height - fittedHeight) / 2;

  return ({ lat, lng }: { lat: number; lng: number }) => ({
    x: offsetX + (lng - bounds.west) * fitScale,
    y: offsetY + (bounds.north - lat) * fitScale
  });
}
