import type { DrawingObjectV1, LineGeometry, PointGeometry } from "../shared/drawing-document";
import type { LatLng } from "../shared/geo";

/**
 * Pure geometry-editing operations over the shared V1 drawing model.
 *
 * Everything works in map coordinates (lat/lng, real-world units) — never
 * pixels. Pixel handles in geometry-editor.tsx are render outputs projected
 * through onMapPointToScreen / onScreenPointToMap and unprojected before any
 * operation here runs.
 *
 * All functions are immutable: they never mutate the input arrays or objects,
 * so history snapshots taken by drawing-history.ts stay intact for undo.
 */

export type MapDelta = { dLat: number; dLng: number };

/** Tolerance (degrees) for collapsing a shared endpoint when joining lines. */
const JOIN_ENDPOINT_TOLERANCE = 1e-5;

export function insertVertexAfter(points: LatLng[], segmentIndex: number, point: LatLng): LatLng[] {
  const next = [...points];

  next.splice(segmentIndex + 1, 0, point);

  return next;
}

export function dragVertex(points: LatLng[], vertexIndex: number, point: LatLng): LatLng[] {
  if (vertexIndex < 0 || vertexIndex >= points.length) {
    return [...points];
  }

  return points.map((existing, index) => (index === vertexIndex ? point : existing));
}

export function canRemoveVertex(points: LatLng[], vertexIndex: number): boolean {
  // A line needs at least two vertices to remain drawable.
  return points.length > 2 && vertexIndex >= 0 && vertexIndex < points.length;
}

export function removeVertex(points: LatLng[], vertexIndex: number): LatLng[] | null {
  if (!canRemoveVertex(points, vertexIndex)) {
    return null;
  }

  return points.filter((_, index) => index !== vertexIndex);
}

export function translateLine(points: LatLng[], delta: MapDelta): LatLng[] {
  return points.map((point) => ({
    lat: point.lat + delta.dLat,
    lng: point.lng + delta.dLng
  }));
}

export function translatePoint(point: LatLng, delta: MapDelta): LatLng {
  return {
    lat: point.lat + delta.dLat,
    lng: point.lng + delta.dLng
  };
}

/**
 * Splits a line at an interior vertex into two point lists sharing that
 * vertex. Returns null for endpoint indices (nothing to split) or degenerate
 * halves.
 */
export function splitLineAtVertex(points: LatLng[], vertexIndex: number): [LatLng[], LatLng[]] | null {
  if (vertexIndex <= 0 || vertexIndex >= points.length - 1) {
    return null;
  }

  const head = points.slice(0, vertexIndex + 1);
  const tail = points.slice(vertexIndex);

  if (head.length < 2 || tail.length < 2) {
    return null;
  }

  return [head, tail];
}

const isSamePoint = (a: LatLng, b: LatLng) =>
  Math.abs(a.lat - b.lat) <= JOIN_ENDPOINT_TOLERANCE && Math.abs(a.lng - b.lng) <= JOIN_ENDPOINT_TOLERANCE;

/** Joins two polylines end-to-end; a shared (or near-shared) endpoint appears once. */
export function joinLines(first: LatLng[], second: LatLng[]): LatLng[] {
  if (first.length === 0) {
    return [...second];
  }

  if (second.length === 0) {
    return [...first];
  }

  const lastOfFirst = first[first.length - 1];
  const connectsForward = isSamePoint(lastOfFirst, second[0]);

  if (!connectsForward) {
    return [...first, ...second];
  }

  // Keep the first line's endpoint as the canonical shared vertex so
  // near-tolerance duplicates collapse into one point.
  return [...first.slice(0, -1), lastOfFirst, ...second.slice(1)];
}

/** Returns a new object with replaced line geometry, preserving identity and properties. */
export function applyGeometryToLineObject(
  object: DrawingObjectV1,
  geometry: LineGeometry
): DrawingObjectV1 | null {
  if (object.geometry.type !== "LineString") {
    return null;
  }

  return { ...object, geometry: { ...geometry, points: [...geometry.points] } } as DrawingObjectV1;
}

/** Returns a new object with replaced point geometry, preserving identity and properties. */
export function applyGeometryToPointObject(
  object: DrawingObjectV1,
  point: LatLng
): DrawingObjectV1 | null {
  if (object.geometry.type !== "Point") {
    return null;
  }

  const geometry: PointGeometry = { point: { ...point }, type: "Point" };

  return { ...object, geometry } as DrawingObjectV1;
}

export type { LatLng };
