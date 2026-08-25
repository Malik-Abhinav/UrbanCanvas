export type LatLng = Readonly<{
  lat: number;
  lng: number;
}>;

const EARTH_RADIUS_METRES = 6_371_008.8;
const toRadians = (degrees: number) => (degrees * Math.PI) / 180;
const toDegrees = (radians: number) => (radians * 180) / Math.PI;
const normalizeLongitude = (longitude: number) => {
  const normalized = ((longitude + 180) % 360 + 360) % 360 - 180;
  return Object.is(normalized, -0) ? 0 : normalized;
};

export function distanceMetres(start: LatLng, end: LatLng): number {
  const latitudeDelta = toRadians(end.lat - start.lat);
  const longitudeDelta = toRadians(end.lng - start.lng);
  const startLatitude = toRadians(start.lat);
  const endLatitude = toRadians(end.lat);
  const haversine =
    Math.sin(latitudeDelta / 2) ** 2 +
    Math.cos(startLatitude) * Math.cos(endLatitude) * Math.sin(longitudeDelta / 2) ** 2;

  const clampedHaversine = Math.max(0, Math.min(1, haversine));
  return 2 * EARTH_RADIUS_METRES * Math.asin(Math.sqrt(clampedHaversine));
}

export function interpolateLatLng(start: LatLng, end: LatLng, fraction: number): LatLng {
  const longitudeDelta = normalizeLongitude(end.lng - start.lng);
  return {
    lat: start.lat + (end.lat - start.lat) * fraction,
    lng: normalizeLongitude(start.lng + longitudeDelta * fraction)
  };
}

export function offsetLatLngMetres(
  origin: LatLng,
  offset: Readonly<{ eastMetres: number; northMetres: number }>
): LatLng {
  const latitudeRadians = toRadians(origin.lat);
  const longitudeScale = Math.cos(latitudeRadians);
  if (Math.abs(longitudeScale) < 1e-12 && offset.eastMetres !== 0) {
    throw new RangeError("East-west metre offsets are undefined at the poles.");
  }
  return {
    lat: origin.lat + toDegrees(offset.northMetres / EARTH_RADIUS_METRES),
    lng: normalizeLongitude(origin.lng + toDegrees(offset.eastMetres / (EARTH_RADIUS_METRES * longitudeScale)))
  };
}
