import {
  INDIA_CONCEPT_DEFAULTS,
  createEmptyDrawingDocumentV1,
  type DrawingDocumentV1,
  type DrawingObjectV1,
  type ValidationPath
} from "./drawing-document";
import type { LatLng } from "./geo";

export type PixelMeasurementContext = Readonly<{
  objectType: "crossing" | "roundabout";
  id: string;
  at: LatLng;
  measurement: "length" | "diameter";
}>;

export type LegacyMigrationOptions = Readonly<{
  pixelsToMetres: (pixels: number, context: PixelMeasurementContext) => number;
}>;

export type LegacyMigrationIssue = {
  index: number | null;
  code:
    | "invalid_legacy_payload"
    | "invalid_legacy_entry"
    | "unsupported_legacy_type"
    | "conversion_failed"
    | "duplicate_id";
  path: ValidationPath;
  message: string;
};

export type LegacyMigrationResult = {
  document: DrawingDocumentV1;
  issues: LegacyMigrationIssue[];
};

type UnknownRecord = Record<string, unknown>;

const isRecord = (value: unknown): value is UnknownRecord =>
  typeof value === "object" && value !== null && !Array.isArray(value);

function issue(
  issues: LegacyMigrationIssue[],
  index: number,
  code: LegacyMigrationIssue["code"],
  path: ValidationPath,
  message: string
): undefined {
  issues.push({ index, code, path: [index, ...path], message });
  return undefined;
}

function validId(entry: UnknownRecord, index: number, issues: LegacyMigrationIssue[]): string | undefined {
  if (typeof entry.id !== "string" || entry.id.trim().length === 0 || entry.id.length > 200) {
    return issue(issues, index, "invalid_legacy_entry", ["id"], "Expected a non-empty legacy object ID.");
  }
  return entry.id;
}

function validCoordinate(
  value: unknown,
  index: number,
  fieldPath: ValidationPath,
  issues: LegacyMigrationIssue[]
): LatLng | undefined {
  if (!isRecord(value)) {
    return issue(issues, index, "invalid_legacy_entry", fieldPath, "Expected a latitude/longitude coordinate.");
  }
  if (typeof value.lat !== "number" || !Number.isFinite(value.lat) || value.lat < -90 || value.lat > 90) {
    return issue(issues, index, "invalid_legacy_entry", [...fieldPath, "lat"], "Latitude must be finite and between -90 and 90.");
  }
  if (typeof value.lng !== "number" || !Number.isFinite(value.lng) || value.lng < -180 || value.lng > 180) {
    return issue(issues, index, "invalid_legacy_entry", [...fieldPath, "lng"], "Longitude must be finite and between -180 and 180.");
  }
  return { lat: value.lat, lng: value.lng };
}

function validPath(
  value: unknown,
  index: number,
  issues: LegacyMigrationIssue[]
): LatLng[] | undefined {
  if (!Array.isArray(value) || value.length < 2 || value.length > 10_000) {
    return issue(issues, index, "invalid_legacy_entry", ["path"], "A legacy path requires 2–10,000 coordinates.");
  }
  const points: LatLng[] = [];
  for (let pointIndex = 0; pointIndex < value.length; pointIndex += 1) {
    const point = validCoordinate(value[pointIndex], index, ["path", pointIndex], issues);
    if (!point) return undefined;
    points.push(point);
  }
  return points;
}

function validSnapped(entry: UnknownRecord, index: number, issues: LegacyMigrationIssue[]): boolean {
  if (typeof entry.snapped !== "boolean") {
    issue(issues, index, "invalid_legacy_entry", ["snapped"], "Expected the legacy snapped flag to be boolean.");
    return false;
  }
  return true;
}

function convertPixels(
  pixels: number,
  context: PixelMeasurementContext,
  sourcePath: ValidationPath,
  index: number,
  options: LegacyMigrationOptions,
  issues: LegacyMigrationIssue[]
): number | undefined {
  if (!Number.isFinite(pixels) || pixels <= 0) {
    return issue(issues, index, "conversion_failed", sourcePath, "Pixel measurement must be a positive finite value.");
  }
  let metres: number;
  try {
    metres = options.pixelsToMetres(pixels, context);
  } catch (error) {
    const detail = error instanceof Error ? ` ${error.message}` : "";
    return issue(issues, index, "conversion_failed", sourcePath, `Pixel-to-metres conversion failed.${detail}`);
  }
  if (!Number.isFinite(metres) || metres <= 0 || metres > 1_000) {
    return issue(issues, index, "conversion_failed", sourcePath, "Pixel-to-metres conversion must return a positive finite value no greater than 1,000 metres.");
  }
  return metres;
}

function migratePathObject(
  entry: UnknownRecord,
  index: number,
  id: string,
  issues: LegacyMigrationIssue[]
): DrawingObjectV1 | undefined {
  const path = validPath(entry.path, index, issues);
  if (!path || !validSnapped(entry, index, issues)) return undefined;
  const geometry = { type: "LineString" as const, points: path };

  if (entry.type === "road") {
    return { id, type: "road", geometry, properties: { ...INDIA_CONCEPT_DEFAULTS.road } };
  }
  if (entry.type === "bike") {
    const defaults = INDIA_CONCEPT_DEFAULTS.cycleway;
    return {
      id,
      type: "cycleway",
      geometry,
      properties: {
        direction: defaults.direction,
        protection: defaults.protection,
        widthMetres: defaults.oneWayWidthMetres,
        bufferMetres: defaults.bufferMetres,
        alignment: defaults.alignment
      }
    };
  }
  return { id, type: "footpath", geometry, properties: { ...INDIA_CONCEPT_DEFAULTS.footpath } };
}

function migrateEntry(
  entry: UnknownRecord,
  index: number,
  id: string,
  options: LegacyMigrationOptions,
  issues: LegacyMigrationIssue[]
): DrawingObjectV1 | undefined {
  switch (entry.type) {
    case "road":
    case "bike":
    case "sidewalk":
      return migratePathObject(entry, index, id, issues);
    case "signal": {
      const point = validCoordinate(entry.point, index, ["point"], issues);
      return point
        ? { id, type: "traffic-signal", geometry: { type: "Point", point }, properties: { ...INDIA_CONCEPT_DEFAULTS.trafficSignal } }
        : undefined;
    }
    case "crossing": {
      const anchor = validCoordinate(entry.anchor, index, ["anchor"], issues);
      if (!anchor) return undefined;
      if (!isRecord(entry.pixelVector)) {
        return issue(issues, index, "invalid_legacy_entry", ["pixelVector"], "Expected a finite crossing pixel vector.");
      }
      const { x, y } = entry.pixelVector;
      if (typeof x !== "number" || !Number.isFinite(x)) {
        return issue(issues, index, "invalid_legacy_entry", ["pixelVector", "x"], "Expected a finite x component.");
      }
      if (typeof y !== "number" || !Number.isFinite(y)) {
        return issue(issues, index, "invalid_legacy_entry", ["pixelVector", "y"], "Expected a finite y component.");
      }
      const pixelLength = Math.hypot(x, y);
      if (pixelLength <= 0) {
        return issue(issues, index, "invalid_legacy_entry", ["pixelVector"], "Crossing pixel vector must have positive length.");
      }
      const lengthMetres = convertPixels(
        pixelLength,
        { objectType: "crossing", id, at: anchor, measurement: "length" },
        ["pixelVector"],
        index,
        options,
        issues
      );
      if (lengthMetres === undefined) return undefined;
      const bearingDegrees = ((Math.atan2(x, -y) * 180) / Math.PI + 360) % 360;
      return {
        id,
        type: "crossing",
        geometry: { type: "Point", point: anchor },
        properties: {
          control: INDIA_CONCEPT_DEFAULTS.crossing.control,
          widthMetres: INDIA_CONCEPT_DEFAULTS.crossing.widthMetres,
          lengthMetres,
          bearingDegrees
        }
      };
    }
    case "roundabout": {
      const center = validCoordinate(entry.center, index, ["center"], issues);
      if (!center) return undefined;
      if (typeof entry.pixelRadius !== "number" || !Number.isFinite(entry.pixelRadius) || entry.pixelRadius <= 0) {
        return issue(issues, index, "invalid_legacy_entry", ["pixelRadius"], "Roundabout pixel radius must be a positive finite number.");
      }
      const diameterMetres = convertPixels(
        entry.pixelRadius * 2,
        { objectType: "roundabout", id, at: center, measurement: "diameter" },
        ["pixelRadius"],
        index,
        options,
        issues
      );
      return diameterMetres === undefined
        ? undefined
        : {
            id,
            type: "roundabout",
            geometry: { type: "Point", point: center },
            properties: { inscribedCircleDiameterMetres: diameterMetres, lanes: INDIA_CONCEPT_DEFAULTS.roundabout.lanes }
          };
    }
    default:
      return issue(issues, index, "unsupported_legacy_type", ["type"], "Unsupported legacy drawing object type.");
  }
}

export function migrateLegacyDrawingArray(input: unknown, options: LegacyMigrationOptions): LegacyMigrationResult {
  const document = createEmptyDrawingDocumentV1();
  const issues: LegacyMigrationIssue[] = [];
  if (!Array.isArray(input)) {
    issues.push({
      index: null,
      code: "invalid_legacy_payload",
      path: [],
      message: "Expected the legacy v0 drawing payload to be an array."
    });
    return { document, issues };
  }

  const ids = new Set<string>();
  input.forEach((value, index) => {
    if (!isRecord(value)) {
      issue(issues, index, "invalid_legacy_entry", [], "Expected a legacy drawing object.");
      return;
    }
    const id = validId(value, index, issues);
    if (!id) return;
    if (ids.has(id)) {
      issue(issues, index, "duplicate_id", ["id"], `Duplicate legacy object ID '${id}'.`);
      return;
    }
    const object = migrateEntry(value, index, id, options, issues);
    if (object) {
      ids.add(id);
      document.objects.push(object);
    }
  });

  return { document, issues };
}
