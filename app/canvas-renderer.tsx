"use client";

import { useMemo, useRef, useState } from "react";
import type { WheelEvent } from "react";
import { Layer, Line, Rect, Stage } from "react-konva";
import type Konva from "konva";

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

const canvasWidth = 1200;
const canvasHeight = 820;
const canvasPadding = 56;

export default function CanvasRenderer({ data, onBackToMap }: CanvasRendererProps) {
  const stageRef = useRef<Konva.Stage | null>(null);
  const [scale, setScale] = useState(1);
  const [position, setPosition] = useState({ x: 0, y: 0 });

  const projected = useMemo(() => projectOsmData(data), [data]);

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

  return (
    <div className="absolute inset-0 bg-[#101311]" onWheel={handleWheel}>
      <div className="absolute left-4 top-4 z-10 flex flex-wrap items-center gap-2 rounded border border-white/10 bg-[#161a18]/95 px-3 py-2 shadow-xl">
        <button
          className="rounded bg-[#f5c542] px-3 py-2 text-sm font-semibold text-[#111412] transition hover:bg-[#ffd85a]"
          onClick={onBackToMap}
          type="button"
        >
          Back to map
        </button>
        <CanvasStat label="Buildings" value={data.counts.buildings} />
        <CanvasStat label="Roads" value={data.counts.roads} />
        <CanvasStat label="Open land" value={data.counts.openLand} />
      </div>

      <Stage
        draggable
        height={canvasHeight}
        onDragEnd={(event) => setPosition(event.currentTarget.position())}
        ref={stageRef}
        scaleX={scale}
        scaleY={scale}
        width={canvasWidth}
        x={position.x}
        y={position.y}
      >
        <Layer>
          <Rect fill="#101311" height={canvasHeight} width={canvasWidth} x={0} y={0} />
          {projected.openLand.map((feature) => (
            <Line
              closed
              fill="#4d7f58"
              key={`land-${feature.id}`}
              opacity={0.72}
              points={feature.points}
              stroke="#6ea978"
              strokeWidth={1}
            />
          ))}
          {projected.buildings.map((feature) => (
            <Line
              closed
              fill="#8c9190"
              key={`building-${feature.id}`}
              opacity={0.82}
              points={feature.points}
              stroke="#c1c7c4"
              strokeWidth={0.8}
            />
          ))}
          {projected.roads.map((feature) => (
            <Line
              key={`road-${feature.id}`}
              lineCap="round"
              lineJoin="round"
              opacity={0.94}
              points={feature.points}
              stroke={getRoadColor(feature.kind)}
              strokeWidth={getRoadWidth(feature.kind)}
            />
          ))}
        </Layer>
      </Stage>
    </div>
  );
}

function CanvasStat({ label, value }: { label: string; value: number }) {
  return (
    <div className="min-w-20 rounded border border-white/10 bg-white/[0.04] px-2 py-1.5">
      <p className="text-[10px] uppercase text-white/45">{label}</p>
      <p className="text-sm font-semibold text-white">{value}</p>
    </div>
  );
}

function projectOsmData(data: OsmData) {
  const projector = createProjector(data.bbox);

  return {
    buildings: data.buildings.map((feature) => projectFeature(feature, projector)),
    roads: data.roads.map((feature) => projectFeature(feature, projector)),
    openLand: data.openLand.map((feature) => projectFeature(feature, projector))
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

function createProjector(bounds: BoundingBox) {
  const lngSpan = Math.max(bounds.east - bounds.west, 0.000001);
  const latSpan = Math.max(bounds.north - bounds.south, 0.000001);
  const drawableWidth = canvasWidth - canvasPadding * 2;
  const drawableHeight = canvasHeight - canvasPadding * 2;
  const fitScale = Math.min(drawableWidth / lngSpan, drawableHeight / latSpan);
  const fittedWidth = lngSpan * fitScale;
  const fittedHeight = latSpan * fitScale;
  const offsetX = (canvasWidth - fittedWidth) / 2;
  const offsetY = (canvasHeight - fittedHeight) / 2;

  return ({ lat, lng }: { lat: number; lng: number }) => ({
    x: offsetX + (lng - bounds.west) * fitScale,
    y: offsetY + (bounds.north - lat) * fitScale
  });
}

function getRoadWidth(kind: string) {
  if (["motorway", "trunk", "primary"].includes(kind)) {
    return 8;
  }

  if (["secondary", "tertiary"].includes(kind)) {
    return 5;
  }

  if (["residential", "unclassified", "service"].includes(kind)) {
    return 3;
  }

  return 1.6;
}

function getRoadColor(kind: string) {
  if (["footway", "path", "pedestrian", "cycleway"].includes(kind)) {
    return "#5f6866";
  }

  return "#2d3332";
}
