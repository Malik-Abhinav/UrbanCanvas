import { describe, expect, it } from "vitest";
import type {
  CrossingObject,
  CyclewayObject,
  DrawingObjectV1,
  RoadObject,
  RoundaboutObject,
  TrafficSignalObject
} from "./drawing-document";
import { CONCEPT_DESIGN_DISCLAIMER } from "./drawing-document";
import { CYCLING_HEURISTIC_DISCLAIMER, analyzeCyclingDesign } from "./cycling-analysis";

const p = (lat: number, lng: number) => ({ lat, lng });
const line = (points: Array<[number, number]>) => ({
  type: "LineString" as const,
  points: points.map(([lat, lng]) => p(lat, lng))
});

let nextId = 0;
function cycleway(
  points: Array<[number, number]>,
  properties: Partial<CyclewayObject["properties"]> = {}
): CyclewayObject {
  nextId += 1;
  return {
    id: `cycle-${nextId}`,
    type: "cycleway",
    geometry: line(points),
    properties: {
      direction: "one-way",
      protection: "protected",
      widthMetres: 2.5,
      bufferMetres: 0.5,
      alignment: "separate",
      ...properties
    }
  };
}

function road(
  points: Array<[number, number]>,
  properties: Partial<RoadObject["properties"]> = {}
): RoadObject {
  nextId += 1;
  return {
    id: `road-${nextId}`,
    type: "road",
    geometry: line(points),
    properties: {
      lanes: 2,
      direction: "two-way",
      laneWidthMetres: 3.5,
      highwayFunction: "local",
      ...properties
    }
  };
}

function crossing(
  point: [number, number],
  properties: Partial<CrossingObject["properties"]> = {}
): CrossingObject {
  nextId += 1;
  return {
    id: `crossing-${nextId}`,
    type: "crossing",
    geometry: { type: "Point", point: p(...point) },
    properties: {
      control: "zebra",
      widthMetres: 3,
      lengthMetres: 6,
      bearingDegrees: 0,
      ...properties
    }
  };
}

function roundabout(point: [number, number]): RoundaboutObject {
  nextId += 1;
  return {
    id: `roundabout-${nextId}`,
    type: "roundabout",
    geometry: { type: "Point", point: p(...point) },
    properties: { inscribedCircleDiameterMetres: 32, lanes: 1 }
  };
}

function signal(
  point: [number, number],
  properties: Partial<TrafficSignalObject["properties"]> = {}
): TrafficSignalObject {
  nextId += 1;
  return {
    id: `signal-${nextId}`,
    type: "traffic-signal",
    geometry: { type: "Point", point: p(...point) },
    properties: { kind: "vehicle", ...properties }
  };
}

const doc = (objects: DrawingObjectV1[]) => ({
  schemaVersion: 1 as const,
  metadata: {
    locale: "IN" as const,
    designBasis: "concept-only" as const,
    disclaimer: CONCEPT_DESIGN_DISCLAIMER
  },
  objects
});

describe("analyzeCyclingDesign", () => {
  it("returns no issues for an empty document", () => {
    const result = analyzeCyclingDesign(doc([]));
    expect(result.issues).toEqual([]);
    expect(result.heuristicDisclaimer).toBe(CYCLING_HEURISTIC_DISCLAIMER);
    expect(result.cyclewayCount).toBe(0);
  });

  describe("protected vs painted continuity", () => {
    it("flags connected cycleways whose protection changes", () => {
      // Two ~110 m segments joined end-to-end along the same street.
      const result = analyzeCyclingDesign(
        doc([
          cycleway([[12.9, 77.58], [12.9, 77.59]], { protection: "protected" }),
          cycleway([[12.9, 77.59], [12.9, 77.6]], { protection: "painted" })
        ])
      );
      const issue = result.issues.find((i) => i.code === "protection-discontinuity");
      expect(issue).toBeDefined();
      expect(issue?.objectIds).toHaveLength(2);
    });

    it("does not flag consistent protection", () => {
      const result = analyzeCyclingDesign(
        doc([
          cycleway([[12.9, 77.58], [12.9, 77.59]], { protection: "painted" }),
          cycleway([[12.9, 77.59], [12.9, 77.6]], { protection: "painted" })
        ])
      );
      expect(result.issues.find((i) => i.code === "protection-discontinuity")).toBeUndefined();
    });

    it("does not flag parallel segments merely near each other", () => {
      const result = analyzeCyclingDesign(
        doc([
          cycleway([[12.9, 77.58], [12.9, 77.59]], { protection: "protected" }),
          cycleway([[12.901, 77.58], [12.901, 77.59]], { protection: "painted" })
        ])
      );
      expect(result.issues.find((i) => i.code === "protection-discontinuity")).toBeUndefined();
    });
  });

  describe("abrupt termination", () => {
    it("flags an isolated cycleway end far from anything else", () => {
      const result = analyzeCyclingDesign(doc([cycleway([[12.9, 77.58], [12.9, 77.59]])]));
      const issues = result.issues.filter((i) => i.code === "abrupt-termination");
      expect(issues).toHaveLength(1);
    });

    it("does not flag ends that connect to another cycleway", () => {
      const result = analyzeCyclingDesign(
        doc([
          cycleway([[12.9, 77.58], [12.9, 77.59]]),
          cycleway([[12.9, 77.59], [12.91, 77.59]]),
          cycleway([[12.91, 77.59], [12.91, 77.58]]),
          cycleway([[12.91, 77.58], [12.9, 77.58]])
        ])
      );
      expect(result.issues.filter((i) => i.code === "abrupt-termination")).toHaveLength(0);
    });

    it("reports one issue per route, listing every dangling end", () => {
      const result = analyzeCyclingDesign(
        doc([
          cycleway([[12.9, 77.58], [12.9, 77.59]]),
          cycleway([[12.9, 77.59], [12.9, 77.60]])
        ])
      );
      const issues = result.issues.filter((i) => i.code === "abrupt-termination");
      expect(issues).toHaveLength(1);
      expect(issues[0].objectIds).toHaveLength(2);
      expect(issues[0].message).toContain("2 ends");
    });

    it("does not flag an end that lands on a crossing (transition)", () => {
      const result = analyzeCyclingDesign(
        doc([
          cycleway([[12.9, 77.58], [12.9, 77.59]]),
          crossing([12.9, 77.59]),
          crossing([12.9, 77.58])
        ])
      );
      expect(result.issues.filter((i) => i.code === "abrupt-termination")).toHaveLength(0);
    });
  });

  describe("direction conflicts", () => {
    it("flags connected segments with mismatched direction", () => {
      const result = analyzeCyclingDesign(
        doc([
          cycleway([[12.9, 77.58], [12.9, 77.59]], { direction: "one-way" }),
          cycleway([[12.9, 77.59], [12.9, 77.60]], { direction: "two-way" })
        ])
      );
      expect(result.issues.find((i) => i.code === "direction-conflict")).toBeDefined();
    });

    it("does not flag matching directions", () => {
      const result = analyzeCyclingDesign(
        doc([
          cycleway([[12.9, 77.58], [12.9, 77.59]], { direction: "two-way" }),
          cycleway([[12.9, 77.59], [12.9, 77.60]], { direction: "two-way" })
        ])
      );
      expect(result.issues.find((i) => i.code === "direction-conflict")).toBeUndefined();
    });
  });

  describe("implausible widths", () => {
    it("flags a too-narrow two-way cycleway", () => {
      const result = analyzeCyclingDesign(
        doc([cycleway([[12.9, 77.58], [12.9, 77.59]], { direction: "two-way", widthMetres: 2 })])
      );
      expect(result.issues.find((i) => i.code === "implausible-width")).toBeDefined();
    });

    it("flags an excessively wide cycleway", () => {
      const result = analyzeCyclingDesign(
        doc([cycleway([[12.9, 77.58], [12.9, 77.59]], { widthMetres: 8 })])
      );
      expect(result.issues.find((i) => i.code === "implausible-width")).toBeDefined();
    });

    it("flags implausible road lane/lane-width combinations", () => {
      const result = analyzeCyclingDesign(
        doc([road([[12.9, 77.58], [12.9, 77.59]], { lanes: 12, laneWidthMetres: 5 })])
      );
      const issue = result.issues.find((i) => i.code === "implausible-road-section");
      expect(issue).toBeDefined();
    });

    it("accepts ordinary road sections", () => {
      const result = analyzeCyclingDesign(
        doc([road([[12.9, 77.58], [12.9, 77.59]], { lanes: 2, laneWidthMetres: 3.5 })])
      );
      expect(result.issues.find((i) => i.code === "implausible-road-section")).toBeUndefined();
    });
  });

  describe("intersections lacking transitions", () => {
    it("flags a cycleway ending on a road with no nearby crossing", () => {
      const result = analyzeCyclingDesign(
        doc([
          road([[12.89, 77.58], [12.91, 77.58]]),
          cycleway([[12.9, 77.57], [12.9, 77.58]])
        ])
      );
      expect(result.issues.find((i) => i.code === "missing-intersection-transition")).toBeDefined();
    });

    it("does not flag when a crossing sits at the junction", () => {
      const result = analyzeCyclingDesign(
        doc([
          road([[12.89, 77.58], [12.91, 77.58]]),
          cycleway([[12.9, 77.57], [12.9, 77.58]]),
          crossing([12.9, 77.58])
        ])
      );
      expect(
        result.issues.find((i) => i.code === "missing-intersection-transition")
      ).toBeUndefined();
    });
  });

  describe("roundabout / cycle conflicts", () => {
    it("warns when a cycleway reaches a roundabout with no crossing nearby", () => {
      const result = analyzeCyclingDesign(
        doc([
          roundabout([12.9, 77.59]),
          cycleway([[12.895, 77.59], [12.89985, 77.59]])
        ])
      );
      expect(result.issues.find((i) => i.code === "roundabout-cycle-conflict")).toBeDefined();
    });

    it("does not warn when a crossing coordinates the approach", () => {
      const result = analyzeCyclingDesign(
        doc([
          roundabout([12.9, 77.59]),
          cycleway([[12.895, 77.59], [12.89985, 77.59]]),
          crossing([12.8998, 77.59])
        ])
      );
      expect(result.issues.find((i) => i.code === "roundabout-cycle-conflict")).toBeUndefined();
    });
  });

  describe("signal / crossing coordination", () => {
    it("flags a signal-controlled crossing with no signal nearby", () => {
      const result = analyzeCyclingDesign(
        doc([crossing([12.9, 77.59], { control: "signal-controlled" })])
      );
      expect(result.issues.find((i) => i.code === "uncoordinated-signal-crossing")).toBeDefined();
    });

    it("does not flag when a signal stands beside the crossing", () => {
      const result = analyzeCyclingDesign(
        doc([
          crossing([12.9, 77.59], { control: "signal-controlled" }),
          signal([12.90005, 77.59], { kind: "pedestrian" })
        ])
      );
      expect(
        result.issues.find((i) => i.code === "uncoordinated-signal-crossing")
      ).toBeUndefined();
    });

    it("flags a pedestrian/cycle signal with no crossing to serve", () => {
      const result = analyzeCyclingDesign(doc([signal([12.9, 77.59], { kind: "cycle" })]));
      expect(result.issues.find((i) => i.code === "orphaned-signal")).toBeDefined();
    });

    it("does not flag vehicle-only signals", () => {
      const result = analyzeCyclingDesign(doc([signal([12.9, 77.59], { kind: "vehicle" })]));
      expect(result.issues.find((i) => i.code === "orphaned-signal")).toBeUndefined();
    });
  });

  it("reports cycleway coverage stats", () => {
    const result = analyzeCyclingDesign(
      doc([
        cycleway([[12.9, 77.58], [12.9, 77.59]], { protection: "protected" }),
        cycleway([[12.901, 77.58], [12.901, 77.59]], { protection: "painted" })
      ])
    );
    expect(result.cyclewayCount).toBe(2);
    expect(result.protectedLengthMeters).toBeGreaterThan(0);
    expect(result.paintedLengthMeters).toBeGreaterThan(0);
  });
});
