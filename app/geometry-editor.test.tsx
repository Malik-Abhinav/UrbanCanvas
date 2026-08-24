import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import type { DrawingObjectV1 } from "../shared/drawing-document";

// react-konva pulls in konva's node backend under vitest; stub the components —
// these tests cover handle model building and rendered chrome, not canvas pixels.
const renderedProps: Array<Record<string, unknown>> = [];

vi.mock("react-konva", async () => {
  const makeStub = (name: string) => {
    const Stub = (props: Record<string, unknown>) => {
      renderedProps.push(props);
      // Pass children through so nested handles actually render under test.
      return (props.children ?? null) as null;
    };

    Stub.displayName = name;
    return Stub;
  };

  return {
    Circle: makeStub("Circle"),
    Group: makeStub("Group"),
    Line: makeStub("Line")
  };
});

const {
  HANDLE_COLOR,
  buildMidpointHandles,
  buildVertexHandles,
  findNearestHandle,
  GeometryEditorOverlay
} = await import("./geometry-editor");

const latLng = (lat: number, lng: number) => ({ lat, lng });

const identityProject = (point: { lat: number; lng: number }) => ({
  x: point.lng * 100,
  y: point.lat * 100
});

const lineObject: DrawingObjectV1 = {
  geometry: {
    points: [latLng(1, 1), latLng(2, 2), latLng(3, 3)],
    type: "LineString"
  },
  id: "road-1",
  properties: {
    direction: "two-way",
    highwayFunction: "local",
    laneWidthMetres: 3.5,
    lanes: 2
  },
  type: "road"
};

describe("vertex handle models", () => {
  it("projects every vertex into a numbered screen-space handle", () => {
    const handles = buildVertexHandles(lineObject.geometry.points, identityProject);

    expect(handles.map((handle) => handle.index)).toEqual([0, 1, 2]);
    expect(handles[1]).toMatchObject({ x: 200, y: 200 });
  });

  it("projects per-segment midpoints used to insert new vertices", () => {
    const midpoints = buildMidpointHandles(lineObject.geometry.points, identityProject);

    expect(midpoints.map((midpoint) => midpoint.segmentIndex)).toEqual([0, 1]);
  });

  it("finds the nearest handle within pixel tolerance", () => {
    const handles = buildVertexHandles(lineObject.geometry.points, identityProject);

    expect(findNearestHandle(handles, { x: 203, y: 198 }, 10)?.index).toBe(1);
    expect(findNearestHandle(handles, { x: 400, y: 400 }, 10)).toBeNull();
  });
});

describe("GeometryEditorOverlay", () => {
  it("renders one #f5c542 handle circle per vertex plus insertion midpoints", () => {
    renderToStaticMarkup(
      createElement(GeometryEditorOverlay, {
        object: lineObject,
        onAddVertex: () => undefined,
        onDragVertex: () => undefined,
        onMoveObject: () => undefined,
        onRemoveVertex: () => undefined,
        projectMapPoint: identityProject,
        unprojectScreenPoint: ({ x, y }: { x: number; y: number }) => ({ lat: x / 100, lng: y / 100 })
      })
    );

    const names = renderedProps
      .filter((props) => typeof props.name === "string")
      .map((props) => props.name);

    // Three vertex handles + two midpoint handles.
    expect(names.filter((name) => name === "geometry-vertex-handle")).toHaveLength(3);
    expect(names.filter((name) => name === "geometry-midpoint-handle")).toHaveLength(2);

    const handleFills = renderedProps
      .filter((props) => props.name === "geometry-vertex-handle")
      .map((props) => props.fill);

    expect(handleFills.every((fill) => fill === HANDLE_COLOR)).toBe(true);
  });

  it("renders nothing for point geometries (single vertex has no handles)", () => {
    const signal: DrawingObjectV1 = {
      geometry: { point: latLng(1, 1), type: "Point" },
      id: "signal-1",
      properties: { kind: "vehicle" },
      type: "traffic-signal"
    };

    const markup = renderToStaticMarkup(
      createElement(GeometryEditorOverlay, {
        object: signal,
        onAddVertex: () => undefined,
        onDragVertex: () => undefined,
        onMoveObject: () => undefined,
        onRemoveVertex: () => undefined,
        projectMapPoint: identityProject,
        unprojectScreenPoint: ({ x, y }: { x: number; y: number }) => ({ lat: x / 100, lng: y / 100 })
      })
    );

    expect(markup).not.toContain('name="geometry-vertex-handle"');
  });
});
