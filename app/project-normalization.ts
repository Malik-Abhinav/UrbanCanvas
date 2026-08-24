import type { OsmData, OsmFeature } from "./canvas-renderer";
import type { DrawingObject } from "./satellite-overlay";

export type BoundingBox = {
  north: number;
  south: number;
  east: number;
  west: number;
};

export type NormalizedProject = {
  bbox: BoundingBox;
  created_at: string;
  id: string;
  name: string;
  osm_data: OsmData;
  updated_at: string;
  user_edits: DrawingObject[];
};

export type NormalizedProjectResult = {
  project: NormalizedProject;
  skippedDrawingCount: number;
};

export function normalizeSavedProject(value: unknown): NormalizedProjectResult | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const project = value as Record<string, unknown>;
  if (
    typeof project.id !== "string" ||
    typeof project.name !== "string" ||
    typeof project.created_at !== "string" ||
    typeof project.updated_at !== "string" ||
    !isBoundingBox(project.bbox) ||
    !isOsmData(project.osm_data) ||
    !Array.isArray(project.user_edits)
  ) {
    return null;
  }

  const userEdits = project.user_edits.filter(isDrawingObject);

  return {
    project: {
      bbox: project.bbox,
      created_at: project.created_at,
      id: project.id,
      name: project.name,
      osm_data: project.osm_data,
      updated_at: project.updated_at,
      user_edits: userEdits
    },
    skippedDrawingCount: project.user_edits.length - userEdits.length
  };
}

function isBoundingBox(value: unknown): value is BoundingBox {
  if (!value || typeof value !== "object") {
    return false;
  }

  const bbox = value as Partial<BoundingBox>;
  return (
    [bbox.north, bbox.south, bbox.east, bbox.west].every(
      (coordinate) => typeof coordinate === "number" && Number.isFinite(coordinate)
    ) &&
    bbox.south! < bbox.north! &&
    bbox.west! < bbox.east!
  );
}

function isOsmData(value: unknown): value is OsmData {
  if (!value || typeof value !== "object") {
    return false;
  }

  const data = value as Partial<OsmData>;
  const counts = data.counts as Record<string, unknown> | undefined;
  return (
    isBoundingBox(data.bbox) &&
    isFeatureArray(data.buildings) &&
    isFeatureArray(data.roads) &&
    isFeatureArray(data.openLand) &&
    Boolean(counts) &&
    [counts?.buildings, counts?.roads, counts?.openLand].every(
      (count) => typeof count === "number" && Number.isFinite(count) && count >= 0
    )
  );
}

function isFeatureArray(value: unknown): value is OsmFeature[] {
  return (
    Array.isArray(value) &&
    value.every((feature) => {
      if (!feature || typeof feature !== "object") {
        return false;
      }

      const candidate = feature as Partial<OsmFeature>;
      return (
        typeof candidate.id === "number" &&
        Number.isFinite(candidate.id) &&
        typeof candidate.kind === "string" &&
        Array.isArray(candidate.geometry) &&
        candidate.geometry.every(isMapPoint)
      );
    })
  );
}

function isDrawingObject(value: unknown): value is DrawingObject {
  if (!value || typeof value !== "object") {
    return false;
  }

  const object = value as Record<string, unknown>;
  if (typeof object.id !== "string") {
    return false;
  }

  switch (object.type) {
    case "road":
    case "bike":
    case "sidewalk":
      return (
        Array.isArray(object.path) &&
        object.path.length >= 2 &&
        object.path.every(isMapPoint) &&
        typeof object.snapped === "boolean"
      );
    case "crossing":
      return isMapPoint(object.anchor) && isPoint(object.pixelVector);
    case "roundabout":
      return (
        isMapPoint(object.center) &&
        typeof object.pixelRadius === "number" &&
        Number.isFinite(object.pixelRadius) &&
        object.pixelRadius > 0
      );
    case "signal":
      return isMapPoint(object.point);
    default:
      return false;
  }
}

function isMapPoint(value: unknown): value is { lat: number; lng: number } {
  if (!value || typeof value !== "object") {
    return false;
  }

  const point = value as { lat?: unknown; lng?: unknown };
  return (
    typeof point.lat === "number" &&
    Number.isFinite(point.lat) &&
    typeof point.lng === "number" &&
    Number.isFinite(point.lng)
  );
}

function isPoint(value: unknown): value is { x: number; y: number } {
  if (!value || typeof value !== "object") {
    return false;
  }

  const point = value as { x?: unknown; y?: unknown };
  return (
    typeof point.x === "number" &&
    Number.isFinite(point.x) &&
    typeof point.y === "number" &&
    Number.isFinite(point.y)
  );
}
