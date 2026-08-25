/**
 * Pedestrian and accessibility analysis (Task 22).
 *
 * Evaluates the CONTINUOUS walking experience over a combined transport
 * network graph instead of merely counting sidewalk edges: sidewalk gaps,
 * dangerous discontinuities near junctions, isolated footpaths, missing
 * curb/access connections, and excessive distances between crossing
 * opportunities.
 *
 * All findings are HEURISTICS derived from graph topology and haversine
 * distances. They are planning aids, not engineering certification.
 */

import type { MapPoint, NetworkEdge, NetworkGraphs } from "./network-analysis";
import { getNodeKey } from "./network-analysis";
import { distanceMetres } from "./geo";

export type PedestrianAnalysisOptions = {
  /** Max distance between walkable components to count as a closable gap. */
  maxSidewalkGapMeters?: number;
  /** Max length of a contiguous non-walkable corridor before flagging it. */
  maxCrossingSpacingMeters?: number;
  /** Distance from a junction for a discontinuity to be "near junction". */
  junctionProximityMeters?: number;
};

export type SidewalkGap = {
  start: MapPoint;
  end: MapPoint;
  gapMeters: number;
  nearJunction: boolean;
};

export type IsolatedFootpath = {
  edgeCount: number;
  lengthMeters: number;
};

export type ExcessiveCrossingDistance = {
  start: MapPoint;
  end: MapPoint;
  lengthMeters: number;
  /** True when the corridor passes within junction proximity of a junction. */
  nearJunction: boolean;
};

export type PedestrianAnalysisResult = {
  heuristicDisclaimer: string;
  sidewalk: {
    edges: number;
    totalLengthMeters: number;
    networkLengthMeters: number;
    coveragePercent: number;
  };
  gaps: SidewalkGap[];
  junctionDiscontinuities: number;
  isolatedFootpaths: IsolatedFootpath[];
  missingCurbConnections: number;
  excessiveCrossingDistances: ExcessiveCrossingDistance[];
  /** True when any flagged corridor touches a junction. */
  junctionNearExcessiveCrossings: boolean;
};

const DEFAULT_MAX_SIDEWALK_GAP_METERS = 30;
const DEFAULT_MAX_CROSSING_SPACING_METERS = 150;
const DEFAULT_JUNCTION_PROXIMITY_METERS = 25;
/** A walkable dead-end this close to a road counts as having a curb connection. */
const CURB_CONNECTION_TOLERANCE_METERS = 5;

export const PEDESTRIAN_HEURISTIC_DISCLAIMER =
  "Heuristic pedestrian analysis based on network topology only. Not an engineering certification of walkability or safety.";

/** Kinds that are themselves walking infrastructure. */
const WALK_KINDS = new Set([
  "footway",
  "path",
  "pedestrian",
  "steps",
  "living_street",
  "footpath"
]);

function isWalkableEdge(edge: NetworkEdge): boolean {
  return edge.hasSidewalk || WALK_KINDS.has(edge.kind);
}

export function analyzePedestrianAccessibility(
  graphs: NetworkGraphs,
  options: PedestrianAnalysisOptions = {}
): PedestrianAnalysisResult {
  const maxGap = options.maxSidewalkGapMeters ?? DEFAULT_MAX_SIDEWALK_GAP_METERS;
  const maxSpacing =
    options.maxCrossingSpacingMeters ?? DEFAULT_MAX_CROSSING_SPACING_METERS;
  const junctionProximity =
    options.junctionProximityMeters ?? DEFAULT_JUNCTION_PROXIMITY_METERS;

  const allEdges = graphs.combined
    .edges()
    .map((key) => graphs.combined.getEdgeAttributes(key));
  const walkEdges = allEdges.filter(isWalkableEdge);
  const bareEdges = allEdges.filter((edge) => !isWalkableEdge(edge));

  const junctionKeys = collectJunctionKeys(graphs);
  const components = computeWalkComponents(walkEdges);

  const gaps = findGaps(components, junctionKeys, maxGap, junctionProximity, graphs);
  const corridors = findExcessiveCrossingCorridors(
    bareEdges,
    maxSpacing,
    junctionKeys,
    junctionProximity,
    graphs
  );
  const isolatedFootpaths = components
    .slice(1) // index 0 is the largest (main) component; the rest are islands
    .map(({ edges, lengthMeters }) => ({ edgeCount: edges.length, lengthMeters }));
  const missingCurbConnections = countMissingCurbConnections(walkEdges, bareEdges);

  const totalLength = sum(allEdges.map((edge) => edge.lengthMeters));
  const walkLength = sum(walkEdges.map((edge) => edge.lengthMeters));

  return {
    heuristicDisclaimer: PEDESTRIAN_HEURISTIC_DISCLAIMER,
    sidewalk: {
      edges: walkEdges.length,
      totalLengthMeters: round1(walkLength),
      networkLengthMeters: round1(totalLength),
      coveragePercent: totalLength > 0 ? Math.round((walkLength / totalLength) * 100) : 0
    },
    gaps,
    junctionDiscontinuities: gaps.filter((gap) => gap.nearJunction).length,
    isolatedFootpaths,
    missingCurbConnections,
    excessiveCrossingDistances: corridors,
    junctionNearExcessiveCrossings: corridors.some((corridor) => corridor.nearJunction)
  };
}

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

type WalkComponent = {
  edges: NetworkEdge[];
  endpoints: MapPoint[];
  lengthMeters: number;
};

function collectJunctionKeys(graphs: NetworkGraphs): Set<string> {
  const keys = new Set<string>();
  for (const nodeKey of graphs.existingNodeKeys) {
    if (!graphs.existing.hasNode(nodeKey)) continue;
    if (graphs.existing.degree(nodeKey) >= 3) {
      keys.add(nodeKey);
    }
  }
  return keys;
}

function isNearAnyKey(
  point: MapPoint,
  keys: Set<string>,
  proximityMeters: number,
  graphs: NetworkGraphs
): boolean {
  for (const key of keys) {
    if (distanceMetres(point, graphs.combined.getNodeAttributes(key).point) <= proximityMeters) {
      return true;
    }
  }
  return false;
}

/** Union-find grouping of walkable edges into connected components. */
function computeWalkComponents(walkEdges: NetworkEdge[]): WalkComponent[] {
  const parent = new Map<string, string>();
  const find = (key: string): string => {
    let root = key;
    while ((parent.get(root) ?? root) !== root) {
      root = parent.get(root) as string;
    }
    return root;
  };
  const union = (a: string, b: string) => {
    const rootA = find(a);
    const rootB = find(b);
    if (rootA !== rootB) parent.set(rootA, rootB);
  };

  for (const edge of walkEdges) {
    const keyA = getNodeKey(edge.start);
    const keyB = getNodeKey(edge.end);
    if (!parent.has(keyA)) parent.set(keyA, keyA);
    if (!parent.has(keyB)) parent.set(keyB, keyB);
    union(keyA, keyB);
  }

  const byRoot = new Map<string, WalkComponent>();
  for (const edge of walkEdges) {
    const root = find(getNodeKey(edge.start));
    let component = byRoot.get(root);
    if (!component) {
      component = { edges: [], endpoints: [], lengthMeters: 0 };
      byRoot.set(root, component);
    }
    component.edges.push(edge);
    component.endpoints.push(edge.start, edge.end);
    component.lengthMeters += edge.lengthMeters;
  }

  // Largest component first so index 0 is always the main walkable network.
  return [...byRoot.values()].sort((a, b) => b.lengthMeters - a.lengthMeters);
}

function findGaps(
  components: WalkComponent[],
  junctionKeys: Set<string>,
  maxGapMeters: number,
  junctionProximityMeters: number,
  graphs: NetworkGraphs
): SidewalkGap[] {
  const gaps: SidewalkGap[] = [];
  const seenPairs = new Set<string>();

  for (let i = 0; i < components.length; i += 1) {
    for (let j = i + 1; j < components.length; j += 1) {
      let best: { from: MapPoint; to: MapPoint; meters: number } | null = null;
      for (const pointA of components[i].endpoints) {
        for (const pointB of components[j].endpoints) {
          const meters = distanceMetres(pointA, pointB);
          if (meters <= maxGapMeters && (!best || meters < best.meters)) {
            best = { from: pointA, to: pointB, meters };
          }
        }
      }
      if (!best) continue;

      const pairKey = `${getNodeKey(best.from)}|${getNodeKey(best.to)}`;
      if (seenPairs.has(pairKey)) continue;
      seenPairs.add(pairKey);

      gaps.push({
        start: best.from,
        end: best.to,
        gapMeters: round1(best.meters),
        nearJunction:
          isNearAnyKey(best.from, junctionKeys, junctionProximityMeters, graphs) ||
          isNearAnyKey(best.to, junctionKeys, junctionProximityMeters, graphs)
      });
    }
  }

  return gaps.sort((a, b) => a.gapMeters - b.gapMeters);
}

/**
 * Chains of contiguous non-walkable ("bare") edges. Any chain longer than
 * `maxSpacingMeters` represents a stretch with no continuous footway and no
 * intermediate crossing opportunity — flagged as an excessive crossing
 * distance for pedestrians.
 */
function findExcessiveCrossingCorridors(
  bareEdges: NetworkEdge[],
  maxSpacingMeters: number,
  junctionKeys: Set<string>,
  junctionProximityMeters: number,
  graphs: NetworkGraphs
): ExcessiveCrossingDistance[] {
  const adjacency = new Map<string, NetworkEdge[]>();
  for (const edge of bareEdges) {
    for (const key of [getNodeKey(edge.start), getNodeKey(edge.end)]) {
      const list = adjacency.get(key);
      if (list) list.push(edge);
      else adjacency.set(key, [edge]);
    }
  }

  const visited = new Set<NetworkEdge>();
  const corridors: ExcessiveCrossingDistance[] = [];

  for (const seed of bareEdges) {
    if (visited.has(seed)) continue;

    // Grow the chain outward from the seed in both directions.
    const chain: NetworkEdge[] = [];
    const queue = [seed];
    visited.add(seed);
    while (queue.length > 0) {
      const current = queue.pop() as NetworkEdge;
      chain.push(current);
      for (const key of [getNodeKey(current.start), getNodeKey(current.end)]) {
        for (const next of adjacency.get(key) ?? []) {
          if (!visited.has(next)) {
            visited.add(next);
            queue.push(next);
          }
        }
      }
    }

    const lengthMeters = sum(chain.map((edge) => edge.lengthMeters));
    if (lengthMeters <= maxSpacingMeters) continue;

    // Endpoints of the corridor: bare nodes touched by exactly one chain edge.
    const degree = new Map<string, number>();
    const pointsByKey = new Map<string, MapPoint>();
    for (const edge of chain) {
      for (const point of [edge.start, edge.end]) {
        const key = getNodeKey(point);
        pointsByKey.set(key, point);
        degree.set(key, (degree.get(key) ?? 0) + 1);
      }
    }
    const endpointPoints = [...degree.entries()]
      .filter(([, count]) => count === 1)
      .map(([key]) => pointsByKey.get(key) as MapPoint);
    const start = endpointPoints[0] ?? chain[0].start;
    const end = endpointPoints[endpointPoints.length - 1] ?? chain[0].end;

    const nearJunction = [...pointsByKey.entries()].some(([key, point]) =>
      junctionKeys.has(key) ||
      isNearAnyKey(point, junctionKeys, junctionProximityMeters, graphs)
    );
    corridors.push({ start, end, lengthMeters: round1(lengthMeters), nearJunction });
  }

  return corridors.sort((a, b) => b.lengthMeters - a.lengthMeters);
}

/**
 * A curb/access connection is "missing" when a walkable path dead-ends at a
 * point that is not adjacent to any road — nothing to step off onto.
 */
function countMissingCurbConnections(
  walkEdges: NetworkEdge[],
  bareEdges: NetworkEdge[]
): number {
  const degree = new Map<string, number>();
  const pointsByKey = new Map<string, MapPoint>();
  for (const edge of walkEdges) {
    for (const point of [edge.start, edge.end]) {
      const key = getNodeKey(point);
      degree.set(key, (degree.get(key) ?? 0) + 1);
      pointsByKey.set(key, point);
    }
  }

  let missing = 0;
  for (const [key, count] of degree) {
    if (count > 1) continue; // interior node, not a dead end
    const point = pointsByKey.get(key);
    if (!point) continue;
    const touchesRoad = bareEdges.some(
      (edge) =>
        Math.min(distanceMetres(point, edge.start), distanceMetres(point, edge.end)) <=
        CURB_CONNECTION_TOLERANCE_METERS
    );
    if (!touchesRoad) missing += 1;
  }
  return missing;
}

function sum(values: number[]): number {
  return values.reduce((total, value) => total + value, 0);
}

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}
