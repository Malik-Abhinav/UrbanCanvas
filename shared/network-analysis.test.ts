import { describe, expect, it } from "vitest";
import { offsetLatLngMetres, type LatLng } from "./geo";
import type { DrawingObjectV1 } from "./drawing-document";
import {
  analyzeCombinedTransportNetwork,
  getRouteDistanceChange,
  proposalsFromDrawingObjects
} from "./network-analysis";

const ORIGIN: LatLng = { lat: 28.61, lng: 77.21 };

function eastOf(metres: number): LatLng {
  return offsetLatLngMetres(ORIGIN, { eastMetres: metres, northMetres: 0 });
}

function northOf(metres: number): LatLng {
  return offsetLatLngMetres(ORIGIN, { eastMetres: 0, northMetres: metres });
}

/** Straight east-west OSM road through the origin, 300 m long. */
function makeMainRoad(id = 1) {
  return {
    id,
    kind: "residential",
    geometry: [eastOf(-150), eastOf(0), eastOf(150)]
  };
}

function makeRoadObject(
  id: string,
  points: LatLng[],
  overrides: Partial<Extract<DrawingObjectV1, { type: "road" }>["properties"]> = {}
): DrawingObjectV1 {
  return {
    id,
    type: "road",
    geometry: { type: "LineString", points },
    properties: {
      lanes: 2,
      direction: "two-way",
      laneWidthMetres: 3.5,
      highwayFunction: "local",
      ...overrides
    }
  };
}

describe("analyzeCombinedTransportNetwork", () => {
  it("returns empty metrics when there is no network and no proposals", () => {
    const analysis = analyzeCombinedTransportNetwork({ roads: [], proposals: [] });

    expect(analysis.combined.edgeCount).toBe(0);
    expect(analysis.proposals.segmentsTotal).toBe(0);
    expect(analysis.newIntersections).toBe(0);
    expect(analysis.deadEnds.introduced).toBe(0);
    expect(analysis.deadEnds.resolved).toBe(0);
  });

  it("merges OSM roads and proposals that share an endpoint into one graph", () => {
    const proposal = makeRoadObject("p1", [eastOf(150), eastOf(300)]);
    const analysis = analyzeCombinedTransportNetwork({
      roads: [makeMainRoad()],
      proposals: proposalsFromDrawingObjects([proposal])
    });

    // Main road contributes 2 edges; the proposal shares the (150 m, 0) node.
    expect(analysis.existing.edgeCount).toBe(2);
    expect(analysis.combined.edgeCount).toBe(3);
    expect(analysis.proposals.segmentsConnected).toBe(1);
    expect(analysis.proposals.segmentsDisconnected).toBe(0);
    expect(analysis.newIntersections).toBe(1);
  });

  it("marks floating proposals as disconnected without inventing intersections", () => {
    const floating = makeRoadObject("p1", [northOf(500), northOf(700)]);
    const analysis = analyzeCombinedTransportNetwork({
      roads: [makeMainRoad()],
      proposals: proposalsFromDrawingObjects([floating])
    });

    expect(analysis.proposals.segmentsConnected).toBe(0);
    expect(analysis.proposals.segmentsDisconnected).toBe(1);
    expect(analysis.newIntersections).toBe(0);
    expect(analysis.deadEnds.introduced).toBe(0);
  });

  it("snaps nearly-touching proposal endpoints onto the existing network", () => {
    // Endpoint 1 m south of the main road's mid node — inside the 2 m tolerance.
    const almostTouching = offsetLatLngMetres(eastOf(150), { eastMetres: 0, northMetres: -1 });
    const proposal = makeRoadObject("p1", [almostTouching, northOf(200)]);
    const analysis = analyzeCombinedTransportNetwork({
      roads: [makeMainRoad()],
      proposals: proposalsFromDrawingObjects([proposal])
    });

    expect(analysis.proposals.segmentsConnected).toBe(1);
    expect(analysis.newIntersections).toBe(1);
  });

  it("counts dead ends introduced and resolved by proposals", () => {
    // A stub road hanging off the main line creates a new dead-end node;
    // connecting another stub between it and the main line resolves it again.
    const stub = makeRoadObject("stub", [eastOf(150), northOf(100)]);
    const loopBack = makeRoadObject("loop", [northOf(100), eastOf(150)]);

    const withStubOnly = analyzeCombinedTransportNetwork({
      roads: [makeMainRoad()],
      proposals: proposalsFromDrawingObjects([stub])
    });
    const withBoth = analyzeCombinedTransportNetwork({
      roads: [makeMainRoad()],
      proposals: proposalsFromDrawingObjects([stub, loopBack])
    });
    const baseline = analyzeCombinedTransportNetwork({
      roads: [makeMainRoad()],
      proposals: []
    });

    expect(withStubOnly.deadEnds.introduced).toBeGreaterThan(0);
    expect(baseline.deadEnds.introduced).toBe(0);
    // With the loop back in place, the stub's far end is no longer a dead end.
    expect(withBoth.deadEnds.introduced).toBeLessThan(withStubOnly.deadEnds.introduced);
  });

  it("reports route-distance changes when a shortcut is added", () => {
    // Detour is the ONLY connection between the anchors; a direct shortcut
    // then shortens the route.
    const roads = [
      // A long detour connecting two anchors.
      {
        id: 2,
        kind: "residential",
        geometry: [eastOf(-150), northOf(400), eastOf(350), northOf(-400), eastOf(150)]
      }
    ];
    const from = eastOf(-150);
    const to = eastOf(150);
    const directShortcut = makeRoadObject("shortcut", [from, to]);

    const before = analyzeCombinedTransportNetwork({ roads, proposals: [] });
    const after = analyzeCombinedTransportNetwork({
      roads,
      proposals: proposalsFromDrawingObjects([directShortcut]),
      options: { routes: [{ from, to }] }
    });

    expect(before.routeDistanceChanges).toHaveLength(0);
    expect(after.routeDistanceChanges).toHaveLength(1);

    const change = after.routeDistanceChanges[0];
    expect(change.beforeMeters).not.toBeNull();
    expect(change.afterMeters).not.toBeNull();
    expect(change.beforeMeters!).toBeGreaterThan(change.afterMeters!);
    expect(change.deltaMeters).toBeLessThan(0);
  });

  it("computes route distance change directly for a given pair", () => {
    // Detour via the north is the only connection; shortcut makes it direct.
    const roads = [
      { id: 2, kind: "residential", geometry: [eastOf(-150), northOf(400), eastOf(150)] }
    ];
    const from = eastOf(-150);
    const to = eastOf(150);
    const base = analyzeCombinedTransportNetwork({ roads, proposals: [] });
    const withShortcut = analyzeCombinedTransportNetwork({
      roads,
      proposals: proposalsFromDrawingObjects([makeRoadObject("s", [from, to])])
    });

    const before = getRouteDistanceChange(base.graphs, from, to);
    const after = getRouteDistanceChange(withShortcut.graphs, from, to);

    expect(before).not.toBeNull();
    expect(after).not.toBeNull();
    expect(after!.afterMeters).toBeCloseTo(300, 0);
    expect(before!.beforeMeters).toBeGreaterThan(after!.afterMeters!);
  });

  it("includes proposed footpaths in connected pedestrian coverage", () => {
    const taggedRoad = {
      id: 3,
      kind: "residential",
      geometry: [eastOf(-150), eastOf(0)],
      tags: { sidewalk: "both" }
    };
    const plainRoad = { id: 4, kind: "residential", geometry: [eastOf(0), eastOf(150)] };
    const footpath: DrawingObjectV1 = {
      id: "fp1",
      type: "footpath",
      geometry: { type: "LineString", points: [eastOf(150), northOf(80)] },
      properties: {
        clearWidthMetres: 2,
        surface: "paved",
        accessibility: "step-free",
        alignment: "attached"
      }
    };

    const analysis = analyzeCombinedTransportNetwork({
      roads: [taggedRoad, plainRoad],
      proposals: proposalsFromDrawingObjects([footpath])
    });

    // Tagged road edge + footpath edge out of 3 combined edges.
    expect(analysis.pedestrianCoverage.sidewalkEdges).toBeGreaterThanOrEqual(2);
    expect(analysis.pedestrianCoverage.totalEdges).toBe(3);
    expect(analysis.pedestrianCoverage.percent).toBeGreaterThanOrEqual(67);
  });

  it("measures cycle-network continuity across existing and proposed cycleways", () => {
    const existingCycleA = { id: 5, kind: "cycleway", geometry: [eastOf(-150), eastOf(-75)] };
    const isolatedCycle = { id: 6, kind: "cycleway", geometry: [eastOf(500), eastOf(600)] };
    const connector = {
      id: "cw1",
      type: "cycleway" as const,
      geometry: {
        type: "LineString" as const,
        points: [eastOf(-75), eastOf(0)]
      },
      properties: {
        direction: "one-way" as const,
        protection: "protected" as const,
        widthMetres: 2.5,
        bufferMetres: 0.5,
        alignment: "separate" as const
      }
    };

    const withoutConnector = analyzeCombinedTransportNetwork({
      roads: [existingCycleA, isolatedCycle],
      proposals: []
    });
    const withConnector = analyzeCombinedTransportNetwork({
      roads: [existingCycleA, isolatedCycle],
      proposals: proposalsFromDrawingObjects([connector])
    });

    expect(withoutConnector.cycleNetwork.edges).toBe(2);
    expect(withoutConnector.cycleNetwork.components).toBe(2);
    expect(withConnector.cycleNetwork.edges).toBe(3);
    expect(withConnector.cycleNetwork.components).toBe(2);
    expect(withConnector.cycleNetwork.largestComponentEdges).toBe(2);
  });

  it("counts crossings that connect to a footpath", () => {
    const crossing: DrawingObjectV1 = {
      id: "x1",
      type: "crossing",
      geometry: { type: "Point", point: eastOf(150) },
      properties: { control: "zebra", widthMetres: 3, lengthMetres: 3, bearingDegrees: 0 }
    };
    const footpath: DrawingObjectV1 = {
      id: "fp1",
      type: "footpath",
      geometry: { type: "LineString", points: [eastOf(120), eastOf(180)] },
      properties: {
        clearWidthMetres: 2,
        surface: "paved",
        accessibility: "step-free",
        alignment: "attached"
      }
    };
    const farCrossing: DrawingObjectV1 = {
      ...crossing,
      id: "x2",
      geometry: { type: "Point", point: eastOf(800) }
    };

    const analysis = analyzeCombinedTransportNetwork({
      roads: [],
      proposals: proposalsFromDrawingObjects([crossing, footpath, farCrossing])
    });

    expect(analysis.crossings.total).toBe(2);
    expect(analysis.crossings.connectedToFootpaths).toBe(1);
  });

  it("evaluates roundabout approach completeness", () => {
    const center = northOf(300);
    const roundabout: DrawingObjectV1 = {
      id: "rb1",
      type: "roundabout",
      geometry: { type: "Point", point: center },
      properties: { inscribedCircleDiameterMetres: 32, lanes: 1 }
    };

    const approach = (id: string, target: LatLng) => makeRoadObject(id, [target, center]);

    const lonely = analyzeCombinedTransportNetwork({
      roads: [],
      proposals: proposalsFromDrawingObjects([roundabout])
    });
    const connected = analyzeCombinedTransportNetwork({
      roads: [],
      proposals: proposalsFromDrawingObjects([
        roundabout,
        approach("a1", northOf(400)),
        approach("a2", northOf(200)),
        approach("a3", eastOf(320)),
        approach("a4", eastOf(280))
      ])
    });

    expect(lonely.roundabouts).toHaveLength(1);
    expect(lonely.roundabouts[0].approaches).toBe(0);
    expect(lonely.roundabouts[0].complete).toBe(false);
    expect(connected.roundabouts[0].approaches).toBeGreaterThanOrEqual(4);
    expect(connected.roundabouts[0].complete).toBe(true);
  });
});
