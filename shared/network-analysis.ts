import UndirectedGraph, { MultiUndirectedGraph } from "graphology";
import { dijkstra } from "graphology-shortest-path";
import type { LatLng } from "./geo";
import { distanceMetres } from "./geo";

/**
 * Combined existing-plus-proposed transport graph analysis (Task 21).
 *
 * All geometry is in map coordinates (lat/lng); all distances are real-world
 * metres computed with haversine via `shared/geo`. The existing network comes
 * from OSM road features; proposals come from DrawingObjectV1 documents via
 * `proposalsFromDrawingObjects` (or any adapter producing NetworkProposal).
 */

export type MapPoint = LatLng;

export type NetworkOsmRoad = {
  id: number | string;
  kind: string;
  geometry: MapPoint[];
  tags?: Record<string, string>;
};

export type ProposalLine = {
  id: string;
  kind: "road" | "footpath" | "cycleway";
  points: MapPoint[];
};

export type ProposalCrossing = {
  id: string;
  point: MapPoint;
};

export type ProposalRoundabout = {
  id: string;
  center: MapPoint;
  diameterMetres: number;
};

export type NetworkProposal =
  | ProposalLine
  | ProposalCrossing
  | ProposalRoundabout;

export type NetworkEdge = {
  start: MapPoint;
  end: MapPoint;
  lengthMeters: number;
  kind: string;
  hasSidewalk: boolean;
  sourceId: number | string;
  origin: "existing" | "proposal";
};

export type NetworkGraphs = {
  existing: UndirectedGraph<{ point: MapPoint }, NetworkEdge>;
  combined: UndirectedGraph<{ point: MapPoint }, NetworkEdge>;
  /** Node keys present in the existing network. */
  existingNodeKeys: Set<string>;
  existingEdges: NetworkEdge[];
  proposalEdges: NetworkEdge[];
};

export type RouteDistanceChange = {
  from: MapPoint;
  to: MapPoint;
  beforeMeters: number | null;
  afterMeters: number | null;
  deltaMeters: number | null;
};

export type NetworkAnalysis = {
  /** The underlying graphs, for direct route-distance queries. */
  graphs: NetworkGraphs;
  existing: { nodeCount: number; edgeCount: number };
  combined: { nodeCount: number; edgeCount: number };
  proposals: {
    segmentsTotal: number;
    segmentsConnected: number;
    segmentsDisconnected: number;
    connectedRatio: number;
  };
  newIntersections: number;
  deadEnds: { introduced: number; resolved: number };
  routeDistanceChanges: RouteDistanceChange[];
  pedestrianCoverage: {
    sidewalkEdges: number;
    totalEdges: number;
    percent: number;
  };
  cycleNetwork: {
    edges: number;
    components: number;
    largestComponentEdges: number;
    continuityPercent: number;
  };
  crossings: { total: number; connectedToFootpaths: number };
  roundabouts: Array<{
    id: string;
    approaches: number;
    complete: boolean;
  }>;
};

export type AnalysisOptions = {
  /** Snap tolerance for proposal endpoints landing on the existing network. */
  snapToleranceMetres?: number;
  /** Max distance for a crossing to count as connected to a footpath. */
  crossingFootpathToleranceMetres?: number;
  /** Explicit routes to measure before/after. */
  routes?: Array<{ from: MapPoint; to: MapPoint }>;
  /** Approaches required for a roundabout to count as complete. */
  roundaboutRequiredApproaches?: number;
};

const DEFAULT_SNAP_TOLERANCE_METRES = 2;
const DEFAULT_CROSSING_FOOTPATH_TOLERANCE_METRES = 15;
const DEFAULT_ROUNDABOUT_REQUIRED_APPROACHES = 4;
const ROUNDABOUT_RING_SEGMENTS = 16;
const ROUNDABOUT_APPROACH_BAND_METRES = 25;
/** OSM kinds that are not usable transport links. */
const NON_ROAD_KINDS = ["construction", "proposed", "abandoned", "raceway"];
const SIDEWALK_KINDS = ["footway", "path", "pedestrian", "steps", "living_street"];

// ---------------------------------------------------------------------------
// Public entry point
// ---------------------------------------------------------------------------

export function analyzeCombinedTransportNetwork(input: {
  roads: NetworkOsmRoad[];
  proposals: NetworkProposal[];
  options?: AnalysisOptions;
}): NetworkAnalysis {
  const options = input.options ?? {};
  const graphs = buildCombinedNetworkGraphs(input.roads, input.proposals, options);
  const proposalLines = input.proposals.filter(
    (proposal): proposal is ProposalLine => "kind" in proposal && "points" in proposal
  );
  const crossings = input.proposals.filter(
    (proposal): proposal is ProposalCrossing => "point" in proposal && !("diameterMetres" in proposal)
  );
  const roundabouts = input.proposals.filter(
    (proposal): proposal is ProposalRoundabout => "diameterMetres" in proposal
  );

  const segmentStatus = analyzeProposalSegments(graphs, proposalLines, options);
  const deadEnds = analyzeDeadEndChanges(graphs);
  const pedestrianCoverage = computePedestrianCoverage(graphs.combined);
  const cycleNetwork = computeCycleContinuity(graphs.combined);
  const footpathEdges = getFootpathEdges(graphs.combined);
  const routeDistanceChanges = computeRouteDistanceChanges(graphs, options.routes ?? []);

  return {
    graphs,
    existing: {
      nodeCount: graphs.existing.order,
      edgeCount: graphs.existing.size
    },
    combined: {
      nodeCount: graphs.combined.order,
      edgeCount: graphs.combined.size
    },
    proposals: {
      segmentsTotal: segmentStatus.length,
      segmentsConnected: segmentStatus.filter((segment) => segment.connected).length,
      segmentsDisconnected: segmentStatus.filter((segment) => !segment.connected).length,
      connectedRatio:
        segmentStatus.length > 0
          ? round2(segmentStatus.filter((segment) => segment.connected).length / segmentStatus.length)
          : 0
    },
    newIntersections: countNewIntersections(graphs),
    deadEnds,
    routeDistanceChanges,
    pedestrianCoverage,
    cycleNetwork,
    crossings: {
      total: crossings.length,
      connectedToFootpaths: crossings.filter((crossing) =>
        isPointNearAnyEdge(crossing.point, footpathEdges, options.crossingFootpathToleranceMetres ??
          DEFAULT_CROSSING_FOOTPATH_TOLERANCE_METRES)
      ).length
    },
    roundabouts: roundabouts.map((roundabout) =>
      analyzeRoundaboutApproaches(roundabout, graphs, options.roundaboutRequiredApproaches ??
        DEFAULT_ROUNDABOUT_REQUIRED_APPROACHES)
    )
  };
}

// ---------------------------------------------------------------------------
// Graph construction
// ---------------------------------------------------------------------------

export function getNodeKey(point: MapPoint): string {
  return `${point.lat.toFixed(6)},${point.lng.toFixed(6)}`;
}

export function buildCombinedNetworkGraphs(
  roads: NetworkOsmRoad[],
  proposals: NetworkProposal[],
  options: AnalysisOptions = {}
): NetworkGraphs {
  const snapTolerance = options.snapToleranceMetres ?? DEFAULT_SNAP_TOLERANCE_METRES;
  const existing = new MultiUndirectedGraph<{ point: MapPoint }, NetworkEdge>({ multi: true });
  const existingEdges: NetworkEdge[] = [];

  for (const road of roads) {
    if (!Array.isArray(road.geometry) || road.geometry.length < 2 || NON_ROAD_KINDS.includes(road.kind)) {
      continue;
    }

    for (let index = 0; index < road.geometry.length - 1; index += 1) {
      addEdge(existing, existingEdges, road.geometry[index], road.geometry[index + 1], {
        kind: road.kind,
        hasSidewalk: roadImpliesSidewalk(road),
        sourceId: road.id,
        origin: "existing"
      });
    }
  }

  const combined = existing.copy();
  const proposalEdges: NetworkEdge[] = [];
  const ringNodesByRoundabout = new Map<string, Set<string>>();

  // First pass: expand roundabouts into rings so lines can attach to them.
  const lineProposals: ProposalLine[] = [];
  for (const proposal of proposals) {
    if ("points" in proposal) {
      lineProposals.push(proposal);
      continue;
    }

    if ("diameterMetres" in proposal) {
      const ringPoints = buildRoundaboutRing(proposal.center, proposal.diameterMetres);
      const ringNodes = new Set<string>();
      for (let index = 0; index < ringPoints.length - 1; index += 1) {
        const edgeNodes = addEdge(combined, proposalEdges, ringPoints[index], ringPoints[index + 1], {
          kind: "roundabout",
          hasSidewalk: false,
          sourceId: `${proposal.id}-ring`,
          origin: "proposal"
        });
        edgeNodes.forEach((nodeKey) => ringNodes.add(nodeKey));
      }
      ringNodesByRoundabout.set(proposal.id, ringNodes);
    }
    // Crossings contribute no edges.
  }

  const existingNodeKeys = new Set(existing.nodes());

  for (const line of lineProposals) {
    const snapped = [...line.points];
    if (snapped.length >= 1) {
      snapped[0] = snapToExisting(combined, existingNodeKeys, snapped[0], snapTolerance) ?? snapped[0];
      snapped[snapped.length - 1] =
        snapToExisting(combined, existingNodeKeys, snapped[snapped.length - 1], snapTolerance) ??
        snapped[snapped.length - 1];
    }

    for (let index = 0; index < snapped.length - 1; index += 1) {
      addEdge(combined, proposalEdges, snapped[index], snapped[index + 1], {
        kind: line.kind,
        hasSidewalk: line.kind === "footpath",
        sourceId: line.id,
        origin: "proposal"
      });
    }
  }

  return { existing, combined, existingNodeKeys, existingEdges, proposalEdges };
}

function addEdge(
  graph: UndirectedGraph<{ point: MapPoint }, NetworkEdge>,
  sink: NetworkEdge[],
  start: MapPoint,
  end: MapPoint,
  meta: { kind: string; hasSidewalk: boolean; sourceId: number | string; origin: "existing" | "proposal" }
): [string, string] {
  const startKey = getNodeKey(start);
  const endKey = getNodeKey(end);

  if (startKey === endKey) {
    graph.mergeNode(startKey, { point: start });
    return [startKey, endKey];
  }

  const lengthMeters = distanceMetres(start, end);

  if (lengthMeters < 1) {
    graph.mergeNode(startKey, { point: start });
    graph.mergeNode(endKey, { point: end });
    return [startKey, endKey];
  }

  graph.mergeNode(startKey, { point: start });
  graph.mergeNode(endKey, { point: end });

  const key = `${meta.sourceId}-${getNodeKey(start)}->${getNodeKey(end)}`;
  if (graph.hasEdge(startKey, endKey)) {
    // Parallel edges between the same node pair are legitimate in a transport
    // network (two roads linking the same junctions). merge*WithKey would
    // silently REPLACE the existing edge, so add a distinct parallel edge.
    graph.addUndirectedEdgeWithKey(key, startKey, endKey, {
      ...meta,
      start,
      end,
      lengthMeters
    });
  } else {
    graph.mergeUndirectedEdgeWithKey(key, startKey, endKey, {
      ...meta,
      start,
      end,
      lengthMeters
    });
  }
  sink.push({ ...meta, start, end, lengthMeters });

  return [startKey, endKey];
}

function snapToExisting(
  combined: UndirectedGraph<{ point: MapPoint }, NetworkEdge>,
  existingNodeKeys: Set<string>,
  point: MapPoint,
  toleranceMetres: number
): MapPoint | null {
  let best: { distance: number; point: MapPoint } | null = null;

  for (const nodeKey of existingNodeKeys) {
    const nodePoint = combined.getNodeAttributes(nodeKey).point;
    const distance = distanceMetres(point, nodePoint);

    if (distance <= toleranceMetres && (!best || distance < best.distance)) {
      best = { distance, point: nodePoint };
    }
  }

  return best?.point ?? null;
}

function buildRoundaboutRing(center: MapPoint, diameterMetres: number): MapPoint[] {
  const radiusMetres = Math.max(diameterMetres, 1) / 2;
  const ring: MapPoint[] = [];

  for (let step = 0; step <= ROUNDABOUT_RING_SEGMENTS; step += 1) {
    const angle = (step / ROUNDABOUT_RING_SEGMENTS) * Math.PI * 2;
    const north = radiusMetres * Math.sin(angle);
    const east = radiusMetres * Math.cos(angle);
    const latDegrees = north / 111_320;
    const lngDegrees = east / (111_320 * Math.cos((center.lat * Math.PI) / 180));
    ring.push({ lat: center.lat + latDegrees, lng: center.lng + lngDegrees });
  }

  return ring;
}

function roadImpliesSidewalk(road: NetworkOsmRoad): boolean {
  const sidewalkTag = road.tags?.sidewalk;

  return (
    SIDEWALK_KINDS.includes(road.kind) ||
    Boolean(sidewalkTag && !["no", "none", "separate"].includes(sidewalkTag))
  );
}

// ---------------------------------------------------------------------------
// Metrics
// ---------------------------------------------------------------------------

function analyzeProposalSegments(
  graphs: NetworkGraphs,
  proposals: ProposalLine[],
  options: AnalysisOptions
): Array<{ id: string; segmentIndex: number; connected: boolean }> {
  const tolerance = options.snapToleranceMetres ?? DEFAULT_SNAP_TOLERANCE_METRES;
  const status: Array<{ id: string; segmentIndex: number; connected: boolean }> = [];

  for (const proposal of proposals) {
    for (let index = 0; index < proposal.points.length - 1; index += 1) {
      status.push({
        id: proposal.id,
        segmentIndex: index,
        connected:
          touchesExistingNetwork(graphs, proposal.points[index], tolerance) ||
          touchesExistingNetwork(graphs, proposal.points[index + 1], tolerance)
      });
    }
  }

  return status;
}

function touchesExistingNetwork(graphs: NetworkGraphs, point: MapPoint, toleranceMetres: number): boolean {
  for (const nodeKey of graphs.existingNodeKeys) {
    if (distanceMetres(point, graphs.existing.getNodeAttributes(nodeKey).point) <= toleranceMetres) {
      return true;
    }
  }

  return isPointNearAnyEdge(point, graphs.existingEdges, toleranceMetres);
}

function countNewIntersections(graphs: NetworkGraphs): number {
  const intersections = new Set<string>();

  for (const edge of graphs.proposalEdges) {
    for (const point of [edge.start, edge.end]) {
      const key = getNodeKey(point);

      if (graphs.existingNodeKeys.has(key)) {
        intersections.add(key);
      }
    }
  }

  return intersections.size;
}

function analyzeDeadEndChanges(graphs: NetworkGraphs): { introduced: number; resolved: number } {
  const baselineDeadEnds = collectDeadEndKeys(graphs.existing);
  const combinedDeadEnds = collectDeadEndKeys(graphs.combined);

  // Only dead ends reachable from the existing network count — a floating
  // proposal disconnected from everything does not "introduce" dead ends.
  const anchoredRoots = componentRootsTouchingExisting(graphs);
  const isAnchored = (nodeKey: string): boolean => {
    const attributes = graphs.combined.getNodeAttributes(nodeKey) as { __root?: string };
    return anchoredRoots.has(attributes.__root ?? "");
  };

  let introduced = 0;
  let resolved = 0;

  for (const key of combinedDeadEnds) {
    if (!baselineDeadEnds.has(key) && isAnchored(key)) {
      introduced += 1;
    }
  }

  for (const key of baselineDeadEnds) {
    if (!combinedDeadEnds.has(key)) {
      resolved += 1;
    }
  }

  return { introduced, resolved };
}

/** Union-find over combined edges; returns roots of components containing existing-network nodes. */
function componentRootsTouchingExisting(graphs: NetworkGraphs): Set<string> {
  const parent = new Map<string, string>();
  const find = (key: string): string => {
    let root = key;
    while (parent.get(root) !== root) {
      root = parent.get(root) ?? root;
    }
    // Path compression.
    let current = key;
    while (parent.get(current) !== root) {
      const next = parent.get(current) ?? root;
      parent.set(current, root);
      current = next;
    }
    return root;
  };

  for (const nodeKey of graphs.combined.nodes()) {
    parent.set(nodeKey, nodeKey);
  }
  for (const edgeKey of graphs.combined.edges()) {
    const endpoints = graphs.combined.extremities(edgeKey);
    parent.set(find(endpoints[0]), find(endpoints[1]));
  }

  const roots = new Set<string>();
  for (const nodeKey of graphs.existingNodeKeys) {
    if (graphs.combined.hasNode(nodeKey)) {
      roots.add(find(nodeKey));
    }
  }

  // Stamp roots onto nodes so callers can look membership up cheaply.
  for (const nodeKey of graphs.combined.nodes()) {
    (graphs.combined.getNodeAttributes(nodeKey) as { __root?: string }).__root = find(nodeKey);
  }

  return roots;
}

function collectDeadEndKeys(graph: UndirectedGraph<{ point: MapPoint }, NetworkEdge>): Set<string> {
  return new Set(graph.nodes().filter((nodeKey) => graph.degree(nodeKey) <= 1));
}

function computePedestrianCoverage(graph: UndirectedGraph<{ point: MapPoint }, NetworkEdge>) {
  const edges = graph.edges().map((edgeKey) => graph.getEdgeAttributes(edgeKey));
  const sidewalkEdges = edges.filter((edge) => edge.hasSidewalk).length;

  return {
    sidewalkEdges,
    totalEdges: edges.length,
    percent: edges.length > 0 ? Math.round((sidewalkEdges / edges.length) * 100) : 0
  };
}

function computeCycleContinuity(graph: UndirectedGraph<{ point: MapPoint }, NetworkEdge>) {
  const cycleEdges = graph.edges().map((edgeKey) => graph.getEdgeAttributes(edgeKey))
    .filter((edge) => edge.kind === "cycleway");

  if (cycleEdges.length === 0) {
    return { edges: 0, components: 0, largestComponentEdges: 0, continuityPercent: 0 };
  }

  // Union-find over cycle-edge endpoints.
  const parent = new Map<string, string>();
  const find = (key: string): string => {
    const root = parent.get(key) ?? key;
    if (root === key) {
      return key;
    }
    const ancestor = find(root);
    parent.set(key, ancestor);
    return ancestor;
  };
  const union = (a: string, b: string) => {
    parent.set(find(a), find(b));
  };

  for (const edge of cycleEdges) {
    const a = getNodeKey(edge.start);
    const b = getNodeKey(edge.end);
    parent.set(a, parent.get(a) ?? a);
    parent.set(b, parent.get(b) ?? b);
    union(a, b);
  }

  const componentSizes = new Map<string, number>();
  for (const edge of cycleEdges) {
    const root = find(getNodeKey(edge.start));
    componentSizes.set(root, (componentSizes.get(root) ?? 0) + 1);
  }

  const largest = Math.max(...componentSizes.values(), 0);

  return {
    edges: cycleEdges.length,
    components: componentSizes.size,
    largestComponentEdges: largest,
    continuityPercent: Math.round((largest / cycleEdges.length) * 100)
  };
}

function getFootpathEdges(graph: UndirectedGraph<{ point: MapPoint }, NetworkEdge>): NetworkEdge[] {
  return graph
    .edges()
    .map((edgeKey) => graph.getEdgeAttributes(edgeKey))
    .filter((edge) => edge.kind === "footpath" || edge.kind === "footway" || edge.hasSidewalk);
}

function isPointNearAnyEdge(point: MapPoint, edges: NetworkEdge[], toleranceMetres: number): boolean {
  return edges.some((edge) => getPointToSegmentDistanceMeters(point, edge.start, edge.end) <= toleranceMetres);
}

export function getPointToSegmentDistanceMeters(point: MapPoint, start: MapPoint, end: MapPoint): number {
  const referenceLat = ((point.lat + start.lat + end.lat) / 3) * (Math.PI / 180);
  const scale = 111_320 * Math.cos(referenceLat);
  const px = point.lng * scale;
  const py = point.lat * 111_320;
  const ax = start.lng * scale;
  const ay = start.lat * 111_320;
  const bx = end.lng * scale;
  const by = end.lat * 111_320;

  const dx = bx - ax;
  const dy = by - ay;
  const lengthSquared = dx * dx + dy * dy;

  const t =
    lengthSquared === 0
      ? 0
      : Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / lengthSquared));

  const closestX = ax + t * dx;
  const closestY = ay + t * dy;

  return Math.hypot(px - closestX, py - closestY);
}

function analyzeRoundaboutApproaches(
  roundabout: ProposalRoundabout,
  graphs: NetworkGraphs,
  requiredApproaches: number
): { id: string; approaches: number; complete: boolean } {
  const radiusMetres = Math.max(roundabout.diameterMetres, 1) / 2;
  const centerKey = getNodeKey(roundabout.center);
  const approaches = new Set<string>();

  // A radial approach is an edge whose one endpoint lies on/inside the ring
  // (including the shared centre junction) and whose other endpoint is a
  // distinct node outside the ring. Count each such outer endpoint once.
  for (const edgeKey of graphs.combined.edges()) {
    const [aKey, bKey] = graphs.combined.extremities(edgeKey);
    const distanceToCenter = (nodeKey: string) =>
      distanceMetres(graphs.combined.getNodeAttributes(nodeKey).point, roundabout.center);

    const aInside = aKey === centerKey || distanceToCenter(aKey) <= radiusMetres;
    const bInside = bKey === centerKey || distanceToCenter(bKey) <= radiusMetres;

    if (aInside && !bInside) {
      approaches.add(bKey);
    } else if (bInside && !aInside) {
      approaches.add(aKey);
    }
  }

  return {
    id: roundabout.id,
    approaches: approaches.size,
    complete: approaches.size >= requiredApproaches
  };
}

function ringNodeKeysFor(roundabout: ProposalRoundabout, graphs: NetworkGraphs): string[] {
  const keys: string[] = [];
  const radiusMetres = Math.max(roundabout.diameterMetres, 1) / 2;

  for (const nodeKey of graphs.combined.nodes()) {
    const nodePoint = graphs.combined.getNodeAttributes(nodeKey).point;
    if (distanceMetres(nodePoint, roundabout.center) < radiusMetres * 1.5) {
      keys.push(nodeKey);
    }
  }

  return keys;
}

// ---------------------------------------------------------------------------
// Route-distance deltas
// ---------------------------------------------------------------------------

export function getRouteDistanceChange(
  graphs: NetworkGraphs,
  from: MapPoint,
  to: MapPoint
): RouteDistanceChange {
  const before = shortestPathLengthMeters(graphs.existing, getNodeKey(from), getNodeKey(to));
  const after = shortestPathLengthMeters(graphs.combined, getNodeKey(from), getNodeKey(to));

  return {
    from,
    to,
    beforeMeters: before,
    afterMeters: after,
    deltaMeters: before !== null && after !== null ? round2(after - before) : null
  };
}

function computeRouteDistanceChanges(
  graphs: NetworkGraphs,
  routes: Array<{ from: MapPoint; to: MapPoint }>
): RouteDistanceChange[] {
  return routes.map((route) => getRouteDistanceChange(graphs, route.from, route.to));
}

function shortestPathLengthMeters(
  graph: UndirectedGraph<{ point: MapPoint }, NetworkEdge>,
  fromKey: string,
  toKey: string
): number | null {
  if (!graph.hasNode(fromKey) || !graph.hasNode(toKey)) {
    return null;
  }

  try {
    const path = dijkstra.bidirectional(graph, fromKey, toKey, "lengthMeters");
    if (!path || path.length < 2) {
      return null;
    }

    let total = 0;
    for (let index = 0; index < path.length - 1; index += 1) {
      // In a multi graph a node pair may carry several parallel edges; the
      // shortest path would always take the cheapest one.
      let bestLength: number | null = null;
      for (const edge of graph.edgeEntries(path[index], path[index + 1])) {
        const length = (edge.attributes as { lengthMeters: number }).lengthMeters;
        if (bestLength === null || length < bestLength) {
          bestLength = length;
        }
      }
      if (bestLength === null) {
        return null;
      }
      total += bestLength;
    }

    return round2(total);
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Adapters
// ---------------------------------------------------------------------------

/** Maps DrawingObjectV1 documents into analyzer proposals. */
export function proposalsFromDrawingObjects(objects: Array<Record<string, unknown>>): NetworkProposal[] {
  const proposals: NetworkProposal[] = [];

  for (const object of objects) {
    const id = typeof object.id === "string" ? object.id : String(object.id);
    const geometry = object.geometry as { type?: string; points?: MapPoint[]; point?: MapPoint } | undefined;

    switch (object.type) {
      case "road":
        if (geometry?.points && geometry.points.length >= 2) {
          proposals.push({ id, kind: "road", points: geometry.points });
        }
        break;
      case "footpath":
        if (geometry?.points && geometry.points.length >= 2) {
          proposals.push({ id, kind: "footpath", points: geometry.points });
        }
        break;
      case "cycleway":
        if (geometry?.points && geometry.points.length >= 2) {
          proposals.push({ id, kind: "cycleway", points: geometry.points });
        }
        break;
      case "crossing":
        if (geometry?.point) {
          proposals.push({ id, point: geometry.point });
        }
        break;
      case "roundabout": {
        if (geometry?.point) {
          const properties = object.properties as { inscribedCircleDiameterMetres?: number } | undefined;
          proposals.push({
            id,
            center: geometry.point,
            diameterMetres: properties?.inscribedCircleDiameterMetres ?? 32
          });
        }
        break;
      }
      default:
        // Traffic signals carry no linear network geometry.
        break;
    }
  }

  return proposals;
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}
