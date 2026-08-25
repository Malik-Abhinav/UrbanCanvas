/**
 * Cycling and road-design feedback (Task 23).
 *
 * Rule-based review of a drawing document's cycleways, roads, crossings,
 * roundabouts, and signals: protection continuity along a route, abrupt
 * cycle-lane terminations, direction mismatches between joined segments,
 * implausible widths/lane counts, missing transitions at intersections,
 * roundabout/cycle conflict points, and signal/crossing coordination.
 *
 * All checks are HEURISTICS over drawn geometry and declared properties —
 * planning aids for concept design, not engineering certification.
 */

import type {
  CrossingObject,
  CyclewayObject,
  DrawingDocumentV1,
  DrawingObjectV1,
  RoadObject,
  TrafficSignalObject
} from "./drawing-document";
import type { LatLng } from "./geo";
import { distanceMetres } from "./geo";

export type CyclingFeedbackIssue = {
  code:
    | "protection-discontinuity"
    | "abrupt-termination"
    | "direction-conflict"
    | "implausible-width"
    | "implausible-road-section"
    | "missing-intersection-transition"
    | "roundabout-cycle-conflict"
    | "uncoordinated-signal-crossing"
    | "orphaned-signal";
  objectIds: string[];
  message: string;
};

export type CyclingAnalysisOptions = {
  /** Two cycleway ends closer than this count as connected. */
  connectionToleranceMetres?: number;
  /** Distance within which a crossing counts as serving a junction/approach. */
  transitionToleranceMetres?: number;
};

export type CyclingAnalysisResult = {
  heuristicDisclaimer: string;
  issues: CyclingFeedbackIssue[];
  cyclewayCount: number;
  protectedLengthMeters: number;
  paintedLengthMeters: number;
};

export const CYCLING_HEURISTIC_DISCLAIMER =
  "Heuristic cycling and road-design feedback based on drawn geometry and declared properties only. Not an engineering certification of safety or standards compliance.";

const DEFAULT_CONNECTION_TOLERANCE_METRES = 5;
const DEFAULT_TRANSITION_TOLERANCE_METRES = 25;

/** Two-way cycle lanes below this width are uncomfortable for opposing flows. */
const MIN_TWO_WAY_WIDTH_METRES = 3;
/** One-way cycle lanes below this width force riders into the door zone. */
const MIN_ONE_WAY_WIDTH_METRES = 1.5;
/** Anything wider than this is likely a mislabeled path, not a cycle lane. */
const MAX_CYCLEWAY_WIDTH_METRES = 6;
/** Road sections beyond these are implausible for a single carriageway. */
const MAX_ROAD_LANES = 8;
const MIN_LANE_WIDTH_METRES = 2.5;
const MAX_LANE_WIDTH_METRES = 4.5;

type LineObject = { id: string; points: LatLng[] };

function linePoints(object: DrawingObjectV1): LatLng[] | undefined {
  return object.geometry.type === "LineString" ? object.geometry.points : undefined;
}

function pointOf(object: DrawingObjectV1): LatLng | undefined {
  return object.geometry.type === "Point" ? object.geometry.point : undefined;
}

function endpointsOf(object: LineObject): [LatLng, LatLng] {
  return [object.points[0], object.points[object.points.length - 1]];
}

/** Minimum distance from a point to any vertex of the line objects. */
function minDistanceToPoint(point: LatLng, lines: LineObject[]): number {
  let best = Number.POSITIVE_INFINITY;
  for (const line of lines) {
    for (let i = 0; i < line.points.length; i += 1) {
      const metres =
        i === 0
          ? distanceMetres(point, line.points[0])
          : segmentDistanceMetres(point, line.points[i - 1], line.points[i]);
      if (metres < best) best = metres;
    }
  }
  return best;
}

const EARTH_RADIUS_METRES = 6_371_000;
const DEGREES_TO_RADIANS = Math.PI / 180;

/**
 * Distance from a point to a great-circle-ish segment, approximated in a
 * local equirectangular frame centred on the segment midpoint (fine at the
 * street scale these heuristics operate on).
 */
function segmentDistanceMetres(point: LatLng, a: LatLng, b: LatLng): number {
  const cosLat = Math.cos(((a.lat + b.lat) / 2) * DEGREES_TO_RADIANS);
  const ax = a.lng * cosLat * DEGREES_TO_RADIANS * EARTH_RADIUS_METRES;
  const ay = a.lat * DEGREES_TO_RADIANS * EARTH_RADIUS_METRES;
  const bx = b.lng * cosLat * DEGREES_TO_RADIANS * EARTH_RADIUS_METRES;
  const by = b.lat * DEGREES_TO_RADIANS * EARTH_RADIUS_METRES;
  const px = point.lng * cosLat * DEGREES_TO_RADIANS * EARTH_RADIUS_METRES;
  const py = point.lat * DEGREES_TO_RADIANS * EARTH_RADIUS_METRES;

  const dx = bx - ax;
  const dy = by - ay;
  const lengthSquared = dx * dx + dy * dy;
  if (lengthSquared === 0) return Math.hypot(px - ax, py - ay);
  let t = ((px - ax) * dx + (py - ay) * dy) / lengthSquared;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

/**
 * True when two line objects share an end (within tolerance) — joined
 * segments of what a designer would read as one continuous facility.
 */
function shareEndpoint(a: LineObject, b: LineObject[], toleranceMetres: number): boolean {
  const [startA, endA] = endpointsOf(a);
  for (const other of b) {
    const [startB, endB] = endpointsOf(other);
    const pairs: Array<[LatLng, LatLng]> = [
      [startA, startB],
      [startA, endB],
      [endA, startB],
      [endA, endB]
    ];
    if (pairs.some(([p1, p2]) => distanceMetres(p1, p2) <= toleranceMetres)) return true;
  }
  return false;
}

/** Union-find grouping of cycleway lines joined at shared endpoints. */
function groupCycleChains(lines: LineObject[], toleranceMetres: number): LineObject[][] {
  const parent = lines.map((_, index) => index);
  const find = (index: number): number => {
    while (parent[index] !== index) {
      parent[index] = parent[parent[index]];
      index = parent[index];
    }
    return index;
  };

  for (let i = 0; i < lines.length; i += 1) {
    for (let j = i + 1; j < lines.length; j += 1) {
      if (shareEndpoint(lines[i], [lines[j]], toleranceMetres)) {
        parent[find(i)] = find(j);
      }
    }
  }

  const byRoot = new Map<number, LineObject[]>();
  lines.forEach((line, index) => {
    const root = find(index);
    const group = byRoot.get(root);
    if (group) group.push(line);
    else byRoot.set(root, [line]);
  });
  return [...byRoot.values()];
}

function lengthMeters(points: LatLng[]): number {
  let total = 0;
  for (let i = 1; i < points.length; i += 1) total += distanceMetres(points[i - 1], points[i]);
  return total;
}

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

function isCycleway(object: DrawingObjectV1): object is CyclewayObject {
  return object.type === "cycleway";
}

function isCrossing(object: DrawingObjectV1): object is CrossingObject {
  return object.type === "crossing";
}

function isRoad(object: DrawingObjectV1): object is RoadObject {
  return object.type === "road";
}

function isSignal(object: DrawingObjectV1): object is TrafficSignalObject {
  return object.type === "traffic-signal";
}

function asLine(object: DrawingObjectV1): LineObject | undefined {
  const points = linePoints(object);
  return points ? { id: object.id, points } : undefined;
}

export function analyzeCyclingDesign(
  document: Pick<DrawingDocumentV1, "objects">,
  options: CyclingAnalysisOptions = {}
): CyclingAnalysisResult {
  const connectionTolerance =
    options.connectionToleranceMetres ?? DEFAULT_CONNECTION_TOLERANCE_METRES;
  const transitionTolerance =
    options.transitionToleranceMetres ?? DEFAULT_TRANSITION_TOLERANCE_METRES;

  const objects = document.objects;
  const cycleways = objects.filter(isCycleway);
  const cycleLines = cycleways.map(asLine).filter((line): line is LineObject => !!line);
  const otherLines = objects.filter((o) => !isCycleway(o)).map(asLine)
    .filter((line): line is LineObject => !!line);
  const allLines = [...cycleLines, ...otherLines];
  const crossings = objects.filter(isCrossing);
  const crossingPoints = crossings
    .map((c) => ({ id: c.id, point: pointOf(c) }))
    .filter((c): c is { id: string; point: LatLng } => !!c.point);
  const roads = objects.filter(isRoad);
  const roadLines = roads.map(asLine).filter((line): line is LineObject => !!line);
  const roundaboutPoints = objects
    .filter((o) => o.type === "roundabout")
    .map((o) => ({ id: o.id, point: pointOf(o) }))
    .filter((o): o is { id: string; point: LatLng } => !!o.point);
  const signals = objects.filter(isSignal);

  const issues: CyclingFeedbackIssue[] = [];

  // -- Protection and direction continuity between joined segments ----------
  for (let i = 0; i < cycleLines.length; i += 1) {
    for (let j = i + 1; j < cycleLines.length; j += 1) {
      const a = cycleways[i];
      const b = cycleways[j];
      const joined = shareEndpoint(cycleLines[i], [cycleLines[j]], connectionTolerance);
      if (!joined) continue;

      if (a.properties.protection !== b.properties.protection) {
        issues.push({
          code: "protection-discontinuity",
          objectIds: [a.id, b.id],
          message: `Joined cycleway segments shift from '${a.properties.protection}' to '${b.properties.protection}'; keep protection consistent or design an explicit transition at the junction.`
        });
      }

      if (a.properties.direction !== b.properties.direction) {
        issues.push({
          code: "direction-conflict",
          objectIds: [a.id, b.id],
          message: `Connected cycleway segments change direction regime ('${a.properties.direction}' meets '${b.properties.direction}'); riders may face wrong-way conflicts where the regimes meet.`
        });
      }
    }
  }

  // -- Abrupt terminations ---------------------------------------------------
  // Group cycleways into chains (joined via shared endpoints), then flag each
  // chain only for its genuinely dangling outer ends.
  const chainMembers = groupCycleChains(cycleLines, connectionTolerance);
  for (const members of chainMembers) {
    const memberIds = [...new Set(members.map((line) => line.id))];
    const outsideLines = allLines.filter((line) => !memberIds.includes(line.id));
    const memberEndpoints = members.flatMap((line) => endpointsOf(line));
    const danglingEnds: LatLng[] = [];

    for (const line of members) {
      for (const endpoint of endpointsOf(line)) {
        // Anchored when it joins another chain member...
        const joinsChainMember = memberEndpoints.some(
          (point) => point !== endpoint && distanceMetres(endpoint, point) <= connectionTolerance
        );
        if (joinsChainMember) continue;
        // ...or lands on any other facility...
        if (minDistanceToPoint(endpoint, outsideLines) <= connectionTolerance) continue;
        // ...or has a crossing/transition nearby.
        const hasNearbyTransition = crossingPoints.some(
          (c) => distanceMetres(endpoint, c.point) <= transitionTolerance
        );
        if (!hasNearbyTransition) danglingEnds.push(endpoint);
      }
    }

    if (danglingEnds.length > 0) {
      issues.push({
        code: "abrupt-termination",
        objectIds: memberIds,
        message: `${danglingEnds.length === 1 ? "One end" : `${danglingEnds.length} ends`} of the cycle route (${memberIds.join(", ")}) terminate${danglingEnds.length === 1 ? "s" : ""} abruptly with no connection to another facility or crossing; dangling cycle lanes strand riders in mixed traffic.`
      });
    }
  }

  // -- Implausible widths ----------------------------------------------------
  for (const cycle of cycleways) {
    const { direction, widthMetres } = cycle.properties;
    const tooNarrow =
      direction === "two-way"
        ? widthMetres < MIN_TWO_WAY_WIDTH_METRES
        : widthMetres < MIN_ONE_WAY_WIDTH_METRES;
    if (tooNarrow || widthMetres > MAX_CYCLEWAY_WIDTH_METRES) {
      issues.push({
        code: "implausible-width",
        objectIds: [cycle.id],
        message: `Cycleway '${cycle.id}' declares ${widthMetres} m width for a ${direction} facility; expect roughly ${MIN_ONE_WAY_WIDTH_METRES}–${MAX_CYCLEWAY_WIDTH_METRES} m (${MIN_TWO_WAY_WIDTH_METRES}+ m for two-way).`
      });
    }
  }

  for (const road of roads) {
    const { lanes, laneWidthMetres } = road.properties;
    if (
      lanes > MAX_ROAD_LANES ||
      laneWidthMetres < MIN_LANE_WIDTH_METRES ||
      laneWidthMetres > MAX_LANE_WIDTH_METRES
    ) {
      issues.push({
        code: "implausible-road-section",
        objectIds: [road.id],
        message: `Road '${road.id}' declares ${lanes} lanes at ${laneWidthMetres} m per lane; check the cross-section — typical urban lanes are ${MIN_LANE_WIDTH_METRES}–${MAX_LANE_WIDTH_METRES} m and ${MAX_ROAD_LANES}+ total lanes rarely fit an urban street.`
      });
    }
  }

  // -- Intersections lacking transitions -------------------------------------
  for (const cycle of cycleways) {
    const line = asLine(cycle);
    if (!line) continue;
    for (const endpoint of endpointsOf(line)) {
      const landsOnRoad = roadLines.some(
        (road) => minDistanceToPoint(endpoint, [road]) <= connectionTolerance
      );
      if (!landsOnRoad) continue;
      const hasCrossing = crossingPoints.some(
        (c) => distanceMetres(endpoint, c.point) <= transitionTolerance
      );
      if (hasCrossing) continue;
      issues.push({
        code: "missing-intersection-transition",
        objectIds: [cycle.id],
        message: `Cycleway '${cycle.id}' reaches a road junction with no marked crossing or transition; cyclists are dropped into conflicting motor traffic at exactly the highest-risk point.`
      });
    }
  }

  // -- Roundabout / cycle conflicts -------------------------------------------
  for (const roundabout of roundaboutPoints) {
    const approachingCycles = cycleLines.filter((cycle) =>
      cycle.points.some((point) => distanceMetres(point, roundabout.point) <= transitionTolerance)
    );
    if (approachingCycles.length === 0) continue;
    const hasCoordinatingCrossing = crossingPoints.some(
      (c) => distanceMetres(c.point, roundabout.point) <= transitionTolerance
    );
    if (hasCoordinatingCrossing) continue;
    issues.push({
      code: "roundabout-cycle-conflict",
      objectIds: [roundabout.id, ...approachingCycles.map((c) => c.id)],
      message: `Cycleway(s) approach roundabout '${roundabout.id}' without a coordinated crossing; roundabout entries are high-conflict points for cyclists — add separated crossings on each approach arm.`
    });
  }

  // -- Signal / crossing coordination ------------------------------------------
  for (const crossing of crossings) {
    const point = pointOf(crossing);
    if (!point) continue;
    if (crossing.properties.control !== "signal-controlled") continue;
    const hasSignal = signals.some((s) => {
      const signalPoint = pointOf(s);
      return signalPoint ? distanceMetres(signalPoint, point) <= transitionTolerance : false;
    });
    if (hasSignal) continue;
    issues.push({
      code: "uncoordinated-signal-crossing",
      objectIds: [crossing.id],
      message: `Signal-controlled crossing '${crossing.id}' has no traffic signal nearby; either place a signal or downgrade to zebra/raised control so the marking matches reality.`
    });
  }

  for (const signal of signals) {
    if (signal.properties.kind === "vehicle") continue;
    const point = pointOf(signal);
    if (!point) continue;
    const servesCrossing = crossingPoints.some(
      (c) => distanceMetres(c.point, point) <= transitionTolerance
    );
    if (servesCrossing) continue;
    issues.push({
      code: "orphaned-signal",
      objectIds: [signal.id],
      message: `Traffic signal '${signal.id}' (${signal.properties.kind}) stands with no crossing to serve; pair it with a crossing or mark it vehicle-only.`
    });
  }

  const protectedLength = cycleways
    .filter((c) => c.properties.protection === "protected")
    .reduce((total, c) => total + lengthMeters(c.geometry.points), 0);
  const paintedLength = cycleways
    .filter((c) => c.properties.protection === "painted")
    .reduce((total, c) => total + lengthMeters(c.geometry.points), 0);

  return {
    heuristicDisclaimer: CYCLING_HEURISTIC_DISCLAIMER,
    issues,
    cyclewayCount: cycleways.length,
    protectedLengthMeters: round1(protectedLength),
    paintedLengthMeters: round1(paintedLength)
  };
}
