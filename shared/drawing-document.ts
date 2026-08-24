import type { LatLng } from "./geo";

export const CONCEPT_DESIGN_DISCLAIMER =
  "For early concept design only; values are India-tilted starting assumptions, not a claim of compliance or a substitute for applicable standards, surveys, engineering review, or authority approval.";

export const INDIA_CONCEPT_DEFAULTS = {
  road: { lanes: 2, direction: "two-way" as const, laneWidthMetres: 3.5, highwayFunction: "local" as const },
  footpath: {
    clearWidthMetres: 1.8,
    surface: "paved" as const,
    accessibility: "step-free" as const,
    alignment: "attached" as const
  },
  cycleway: {
    direction: "one-way" as const,
    protection: "protected" as const,
    oneWayWidthMetres: 2.5,
    twoWayWidthMetres: 3,
    bufferMetres: 0.5,
    alignment: "separate" as const
  },
  crossing: { control: "uncontrolled" as const, widthMetres: 3 },
  roundabout: { inscribedCircleDiameterMetres: 32, lanes: 1 },
  trafficSignal: { kind: "vehicle" as const }
} as const;

export type LineGeometry = { type: "LineString"; points: LatLng[] };
export type PointGeometry = { type: "Point"; point: LatLng };

export type RoadObject = {
  id: string;
  type: "road";
  geometry: LineGeometry;
  properties: {
    lanes: number;
    direction: "two-way" | "one-way-forward" | "one-way-reverse";
    laneWidthMetres: number;
    highwayFunction: "local" | "collector" | "arterial" | "service";
  };
};

export type FootpathObject = {
  id: string;
  type: "footpath";
  geometry: LineGeometry;
  properties: {
    clearWidthMetres: number;
    surface: "paved" | "unpaved" | "unknown";
    accessibility: "step-free" | "steps" | "unknown";
    alignment: "attached" | "separate";
  };
};

export type CyclewayObject = {
  id: string;
  type: "cycleway";
  geometry: LineGeometry;
  properties: {
    direction: "one-way" | "two-way";
    protection: "protected" | "painted" | "mixed-traffic";
    widthMetres: number;
    bufferMetres: number;
    alignment: "attached" | "separate";
  };
};

export type CrossingObject = {
  id: string;
  type: "crossing";
  geometry: PointGeometry;
  properties: {
    control: "uncontrolled" | "zebra" | "signal-controlled" | "raised";
    widthMetres: number;
    lengthMetres: number;
    bearingDegrees: number;
  };
};

export type RoundaboutObject = {
  id: string;
  type: "roundabout";
  geometry: PointGeometry;
  properties: { inscribedCircleDiameterMetres: number; lanes: number };
};

export type TrafficSignalObject = {
  id: string;
  type: "traffic-signal";
  geometry: PointGeometry;
  properties: { kind: "vehicle" | "pedestrian" | "cycle" | "mixed" };
};

export type DrawingObjectV1 =
  | RoadObject
  | FootpathObject
  | CyclewayObject
  | CrossingObject
  | RoundaboutObject
  | TrafficSignalObject;

export type DrawingDocumentV1 = {
  schemaVersion: 1;
  metadata: {
    locale: "IN";
    designBasis: "concept-only";
    disclaimer: typeof CONCEPT_DESIGN_DISCLAIMER;
  };
  objects: DrawingObjectV1[];
};

export type ValidationPath = Array<string | number>;
export type ValidationIssue = {
  code: "invalid_type" | "invalid_value" | "out_of_range" | "unknown_key" | "unsupported_version" | "duplicate_id";
  path: ValidationPath;
  message: string;
};

export type DrawingDocumentParseResult =
  | { success: true; data: DrawingDocumentV1 }
  | { success: false; issues: ValidationIssue[] };

export function createEmptyDrawingDocumentV1(): DrawingDocumentV1 {
  return {
    schemaVersion: 1,
    metadata: {
      locale: "IN",
      designBasis: "concept-only",
      disclaimer: CONCEPT_DESIGN_DISCLAIMER
    },
    objects: []
  };
}

type UnknownRecord = Record<string, unknown>;
const maxDrawingObjects = 10_000;
const maxLinePoints = 10_000;
const maxValidationIssues = 1_000;

const isRecord = (value: unknown): value is UnknownRecord =>
  typeof value === "object" && value !== null && !Array.isArray(value);

function addIssue(issues: ValidationIssue[], issue: ValidationIssue): void {
  if (issues.length < maxValidationIssues) {
    issues.push(issue);
  }
}

function requireRecord(value: unknown, path: ValidationPath, issues: ValidationIssue[]): UnknownRecord | undefined {
  if (!isRecord(value)) {
    addIssue(issues, { code: "invalid_type", path, message: "Expected an object." });
    return undefined;
  }
  return value;
}

function rejectUnknownKeys(
  record: UnknownRecord,
  allowed: readonly string[],
  path: ValidationPath,
  issues: ValidationIssue[]
): void {
  for (const key of Object.keys(record)) {
    if (!allowed.includes(key)) {
      addIssue(issues, { code: "unknown_key", path: [...path, key], message: `Unknown key '${key}'.` });
    }
  }
}

function validateEnum(
  value: unknown,
  values: readonly string[],
  path: ValidationPath,
  issues: ValidationIssue[]
): void {
  if (typeof value !== "string" || !values.includes(value)) {
    addIssue(issues, { code: "invalid_value", path, message: `Expected one of: ${values.join(", ")}.` });
  }
}

function validateString(value: unknown, path: ValidationPath, issues: ValidationIssue[]): void {
  if (typeof value !== "string" || value.trim().length === 0 || value.length > 200) {
    addIssue(issues, { code: "invalid_value", path, message: "Expected a non-empty string of at most 200 characters." });
  }
}

function validateFiniteRange(
  value: unknown,
  minimum: number,
  maximum: number,
  path: ValidationPath,
  issues: ValidationIssue[],
  options: { integer?: boolean; minimumInclusive?: boolean } = {}
): void {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    addIssue(issues, { code: "invalid_type", path, message: "Expected a finite number." });
    return;
  }
  const aboveMinimum = options.minimumInclusive === false ? value > minimum : value >= minimum;
  if (!aboveMinimum || value > maximum || (options.integer === true && !Number.isInteger(value))) {
    addIssue(issues, { code: "out_of_range", path, message: `Expected a value in the valid range ${minimum}–${maximum}.` });
  }
}

function validateLatLng(value: unknown, path: ValidationPath, issues: ValidationIssue[]): void {
  const point = requireRecord(value, path, issues);
  if (!point) return;
  rejectUnknownKeys(point, ["lat", "lng"], path, issues);
  validateFiniteRange(point.lat, -90, 90, [...path, "lat"], issues);
  validateFiniteRange(point.lng, -180, 180, [...path, "lng"], issues);
}

function validateLineGeometry(value: unknown, path: ValidationPath, issues: ValidationIssue[]): void {
  const geometry = requireRecord(value, path, issues);
  if (!geometry) return;
  rejectUnknownKeys(geometry, ["type", "points"], path, issues);
  if (geometry.type !== "LineString") {
    addIssue(issues, { code: "invalid_value", path: [...path, "type"], message: "Expected LineString geometry." });
  }
  if (!Array.isArray(geometry.points)) {
    addIssue(issues, { code: "invalid_type", path: [...path, "points"], message: "Expected an array of coordinates." });
    return;
  }
  if (geometry.points.length < 2 || geometry.points.length > maxLinePoints) {
    addIssue(issues, { code: "out_of_range", path: [...path, "points"], message: "A line requires 2–10,000 points." });
    return;
  }
  geometry.points.forEach((point, index) => validateLatLng(point, [...path, "points", index], issues));
}

function validatePointGeometry(value: unknown, path: ValidationPath, issues: ValidationIssue[]): void {
  const geometry = requireRecord(value, path, issues);
  if (!geometry) return;
  rejectUnknownKeys(geometry, ["type", "point"], path, issues);
  if (geometry.type !== "Point") {
    addIssue(issues, { code: "invalid_value", path: [...path, "type"], message: "Expected Point geometry." });
  }
  validateLatLng(geometry.point, [...path, "point"], issues);
}

function validateProperties(
  value: unknown,
  path: ValidationPath,
  allowed: readonly string[],
  issues: ValidationIssue[]
): UnknownRecord | undefined {
  const properties = requireRecord(value, path, issues);
  if (properties) rejectUnknownKeys(properties, allowed, path, issues);
  return properties;
}

function validateDrawingObject(value: unknown, index: number, issues: ValidationIssue[]): string | undefined {
  const path: ValidationPath = ["objects", index];
  const object = requireRecord(value, path, issues);
  if (!object) return undefined;
  rejectUnknownKeys(object, ["id", "type", "geometry", "properties"], path, issues);
  validateString(object.id, [...path, "id"], issues);
  const id = typeof object.id === "string" ? object.id : undefined;

  if (typeof object.type !== "string") {
    addIssue(issues, { code: "invalid_type", path: [...path, "type"], message: "Expected an object type." });
    return id;
  }

  const propertyPath = [...path, "properties"];
  switch (object.type) {
    case "road": {
      validateLineGeometry(object.geometry, [...path, "geometry"], issues);
      const properties = validateProperties(object.properties, propertyPath, ["lanes", "direction", "laneWidthMetres", "highwayFunction"], issues);
      if (properties) {
        validateFiniteRange(properties.lanes, 1, 20, [...propertyPath, "lanes"], issues, { integer: true });
        validateEnum(properties.direction, ["two-way", "one-way-forward", "one-way-reverse"], [...propertyPath, "direction"], issues);
        validateFiniteRange(properties.laneWidthMetres, 0, 20, [...propertyPath, "laneWidthMetres"], issues, { minimumInclusive: false });
        validateEnum(properties.highwayFunction, ["local", "collector", "arterial", "service"], [...propertyPath, "highwayFunction"], issues);
      }
      break;
    }
    case "footpath": {
      validateLineGeometry(object.geometry, [...path, "geometry"], issues);
      const properties = validateProperties(object.properties, propertyPath, ["clearWidthMetres", "surface", "accessibility", "alignment"], issues);
      if (properties) {
        validateFiniteRange(properties.clearWidthMetres, 0, 20, [...propertyPath, "clearWidthMetres"], issues, { minimumInclusive: false });
        validateEnum(properties.surface, ["paved", "unpaved", "unknown"], [...propertyPath, "surface"], issues);
        validateEnum(properties.accessibility, ["step-free", "steps", "unknown"], [...propertyPath, "accessibility"], issues);
        validateEnum(properties.alignment, ["attached", "separate"], [...propertyPath, "alignment"], issues);
      }
      break;
    }
    case "cycleway": {
      validateLineGeometry(object.geometry, [...path, "geometry"], issues);
      const properties = validateProperties(object.properties, propertyPath, ["direction", "protection", "widthMetres", "bufferMetres", "alignment"], issues);
      if (properties) {
        validateEnum(properties.direction, ["one-way", "two-way"], [...propertyPath, "direction"], issues);
        validateEnum(properties.protection, ["protected", "painted", "mixed-traffic"], [...propertyPath, "protection"], issues);
        validateFiniteRange(properties.widthMetres, 0, 20, [...propertyPath, "widthMetres"], issues, { minimumInclusive: false });
        validateFiniteRange(properties.bufferMetres, 0, 20, [...propertyPath, "bufferMetres"], issues);
        validateEnum(properties.alignment, ["attached", "separate"], [...propertyPath, "alignment"], issues);
      }
      break;
    }
    case "crossing": {
      validatePointGeometry(object.geometry, [...path, "geometry"], issues);
      const properties = validateProperties(object.properties, propertyPath, ["control", "widthMetres", "lengthMetres", "bearingDegrees"], issues);
      if (properties) {
        validateEnum(properties.control, ["uncontrolled", "zebra", "signal-controlled", "raised"], [...propertyPath, "control"], issues);
        validateFiniteRange(properties.widthMetres, 0, 100, [...propertyPath, "widthMetres"], issues, { minimumInclusive: false });
        validateFiniteRange(properties.lengthMetres, 0, 1_000, [...propertyPath, "lengthMetres"], issues, { minimumInclusive: false });
        validateFiniteRange(properties.bearingDegrees, 0, 360, [...propertyPath, "bearingDegrees"], issues, { minimumInclusive: true });
        if (properties.bearingDegrees === 360) {
          addIssue(issues, { code: "out_of_range", path: [...propertyPath, "bearingDegrees"], message: "Bearing must be less than 360 degrees." });
        }
      }
      break;
    }
    case "roundabout": {
      validatePointGeometry(object.geometry, [...path, "geometry"], issues);
      const properties = validateProperties(object.properties, propertyPath, ["inscribedCircleDiameterMetres", "lanes"], issues);
      if (properties) {
        validateFiniteRange(properties.inscribedCircleDiameterMetres, 0, 1_000, [...propertyPath, "inscribedCircleDiameterMetres"], issues, { minimumInclusive: false });
        validateFiniteRange(properties.lanes, 1, 20, [...propertyPath, "lanes"], issues, { integer: true });
      }
      break;
    }
    case "traffic-signal": {
      validatePointGeometry(object.geometry, [...path, "geometry"], issues);
      const properties = validateProperties(object.properties, propertyPath, ["kind"], issues);
      if (properties) validateEnum(properties.kind, ["vehicle", "pedestrian", "cycle", "mixed"], [...propertyPath, "kind"], issues);
      break;
    }
    default:
      addIssue(issues, {
        code: "invalid_value",
        path: [...path, "type"],
        message: "Unknown drawing object type."
      });
  }
  return id;
}

export function parseDrawingDocument(input: unknown): DrawingDocumentParseResult {
  const issues: ValidationIssue[] = [];
  const document = requireRecord(input, [], issues);
  if (!document) return { success: false, issues };
  rejectUnknownKeys(document, ["schemaVersion", "metadata", "objects"], [], issues);

  if (document.schemaVersion !== 1) {
    addIssue(issues, {
      code: "unsupported_version",
      path: ["schemaVersion"],
      message: `Unsupported drawing document schema version '${String(document.schemaVersion)}'.`
    });
  }

  const metadata = requireRecord(document.metadata, ["metadata"], issues);
  if (metadata) {
    rejectUnknownKeys(metadata, ["locale", "designBasis", "disclaimer"], ["metadata"], issues);
    if (metadata.locale !== "IN") addIssue(issues, { code: "invalid_value", path: ["metadata", "locale"], message: "Expected locale IN." });
    if (metadata.designBasis !== "concept-only") addIssue(issues, { code: "invalid_value", path: ["metadata", "designBasis"], message: "Expected concept-only design basis." });
    if (metadata.disclaimer !== CONCEPT_DESIGN_DISCLAIMER) addIssue(issues, { code: "invalid_value", path: ["metadata", "disclaimer"], message: "Expected the concept-design disclaimer." });
  }

  if (!Array.isArray(document.objects)) {
    addIssue(issues, { code: "invalid_type", path: ["objects"], message: "Expected an array of drawing objects." });
  } else {
    if (document.objects.length > maxDrawingObjects) {
      addIssue(issues, {
        code: "out_of_range",
        path: ["objects"],
        message: `A drawing document supports at most ${maxDrawingObjects.toLocaleString("en-US")} objects.`
      });
    }
    const ids = new Set<string>();
    document.objects.slice(0, maxDrawingObjects).forEach((object, index) => {
      const id = validateDrawingObject(object, index, issues);
      if (id && ids.has(id)) {
        addIssue(issues, { code: "duplicate_id", path: ["objects", index, "id"], message: `Duplicate object ID '${id}'.` });
      }
      if (id) ids.add(id);
    });
  }

  return issues.length > 0
    ? { success: false, issues }
    : { success: true, data: input as DrawingDocumentV1 };
}
