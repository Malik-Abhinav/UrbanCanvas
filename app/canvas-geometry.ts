import type { DrawingObject } from "./satellite-overlay";

type Point = {
  x: number;
  y: number;
};

type MapPoint = {
  lat: number;
  lng: number;
};

export type { MapPoint, Point };

export const snapDistance = 34;

export function getClosestPointOnSegment(point: Point, start: Point, end: Point) {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const lengthSquared = dx * dx + dy * dy;
  const t =
    lengthSquared === 0
      ? 0
      : Math.max(0, Math.min(1, ((point.x - start.x) * dx + (point.y - start.y) * dy) / lengthSquared));
  const closest = {
    x: start.x + dx * t,
    y: start.y + dy * t
  };

  return {
    distance: getDistance(point, closest),
    point: closest,
    t
  };
}

export function getDistance(start: Point, end: Point) {
  return Math.sqrt((end.x - start.x) ** 2 + (end.y - start.y) ** 2);
}

export function getMapDistanceMeters(start: MapPoint, end: MapPoint) {
  const earthRadiusMeters = 6371000;
  const startLat = toRadians(start.lat);
  const endLat = toRadians(end.lat);
  const deltaLat = toRadians(end.lat - start.lat);
  const deltaLng = toRadians(end.lng - start.lng);
  const a =
    Math.sin(deltaLat / 2) ** 2 +
    Math.cos(startLat) * Math.cos(endLat) * Math.sin(deltaLng / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

  return earthRadiusMeters * c;
}

export function interpolateMapPoint(start: MapPoint, end: MapPoint, t: number): MapPoint {
  return {
    lat: start.lat + (end.lat - start.lat) * t,
    lng: start.lng + (end.lng - start.lng) * t
  };
}

export function normalizePoint(point: Point): Point {
  const length = Math.sqrt(point.x * point.x + point.y * point.y);

  if (length === 0) {
    return { x: 1, y: 0 };
  }

  return {
    x: point.x / length,
    y: point.y / length
  };
}

function toRadians(value: number) {
  return (value * Math.PI) / 180;
}

export type { DrawingObject };
