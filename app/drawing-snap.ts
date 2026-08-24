import type { DrawingObjectV1 } from "../shared/drawing-document";
import type { LatLng } from "../shared/geo";
import { interpolateLatLng } from "../shared/geo";
import { metresPerPixelAt } from "./drawing-document-bridge";

/**
 * Pure snap-resolution logic for network-continuity drawing.
 *
 * Everything resolves in MAP coordinates (lat/lng) against real-world metre
 * distances; the configurable screen threshold is converted through
 * metresPerPixelAt and clamped by sanity limits so zoom extremes can never
 * produce absurd snap radii. Screen positions are carried alongside so the
 * UI can preview the exact connection without re-projecting.
 */

export type SnapKind = "endpoint" | "segment" | "perpendicular" | "intersection";
export type SnapSource = "osm" | "proposal";
export type SnapTargetKind = "endpoint" | "segment" | "intersection" | "circumference";

export type ScreenPoint = { x: number; y: number };

export type SnapTarget =
  | {
      kind: "endpoint" | "intersection" | "circumference";
      id: string;
      mapPoint: LatLng;
      screenPoint: ScreenPoint;
      source: SnapSource;
    }
  | {
      kind: "segment";
      id: string;
      mapEnd: LatLng;
      mapStart: LatLng;
      screenEnd: ScreenPoint;
      screenStart: ScreenPoint;
      segmentIndex: number;
      source: SnapSource;
    };

export type ResolvedSnap = {
  /** Distance from the pointer to the snap point, in metres. */
  distanceMetres: number;
  kind: SnapKind;
  mapPoint: LatLng;
  screenPoint: ScreenPoint;
  target: SnapTarget;
};

export type SnapConfig = {
  latitudeDegrees: number;
  screenThresholdPx: number;
  zoom: number;
};

export type OsmRoadLike = {
  geometry: LatLng[];
  id: number | string;
};

export type BuildSnapTargetsOptions = {
  metresToPixels?: (metres: number, at: LatLng) => number;
  osmRoads: OsmRoadLike[];
  project: (point: LatLng) => ScreenPoint;
  proposalObjects: DrawingObjectV1[];
};

/** Sanity clamps on the map-space snap radius, whatever the zoom says. */
export const MIN_SNAP_DISTANCE_METRES = 0.5;
export const MAX_SNAP_DISTANCE_METRES = 50;

/** Default screen threshold in pixels, converted per-view via snapThresholdMetres. */
export const DEFAULT_SNAP_THRESHOLD_PX = 34;

const METRES_PER_DEGREE_LATITUDE = 110_574;
const CIRCUMFERENCE_POINT_COUNT = 8;
const MIN_CIRCUMFERENCE_RADIUS_PX = 8;

// Priority when several candidates fall inside the threshold: exact network
// nodes beat crossings, crossings beat riding along a segment body.
const KIND_PRIORITY: Record<SnapTargetKind, number> = {
  circumference: 3,
  endpoint: 3,
  intersection: 2,
  segment: 1
};

/**
 * The configured screen threshold converted into real-world metres via
 * metresPerPixelAt, clamped between the sanity limits.
 */
export function snapThresholdMetres(config: SnapConfig): number {
  const raw = config.screenThresholdPx * metresPerPixelAt(config.latitudeDegrees, config.zoom);

  return Math.max(MIN_SNAP_DISTANCE_METRES, Math.min(MAX_SNAP_DISTANCE_METRES, raw));
}

type LocalFrame = {
  cosLatitude: number;
  origin: LatLng;
};

function localFrame(origin: LatLng): LocalFrame {
  return {
    cosLatitude: Math.cos((origin.lat * Math.PI) / 180),
    origin
  };
}

function toLocal(point: LatLng, frame: LocalFrame): ScreenPoint {
  return {
    x: (point.lng - frame.origin.lng) * METRES_PER_DEGREE_LATITUDE * frame.cosLatitude,
    y: (point.lat - frame.origin.lat) * METRES_PER_DEGREE_LATITUDE
  };
}

function fromLocal(offset: ScreenPoint, frame: LocalFrame): LatLng {
  return {
    lat: frame.origin.lat + offset.y / METRES_PER_DEGREE_LATITUDE,
    lng: frame.origin.lng + offset.x / (METRES_PER_DEGREE_LATITUDE * frame.cosLatitude)
  };
}

function distance(a: ScreenPoint, b: ScreenPoint): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

export type ResolveOptions = {
  /**
   * How to report an interior (non-endpoint) segment projection. Crossing
   * placement asks for "perpendicular" alignment across the carriageway;
   * general line drawing reports plain "segment".
   */
  interiorSnapKind?: "segment" | "perpendicular";
};

/**
 * Resolves the best snap for a pointer position against the given targets.
 * Point-like network nodes (endpoints, intersections, roundabout
 * circumference) win over segment bodies; nearer candidates win ties inside
 * a priority class. Returns null when nothing is within the threshold.
 */
export function resolveSnap(
  pointer: { map: LatLng; screen: ScreenPoint },
  targets: readonly SnapTarget[],
  config: SnapConfig,
  options: ResolveOptions = {}
): ResolvedSnap | null {
  const threshold = snapThresholdMetres(config);
  const frame = localFrame(pointer.map);
  const pointerLocal = { x: 0, y: 0 };
  const interiorKind = options.interiorSnapKind ?? "segment";

  let best: ResolvedSnap | null = null;
  let bestDistance = Number.POSITIVE_INFINITY;
  let bestPriority = -1;

  const consider = (candidate: ResolvedSnap, priority: number) => {
    if (candidate.distanceMetres > threshold) {
      return;
    }

    const better =
      priority > bestPriority ||
      (priority === bestPriority && candidate.distanceMetres < bestDistance);

    if (better) {
      best = candidate;
      bestPriority = priority;
      bestDistance = candidate.distanceMetres;
    }
  };

  for (const target of targets) {
    if (target.kind === "segment") {
      const start = toLocal(target.mapStart, frame);
      const end = toLocal(target.mapEnd, frame);
      const dx = end.x - start.x;
      const dy = end.y - start.y;
      const lengthSquared = dx * dx + dy * dy;
      const t =
        lengthSquared === 0 ? 0 : Math.max(0, Math.min(1, -(start.x * dx + start.y * dy) / lengthSquared));
      const closest = { x: start.x + dx * t, y: start.y + dy * t };
      const interior = t > 0 && t < 1;

      consider(
        {
          distanceMetres: distance(pointerLocal, closest),
          kind: interior ? interiorKind : "endpoint",
          mapPoint: interpolateLatLng(target.mapStart, target.mapEnd, t),
          screenPoint: {
            x: target.screenStart.x + (target.screenEnd.x - target.screenStart.x) * t,
            y: target.screenStart.y + (target.screenEnd.y - target.screenStart.y) * t
          },
          target
        },
        interior ? KIND_PRIORITY.segment : KIND_PRIORITY.endpoint
      );
      continue;
    }

    const local = toLocal(target.mapPoint, frame);

    consider(
      {
        distanceMetres: distance(pointerLocal, local),
        kind: target.kind === "intersection" ? "intersection" : "endpoint",
        mapPoint: target.mapPoint,
        screenPoint: target.screenPoint,
        target
      },
      KIND_PRIORITY[target.kind]
    );
  }

  if (!best || bestPriority < 0) {
    return null;
  }

  return best;
}

/**
 * Collects every snap candidate: OSM segment bodies and endpoints, proposal
 * object geometry (line endpoints/bodies, point objects), precomputed
 * intersections between different OSM roads, and roundabout circumference
 * connection points so entries land on the ring itself.
 */
export function buildSnapTargets(options: BuildSnapTargetsOptions): SnapTarget[] {
  const { metresToPixels, osmRoads, project, proposalObjects } = options;
  const targets: SnapTarget[] = [];

  const addLineTargets = (id: string, source: SnapSource, points: LatLng[]) => {
    if (points.length === 0) {
      return;
    }

    targets.push({
      id,
      kind: "endpoint",
      mapPoint: points[0],
      screenPoint: project(points[0]),
      source
    });
    targets.push({
      id,
      kind: "endpoint",
      mapPoint: points[points.length - 1],
      screenPoint: project(points[points.length - 1]),
      source
    });

    for (let index = 0; index < points.length - 1; index += 1) {
      targets.push({
        id,
        kind: "segment",
        mapEnd: points[index + 1],
        mapStart: points[index],
        screenEnd: project(points[index + 1]),
        screenStart: project(points[index]),
        segmentIndex: index,
        source
      });
    }
  };

  const addPointTarget = (id: string, source: SnapSource, point: LatLng) => {
    targets.push({ id, kind: "endpoint", mapPoint: point, screenPoint: project(point), source });
  };

  for (const road of osmRoads) {
    addLineTargets(String(road.id), "osm", road.geometry);
  }

  for (const object of proposalObjects) {
    if (object.geometry.type === "LineString") {
      addLineTargets(object.id, "proposal", object.geometry.points);
      continue;
    }

    if (object.type === "roundabout") {
      addTargetsWithCircumference(object, targets, project, metresToPixels);
      continue;
    }

    addPointTarget(object.id, "proposal", object.geometry.point);
  }

  targets.push(...findOsmIntersections(osmRoads, project));

  return targets;
}

function addTargetsWithCircumference(
  object: Extract<DrawingObjectV1, { type: "roundabout" }>,
  targets: SnapTarget[],
  project: (point: LatLng) => ScreenPoint,
  metresToPixels: BuildSnapTargetsOptions["metresToPixels"]
): void {
  const center = object.geometry.point;
  // Derive the ring in real metres from the property so connection points
  // stay valid at any zoom; the pixel converter (when supplied) only sets a
  // minimum on-screen radius so tiny roundabouts stay grabbable.
  const ringRadiusMetres = Math.max(
    object.properties.inscribedCircleDiameterMetres / 2,
    metresToPixels ? MIN_CIRCUMFERENCE_RADIUS_PX * metresPerPixelAt(center.lat, 0) : 0
  );

  for (let index = 0; index < CIRCUMFERENCE_POINT_COUNT; index += 1) {
    const angle = (Math.PI * 2 * index) / CIRCUMFERENCE_POINT_COUNT;
    const mapPoint: LatLng = {
      lat: center.lat + (Math.sin(angle) * ringRadiusMetres) / METRES_PER_DEGREE_LATITUDE,
      lng:
        center.lng +
        (Math.cos(angle) * ringRadiusMetres) /
          (METRES_PER_DEGREE_LATITUDE * Math.cos((center.lat * Math.PI) / 180))
    };

    targets.push({
      id: object.id,
      kind: "circumference",
      mapPoint,
      screenPoint: project(mapPoint),
      source: "proposal"
    });
  }
}

/** Intersections between segments of DIFFERENT roads, in map coordinates. */
function findOsmIntersections(roads: OsmRoadLike[], project: (point: LatLng) => ScreenPoint): SnapTarget[] {
  const intersections: SnapTarget[] = [];

  for (let a = 0; a < roads.length; a += 1) {
    const roadA = roads[a];

    if (roadA.geometry.length < 2) {
      continue;
    }

    for (let b = a + 1; b < roads.length; b += 1) {
      const roadB = roads[b];

      if (roadB.geometry.length < 2) {
        continue;
      }

      for (let i = 0; i < roadA.geometry.length - 1; i += 1) {
        for (let j = 0; j < roadB.geometry.length - 1; j += 1) {
          const hit = segmentIntersection(roadA.geometry[i], roadA.geometry[i + 1], roadB.geometry[j], roadB.geometry[j + 1]);

          if (!hit) {
            continue;
          }

          intersections.push({
            id: `intersection:${roadA.id}:${i}:${roadB.id}:${j}`,
            kind: "intersection",
            mapPoint: hit,
            screenPoint: project(hit),
            source: "osm"
          });
        }
      }
    }
  }

  return intersections;
}

function segmentIntersection(p1: LatLng, p2: LatLng, p3: LatLng, p4: LatLng): LatLng | null {
  const frame = localFrame(p1);
  const a = { x: 0, y: 0 };
  const b = toLocal(p2, frame);
  const c = toLocal(p3, frame);
  const d = toLocal(p4, frame);
  const r = { x: b.x - a.x, y: b.y - a.y };
  const s = { x: d.x - c.x, y: d.y - c.y };
  const denominator = r.x * s.y - r.y * s.x;

  if (denominator === 0) {
    return null;
  }

  const t = ((c.x - a.x) * s.y - (c.y - a.y) * s.x) / denominator;
  const u = ((c.x - a.x) * r.y - (c.y - a.y) * r.x) / denominator;

  if (t <= 0 || t >= 1 || u <= 0 || u >= 1) {
    return null;
  }

  return fromLocal({ x: r.x * t, y: r.y * t }, frame);
}
