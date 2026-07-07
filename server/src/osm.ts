export type BoundingBox = {
  north: number;
  south: number;
  east: number;
  west: number;
};

type OverpassElement = {
  type: string;
  id: number;
  tags?: Record<string, string>;
  geometry?: Array<{
    lat: number;
    lon: number;
  }>;
};

type OverpassResponse = {
  elements?: OverpassElement[];
  remark?: string;
};

type OsmFeature = {
  id: number;
  kind: string;
  tags: Record<string, string>;
  geometry: Array<{
    lat: number;
    lng: number;
  }>;
};

const overpassUrl = "https://overpass-api.de/api/interpreter";
const maxAreaKm2 = 5;

export async function fetchOsmData(bbox: unknown) {
  validateBoundingBox(bbox);

  const query = buildOverpassQuery(bbox);
  const response = await fetch(overpassUrl, {
    method: "POST",
    headers: {
      "content-type": "text/plain;charset=UTF-8",
      "user-agent": "UrbanCanvas/0.1 local development"
    },
    body: query
  });

  const text = await response.text();

  if (!response.ok) {
    throw new Error(getOverpassErrorMessage(response.status, text));
  }

  const data = JSON.parse(text) as OverpassResponse;

  if (data.remark) {
    throw new Error(data.remark);
  }

  return parseOverpassResponse(data, bbox);
}

function buildOverpassQuery({ north, south, east, west }: BoundingBox) {
  return `
[out:json][timeout:35][bbox:${south},${west},${north},${east}];
(
  way["building"];
  way["highway"];
  way["landuse"];
  way["leisure"];
);
out geom;
`;
}

function parseOverpassResponse(data: OverpassResponse, bbox: BoundingBox) {
  const buildings: OsmFeature[] = [];
  const roads: OsmFeature[] = [];
  const openLand: OsmFeature[] = [];

  for (const element of data.elements ?? []) {
    const tags = element.tags ?? {};
    const geometry = (element.geometry ?? []).map((point) => ({
      lat: point.lat,
      lng: point.lon
    }));

    if (element.type !== "way" || geometry.length === 0) {
      continue;
    }

    const baseFeature = {
      id: element.id,
      tags,
      geometry
    };

    if (tags.building) {
      buildings.push({
        ...baseFeature,
        kind: tags.building
      });
      continue;
    }

    if (tags.highway) {
      roads.push({
        ...baseFeature,
        kind: tags.highway
      });
      continue;
    }

    if (tags.landuse || tags.leisure) {
      openLand.push({
        ...baseFeature,
        kind: tags.landuse ?? tags.leisure ?? "open_land"
      });
    }
  }

  return {
    bbox,
    counts: {
      buildings: buildings.length,
      roads: roads.length,
      openLand: openLand.length
    },
    buildings,
    roads,
    openLand
  };
}

function validateBoundingBox(bbox: unknown): asserts bbox is BoundingBox {
  if (!isBoundingBox(bbox)) {
    throw new Error("Request body must include bbox with north, south, east, and west numbers.");
  }

  const values = [bbox.north, bbox.south, bbox.east, bbox.west];

  if (values.some((value) => !Number.isFinite(value))) {
    throw new Error("Bounding box coordinates must be finite numbers.");
  }

  if (bbox.south >= bbox.north || bbox.west >= bbox.east) {
    throw new Error("Bounding box coordinates are invalid.");
  }

  if (bbox.north > 90 || bbox.south < -90 || bbox.east > 180 || bbox.west < -180) {
    throw new Error("Bounding box coordinates are outside valid latitude/longitude ranges.");
  }

  const areaKm2 = getApproximateAreaKm2(bbox);
  if (areaKm2 > maxAreaKm2) {
    throw new Error(`Select a smaller area. Keep it under ${maxAreaKm2} km2 for now.`);
  }
}

function isBoundingBox(value: unknown): value is BoundingBox {
  if (!value || typeof value !== "object") {
    return false;
  }

  const bbox = value as Record<string, unknown>;

  return (
    typeof bbox.north === "number" &&
    typeof bbox.south === "number" &&
    typeof bbox.east === "number" &&
    typeof bbox.west === "number"
  );
}

function getApproximateAreaKm2(bounds: BoundingBox) {
  const centerLatitude = ((bounds.north + bounds.south) / 2) * (Math.PI / 180);
  const kmPerLatitudeDegree = 111.32;
  const kmPerLongitudeDegree = 111.32 * Math.cos(centerLatitude);
  const heightKm = Math.abs(bounds.north - bounds.south) * kmPerLatitudeDegree;
  const widthKm = Math.abs(bounds.east - bounds.west) * kmPerLongitudeDegree;

  return widthKm * heightKm;
}

function getOverpassErrorMessage(status: number, body: string) {
  if (status === 429) {
    return "Overpass is rate limiting requests. Wait a minute, then try again.";
  }

  if (status === 504) {
    return "Overpass timed out. Try a smaller area with fewer buildings and roads.";
  }

  if (status >= 500) {
    return "Overpass is temporarily unavailable. Try again in a moment.";
  }

  const compactBody = body.replace(/\s+/g, " ").trim();

  return `Overpass request failed with ${status}: ${compactBody.slice(0, 180)}`;
}
