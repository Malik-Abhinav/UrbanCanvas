import { describe, expect, it } from "vitest";
import { analyzeProjectChanges } from "../src/analysis.js";

const bbox = { north: 28.615, south: 28.605, east: 77.215, west: 77.205 };

function makeOsmData(roadCount = 12) {
  return {
    bbox,
    counts: { buildings: 5, roads: roadCount, openLand: 1 },
    buildings: [],
    roads: Array.from({ length: roadCount }, (_, index) => ({
      id: index,
      kind: "residential",
      geometry: [{ lat: 28.61, lng: 77.21 }]
    })),
    openLand: []
  };
}

function makeInput(overrides: Record<string, unknown> = {}) {
  return {
    bbox,
    osmData: makeOsmData(),
    projectName: "Test plan",
    userEdits: [],
    ...overrides
  };
}

describe("analyzeProjectChanges", () => {
  it("returns a rules analysis with all sections", () => {
    const analysis = analyzeProjectChanges(makeInput());

    expect(analysis.provider).toBe("rules");
    expect(typeof analysis.summary).toBe("string");
    expect(Array.isArray(analysis.safetyObservations)).toBe(true);
    expect(Array.isArray(analysis.pedestrianImpact)).toBe(true);
    expect(Array.isArray(analysis.suggestions)).toBe(true);
  });

  it("describes the edit mix in the summary", () => {
    const analysis = analyzeProjectChanges(
      makeInput({
        userEdits: [
          { id: "a", type: "sidewalk" },
          { id: "b", type: "signal" },
          { id: "c", type: "crossing", anchor: { lat: 0, lng: 0 }, pixelVector: { x: 1, y: 2 } },
          { id: "junk-shape" }
        ]
      })
    );

    expect(analysis.summary).toContain("1 sidewalk");
    expect(analysis.summary).toContain("1 traffic signal");
    expect(analysis.summary).toContain("1 crossing");
  });

  it("flags sidewalks without crossings as a safety observation on busy areas", () => {
    const analysis = analyzeProjectChanges(
      makeInput({
        userEdits: [{ id: "a", type: "sidewalk" }]
      })
    );

    expect(analysis.safetyObservations.join(" ")).toContain("no crossings");
  });

  it("rejects invalid input shapes", () => {
    expect(() => analyzeProjectChanges(null)).toThrow();
    expect(() => analyzeProjectChanges({})).toThrow(/bbox/);
    expect(() => analyzeProjectChanges(makeInput({ osmData: null }))).toThrow(/osmData/);
    expect(() => analyzeProjectChanges(makeInput({ userEdits: "nope" }))).toThrow(/userEdits/);
  });

  it("ignores malformed edit objects instead of crashing", () => {
    const analysis = analyzeProjectChanges(
      makeInput({
        userEdits: [null, 42, { id: "ok", type: "crossing", anchor: { lat: 0, lng: 0 }, pixelVector: { x: 1, y: 2 } }]
      })
    );

    expect(analysis.summary).toContain("1 crossing");
  });

  it("surfaces cycling design findings for dangling bike lanes", () => {
    const analysis = analyzeProjectChanges(
      makeInput({
        userEdits: [
          {
            id: "bike-1",
            type: "bike",
            path: [
              { lat: 28.61, lng: 77.21 },
              { lat: 28.611, lng: 77.211 }
            ],
            snapped: false
          }
        ]
      })
    );

    const cyclingLines = analysis.pedestrianImpact.filter((line) =>
      line.startsWith("Heuristic cycling:")
    );
    expect(cyclingLines.join(" ")).toContain("cycle route");
  });

  it("reports when no cycling design issues are found", () => {
    const analysis = analyzeProjectChanges(
      makeInput({
        userEdits: [
          { id: "x1", type: "crossing", anchor: { lat: 0, lng: 0 }, pixelVector: { x: 1, y: 2 } }
        ]
      })
    );

    expect(
      analysis.pedestrianImpact.some(
        (line) => line.startsWith("Heuristic cycling:") && /no cycling/i.test(line)
      )
    ).toBe(true);
  });
});


describe("analyzeProjectChanges input hardening", () => {
  it("rejects non-finite or negative OSM counts", () => {
    const badCounts = (counts: Record<string, unknown>) =>
      makeInput({
        osmData: { ...makeOsmData(), counts: { ...makeOsmData().counts, ...counts } }
      });

    expect(() => analyzeProjectChanges(badCounts({ roads: Number.NaN }))).toThrow(/osmData/);
    expect(() => analyzeProjectChanges(badCounts({ buildings: -3 }))).toThrow(/osmData/);
    expect(() => analyzeProjectChanges(badCounts({ openLand: "many" }))).toThrow(/osmData/);
  });

  it("caps long project names instead of echoing arbitrary text", () => {
    const analysis = analyzeProjectChanges(makeInput({ projectName: "x".repeat(500) }));

    expect(analysis.summary.length).toBeLessThan(400);
  });

  it("analyzes 501 valid edits within the request body limit", () => {
    const edits = Array.from({ length: 501 }, (_, index) => ({ id: String(index), type: "signal" }));

    const analysis = analyzeProjectChanges(makeInput({ userEdits: edits }));

    expect(analysis.summary).toContain("501 traffic signals");
  });

  it("rejects more than 10,000 edits before analysis work", () => {
    const edits = Array.from({ length: 10_001 }, (_, index) => ({ id: String(index), type: "signal" }));

    expect(() => analyzeProjectChanges(makeInput({ userEdits: edits }))).toThrow(/10,000 drawing edits/i);
  });

  it("treats a whitespace-only project name as unnamed", () => {
    const analysis = analyzeProjectChanges(makeInput({ projectName: "   " }));

    expect(analysis.summary.startsWith("This project")).toBe(true);
  });
});
