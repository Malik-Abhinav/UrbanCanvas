import { describe, expect, it } from "vitest";
import { buildCombinedNetworkGraphs } from "./network-analysis";
import type { NetworkOsmRoad, NetworkProposal } from "./network-analysis";
import { analyzePedestrianAccessibility } from "./pedestrian-analysis";
import { offsetLatLngMetres } from "./geo";

const ORIGIN = { lat: 37.0, lng: -122.0 };

function point(eastMeters: number, northMeters: number) {
  return offsetLatLngMetres(ORIGIN, { eastMetres: eastMeters, northMetres: northMeters });
}

function eastWestRoad(
  id: number,
  startEast: number,
  lengthMeters: number,
  tags?: Record<string, string>
): NetworkOsmRoad {
  return {
    id,
    kind: "residential",
    geometry: [point(startEast, 0), point(startEast + lengthMeters, 0)],
    tags
  };
}

function northSouthRoad(
  id: number,
  startNorth: number,
  lengthMeters: number,
  tags?: Record<string, string>
): NetworkOsmRoad {
  return {
    id,
    kind: "residential",
    geometry: [point(0, startNorth), point(0, startNorth + lengthMeters)],
    tags
  };
}

function footpathLine(id: string, startEast: number, startNorth: number, lengthMeters: number): NetworkProposal {
  return {
    id,
    kind: "footpath",
    points: [point(startEast, startNorth), point(startEast + lengthMeters, startNorth)]
  };
}

describe("analyzePedestrianAccessibility", () => {
  it("flags a sidewalk gap between two separate sidewalk segments", () => {
    const roadA = eastWestRoad(1, 0, 100, { sidewalk: "both" });
    const roadB = eastWestRoad(2, 100, 60);
    const roadC = eastWestRoad(3, 160, 100, { sidewalk: "both" });
    const graphs = buildCombinedNetworkGraphs([roadA, roadB, roadC], []);

    const result = analyzePedestrianAccessibility(graphs, { maxSidewalkGapMeters: 70 });

    expect(result.gaps).toHaveLength(1);
    expect(result.gaps[0].gapMeters).toBeGreaterThan(50);
    expect(result.gaps[0].gapMeters).toBeLessThan(70);
    expect(typeof result.gaps[0].nearJunction).toBe("boolean");
    expect(result.junctionDiscontinuities).toBe(
      result.gaps.filter((gap) => gap.nearJunction).length
    );
  });

  it("does not flag gaps when sidewalks are continuous", () => {
    const roadA = eastWestRoad(1, 0, 120, { sidewalk: "both" });
    const roadB = eastWestRoad(2, 120, 120, { sidewalk: "both" });
    const graphs = buildCombinedNetworkGraphs([roadA, roadB], []);

    const result = analyzePedestrianAccessibility(graphs);

    expect(result.gaps).toHaveLength(0);
    expect(result.junctionDiscontinuities).toBe(0);
    expect(result.isolatedFootpaths).toHaveLength(0);
  });

  it("reports isolated footpath components detached from the main walkable network", () => {
    const mainRoad = eastWestRoad(1, 0, 200, { sidewalk: "both" });
    // A floating footpath far away (500 m north) from everything else.
    const floatingPath = footpathLine("p1", 0, 500, 80);
    const graphs = buildCombinedNetworkGraphs([mainRoad], [floatingPath]);

    const result = analyzePedestrianAccessibility(graphs);

    expect(result.isolatedFootpaths).toHaveLength(1);
    expect(result.isolatedFootpaths[0].lengthMeters).toBeCloseTo(80, 0);
    expect(result.isolatedFootpaths[0].edgeCount).toBe(1);
  });

  it("counts missing curb/access connections where a walkable path dead-ends away from any road", () => {
    const mainRoad = eastWestRoad(1, 0, 200, { sidewalk: "both" });
    // Footpath starting at the road end and continuing east into open space.
    const danglingPath = footpathLine("fp1", 200, 0, 100);
    const graphs = buildCombinedNetworkGraphs([mainRoad], [danglingPath]);

    const result = analyzePedestrianAccessibility(graphs);

    expect(result.missingCurbConnections).toBeGreaterThanOrEqual(1);
  });

  it("does not count curb connections where the walkable dead-end meets a road", () => {
    const mainRoad = eastWestRoad(1, 0, 200, { sidewalk: "both" });
    // Roads continuing past both walkable ends: both dead-ends touch a road.
    const sideStreet = northSouthRoad(2, 0, 50, { sidewalk: "none" });
    const continuation = eastWestRoad(3, 200, 50);
    const graphs = buildCombinedNetworkGraphs([mainRoad, sideStreet, continuation], []);

    const result = analyzePedestrianAccessibility(graphs);

    expect(result.missingCurbConnections).toBe(0);
  });

  it("flags excessive distances between crossing opportunities on long sidewalk-less roads", () => {
    const longBareRoad = eastWestRoad(1, 0, 400);
    const graphs = buildCombinedNetworkGraphs([longBareRoad], []);

    const result = analyzePedestrianAccessibility(graphs, { maxCrossingSpacingMeters: 150 });

    expect(result.excessiveCrossingDistances).toHaveLength(1);
    expect(result.excessiveCrossingDistances[0].lengthMeters).toBeCloseTo(400, 0);
  });

  it("does not flag short sidewalk-less roads as excessive", () => {
    const shortBareRoad = eastWestRoad(1, 0, 60);
    const graphs = buildCombinedNetworkGraphs([shortBareRoad], []);

    const result = analyzePedestrianAccessibility(graphs);

    expect(result.excessiveCrossingDistances).toHaveLength(0);
  });

  it("marks discontinuities near junctions as dangerous", () => {
    // Three arms meet at the junction; only the eastern arm has sidewalks, so
    // the bare northern corridor (300 m) starts right at the junction.
    const roadA = eastWestRoad(1, 0, 300, { sidewalk: "both" });
    const roadB = northSouthRoad(2, 0, 300);
    const roadC = eastWestRoad(3, -100, 100);
    const graphs = buildCombinedNetworkGraphs([roadA, roadB, roadC], []);
    const result = analyzePedestrianAccessibility(graphs, { maxCrossingSpacingMeters: 150 });

    expect(result.excessiveCrossingDistances.length).toBeGreaterThan(0);
    expect(result.junctionNearExcessiveCrossings).toBe(true);
  });

  it("summarizes sidewalk coverage", () => {
    const sidewalkRoad = eastWestRoad(1, 0, 100, { sidewalk: "both" });
    const bareRoad = eastWestRoad(2, 100, 100);
    const graphs = buildCombinedNetworkGraphs([sidewalkRoad, bareRoad], []);

    const result = analyzePedestrianAccessibility(graphs);

    expect(result.sidewalk.totalLengthMeters).toBeCloseTo(100, 0);
    expect(result.sidewalk.networkLengthMeters).toBeCloseTo(200, 0);
    expect(result.sidewalk.coveragePercent).toBe(50);
  });

  it("always labels its output as heuristic, never certification", () => {
    const result = analyzePedestrianAccessibility(buildCombinedNetworkGraphs([], []));

    expect(result.heuristicDisclaimer).toMatch(/heuristic/i);
    expect(result.heuristicDisclaimer).toMatch(/not an engineering/i);
  });

  it("handles an empty network without throwing", () => {
    const result = analyzePedestrianAccessibility(buildCombinedNetworkGraphs([], []));

    expect(result.gaps).toHaveLength(0);
    expect(result.isolatedFootpaths).toHaveLength(0);
    expect(result.missingCurbConnections).toBe(0);
    expect(result.excessiveCrossingDistances).toHaveLength(0);
    expect(result.sidewalk.coveragePercent).toBe(0);
    expect(result.junctionNearExcessiveCrossings).toBe(false);
  });
});
