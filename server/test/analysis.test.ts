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
});
