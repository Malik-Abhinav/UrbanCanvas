import { describe, expect, it } from "vitest";
import {
  parseDrawingDocument
} from "../shared/drawing-document";
import type { PixelMeasurementContext } from "../shared/legacy-drawing-migration";
import type { DrawingObjectV1 } from "../shared/drawing-document";
import {
  MAX_MIGRATION_MEASUREMENT_METRES,
  MIN_CROSSING_LENGTH_PX,
  MIN_PATH_WIDTH_PX,
  MIN_ROUNDABOUT_RADIUS_PX,
  MIN_ROAD_WIDTH_PX,
  createMigrationPixelsToMetres,
  createPixelMetreConverter,
  getLineObjectWidthMetres,
  hashDrawingObjects,
  metresPerPixelAt,
  parseStoredUserEdits,
  toLegacyAnalysisEdits,
  toUserEditsPayload
} from "./drawing-document-bridge";

const crossingContext: PixelMeasurementContext = {
  at: { lat: 28.61, lng: 77.21 },
  id: "crossing-1",
  measurement: "length",
  objectType: "crossing"
};

describe("metresPerPixelAt", () => {
  it("uses the Web Mercator scale: 156543.034 m/px at the equator and zoom 0", () => {
    expect(metresPerPixelAt(0, 0)).toBeCloseTo(156543.03392, 3);
  });

  it("scales by cos(latitude) and halves per zoom level", () => {
    expect(metresPerPixelAt(60, 0)).toBeCloseTo(156543.03392 * Math.cos((60 * Math.PI) / 180), 3);
    expect(metresPerPixelAt(0, 1)).toBeCloseTo(156543.03392 / 2, 3);
    expect(metresPerPixelAt(-45, 5)).toBe(metresPerPixelAt(45, 5));
  });

  it("clamps polar latitudes and negative zooms instead of returning garbage", () => {
    expect(metresPerPixelAt(89.9, 0)).toBeGreaterThan(0);
    expect(Number.isFinite(metresPerPixelAt(95, 0))).toBe(true);
    expect(metresPerPixelAt(28.61, -3)).toBe(metresPerPixelAt(28.61, 0));
  });
});

describe("createPixelMetreConverter", () => {
  it("converts pixels to metres using the live zoom and the anchor latitude", () => {
    let zoom = 12;
    const converter = createPixelMetreConverter({ getZoom: () => zoom });
    const expected = 10 * metresPerPixelAt(28.61, 12);

    expect(converter.pixelsToMetres(10, crossingContext)).toBeCloseTo(expected, 9);

    zoom = 15;
    expect(converter.pixelsToMetres(10, crossingContext)).toBeCloseTo(
      10 * metresPerPixelAt(28.61, 15),
      9
    );
  });

  it("round-trips pixels → metres → pixels back to the original size", () => {
    const converter = createPixelMetreConverter({ getZoom: () => 14 });
    const pixels = 37;

    const metres = converter.pixelsToMetres(pixels, crossingContext);

    expect(converter.metresToPixels(metres, crossingContext.at)).toBeCloseTo(pixels, 9);
  });
});

describe("createMigrationPixelsToMetres", () => {
  it("clamps results to the migration ceiling so huge drags never drop objects", () => {
    const converter = createPixelMetreConverter({ getZoom: () => 2 });
    const convert = createMigrationPixelsToMetres(converter);

    expect(convert(10_000, crossingContext)).toBe(MAX_MIGRATION_MEASUREMENT_METRES);

    const zoomedWayIn = createMigrationPixelsToMetres(createPixelMetreConverter({ getZoom: () => 20 }));
    expect(zoomedWayIn(1, crossingContext)).toBeLessThan(MAX_MIGRATION_MEASUREMENT_METRES);
  });
});

describe("getLineObjectWidthMetres", () => {
  it("derives real widths from V1 properties", () => {
    expect(
      getLineObjectWidthMetres({
        geometry: { points: [], type: "LineString" },
        id: "r",
        properties: { direction: "two-way", highwayFunction: "local", laneWidthMetres: 3.5, lanes: 2 },
        type: "road"
      })
    ).toBe(7);

    expect(
      getLineObjectWidthMetres({
        geometry: { points: [], type: "LineString" },
        id: "c",
        properties: { alignment: "separate", bufferMetres: 0.5, direction: "one-way", protection: "protected", widthMetres: 2.5 },
        type: "cycleway"
      })
    ).toBe(3.5);

    expect(
      getLineObjectWidthMetres({
        geometry: { points: [], type: "LineString" },
        id: "f",
        properties: { accessibility: "step-free", alignment: "attached", clearWidthMetres: 1.8, surface: "paved" },
        type: "footpath"
      })
    ).toBe(1.8);
  });

  it("exposes distinct minimum pixel floors per object class", () => {
    expect(MIN_ROAD_WIDTH_PX).toBeGreaterThan(MIN_PATH_WIDTH_PX);
    expect(MIN_ROUNDABOUT_RADIUS_PX).toBeGreaterThanOrEqual(MIN_CROSSING_LENGTH_PX / 8);
  });
});

function legacyRoad(id: string) {
  return {
    id,
    path: [
      { lat: 28.61, lng: 77.21 },
      { lat: 28.6101, lng: 77.2101 }
    ],
    snapped: false,
    type: "road" as const
  };
}

describe("parseStoredUserEdits", () => {
  it("migrates a stored legacy array through migrateLegacyDrawingArray", () => {
    const converter = createPixelMetreConverter({ getZoom: () => 12 });
    const result = parseStoredUserEdits([legacyRoad("road-1")], {
      pixelsToMetres: createMigrationPixelsToMetres(converter)
    });

    expect(result.skippedCount).toBe(0);
    expect(result.objects).toHaveLength(1);
    expect(result.objects[0]).toMatchObject({
      id: "road-1",
      properties: { laneWidthMetres: 3.5, lanes: 2 },
      type: "road"
    });
    expect(result.objects[0].geometry).toEqual({
      points: [
        { lat: 28.61, lng: 77.21 },
        { lat: 28.6101, lng: 77.2101 }
      ],
      type: "LineString"
    });
  });

  it("adopts objects from a schemaVersion 1 envelope without re-conversion", () => {
    const converter = createPixelMetreConverter({ getZoom: () => 12 });
    const migrated = parseStoredUserEdits([legacyRoad("road-1")], {
      pixelsToMetres: createMigrationPixelsToMetres(converter)
    });
    const payload = toUserEditsPayload(migrated.objects);

    const reparsed = parseStoredUserEdits(payload, {
      pixelsToMetres: createMigrationPixelsToMetres(createPixelMetreConverter({ getZoom: () => 18 }))
    });

    expect(reparsed.skippedCount).toBe(0);
    // Zoom-independent: V1 objects are already in metres.
    expect(reparsed.objects).toEqual(migrated.objects);
  });

  it("counts invalid entries as skipped instead of rejecting the whole payload", () => {
    const converter = createPixelMetreConverter({ getZoom: () => 12 });
    const result = parseStoredUserEdits(
      [
        legacyRoad("good"),
        { id: "broken", type: "teleporter" },
        { center: { lat: 1, lng: 2 }, id: "ra", pixelRadius: -4, type: "roundabout" }
      ],
      { pixelsToMetres: createMigrationPixelsToMetres(converter) }
    );

    expect(result.objects.map((object) => object.id)).toEqual(["good"]);
    expect(result.skippedCount).toBe(2);
  });

  it("drops later duplicates of an id", () => {
    const converter = createPixelMetreConverter({ getZoom: () => 12 });
    const result = parseStoredUserEdits([legacyRoad("dup"), legacyRoad("dup")], {
      pixelsToMetres: createMigrationPixelsToMetres(converter)
    });

    expect(result.objects).toHaveLength(1);
    expect(result.skippedCount).toBe(1);
  });
});

describe("userEdits serialization round-trip", () => {
  it("produces a valid DrawingDocumentV1 envelope that parses cleanly", () => {
    const converter = createPixelMetreConverter({ getZoom: () => 12 });
    const migrated = parseStoredUserEdits([legacyRoad("road-1")], {
      pixelsToMetres: createMigrationPixelsToMetres(converter)
    });

    const payload = toUserEditsPayload(migrated.objects);

    expect(payload.schemaVersion).toBe(1);
    expect(payload.metadata).toMatchObject({ designBasis: "concept-only", locale: "IN" });

    const parsed = parseDrawingDocument(JSON.parse(JSON.stringify(payload)));
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.objects).toHaveLength(1);
      expect(parsed.data.objects[0].id).toBe("road-1");
    }
  });

  it("returns an empty envelope for no drawings", () => {
    const payload = toUserEditsPayload([]);

    expect(parseDrawingDocument(payload).success).toBe(true);
    expect(payload.objects).toEqual([]);
  });
});

describe("hashDrawingObjects", () => {
  it("is stable across key order but sensitive to property changes", () => {
    const a: DrawingObjectV1[] = [
      {
        geometry: { points: [{ lat: 1, lng: 2 }], type: "LineString" },
        id: "x",
        properties: { direction: "two-way", highwayFunction: "local", laneWidthMetres: 3.5, lanes: 2 },
        type: "road"
      }
    ];
    const reordered = JSON.parse(JSON.stringify(a));
    reordered[0].properties = {
      direction: "two-way",
      highwayFunction: "local",
      lanes: 2,
      laneWidthMetres: 3.5
    };

    expect(hashDrawingObjects(a)).toBe(hashDrawingObjects(reordered));

    const widened = structuredClone(reordered);
    widened[0].properties.lanes = 4;
    expect(hashDrawingObjects(widened)).not.toBe(hashDrawingObjects(reordered));
  });

  it("changes when geometry moves", () => {
    const build = (lat: number): DrawingObjectV1[] => [
      {
        geometry: { points: [{ lat, lng: 2 }, { lat, lng: 3 }], type: "LineString" },
        id: "x",
        properties: { direction: "two-way", highwayFunction: "local", laneWidthMetres: 3.5, lanes: 2 },
        type: "road"
      }
    ];

    expect(hashDrawingObjects(build(1))).not.toBe(hashDrawingObjects(build(2)));
  });
});

describe("toLegacyAnalysisEdits", () => {
  it("maps V1 types onto the analysis vocabulary", () => {
    const converter = createPixelMetreConverter({ getZoom: () => 12 });
    const migrated = parseStoredUserEdits([legacyRoad("road-1")], {
      pixelsToMetres: createMigrationPixelsToMetres(converter)
    });
    const edits = toLegacyAnalysisEdits([
      ...migrated.objects,
      {
        geometry: { point: { lat: 1, lng: 2 }, type: "Point" },
        id: "sig-1",
        properties: { kind: "vehicle" },
        type: "traffic-signal"
      }
    ]);

    expect(edits).toEqual([
      { id: "road-1", type: "road" },
      { id: "sig-1", type: "signal" }
    ]);
  });
});
