export type BoundingBox = {
  north: number;
  south: number;
  east: number;
  west: number;
};

export function isBoundingBox(value: unknown): value is BoundingBox {
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

export function getApproximateAreaKm2(bounds: BoundingBox) {
  const centerLatitude = ((bounds.north + bounds.south) / 2) * (Math.PI / 180);
  const kmPerLatitudeDegree = 111.32;
  const kmPerLongitudeDegree = 111.32 * Math.cos(centerLatitude);
  const heightKm = Math.abs(bounds.north - bounds.south) * kmPerLatitudeDegree;
  const widthKm = Math.abs(bounds.east - bounds.west) * kmPerLongitudeDegree;

  return widthKm * heightKm;
}
