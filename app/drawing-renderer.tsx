"use client";

import type { KonvaEventObject } from "konva/lib/Node";
import { Circle, Group, Line, Rect, Text } from "react-konva";

import type {
  CyclewayObject,
  FootpathObject,
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
  type ScaleContext
} from "./drawing-style";

/**
 * Scale-aware proposal rendering for the map overlay.
 *
 * All widths are derived at draw time from real-world units through
 * metres-per-pixel; nothing here stores pixels in domain data. Legacy/draft
 * objects without V1 properties keep the previous fixed-width appearance.
 */

const LEGACY_ROAD_WIDTH_PX = 22;
const LEGACY_BIKE_WIDTH_PX = 10;
const LEGACY_SIDEWALK_WIDTH_PX = 6;

export type ProposalLineProperties =
  | RoadObject["properties"]
  | CyclewayObject["properties"]
  | FootpathObject["properties"];

export type RenderedProposalObject =
  | {
      id: string;
      metResPerPixel?: number;
      points: number[];
      properties?: RoadObject["properties"];
      snapped?: boolean;
      strokeWidth?: number;
      type: "road";
    }
  | {
      id: string;
      metResPerPixel?: number;
      points: number[];
      properties?: CyclewayObject["properties"];
      snapped?: boolean;
      strokeWidth?: number;
      type: "bike";
    }
  | {
      id: string;
      metResPerPixel?: number;
      points: number[];
      properties?: FootpathObject["properties"];
      snapped?: boolean;
      strokeWidth?: number;
      type: "sidewalk";
    }
  | {
      end: Point2D;
      id: string;
      metResPerPixel?: number;
      properties?: CrossingProperties;
      start: Point2D;
      strokeWidth?: number;
      type: "crossing";
    }
  | {
      center: Point2D;
      id: string;
      metResPerPixel?: number;
      properties?: RoundaboutProperties;
      radius: number;
      type: "roundabout";
    }
  | {
      id: string;
      metResPerPixel?: number;
      point: Point2D;
      properties?: TrafficSignalObject["properties"];
      type: "signal";
    };

export type CrossingProperties = {
  control: "uncontrolled" | "zebra" | "signal-controlled" | "raised";
};

export type RoundaboutProperties = {
  inscribedCircleDiameterMetres: number;
  lanes: number;
};

type Point2D = { x: number; y: number };

export type StyledDrawingObjectProps = {
  isDraft?: boolean;
  isSelected: boolean;
  metResPerPixel?: number;
  object: RenderedProposalObject;
  onClick?: (event: KonvaEventObject<MouseEvent>) => void;
};

export function StyledDrawingObject({
  isDraft = false,
  isSelected,
  metResPerPixel,
  object,
  onClick
}: StyledDrawingObjectProps) {
  const metresPerPixel = object.metResPerPixel ?? metResPerPixel;
  const context: ScaleContext | null =
    typeof metresPerPixel === "number" && metresPerPixel > 0
      ? { metresPerPixel, metresToPixels: (metres) => metres / metresPerPixel }
      : null;
  const opacity = isDraft ? DRAFT_OPACITY : 1;

  if (object.type === "road") {
    return renderRoad({ context, isSelected, object, onClick, opacity });
  }

  if (object.type === "bike") {
    return renderBike({ context, isSelected, object, onClick, opacity });
  }

  if (object.type === "sidewalk") {
    return renderSidewalk({ context, isSelected, object, onClick, opacity });
  }

  if (object.type === "crossing") {
    return renderCrossing({ isSelected, object });
  }

  if (object.type === "roundabout") {
    return renderRoundabout({ context, isSelected, object, onClick, opacity });
  }

  return renderSignal({ context, isSelected, object, onClick, opacity });
}

function SelectionLine({ points, width }: { points: number[]; width: number }) {
  return (
    <Line lineCap="round" lineJoin="round" opacity={0.34} points={points} stroke={SELECTION_ACCENT_COLOR} strokeWidth={width} />
  );
}

function offsetPoints(points: number[], centerIndex: number, ratio: number): number[] {
  // Shift every vertex perpendicular to the segment direction by ratio * half-width.
  const output: number[] = [];

  for (let index = 0; index < points.length - 1; index += 2) {
    const x = points[index];
    const y = points[index + 1];
    const nextX = points[index + 2] ?? x;
    const nextY = points[index + 3] ?? y;
    const length = Math.hypot(nextX - x, nextY - y) || 1;
    const normalX = (-(nextY - y) / length) * centerIndex * ratio;
    const normalY = ((nextX - x) / length) * centerIndex * ratio;

    output.push(x + normalX, y + normalY);
  }
  // Duplicate the final vertex to keep point count consistent.
  output.push(output[output.length - 2], output[output.length - 1]);

  return output;
}

function renderRoad({
  context,
  isSelected,
  object,
  onClick,
  opacity
}: {
  context: ScaleContext | null;
  isSelected: boolean;
  object: Extract<RenderedProposalObject, { type: "road" }>;
  onClick?: (event: KonvaEventObject<MouseEvent>) => void;
  opacity: number;
}) {
  const widthPx =
    context && object.properties
      ? computeRoadStyle(
          {
            geometry: { points: [], type: "LineString" },
            id: object.id,
            properties: object.properties,
            type: "road"
          },
          context
        )
      : null;
  const carriagewayWidth = widthPx?.carriageway.widthPx ?? object.strokeWidth ?? LEGACY_ROAD_WIDTH_PX;
  const casingWidth = widthPx?.casing.widthPx ?? carriagewayWidth + 4;

  return (
    <Group onClick={onClick} opacity={opacity}>
      <Line
        lineCap="round"
        lineJoin="round"
        points={object.points}
        stroke={widthPx?.casing.color ?? "#141819"}
        strokeWidth={casingWidth}
      />
      <Line
        lineCap="round"
        lineJoin="round"
        points={object.points}
        stroke={widthPx?.carriageway.color ?? "#222729"}
        strokeWidth={carriagewayWidth}
      />
      {(widthPx?.laneSeparatorOffsetRatios ?? []).map((ratio) => (
        <Line
          dash={[7, 9]}
          key={ratio}
          lineCap="round"
          lineJoin="round"
          points={offsetPoints(object.points, carriagewayWidth / 2, ratio)}
          stroke={widthPx?.laneSeparatorColor ?? "#8f9a94"}
          strokeWidth={1}
        />
      ))}
      {widthPx?.showCenterline ? (
        <Line dash={[12, 10]} lineCap="round" lineJoin="round" points={object.points} stroke="#d8d2c4" strokeWidth={1.5} />
      ) : null}
      {isSelected ? <SelectionLine points={object.points} width={casingWidth + 7} /> : null}
    </Group>
  );
}

function renderBike({
  context,
  isSelected,
  object,
  onClick,
  opacity
}: {
  context: ScaleContext | null;
  isSelected: boolean;
  object: Extract<RenderedProposalObject, { type: "bike" }>;
  onClick?: (event: KonvaEventObject<MouseEvent>) => void;
  opacity: number;
}) {
  const style =
    context && object.properties
      ? computeCyclewayStyle(
          {
            geometry: { points: [], type: "LineString" },
            id: object.id,
            properties: object.properties,
            type: "cycleway"
          },
          context
        )
      : null;
  const bikeWidth = style?.widthPx ?? object.strokeWidth ?? LEGACY_BIKE_WIDTH_PX;

  return (
    <Group onClick={onClick} opacity={opacity}>
      {style && style.bufferWidthPx > 0 ? (
        <Line
          lineCap="round"
          lineJoin="round"
          points={object.points}
          stroke="rgba(216, 210, 196, 0.35)"
          strokeWidth={style.totalWidthPx}
        />
      ) : null}
      <Line
        lineCap="round"
        lineJoin="round"
        points={object.points}
        stroke={style?.fill ?? "#22c55e"}
        strokeWidth={bikeWidth}
      />
      <Line
        {...(style?.edgeStyle === "dashed" ? { dash: [6, 7] } : {})}
        lineCap="round"
        lineJoin="round"
        points={object.points}
        opacity={style && style.edgeStyle === "none" ? 0 : 1}
        stroke="#ddffe9"
        strokeWidth={style?.edgeStyle === "solid" ? 2 : 1.5}
      />
      {isSelected ? <SelectionLine points={object.points} width={bikeWidth + 7} /> : null}
    </Group>
  );
}

function renderSidewalk({
  context,
  isSelected,
  object,
  onClick,
  opacity
}: {
  context: ScaleContext | null;
  isSelected: boolean;
  object: Extract<RenderedProposalObject, { type: "sidewalk" }>;
  onClick?: (event: KonvaEventObject<MouseEvent>) => void;
  opacity: number;
}) {
  const style =
    context && object.properties
      ? computeFootpathStyle(
          {
            geometry: { points: [], type: "LineString" },
            id: object.id,
            properties: object.properties,
            type: "footpath"
          },
          context
        )
      : null;
  const pathWidth = style?.clearWidthPx ?? object.strokeWidth ?? LEGACY_SIDEWALK_WIDTH_PX;

  return (
    <Group onClick={onClick} opacity={opacity}>
      <Line
        lineCap="round"
        lineJoin="round"
        points={object.points}
        stroke={style?.surfaceFill ?? "#e5e7eb"}
        strokeWidth={pathWidth}
      />
      {style?.edgeStyle === "curb" ? (
        <Line lineCap="round" lineJoin="round" points={object.points} stroke={style.curbColor} strokeWidth={1} />
      ) : null}
      {style?.edgeStyle === "dashed-edge" ? (
        <Line dash={[4, 6]} lineCap="round" lineJoin="round" points={object.points} stroke={style.curbColor} strokeWidth={1} />
      ) : null}
      {style?.continuityIndicator ? (
        <Circle fill={SELECTION_ACCENT_COLOR} opacity={0.85} radius={2.5} x={object.points[0]} y={object.points[1]} />
      ) : null}
      {isSelected ? <SelectionLine points={object.points} width={pathWidth + 7} /> : null}
    </Group>
  );
}

function renderCrossing({
  isSelected,
  object
}: {
  isSelected: boolean;
  object: Extract<RenderedProposalObject, { type: "crossing" }>;
}) {
  const dx = object.end.x - object.start.x;
  const dy = object.end.y - object.start.y;
  const angle = (Math.atan2(dy, dx) * 180) / Math.PI;
  const length = Math.hypot(dx, dy);
  const midpoint = { x: (object.start.x + object.end.x) / 2, y: (object.start.y + object.end.y) / 2 };
  const bodyHeight = Math.max(16, object.strokeWidth ?? 28);
  const stripes = computeCrossingStripes(object.properties ?? { control: "zebra" }, { lengthPx: length, widthPx: bodyHeight });
  const stripeHeight = bodyHeight - 4;
  const stripeOffsets = Array.from({ length: stripes.count }, (_, index) => (-length / 2 + (length * (index + 0.5)) / stripes.count));

  return (
    <Group opacity={1} rotation={angle} x={midpoint.x} y={midpoint.y}>
      <Rect fill="#1f2425" height={bodyHeight} offsetX={length / 2} offsetY={bodyHeight / 2} width={length} />
      {stripeOffsets.map((x) => (
        <Rect
          fill="#f8fafc"
          height={stripeHeight}
          key={x}
          offsetX={stripes.stripeWidthPx / 2}
          offsetY={stripeHeight / 2}
          width={Math.max(2, stripes.stripeWidthPx)}
          x={x}
          y={0}
        />
      ))}
      <Rect
        height={bodyHeight + 6}
        offsetX={length / 2}
        offsetY={(bodyHeight + 6) / 2}
        stroke={isSelected ? SELECTION_ACCENT_COLOR : "transparent"}
        strokeWidth={isSelected ? 2 : 0}
        width={length}
      />
    </Group>
  );
}

function renderRoundabout({
  context,
  isSelected,
  object,
  onClick,
  opacity
}: {
  context: ScaleContext | null;
  isSelected: boolean;
  object: Extract<RenderedProposalObject, { type: "roundabout" }>;
  onClick?: (event: KonvaEventObject<MouseEvent>) => void;
  opacity: number;
}) {
  const style =
    context && object.properties
      ? computeRoundaboutStyle(
          {
            geometry: { point: { lat: 0, lng: 0 }, type: "Point" },
            id: object.id,
            properties: object.properties,
            type: "roundabout"
          },
          context
        )
      : null;

  return (
    <Group onClick={onClick} opacity={opacity}>
      <Circle fill="rgba(31, 36, 37, 0.78)" radius={object.radius} stroke="#d8d2c4" strokeWidth={4} x={object.center.x} y={object.center.y} />
      {(style?.laneRingRadiiRatios ?? []).map((ratio) => (
        <Circle
          dash={[10, 8]}
          key={ratio}
          radius={object.radius * ratio}
          stroke={style?.ringColor ?? "#d8d2c4"}
          strokeWidth={1.5}
          x={object.center.x}
          y={object.center.y}
        />
      ))}
      <Circle
        fill="rgba(16, 19, 17, 0.75)"
        radius={Math.max(8, object.radius * 0.42)}
        stroke={SELECTION_ACCENT_COLOR}
        strokeWidth={isSelected ? 3 : 1.5}
        x={object.center.x}
        y={object.center.y}
      />
      {[0, 90, 180, 270].map((rotation) => (
        <Line
          key={rotation}
          points={[object.center.x, object.center.y - object.radius, object.center.x, object.center.y - object.radius - 20]}
          rotation={rotation}
          stroke="#1f2425"
          strokeWidth={10}
        />
      ))}
    </Group>
  );
}

function renderSignal({
  context,
  isSelected,
  object,
  onClick,
  opacity
}: {
  context: ScaleContext | null;
  isSelected: boolean;
  object: Extract<RenderedProposalObject, { type: "signal" }>;
  onClick?: (event: KonvaEventObject<MouseEvent>) => void;
  opacity: number;
}) {
  const style =
    context && object.properties
      ? computeSignalStyle(
          {
            geometry: { point: { lat: 0, lng: 0 }, type: "Point" },
            id: object.id,
            properties: object.properties,
            type: "traffic-signal"
          },
          context
        )
      : null;
  const radius = style?.radiusPx ?? 13;
  const fontSize = Math.max(9, Math.round(radius));

  return (
    <Group onClick={onClick} opacity={opacity} x={object.point.x} y={object.point.y}>
      {/* Pole */}
      <Rect fill="#94a3b8" height={radius * 1.4} offsetX={1} width={2} y={-radius * 1.4} />
      <Circle fill={style?.fill ?? "#60a5fa"} radius={radius} stroke={isSelected ? SELECTION_ACCENT_COLOR : "#dbeafe"} strokeWidth={2} />
      <Text align="center" fill="#101311" fontSize={fontSize} fontStyle="bold" text={style?.label ?? "T"} width={radius * 2} x={-radius} y={-fontSize * 0.65} />
    </Group>
  );
}
