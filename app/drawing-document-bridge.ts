import type { LatLng } from "../shared/geo";
import {
  createEmptyDrawingDocumentV1,
  parseDrawingDocument,
  type CyclewayObject,
  type DrawingDocumentV1,
  type DrawingObjectV1,
  type FootpathObject,
  type RoadObject
} from "../shared/drawing-document";
import {
  migrateLegacyDrawingArray,
  type LegacyMigrationIssue,
  type PixelMeasurementContext
} from "../shared/legacy-drawing-migration";

/**
 * Bridge between the legacy satellite-overlay drawing shapes and the shared
 * DrawingDocumentV1 model.
 *
 * - Pointer interactions still produce legacy-shaped objects (pixels), which
 *   are immediately migrated with a real map-projection converter so the
 *   in-memory overlay state is V1 (metres).
 * - Rendering dimensions are derived from V1 properties via the same
 *   converter, with minimum pixel floors for visibility.
 * - Projects persist the V1 document as the userEdits payload under a
 *   schemaVersion envelope; stored legacy arrays are accepted on load through
 *   the migration path.
 */

// Web Mercator: 156543.03392 metres/pixel at the equator and zoom 0
// (256 px tile), scaled by cos(latitude) and halved per zoom level.
const equatorialMetresPerPixelAtZoomZero = 156_543.03392;
const maxWebMercatorLatitudeDegrees = 85.05112878;

// migrateLegacyDrawingArray refuses measurements above 1,000 metres; clamping
// keeps extreme zoom-outs from silently dropping user drawings.
export const MAX_MIGRATION_MEASUREMENT_METRES = 999;

// Minimum rendered sizes in pixels so real-metre widths stay visible when
// zoomed out (or when a property is very small).
export const MIN_ROAD_WIDTH_PX = 4;
export const MIN_PATH_WIDTH_PX = 2;
export const MIN_ROUNDABOUT_RADIUS_PX = 8;
export const MIN_CROSSING_LENGTH_PX = 26;
export const MIN_CROSSING_WIDTH_PX = 14;

export function metresPerPixelAt(latitudeDegrees: number, zoom: number): number {
  const latitudeRadians =
    (Math.max(-maxWebMercatorLatitudeDegrees, Math.min(maxWebMercatorLatitudeDegrees, latitudeDegrees || 0)) *
      Math.PI) /
    180;
  const safeZoom = Number.isFinite(zoom) ? Math.max(0, zoom) : 0;

  return (equatorialMetresPerPixelAtZoomZero * Math.cos(latitudeRadians)) / 2 ** safeZoom;
}

export type PixelMetreConverter = {
  metresToPixels(metres: number, at: LatLng): number;
  metresPerPixel(at: LatLng): number;
  pixelsToMetres(pixels: number, context: PixelMeasurementContext): number;
};

export function createPixelMetreConverter(options: { getZoom: () => number }): PixelMetreConverter {
  return {
    metresToPixels(metres, at) {
      return metres / metresPerPixelAt(at.lat, options.getZoom());
    },
    metresPerPixel(at) {
      return metresPerPixelAt(at.lat, options.getZoom());
    },
    pixelsToMetres(pixels, context) {
      return pixels * metresPerPixelAt(context.at.lat, options.getZoom());
    }
  };
}

export function createMigrationPixelsToMetres(converter: PixelMetreConverter) {
  return (pixels: number, context: PixelMeasurementContext) =>
    Math.min(converter.pixelsToMetres(pixels, context), MAX_MIGRATION_MEASUREMENT_METRES);
}

type LineObject = RoadObject | FootpathObject | CyclewayObject;

/** Real drawn width in metres, derived from V1 properties. */
export function getLineObjectWidthMetres(object: LineObject): number {
  if (object.type === "road") {
    return object.properties.lanes * object.properties.laneWidthMetres;
  }

  if (object.type === "cycleway") {
    return object.properties.widthMetres + object.properties.bufferMetres * 2;
  }

  return object.properties.clearWidthMetres;
}

export type StoredUserEditsParseResult = {
  objects: DrawingObjectV1[];
  skippedCount: number;
};

type UnknownRecord = Record<string, unknown>;

const isRecord = (value: unknown): value is UnknownRecord =>
  typeof value === "object" && value !== null && !Array.isArray(value);

export function isVersionedDrawingDocument(value: unknown): value is DrawingDocumentV1 {
  return isRecord(value) && value.schemaVersion === 1 && Array.isArray(value.objects);
}

const looksLikeV1Object = (value: unknown): boolean =>
  isRecord(value) &&
  typeof value.id === "string" &&
  typeof value.type === "string" &&
  isRecord(value.geometry) &&
  isRecord(value.properties);

/**
 * Parses whatever a project's userEdits payload holds — a schemaVersion 1
 * document, a stored legacy array, or a mix — into V1 objects. Legacy entries
 * go through migrateLegacyDrawingArray with the caller's projection-aware
 * converter; invalid entries are counted as skipped instead of rejecting the
 * whole project.
 */
export function parseStoredUserEdits(
  payload: unknown,
  options: { pixelsToMetres: (pixels: number, context: PixelMeasurementContext) => number }
): StoredUserEditsParseResult {
  const entries = Array.isArray(payload)
    ? payload
    : isVersionedDrawingDocument(payload)
      ? payload.objects
      : [];

  const objects: DrawingObjectV1[] = [];
  let skippedCount = 0;
  const seenIds = new Set<string>();

  for (const entry of entries) {
    let migrated: DrawingObjectV1 | undefined;

    if (looksLikeV1Object(entry)) {
      const parsed = parseDrawingDocument({ ...createEmptyDrawingDocumentV1(), objects: [entry] });
      migrated = parsed.success ? parsed.data.objects[0] : undefined;
    } else {
      const result = migrateLegacyDrawingArray([entry], { pixelsToMetres: options.pixelsToMetres });
      migrated = result.document.objects[0];
    }

    if (!migrated) {
      skippedCount += 1;
      continue;
    }

    if (seenIds.has(migrated.id)) {
      skippedCount += 1;
      continue;
    }

    seenIds.add(migrated.id);
    objects.push(migrated);
  }

  return { objects, skippedCount };
}

/** Wraps V1 objects in the schemaVersion 1 document used as the userEdits payload. */
export function toUserEditsPayload(objects: DrawingObjectV1[]): DrawingDocumentV1 {
  return {
    ...createEmptyDrawingDocumentV1(),
    objects: [...objects]
  };
}

/** FNV-1a over key-sorted JSON, hex-encoded. Stable across reloads. */
export function hashDrawingObjects(objects: DrawingObjectV1[]): string {
  let hash = 0x811c9dc5;
  const text = stableStringify(objects);

  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }

  return (hash >>> 0).toString(16).padStart(8, "0");
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(",")}]`;
  }

  if (isRecord(value)) {
    const keys = Object.keys(value).sort();

    return `{${keys.map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(",")}}`;
  }

  return JSON.stringify(value) ?? "null";
}

const legacyAnalysisTypes: Record<DrawingObjectV1["type"], string> = {
  crossing: "crossing",
  cycleway: "bike",
  footpath: "sidewalk",
  "traffic-signal": "signal",
  road: "road",
  roundabout: "roundabout"
};

/**
 * The rule-based analyzer still speaks the legacy object vocabulary; map the
 * V1 types onto it without changing the analyzer contract.
 */
export function toLegacyAnalysisEdits(objects: DrawingObjectV1[]): Array<{ id: string; type: string }> {
  return objects.map((object) => ({ id: object.id, type: legacyAnalysisTypes[object.type] }));
}

export type { DrawingDocumentV1, LegacyMigrationIssue };
