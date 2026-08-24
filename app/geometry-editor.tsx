"use client";

import type { KonvaEventObject } from "konva/lib/Node";
import { useRef } from "react";
import { Circle, Group, Line } from "react-konva";

import type { DrawingObjectV1 } from "../shared/drawing-document";
import type { LatLng } from "../shared/geo";
import type { Point } from "./canvas-geometry";

/**
 * Vertex/geometry editing overlay for the currently selected object.
 *
 * Handles are pure render output: they live in screen (pixel) space, but every
 * edit is unprojected back to map coordinates before it reaches the drawing
 * model, so geometry data never stores pixels. Visual identity: graphite
 * chrome, #f5c542 accent handles.
 */

const ACCENT = "#f5c542";

export const HANDLE_COLOR = ACCENT;

export const VERTEX_HANDLE_RADIUS_PX = 6;
export const MIDPOINT_HANDLE_RADIUS_PX = 4;
/** Pixel tolerance when picking a handle with a pointer. */
export const HANDLE_HIT_TOLERANCE_PX = 10;

export type ScreenHandle<T> = {
  index: number;
  x: number;
  y: number;
  meta?: T;
};

type ProjectMapPoint = (point: LatLng) => Point;
type UnprojectScreenPoint = (point: Point) => LatLng;

export function buildVertexHandles(
  points: LatLng[],
  projectMapPoint: ProjectMapPoint
): Array<ScreenHandle<LatLng>> {
  return points.map((point, index) => {
    const projected = projectMapPoint(point);

    return { index, meta: point, x: projected.x, y: projected.y };
  });
}

export function buildMidpointHandles(
  points: LatLng[],
  projectMapPoint: ProjectMapPoint
): Array<ScreenHandle<never> & { segmentIndex: number }> {
  return points.slice(0, -1).map((start, segmentIndex) => {
    const end = points[segmentIndex + 1];
    const projected = projectMapPoint({
      lat: (start.lat + end.lat) / 2,
      lng: (start.lng + end.lng) / 2
    });

    return {
      index: segmentIndex,
      meta: undefined as never,
      segmentIndex,
      x: projected.x,
      y: projected.y
    };
  });
}

export function findNearestHandle<T>(
  handles: Array<ScreenHandle<T>>,
  point: Point,
  tolerancePx = HANDLE_HIT_TOLERANCE_PX
): ScreenHandle<T> | null {
  let nearest: ScreenHandle<T> | null = null;
  let nearestDistanceSquared = tolerancePx * tolerancePx;

  for (const handle of handles) {
    const distanceSquared = (handle.x - point.x) ** 2 + (handle.y - point.y) ** 2;

    if (distanceSquared <= nearestDistanceSquared) {
      nearest = handle;
      nearestDistanceSquared = distanceSquared;
    }
  }

  return nearest;
}

export type GeometryEditorOverlayProps = {
  /** Inserts a new vertex on the given segment at the given map point. */
  onAddVertex: (segmentIndex: number, point: LatLng) => void;
  /** Drags an existing vertex to a new map point. */
  onDragVertex: (vertexIndex: number, point: LatLng) => void;
  /** Moves the whole object by a map-coordinate delta. */
  onMoveObject: (delta: { dLat: number; dLng: number }) => void;
  /** Removes the vertex at the given index (context-menu / alt-click). */
  onRemoveVertex: (vertexIndex: number) => void;
  projectMapPoint: ProjectMapPoint;
  unprojectScreenPoint: UnprojectScreenPoint;
  object: DrawingObjectV1;
};

function eventScreenPoint(event: KonvaEventObject<MouseEvent | PointerEvent>): Point | null {
  const stage = event.target.getStage();
  const pointer = stage?.getPointerPosition();

  return pointer ?? null;
}

export function GeometryEditorOverlay({
  object,
  onAddVertex,
  onDragVertex,
  onMoveObject,
  onRemoveVertex,
  projectMapPoint,
  unprojectScreenPoint
}: GeometryEditorOverlayProps) {
  // Whole-object drag start, kept in screen space and unprojected on drop.
  const dragStartRef = useRef<Point | null>(null);

  if (object.geometry.type !== "LineString") {
    return null;
  }

  const points = object.geometry.points;
  const vertexHandles = buildVertexHandles(points, projectMapPoint);
  const midpointHandles = buildMidpointHandles(points, projectMapPoint);
  const flatPoints = vertexHandles.flatMap((handle) => [handle.x, handle.y]);

  function handleVertexDragEnd(event: KonvaEventObject<DragEvent>, vertexIndex: number) {
    const node = event.target;
    const mapPoint = unprojectScreenPoint({ x: node.x(), y: node.y() });

    onDragVertex(vertexIndex, mapPoint);
  }

  function handleBodyDragStart(event: KonvaEventObject<MouseEvent | PointerEvent>) {
    dragStartRef.current = eventScreenPoint(event);
  }

  function handleBodyDragEnd(event: KonvaEventObject<MouseEvent | PointerEvent>) {
    const start = dragStartRef.current;

    dragStartRef.current = null;

    const end = eventScreenPoint(event);

    if (!start || !end) {
      return;
    }

    const startMap = unprojectScreenPoint(start);
    const endMap = unprojectScreenPoint(end);

    onMoveObject({ dLat: endMap.lat - startMap.lat, dLng: endMap.lng - startMap.lng });
  }

  return (
    <Group name="geometry-editor-overlay">
      {/* Thick transparent hit line: dragging anywhere along the object moves it whole. */}
      <Line
        hitStrokeWidth={Math.max(18, 24)}
        name="geometry-move-body"
        onClick={undefined}
        onDragEnd={handleBodyDragEnd}
        onDragStart={handleBodyDragStart}
        draggable
        opacity={0}
        points={flatPoints}
        stroke={ACCENT}
        strokeWidth={20}
      />

      {midpointHandles.map((midpoint) => (
        <Circle
          dash={[3, 3]}
          fill="rgba(245, 197, 66, 0.25)"
          key={`midpoint-${midpoint.index}`}
          name="geometry-midpoint-handle"
          onClick={(event) => {
            event.cancelBubble = true;

            const mapPoint = unprojectScreenPoint({ x: midpoint.x, y: midpoint.y });

            if (mapPoint) {
              onAddVertex(midpoint.segmentIndex, mapPoint);
            }
          }}
          radius={MIDPOINT_HANDLE_RADIUS_PX}
          stroke={ACCENT}
          strokeWidth={1}
          x={midpoint.x}
          y={midpoint.y}
        />
      ))}

      {vertexHandles.map((handle) => (
        <Circle
          draggable
          fill={ACCENT}
          key={`vertex-${handle.index}`}
          name="geometry-vertex-handle"
          onClick={(event) => {
            event.cancelBubble = true;

            if (event.evt.altKey && handle.meta) {
              onRemoveVertex(handle.index);
            }
          }}
          onContextMenu={(event) => {
            event.cancelBubble = true;
            event.evt.preventDefault();

            if (points.length > 2) {
              onRemoveVertex(handle.index);
            }
          }}
          onDragEnd={(event) => handleVertexDragEnd(event, handle.index)}
          radius={VERTEX_HANDLE_RADIUS_PX}
          stroke="#101311"
          strokeWidth={2}
          x={handle.x}
          y={handle.y}
        />
      ))}
    </Group>
  );
}
