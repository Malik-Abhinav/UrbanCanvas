import { describe, expect, it } from "vitest";
import { normalizeSavedProject } from "./project-normalization";

const bbox = { north: 28.615, south: 28.605, east: 77.215, west: 77.205 };
const osmData = {
  bbox,
  buildings: [],
  counts: { buildings: 0, openLand: 0, roads: 0 },
  openLand: [],
  roads: []
};
const validSignal = {
  id: "signal-1",
  point: { lat: 28.61, lng: 77.21 },
  type: "signal"
};

function validProject(overrides: Record<string, unknown> = {}) {
  return {
    bbox,
    created_at: "2026-08-24T00:00:00.000Z",
    id: "11111111-1111-4111-8111-111111111111",
    name: "My plan",
    osm_data: osmData,
    updated_at: "2026-08-24T00:00:00.000Z",
    user_edits: [validSignal],
    ...overrides
  };
}

describe("normalizeSavedProject", () => {
  it("keeps valid drawings and reports malformed drawing entries", () => {
    const result = normalizeSavedProject(
      validProject({
        user_edits: [
          validSignal,
          null,
          { id: "bad-type", type: "teleporter" },
          { id: "bad-point", point: { lat: "north", lng: 77.21 }, type: "signal" }
        ]
      })
    );

    expect(result).toEqual({ project: expect.objectContaining({ user_edits: [validSignal] }), skippedDrawingCount: 3 });
  });

  it.each([
    ["missing base fields", { name: null }],
    ["invalid bbox", { bbox: { ...bbox, north: Number.NaN } }],
    ["invalid OSM payload", { osm_data: { ...osmData, roads: "not-an-array" } }],
    ["non-array drawings", { user_edits: {} }]
  ])("rejects an unrecoverable %s payload", (_label, overrides) => {
    expect(normalizeSavedProject(validProject(overrides))).toBeNull();
  });

  it("validates every supported drawing shape", () => {
    const drawings = [
      { id: "road-1", path: [{ lat: 1, lng: 2 }, { lat: 3, lng: 4 }], snapped: false, type: "road" },
      { id: "crossing-1", anchor: { lat: 1, lng: 2 }, pixelVector: { x: 5, y: 6 }, type: "crossing" },
      { center: { lat: 1, lng: 2 }, id: "roundabout-1", pixelRadius: 12, type: "roundabout" },
      validSignal
    ];

    expect(normalizeSavedProject(validProject({ user_edits: drawings }))).toMatchObject({
      project: { user_edits: drawings },
      skippedDrawingCount: 0
    });
  });
});
