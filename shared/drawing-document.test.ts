import { describe, expect, it } from "vitest";
import {
  CONCEPT_DESIGN_DISCLAIMER,
  INDIA_CONCEPT_DEFAULTS,
  createEmptyDrawingDocumentV1,
  parseDrawingDocument
} from "./drawing-document";

const line = () => ({
  type: "LineString" as const,
  points: [
    { lat: 28.6139, lng: 77.209 },
    { lat: 28.614, lng: 77.21 }
  ]
});

const allObjects = [
  {
    id: "road-1",
    type: "road",
    geometry: line(),
    properties: { lanes: 2, direction: "two-way", laneWidthMetres: 3.5, highwayFunction: "local" }
  },
  {
    id: "footpath-1",
    type: "footpath",
    geometry: line(),
    properties: { clearWidthMetres: 1.8, surface: "paved", accessibility: "step-free", alignment: "attached" }
  },
  {
    id: "cycleway-1",
    type: "cycleway",
    geometry: line(),
    properties: {
      direction: "one-way",
      protection: "protected",
      widthMetres: 2.5,
      bufferMetres: 0.5,
      alignment: "separate"
    }
  },
  {
    id: "crossing-1",
    type: "crossing",
    geometry: { type: "Point", point: { lat: 28.6139, lng: 77.209 } },
    properties: { control: "uncontrolled", widthMetres: 3, lengthMetres: 12, bearingDegrees: 90 }
  },
  {
    id: "roundabout-1",
    type: "roundabout",
    geometry: { type: "Point", point: { lat: 28.6139, lng: 77.209 } },
    properties: { inscribedCircleDiameterMetres: 32, lanes: 1 }
  },
  {
    id: "signal-1",
    type: "traffic-signal",
    geometry: { type: "Point", point: { lat: 28.6139, lng: 77.209 } },
    properties: { kind: "vehicle" }
  }
];

function validDocument() {
  return {
    schemaVersion: 1,
    metadata: {
      locale: "IN",
      designBasis: "concept-only",
      disclaimer: CONCEPT_DESIGN_DISCLAIMER
    },
    objects: allObjects
  };
}

type MutableTestDocument = {
  debug?: boolean;
  objects: Array<{
    id: string;
    geometry: {
      points?: Array<{ lat: number; lng: number }>;
      point?: { lat: number; lng: number };
    };
    properties: Record<string, unknown>;
  }>;
};

const mutableDocument = () => structuredClone(validDocument()) as unknown as MutableTestDocument;

describe("DrawingDocumentV1", () => {
  it("provides explicit India-tilted conceptual defaults", () => {
    expect(INDIA_CONCEPT_DEFAULTS).toMatchObject({
      road: { laneWidthMetres: 3.5 },
      footpath: { clearWidthMetres: 1.8 },
      cycleway: { oneWayWidthMetres: 2.5, twoWayWidthMetres: 3 },
      crossing: { widthMetres: 3 },
      roundabout: { inscribedCircleDiameterMetres: 32 }
    });
    expect(CONCEPT_DESIGN_DISCLAIMER).toContain("concept design");
    expect(CONCEPT_DESIGN_DISCLAIMER).toContain("not a claim of compliance");

    expect(createEmptyDrawingDocumentV1()).toEqual({
      schemaVersion: 1,
      metadata: {
        locale: "IN",
        designBasis: "concept-only",
        disclaimer: CONCEPT_DESIGN_DISCLAIMER
      },
      objects: []
    });
  });

  it("parses all six object kinds", () => {
    const parsed = parseDrawingDocument(validDocument());
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.objects.map((object) => object.type)).toEqual([
        "road",
        "footpath",
        "cycleway",
        "crossing",
        "roundabout",
        "traffic-signal"
      ]);
    }
  });

  it("rejects unknown schema versions instead of guessing", () => {
    const parsed = parseDrawingDocument({ ...validDocument(), schemaVersion: 2 });
    expect(parsed).toMatchObject({ success: false, issues: [{ code: "unsupported_version", path: ["schemaVersion"] }] });
  });

  it.each([
    ["NaN latitude", ["objects", 0, "geometry", "points", 0, "lat"], (document: MutableTestDocument) => { document.objects[0].geometry.points![0].lat = Number.NaN; }],
    ["latitude outside range", ["objects", 0, "geometry", "points", 0, "lat"], (document: MutableTestDocument) => { document.objects[0].geometry.points![0].lat = 91; }],
    ["longitude outside range", ["objects", 3, "geometry", "point", "lng"], (document: MutableTestDocument) => { document.objects[3].geometry.point!.lng = -181; }],
    ["zero physical dimension", ["objects", 2, "properties", "widthMetres"], (document: MutableTestDocument) => { document.objects[2].properties.widthMetres = 0; }],
    ["non-integer lanes", ["objects", 4, "properties", "lanes"], (document: MutableTestDocument) => { document.objects[4].properties.lanes = 1.5; }],
    ["bearing of 360 degrees", ["objects", 3, "properties", "bearingDegrees"], (document: MutableTestDocument) => { document.objects[3].properties.bearingDegrees = 360; }],
    ["line with one point", ["objects", 1, "geometry", "points"], (document: MutableTestDocument) => { document.objects[1].geometry.points = [{ lat: 1, lng: 2 }]; }]
  ])("rejects %s with a precise issue path", (_name, path, mutate) => {
    const document = mutableDocument();
    mutate(document);
    const parsed = parseDrawingDocument(document);
    expect(parsed).toMatchObject({ success: false, issues: [{ path }] });
  });

  it("rejects unknown fields at document and nested levels", () => {
    const document = mutableDocument();
    document.debug = true;
    document.objects[0].properties.speed = 40;
    const parsed = parseDrawingDocument(document);
    expect(parsed).toMatchObject({
      success: false,
      issues: expect.arrayContaining([
        expect.objectContaining({ code: "unknown_key", path: ["debug"] }),
        expect.objectContaining({ code: "unknown_key", path: ["objects", 0, "properties", "speed"] })
      ])
    });
  });

  it("rejects duplicate IDs and invalid enum values", () => {
    const document = mutableDocument();
    document.objects[1].id = "road-1";
    document.objects[5].properties.kind = "magic";
    const parsed = parseDrawingDocument(document);
    expect(parsed).toMatchObject({
      success: false,
      issues: expect.arrayContaining([
        expect.objectContaining({ code: "duplicate_id", path: ["objects", 1, "id"] }),
        expect.objectContaining({ code: "invalid_value", path: ["objects", 5, "properties", "kind"] })
      ])
    });
  });

  it("stops point validation after the hard per-line limit", () => {
    const document = mutableDocument();
    document.objects[0].geometry.points = Array.from({ length: 10_001 }, () => ({
      lat: Number.NaN,
      lng: Number.NaN
    }));

    const parsed = parseDrawingDocument(document);
    expect(parsed).toMatchObject({
      success: false,
      issues: [{ code: "out_of_range", path: ["objects", 0, "geometry", "points"] }]
    });
  });

  it("caps object traversal and validation issue accumulation", () => {
    const document = validDocument();
    document.objects = Array.from({ length: 10_001 }, (_, index) => ({
      id: `signal-${index}`,
      type: "traffic-signal",
      geometry: { type: "Point", point: { lat: Number.NaN, lng: 77.2 } },
      properties: { kind: "vehicle" }
    }));

    const parsed = parseDrawingDocument(document);
    expect(parsed.success).toBe(false);
    if (!parsed.success) {
      expect(parsed.issues[0]).toMatchObject({ code: "out_of_range", path: ["objects"] });
      expect(parsed.issues.length).toBeLessThanOrEqual(1_001);
    }
  });
});
