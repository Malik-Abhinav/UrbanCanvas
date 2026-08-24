import { describe, expect, it } from "vitest";

import type { DrawingObjectV1, LineGeometry, PointGeometry } from "../shared/drawing-document";
import {
  applyGeometryToLineObject,
  applyGeometryToPointObject,
  canRemoveVertex,
  dragVertex,
  insertVertexAfter,
  joinLines,
  removeVertex,
  splitLineAtVertex,
  translateLine,
  translatePoint
} from "./drawing-operations";

const latLng = (lat: number, lng: number) => ({ lat, lng });

const line = (points: Array<[number, number]>): LineGeometry => ({
  points: points.map(([lat, lng]) => latLng(lat, lng)),
  type: "LineString"
});

const roadObject = (id: string, geometry: LineGeometry): DrawingObjectV1 => ({
  geometry,
  id,
  properties: {
    direction: "two-way",
    highwayFunction: "local",
    laneWidthMetres: 3.5,
    lanes: 2
  },
  type: "road"
});

describe("vertex editing", () => {
  it("inserts a vertex after the given segment index", () => {
    const next = insertVertexAfter(line([[1, 1], [1, 2]]).points, 0, latLng(1.5, 1.5));

    expect(next.map((point) => point.lat)).toEqual([1, 1.5, 1]);
    expect(next.map((point) => point.lng)).toEqual([1, 1.5, 2]);
  });

  it("drags a vertex to a new map position without mutating the source", () => {
    const original = line([[1, 1], [2, 2], [3, 3]]).points;
    const dragged = dragVertex(original, 1, latLng(2.5, 2.25));

    expect(dragged[1]).toEqual(latLng(2.5, 2.25));
    expect(original[1]).toEqual(latLng(2, 2));
    expect(dragged).not.toBe(original);
  });

  it("removes an interior vertex", () => {
    const next = removeVertex(line([[1, 1], [2, 2], [3, 3]]).points, 1);

    if (!next) {
      throw new Error("expected vertex removal to succeed");
    }

    expect(next).toHaveLength(2);
    expect(next[0]).toEqual(latLng(1, 1));
    expect(next[1]).toEqual(latLng(3, 3));
  });

  it("refuses to drop a line below two vertices", () => {
    const twoPoints = line([[1, 1], [2, 2]]).points;

    expect(canRemoveVertex(twoPoints, 0)).toBe(false);
    expect(removeVertex(twoPoints, 0)).toBeNull();
  });
});

describe("whole-object moves", () => {
  it("translates every vertex of a line in map coordinates", () => {
    const moved = translateLine(line([[10, 20], [11, 21]]).points, { dLat: 0.5, dLng: -1 });

    expect(moved[0]).toEqual(latLng(10.5, 19));
    expect(moved[1]).toEqual(latLng(11.5, 20));
  });

  it("translates a point geometry", () => {
    expect(translatePoint(latLng(12, 34), { dLat: -2, dLng: 6 })).toEqual(latLng(10, 40));
  });
});

describe("split / join segments", () => {
  it("splits a line at an interior vertex into two halves", () => {
    const parts = splitLineAtVertex(line([[1, 1], [2, 2], [3, 3], [4, 4]]).points, 2);

    expect(parts).not.toBeNull();
    expect(parts?.[0].map((point) => point.lat)).toEqual([1, 2, 3]);
    expect(parts?.[1].map((point) => point.lat)).toEqual([3, 4]);
  });

  it("rejects splitting at an endpoint", () => {
    expect(splitLineAtVertex(line([[1, 1], [2, 2], [3, 3]]).points, 0)).toBeNull();
    expect(splitLineAtVertex(line([[1, 1], [2, 2], [3, 3]]).points, 2)).toBeNull();
  });

  it("joins two lines end-to-end, dropping the duplicated shared endpoint", () => {
    const joined = joinLines(
      line([[1, 1], [2, 2], [3, 3]]).points,
      line([[3, 3], [4, 4]]).points
    );

    expect(joined.map((point) => point.lat)).toEqual([1, 2, 3, 4]);
  });

  it("joins lines that merely touch within tolerance without exact duplicates", () => {
    const joined = joinLines(
      line([[1, 1], [2, 2]]).points,
      line([[2.0000001, 2], [3, 3]]).points
    );

    // Near-duplicate collapsed into one shared vertex.
    expect(joined.map((point) => point.lat)).toEqual([1, 2, 3]);
  });
});

describe("applying edits to V1 objects", () => {
  it("applies new line geometry immutably, preserving id and properties", () => {
    const road = roadObject("road-1", line([[1, 1], [2, 2]]));
    const edited = applyGeometryToLineObject(road, line([[5, 5], [6, 6], [7, 7]]));

    if (!edited || edited.geometry.type !== "LineString") {
      throw new Error("expected line geometry edit to succeed");
    }

    expect(edited.id).toBe("road-1");
    expect((edited.geometry as LineGeometry).points).toHaveLength(3);
    expect(edited.properties).toEqual(road.properties);
    expect(edited).not.toBe(road);
    expect((road.geometry as LineGeometry).points).toHaveLength(2);
  });

  it("applies new point geometry for signal objects", () => {
    const signal: DrawingObjectV1 = {
      geometry: { point: latLng(1, 2), type: "Point" } satisfies PointGeometry,
      id: "signal-1",
      properties: { kind: "vehicle" },
      type: "traffic-signal"
    };
    const moved = applyGeometryToPointObject(signal, latLng(9, 8));

    if (!moved || moved.geometry.type !== "Point") {
      throw new Error("expected point geometry edit to succeed");
    }

    expect(moved.geometry.point).toEqual(latLng(9, 8));
    expect(moved.id).toBe("signal-1");
  });

  it("returns null when a point object is given line geometry", () => {
    const signal: DrawingObjectV1 = {
      geometry: { point: latLng(1, 2), type: "Point" },
      id: "signal-1",
      properties: { kind: "vehicle" },
      type: "traffic-signal"
    };

    expect(applyGeometryToLineObject(signal, line([[1, 1], [2, 2]]))).toBeNull();
  });
});
