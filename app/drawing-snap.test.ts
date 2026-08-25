import { describe, expect, it } from "vitest";
import type { LatLng } from "../shared/geo";
import type { DrawingObjectV1 } from "../shared/drawing-document";
import { metresPerPixelAt } from "./drawing-document-bridge";
import {
  MAX_SNAP_DISTANCE_METRES,
  MIN_SNAP_DISTANCE_METRES,
  buildSnapTargets,
  resolveSnap,
  snapThresholdMetres,
  type SnapTarget
} from "./drawing-snap";

const identityProject = (point: LatLng) => ({ x: point.lng * 100_000, y: -point.lat * 100_000 });

const makeRoad = (id: string, points: Array<[number, number]>) => ({
  id,
  geometry: points.map(([lat, lng]) => ({ lat, lng }))
});

const baseRoads = [
  makeRoad("osm-1", [
    [12.971, 77.59],
    [12.971, 77.60]
  ]),
  makeRoad("osm-2", [
    [12.9705, 77.595],
    [12.9715, 77.595]
  ])
];

const config = { latitudeDegrees: 12.971, zoom: 18, screenThresholdPx: 34 };

const pointerNear = (map: LatLng, screen: { x: number; y: number }) => ({ map, screen });

describe("snapThresholdMetres", () => {
  it("converts the screen threshold through metresPerPixelAt", () => {
    const expected = 34 * metresPerPixelAt(12.971, 18);

    expect(snapThresholdMetres(config)).toBeCloseTo(expected, 6);
  });

  it("clamps to the maximum map-distance sanity limit at extreme zoom-outs", () => {
    expect(
      snapThresholdMetres({ latitudeDegrees: 12.971, zoom: 3, screenThresholdPx: 400 })
    ).toBe(MAX_SNAP_DISTANCE_METRES);
  });

  it("clamps to the minimum map-distance sanity limit for microscopic thresholds", () => {
    expect(
      snapThresholdMetres({ latitudeDegrees: 12.971, zoom: 24, screenThresholdPx: 0.0001 })
    ).toBe(MIN_SNAP_DISTANCE_METRES);
  });
});

describe("resolveSnap", () => {
  const targets = buildSnapTargets({ osmRoads: baseRoads, proposalObjects: [], project: identityProject });

  it("snaps to the nearest segment within the converted threshold", () => {
    // Middle of osm-1: lng 77.5955 sits between its endpoints along the segment.
    const map = { lat: 12.9709, lng: 77.5955 };
    const snap = resolveSnap(pointerNear(map, identityProject(map)), targets, config);

    expect(snap).not.toBeNull();
    expect(snap?.kind).toBe("segment");
    expect(snap?.target.source).toBe("osm");
    expect(snap?.mapPoint.lat).toBeCloseTo(12.971, 6);
  });

  it("returns null when nothing is within the threshold", () => {
    const map = { lat: 12.98, lng: 77.62 };

    expect(resolveSnap(pointerNear(map, identityProject(map)), targets, config)).toBeNull();
  });

  it("prefers an endpoint over an equally reachable segment", () => {
    // Just past the end of osm-1; the endpoint is nearer than any segment body.
    const map = { lat: 12.971, lng: 77.6001 };
    const snap = resolveSnap(pointerNear(map, identityProject(map)), targets, config);

    expect(snap?.kind).toBe("endpoint");
    expect(snap?.mapPoint.lat).toBeCloseTo(12.971, 9);
    expect(snap?.mapPoint.lng).toBeCloseTo(77.6, 6);
  });

  it("distinguishes perpendicular snaps when requested for interior projections", () => {
    const map = { lat: 12.9709, lng: 77.5955 };
    const point = pointerNear(map, identityProject(map));

    const segment = resolveSnap(point, targets, config);
    const perpendicular = resolveSnap(point, targets, config, { interiorSnapKind: "perpendicular" });

    expect(segment?.kind).toBe("segment");
    expect(perpendicular?.kind).toBe("perpendicular");
  });

  it("does not report a perpendicular snap when the projection lands on an endpoint", () => {
    const map = { lat: 12.971, lng: 77.6001 };

    expect(
      resolveSnap(pointerNear(map, identityProject(map)), targets, config, {
        interiorSnapKind: "perpendicular"
      })?.kind
    ).toBe("endpoint");
  });

  it("snaps to precomputed intersections between different OSM roads", () => {
    // The two base roads cross near lat 12.971 / lng 77.595.
    const map = { lat: 12.97102, lng: 77.59502 };
    const snap = resolveSnap(pointerNear(map, identityProject(map)), targets, config);

    expect(snap?.kind).toBe("intersection");
    expect(snap?.target.source).toBe("osm");
  });

  it("includes proposal object endpoints as snap targets", () => {
    const footpath: DrawingObjectV1 = {
      id: "prop-1",
      type: "footpath",
      geometry: {
        type: "LineString",
        points: [
          { lat: 12.972, lng: 77.59 },
          { lat: 12.972, lng: 77.591 }
        ]
      },
      properties: {
        accessibility: "step-free",
        alignment: "separate",
        clearWidthMetres: 1.8,
        surface: "paved"
      }
    };
    const withProposal = buildSnapTargets({
      osmRoads: [],
      proposalObjects: [footpath],
      project: identityProject
    });
    const map = { lat: 12.972, lng: 77.59005 };
    const snap = resolveSnap(pointerNear(map, identityProject(map)), withProposal, config);

    expect(snap?.kind).toBe("endpoint");
    expect(snap?.target.source).toBe("proposal");
    expect(snap?.target.id).toBe("prop-1");
  });

  it("offers eight roundabout circumference connection points per roundabout", () => {
    const roundabout: DrawingObjectV1 = {
      id: "rb-1",
      type: "roundabout",
      geometry: { type: "Point", point: { lat: 12.971, lng: 77.595 } },
      properties: { inscribedCircleDiameterMetres: 32, lanes: 1 }
    };
    const withRoundabout = buildSnapTargets({
      osmRoads: [],
      proposalObjects: [roundabout],
      project: identityProject
    });

    const circumference = withRoundabout.filter(
      (target): target is Extract<SnapTarget, { kind: "endpoint" | "intersection" | "circumference" }> => target.kind === "circumference"
    );
    expect(circumference).toHaveLength(8);
    expect(circumference.every((target) => target.id === "rb-1")).toBe(true);

    // A road endpoint landing on the circumference connects to it.
    const center = identityProject({ lat: 12.971, lng: 77.595 });
    const east = circumference.find((target) => target.screenPoint.x > center.x);
    expect(east).toBeDefined();
    const snap = resolveSnap(pointerNear(east!.mapPoint, east!.screenPoint), withRoundabout, config);

    expect(snap?.kind).toBe("endpoint");
    expect(snap?.target.kind).toBe("circumference");
  });

  it("keeps geometry in map coordinates regardless of screen projection", () => {
    const shiftedProject = (point: LatLng) => ({
      x: point.lng * 100_000 + 500,
      y: -point.lat * 100_000 - 500
    });
    const shifted = buildSnapTargets({ osmRoads: baseRoads, proposalObjects: [], project: shiftedProject });
    const map = { lat: 12.971, lng: 77.6001 };
    const snap = resolveSnap(pointerNear(map, shiftedProject(map)), shifted, config);

    expect(snap?.mapPoint.lat).toBeCloseTo(12.971, 9);
    expect(snap?.mapPoint.lng).toBeCloseTo(77.6, 6);
  });
});
