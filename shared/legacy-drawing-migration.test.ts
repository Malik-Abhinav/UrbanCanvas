import { describe, expect, it, vi } from "vitest";
import { parseDrawingDocument } from "./drawing-document";
import { migrateLegacyDrawingArray } from "./legacy-drawing-migration";

const delhiA = { lat: 28.6139, lng: 77.209 };
const delhiB = { lat: 28.6142, lng: 77.2101 };

describe("legacy v0 drawing migration", () => {
  it("preserves IDs and map coordinates while mapping legacy path types", () => {
    const legacy = [
      { id: "r", type: "road", path: [delhiA, delhiB], snapped: true },
      { id: "b", type: "bike", path: [delhiA, delhiB], snapped: false },
      { id: "s", type: "sidewalk", path: [delhiB, delhiA], snapped: true },
      { id: "sig", type: "signal", point: delhiA }
    ];

    const result = migrateLegacyDrawingArray(legacy, { pixelsToMetres: () => 1 });

    expect(result.issues).toEqual([]);
    expect(result.document.objects.map((object) => ({ id: object.id, type: object.type }))).toEqual([
      { id: "r", type: "road" },
      { id: "b", type: "cycleway" },
      { id: "s", type: "footpath" },
      { id: "sig", type: "traffic-signal" }
    ]);
    expect(result.document.objects[0].geometry).toEqual({ type: "LineString", points: [delhiA, delhiB] });
    expect(result.document.objects[1].geometry).toEqual({ type: "LineString", points: [delhiA, delhiB] });
    expect(result.document.objects[2].geometry).toEqual({ type: "LineString", points: [delhiB, delhiA] });
    expect(result.document.objects[3].geometry).toEqual({ type: "Point", point: delhiA });
    expect(parseDrawingDocument(result.document).success).toBe(true);
  });

  it("applies India-tilted defaults to migrated path and signal objects", () => {
    const result = migrateLegacyDrawingArray(
      [
        { id: "r", type: "road", path: [delhiA, delhiB], snapped: false },
        { id: "b", type: "bike", path: [delhiA, delhiB], snapped: false },
        { id: "s", type: "sidewalk", path: [delhiA, delhiB], snapped: false },
        { id: "sig", type: "signal", point: delhiA }
      ],
      { pixelsToMetres: () => 1 }
    );

    expect(result.document.objects[0]).toMatchObject({
      properties: { lanes: 2, direction: "two-way", laneWidthMetres: 3.5, highwayFunction: "local" }
    });
    expect(result.document.objects[1]).toMatchObject({
      properties: { direction: "one-way", protection: "protected", widthMetres: 2.5, bufferMetres: 0.5, alignment: "separate" }
    });
    expect(result.document.objects[2]).toMatchObject({
      properties: { clearWidthMetres: 1.8, surface: "paved", accessibility: "step-free", alignment: "attached" }
    });
    expect(result.document.objects[3]).toMatchObject({ properties: { kind: "vehicle" } });
  });

  it("converts crossing length and roundabout diameter with projection context", () => {
    const pixelsToMetres = vi.fn((pixels: number) => pixels * 0.75);
    const result = migrateLegacyDrawingArray(
      [
        { id: "cross", type: "crossing", anchor: delhiA, pixelVector: { x: 3, y: -4 } },
        { id: "round", type: "roundabout", center: delhiB, pixelRadius: 10 }
      ],
      { pixelsToMetres }
    );

    expect(pixelsToMetres).toHaveBeenNthCalledWith(1, 5, {
      objectType: "crossing",
      id: "cross",
      at: delhiA,
      measurement: "length"
    });
    expect(pixelsToMetres).toHaveBeenNthCalledWith(2, 20, {
      objectType: "roundabout",
      id: "round",
      at: delhiB,
      measurement: "diameter"
    });
    expect(result.document.objects[0]).toMatchObject({
      geometry: { type: "Point", point: delhiA },
      properties: { widthMetres: 3, lengthMetres: 3.75, bearingDegrees: expect.closeTo(36.87, 2) }
    });
    expect(result.document.objects[1]).toMatchObject({
      geometry: { type: "Point", point: delhiB },
      properties: { inscribedCircleDiameterMetres: 15, lanes: 1 }
    });
  });

  it("reports malformed entries and continues migrating recoverable neighbours", () => {
    const result = migrateLegacyDrawingArray(
      [
        { id: "good-1", type: "signal", point: delhiA },
        { id: "bad-path", type: "road", path: [delhiA], snapped: false },
        { id: "bad-coordinate", type: "signal", point: { lat: Infinity, lng: 77 } },
        { id: "unknown", type: "tram", point: delhiA },
        null,
        { id: "good-2", type: "sidewalk", path: [delhiA, delhiB], snapped: true }
      ],
      { pixelsToMetres: () => 1 }
    );

    expect(result.document.objects.map((object) => object.id)).toEqual(["good-1", "good-2"]);
    expect(result.issues).toEqual([
      expect.objectContaining({ index: 1, code: "invalid_legacy_entry", path: [1, "path"] }),
      expect.objectContaining({ index: 2, code: "invalid_legacy_entry", path: [2, "point", "lat"] }),
      expect.objectContaining({ index: 3, code: "unsupported_legacy_type", path: [3, "type"] }),
      expect.objectContaining({ index: 4, code: "invalid_legacy_entry", path: [4] })
    ]);
  });

  it.each([
    ["throws", () => { throw new Error("projection unavailable"); }],
    ["returns NaN", () => Number.NaN],
    ["returns zero", () => 0]
  ])("turns a conversion callback that %s into a recoverable issue", (_name, pixelsToMetres) => {
    const result = migrateLegacyDrawingArray(
      [
        { id: "cross", type: "crossing", anchor: delhiA, pixelVector: { x: 1, y: 1 } },
        { id: "sig", type: "signal", point: delhiB }
      ],
      { pixelsToMetres }
    );

    expect(result.document.objects.map((object) => object.id)).toEqual(["sig"]);
    expect(result.issues).toEqual([
      expect.objectContaining({ index: 0, code: "conversion_failed", path: [0, "pixelVector"] })
    ]);
  });

  it("turns positive conversion results above the V1 maximum into recoverable issues", () => {
    const result = migrateLegacyDrawingArray(
      [
        { id: "cross", type: "crossing", anchor: delhiA, pixelVector: { x: 1, y: 1 } },
        { id: "round", type: "roundabout", center: delhiB, pixelRadius: 10 },
        { id: "sig", type: "signal", point: delhiB }
      ],
      { pixelsToMetres: () => 1_001 }
    );

    expect(result.document.objects.map((object) => object.id)).toEqual(["sig"]);
    expect(result.issues).toEqual([
      expect.objectContaining({ index: 0, code: "conversion_failed", path: [0, "pixelVector"] }),
      expect.objectContaining({ index: 1, code: "conversion_failed", path: [1, "pixelRadius"] })
    ]);
    expect(parseDrawingDocument(result.document).success).toBe(true);
  });

  it("rejects finite pixel components whose magnitude overflows", () => {
    const result = migrateLegacyDrawingArray(
      [
        {
          id: "cross",
          type: "crossing",
          anchor: delhiA,
          pixelVector: { x: Number.MAX_VALUE, y: Number.MAX_VALUE }
        }
      ],
      { pixelsToMetres: () => 1 }
    );

    expect(result.document.objects).toEqual([]);
    expect(result.issues).toEqual([
      expect.objectContaining({ index: 0, code: "conversion_failed", path: [0, "pixelVector"] })
    ]);
  });

  it("reports a non-array payload instead of throwing", () => {
    const result = migrateLegacyDrawingArray({ objects: [] }, { pixelsToMetres: () => 1 });
    expect(result.document.objects).toEqual([]);
    expect(result.issues).toEqual([
      expect.objectContaining({ index: null, code: "invalid_legacy_payload", path: [] })
    ]);
  });

  it("skips duplicate IDs with a structured issue so the resulting document stays valid", () => {
    const result = migrateLegacyDrawingArray(
      [
        { id: "same", type: "signal", point: delhiA },
        { id: "same", type: "signal", point: delhiB }
      ],
      { pixelsToMetres: () => 1 }
    );
    expect(result.document.objects).toHaveLength(1);
    expect(result.issues).toEqual([
      expect.objectContaining({ index: 1, code: "duplicate_id", path: [1, "id"] })
    ]);
    expect(parseDrawingDocument(result.document).success).toBe(true);
  });
});
