"use client";

import { UndirectedGraph } from "graphology";
import { dijkstra } from "graphology-shortest-path";
import { useEffect, useMemo, useReducer, useRef, useState } from "react";
import type { KeyboardEvent, WheelEvent } from "react";
import { Circle, Group, Layer, Line, Rect, Stage } from "react-konva";
import type Konva from "konva";
import {
  Bike,
  CircleDot,
  Eraser,
  MousePointer2,
  RotateCcw,
  RotateCw,
  Signal,
  Slash,
  SquareDashedMousePointer,
  SquareChevronDown,
  SquareChevronUp,
  Waypoints,
  ZoomIn,
  ZoomOut
} from "lucide-react";
import {
  canRedo,
  canUndo,
  emptyHistoryState,
  historyReducer
} from "./drawing-history";
import {
  MIN_CROSSING_LENGTH_PX,
  MIN_CROSSING_WIDTH_PX,
  MIN_PATH_WIDTH_PX,
  MIN_ROUNDABOUT_RADIUS_PX,
  MIN_ROAD_WIDTH_PX,
  createMigrationPixelsToMetres,
  createPixelMetreConverter,
  getLineObjectWidthMetres,
  type PixelMetreConverter
} from "./drawing-document-bridge";
import { migrateLegacyDrawingArray } from "../shared/legacy-drawing-migration";
import type { LatLng } from "../shared/geo";
import type { DrawingObjectV1, LineGeometry } from "../shared/drawing-document";
import ObjectInspector, { applyPropertyPatch } from "./components/workspace/object-inspector";
import { GeometryEditorOverlay } from "./geometry-editor";
import {
  applyGeometryToLineObject,
  dragVertex,
  insertVertexAfter,
  joinLines,
  removeVertex,
  splitLineAtVertex,
  translateLine
} from "./drawing-operations";
import { StyledDrawingObject, type RenderedProposalObject } from "./drawing-renderer";
import { computeContextRoadStyle, scaleContextAtZoom } from "./drawing-style";
import {
  resolveContextOpacity,
  resolveProposalOpacity,
  type LayerSettings
} from "./layer-semantics";
import {
  getClosestPointOnSegment,
  getDistance,
  getMapDistanceMeters,
  interpolateMapPoint,
  normalizePoint,
  snapThresholdPx as snapDistance
} from "./canvas-geometry";
import {
  buildSnapTargets,
  resolveSnap,
  type ResolvedSnap,
  type SnapTarget
} from "./drawing-snap";
import {
  coerceNumericEntry,
  constrainSegmentDelta,
  duplicateLineObjectLatLng,
  resolveCommand,
  resolveGridSpacing,
  scalePolylineLength,
  type CommandId,
  type PaletteCommand
} from "./drawing-precision";
import { metresPerPixelAt } from "./drawing-document-bridge";
import CommandPalette from "./components/workspace/command-palette";

type SatelliteOverlayProps = {
  getMapZoom: () => number;
  height: number;
  initialObjects: DrawingObjectV1[];
  layerSettings: LayerSettings;
  /** Receives the commit function for inspector edits made outside the canvas. */
  onBindPropertyUpdate?: (update: (key: string, value: string) => void) => void;
  /** Reports the currently selected V1 object (null when nothing is selected). */
  onSelectionChange?: (object: DrawingObjectV1 | null) => void;
  /** Object ids to flag visually (e.g. the segment behind a selected analysis finding). */
  highlightObjectIds?: string[];
  mapRevision: number;
  objectsRevision: number;
  onObjectsChange: (objects: DrawingObjectV1[]) => void;
  onMapPointToScreen: (point: MapPoint) => Point;
  onMapPan: (delta: Point) => void;
  onScreenPointToMap: (point: Point) => MapPoint;
  onMapZoom: (direction: "in" | "out" | "reset") => void;
  osmRoads: OsmRoad[];
  width: number;
};

type OsmRoad = {
  id: number;
  kind: string;
  geometry: MapPoint[];
  tags?: Record<string, string>;
};

type MapPoint = {
  lat: number;
  lng: number;
};

type Point = {
  x: number;
  y: number;
};

declare global {
  interface Window {
    /** Fixtures-only test hook; never compiled into production bundles. */
    __urbanCanvasE2eCanvasState?: () => {
      objects: DrawingObjectV1[];
      rendered: RenderedDrawingObject[];
    };
  }
}

type Tool = "select" | "road" | "bike" | "sidewalk" | "crossing" | "roundabout" | "signal" | "erase";

/** How close (metres) two line endpoints must be for join-segments to link them. */
const JOIN_TOLERANCE_METRES = 2;

/** Minimum on-screen grid cell size before the scale-aware grid hides itself. */
const MIN_GRID_SPACING_PX = 24;
const TOOL_STORAGE_KEY = "urbancanvas.activeTool";

function isLineTool(tool: Tool): tool is "road" | "bike" | "sidewalk" {
  return tool === "road" || tool === "bike" || tool === "sidewalk";
}

function loadStoredTool(): Tool | null {
  try {
    const raw = window.localStorage.getItem(TOOL_STORAGE_KEY);

    return raw === "select" || raw === "road" || raw === "bike" || raw === "sidewalk" || raw === "crossing" ||
      raw === "roundabout" || raw === "signal" || raw === "erase"
      ? (raw as Tool)
      : null;
  } catch {
    return null;
  }
}

/** Width property key differs per line object family in the shared V1 model. */
function widthKeyForType(type: DrawingObjectV1["type"]): string | null {
  if (type === "road") {
    return "laneWidthMetres";
  }

  if (type === "cycleway") {
    return "widthMetres";
  }

  if (type === "footpath") {
    return "clearWidthMetres";
  }

  return null;
}

function readLineWidthMetres(object: DrawingObjectV1): number {
  const properties = object.properties as unknown as Record<string, unknown>;

  for (const key of ["laneWidthMetres", "clearWidthMetres", "widthMetres"]) {
    if (typeof properties[key] === "number") {
      return properties[key] as number;
    }
  }

  return 3;
}

type AnalysisMode = "idle" | "picking-path";

/**
 * Pointer interactions still create these legacy-shaped objects (pixels), but
 * they are migrated to DrawingObjectV1 before entering component state, so the
 * in-memory drawing is always the shared V1 model.
 */
export type DrawingObject =
  | {
      id: string;
      type: "road" | "bike" | "sidewalk";
      path: MapPoint[];
      snapped: boolean;
    }
  | {
      id: string;
      type: "crossing";
      anchor: MapPoint;
      pixelVector: Point;
    }
  | {
      center: MapPoint;
      id: string;
      pixelRadius: number;
      type: "roundabout";
    }
  | {
      id: string;
      point: MapPoint;
      type: "signal";
    };

type RenderedDrawingObject = RenderedProposalObject;

type ProjectedRoad = OsmRoad & {
  points: Point[];
};

type RoadGraphNode = {
  point: MapPoint;
};

type RoadGraphEdge = {
  end: MapPoint;
  hasSidewalk: boolean;
  kind: string;
  lengthMeters: number;
  roadId: number;
  segmentIndex: number;
  start: MapPoint;
  weight: number;
};

type RoadGraph = {
  edgeCount: number;
  edges: RoadGraphEdge[];
  graph: UndirectedGraph<RoadGraphNode, RoadGraphEdge>;
  nodeCount: number;
  nodeIds: string[];
};

type AnalysisPath = {
  distanceMeters: number;
  nodeIds: string[];
  points: MapPoint[];
};

type GraphAnalysis = {
  deadEndEdges: RoadGraphEdge[];
  deadEndNodes: string[];
  graph: RoadGraph;
  sidewalkEdgeCount: number;
  walkabilityScore: number;
};

type RoadSnap = {
  distance: number;
  mapPoint: MapPoint;
  point: Point;
  road: ProjectedRoad;
  segmentIndex: number;
  tangent: Point;
};

type RoundaboutSnap = {
  distance: number;
  mapPoint: MapPoint;
  point: Point;
  roundaboutId: string;
};

type SnapPreview =
  | {
      object: RenderedDrawingObject;
      path: MapPoint[];
      point: Point;
      snapKind?: ResolvedSnap["kind"];
      type: "line";
    }
  | {
      end: Point;
      object: RenderedDrawingObject;
      point: Point;
      snapKind?: ResolvedSnap["kind"];
      start: Point;
      type: "crossing";
    }
  | {
      center: Point;
      centerMap: MapPoint;
      object: RenderedDrawingObject;
      snapKind?: ResolvedSnap["kind"];
      type: "roundabout";
    };

const gridSize = 32;

const tools: Array<{
  Icon: typeof MousePointer2;
  hint: string;
  id: Tool;
  label: string;
}> = [
  { id: "select", label: "Select", Icon: MousePointer2, hint: "V" },
  { id: "road", label: "Road / Lane", Icon: SquareDashedMousePointer, hint: "R" },
  { id: "bike", label: "Bike Lane", Icon: Bike, hint: "B" },
  { id: "sidewalk", label: "Sidewalk", Icon: Waypoints, hint: "S" },
  { id: "crossing", label: "Pedestrian Crossing", Icon: Slash, hint: "C" },
  { id: "roundabout", label: "Roundabout", Icon: CircleDot, hint: "O" },
  { id: "signal", label: "Traffic Signal", Icon: Signal, hint: "T" },
  { id: "erase", label: "Erase", Icon: Eraser, hint: "E" }
];

export default function SatelliteOverlay({
  getMapZoom,
  height,
  initialObjects,
  layerSettings,
  onBindPropertyUpdate,
  onSelectionChange,
  highlightObjectIds,
  mapRevision,
  objectsRevision,
  onObjectsChange,
  onMapPan,
  onMapPointToScreen,
  onMapZoom,
  onScreenPointToMap,
  osmRoads,
  width
}: SatelliteOverlayProps) {
  const stageRef = useRef<Konva.Stage | null>(null);
  const initialObjectsRef = useRef(initialObjects);
  const panLastPointRef = useRef<Point | null>(null);
  const [activeTool, setActiveTool] = useState<Tool>(() => loadStoredTool() ?? "select");
  const [hoveredTool, setHoveredTool] = useState<Tool | null>(null);
  const [isPaletteOpen, setIsPaletteOpen] = useState(false);
  const [isGridVisible, setIsGridVisible] = useState(true);
  const [history, dispatchHistory] = useReducer(historyReducer, emptyHistoryState);
  const objects = history.present;
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [draftStart, setDraftStart] = useState<Point | null>(null);
  const [draftEnd, setDraftEnd] = useState<Point | null>(null);
  // Click-to-place multi-segment chains (in addition to drag drawing): each
  // click appends a vertex; Enter / double-click commits the whole polyline.
  const [chainPoints, setChainPoints] = useState<Point[] | null>(null);
  const shiftHeldRef = useRef(false);
  const [analysisMode, setAnalysisMode] = useState<AnalysisMode>("idle");
  const [isAnalysisCollapsed, setIsAnalysisCollapsed] = useState(false);
  const [pathStartNodeId, setPathStartNodeId] = useState<string | null>(null);
  const [analysisPath, setAnalysisPath] = useState<AnalysisPath | null>(null);
  const [analysisMessage, setAnalysisMessage] = useState("Pick two road points to show the shortest path.");
  const selectedObject = useMemo(
    () => objects.find((object) => object.id === selectedId) ?? null,
    [objects, selectedId]
  );
  // Geometry editing session: active while a line object is selected with the
  // select tool. Escape reverts to the session snapshot; Enter confirms.
  const [isEditingGeometry, setIsEditingGeometry] = useState(false);
  const editSnapshotRef = useRef<DrawingObjectV1 | null>(null);
  const objectsRef = useRef(objects);
  const selectedIdRef = useRef(selectedId);

  useEffect(() => {
    objectsRef.current = objects;
  }, [objects]);

  useEffect(() => {
    selectedIdRef.current = selectedId;
  }, [selectedId]);

  useEffect(() => {
    onSelectionChange?.(selectedObject);
  }, [onSelectionChange, selectedObject]);

  useEffect(() => {
    try {
      window.localStorage.setItem(TOOL_STORAGE_KEY, activeTool);
    } catch {
      // Storage can be unavailable (private mode); tool persistence is best-effort.
    }
  }, [activeTool]);

  const effectiveGridVisible = layerSettings.visible.grid && isGridVisible;
  // The zoom is read lazily at render time through a ref so the converter's
  // identity stays stable; map revision bumps re-run the dependent memos.
  const getMapZoomRef = useRef(getMapZoom);
  const converter = useMemo(
    () => createPixelMetreConverter({ getZoom: () => getMapZoomRef.current() }),
    []
  );
  const migrationPixelsToMetres = useMemo(() => createMigrationPixelsToMetres(converter), [converter]);
  // Scale-aware grid: spacing derives from real metres via metresPerPixelAt
  // and hides itself when no nice spacing stays readable on screen.
  const gridSpec = useMemo(() => {
    void mapRevision;

    const latitude = osmRoads[0]?.geometry[0]?.lat ?? 0;

    return resolveGridSpacing({
      metresPerPixel: metresPerPixelAt(latitude, getMapZoomRef.current()),
      minSpacingPx: MIN_GRID_SPACING_PX
    });
  }, [mapRevision, osmRoads]);
  const grid = useMemo(() => {
    const spacing = gridSpec?.spacingPx ?? gridSize;
    const verticalLines = Math.ceil(width / spacing);
    const horizontalLines = Math.ceil(height / spacing);

    return { horizontalLines, spacing, verticalLines };
  }, [gridSpec, height, width]);
  const renderedObjects = useMemo(() => {
    void mapRevision;

    return objects.map((object) => getRenderedObject(object, onMapPointToScreen, converter));
  }, [converter, mapRevision, objects, onMapPointToScreen]);
  const highlightedIdSet = useMemo(() => new Set(highlightObjectIds ?? []), [highlightObjectIds]);
  // Analysis-finding highlights (Task 24): flagged objects projected to screen
  // space so they can be outlined on a dedicated layer without touching how
  // objects themselves render.
  const highlightShapes = useMemo(() => {
    void mapRevision;

    if (highlightedIdSet.size === 0) {
      return [];
    }

    return objects
      .filter((object) => highlightedIdSet.has(object.id))
      .map((object) =>
        object.geometry.type === "LineString"
          ? {
              id: object.id,
              points: object.geometry.points.flatMap((point) => {
                const projected = onMapPointToScreen(point);

                return [projected.x, projected.y];
              }),
              point: null as Point | null
            }
          : {
              id: object.id,
              points: null,
              point: onMapPointToScreen(object.geometry.point)
            }
      );
  }, [highlightedIdSet, mapRevision, objects, onMapPointToScreen]);
  const projectedRoads = useMemo(() => {
    void mapRevision;

    return osmRoads
      .filter((road) => road.geometry.length >= 2)
      .map((road) => ({
        ...road,
        points: road.geometry.map((point) => onMapPointToScreen(point))
      }));
  }, [mapRevision, onMapPointToScreen, osmRoads]);
  // Editing is active whenever a drawing tool is selected or a draft object
  // is in flight; existing context dims while this holds.
  const isEditing = activeTool !== "select" || draftStart !== null;
  const effectiveContextOpacity = resolveContextOpacity(layerSettings, isEditing);
  const effectiveProposalOpacity = resolveProposalOpacity(layerSettings);
  const contextRoadStyles = useMemo(() => {
    void mapRevision;

    const latitude = osmRoads[0]?.geometry[0]?.lat ?? 0;
    const context = scaleContextAtZoom(latitude, getMapZoom());

    return new Map(projectedRoads.map((road) => [road.id, computeContextRoadStyle(road.kind, context)]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mapRevision, projectedRoads]);
  const roundaboutSnaps = useMemo(() => {
    void mapRevision;

    return getRoundaboutSnapPoints(objects, onMapPointToScreen, onScreenPointToMap, converter);
  }, [converter, mapRevision, objects, onMapPointToScreen, onScreenPointToMap]);
  // Network-continuity snap targets: OSM segments/endpoints/intersections,
  // proposal object geometry, and roundabout circumference connection points.
  const snapTargets = useMemo(() => {
    void mapRevision;

    return buildSnapTargets({
      metresToPixels: (metres, at) => converter.metresToPixels(metres, at),
      osmRoads,
      project: onMapPointToScreen,
      proposalObjects: objects
    });
  }, [converter, mapRevision, objects, onMapPointToScreen, osmRoads]);
  const snapPreview = useMemo(() => {
    if (!draftStart || !draftEnd) {
      return null;
    }

    return getSnapPreview(
      activeTool,
      draftStart,
      draftEnd,
      projectedRoads,
      roundaboutSnaps,
      onMapPointToScreen,
      onScreenPointToMap,
      snapTargets,
      () => getMapZoomRef.current()
    );
  }, [activeTool, draftEnd, draftStart, getMapZoomRef, onMapPointToScreen, onScreenPointToMap, projectedRoads, roundaboutSnaps, snapTargets]);
  const graphAnalysis = useMemo(() => {
    void mapRevision;

    return buildGraphAnalysis(osmRoads, objects);
  }, [mapRevision, objects, osmRoads]);
  const renderedDeadEndEdges = useMemo(() => {
    void mapRevision;

    return graphAnalysis.deadEndEdges.map((edge) => ({
      id: `dead-${edge.roadId}-${edge.segmentIndex}`,
      points: getMapLinePoints([edge.start, edge.end], onMapPointToScreen)
    }));
  }, [graphAnalysis.deadEndEdges, mapRevision, onMapPointToScreen]);
  const renderedAnalysisPath = useMemo(() => {
    void mapRevision;

    return analysisPath ? getMapLinePoints(analysisPath.points, onMapPointToScreen) : null;
  }, [analysisPath, mapRevision, onMapPointToScreen]);
  const renderedPathStart = useMemo(() => {
    void mapRevision;

    if (!pathStartNodeId) {
      return null;
    }

    const node = graphAnalysis.graph.graph.getNodeAttributes(pathStartNodeId);

    return onMapPointToScreen(node.point);
  }, [graphAnalysis.graph.graph, mapRevision, onMapPointToScreen, pathStartNodeId]);

  useEffect(() => {
    initialObjectsRef.current = initialObjects;
  }, [initialObjects]);

  useEffect(() => {
    getMapZoomRef.current = getMapZoom;
  }, [getMapZoom]);

  // E2E fixture support: expose the live V1 objects and their rendered pixel
  // geometry so tests can assert scale-dependent widths. The NODE_ENV check
  // comes first so production builds eliminate this block entirely (the
  // fixtures flag string must never appear in production bundles).
  useEffect(() => {
    if (process.env.NODE_ENV !== "production" && process.env.NEXT_PUBLIC_E2E_TEST_FIXTURES === "1") {
      window.__urbanCanvasE2eCanvasState = () => ({
        objects,
        rendered: renderedObjects
      });
    }
  });

  useEffect(() => {
    dispatchHistory({ objects: initialObjectsRef.current, type: "replace-all" });
    setSelectedId(null);
    setDraftStart(null);
    setDraftEnd(null);
  }, [objectsRevision]);

  useEffect(() => {
    onObjectsChange(objects);
  }, [objects, onObjectsChange]);

  useEffect(() => {
    setAnalysisPath(null);
    setPathStartNodeId(null);
    setAnalysisMessage("Pick two road points to show the shortest path.");
  }, [graphAnalysis.graph.nodeCount, graphAnalysis.graph.edgeCount]);

  function getPointerPoint() {
    const stage = stageRef.current;
    const pointer = stage?.getPointerPosition();

    if (!pointer) {
      return null;
    }

    return pointer;
  }

  function clearDrafting() {
    setDraftStart(null);
    setDraftEnd(null);
    setChainPoints(null);
  }

  /**
   * Applies the Shift angle constraint at the input boundary: the raw end is
   * unprojected to map coordinates, constrained in a local-metre frame
   * relative to the anchor, then projected back to screen space.
   */
  function applyAngleConstraint(anchor: Point, rawEnd: Point): Point {
    if (!shiftHeldRef.current) {
      return rawEnd;
    }

    const METRES_PER_DEGREE = 111320;
    const anchorMap = onScreenPointToMap(anchor);
    const endMap = onScreenPointToMap(rawEnd);
    const referenceLat = (anchorMap.lat * Math.PI) / 180;
    const deltaLocal = {
      x: (endMap.lng - anchorMap.lng) * METRES_PER_DEGREE * Math.cos(referenceLat),
      y: (endMap.lat - anchorMap.lat) * METRES_PER_DEGREE
    };
    const constrained = constrainSegmentDelta({ x: 0, y: 0 }, deltaLocal, true);

    return onMapPointToScreen({
      lat: anchorMap.lat + constrained.y / METRES_PER_DEGREE,
      lng: anchorMap.lng + constrained.x / (METRES_PER_DEGREE * Math.cos(referenceLat))
    });
  }

  function handleStagePointerDown(event: Konva.KonvaEventObject<PointerEvent>) {
    shiftHeldRef.current = event.evt.shiftKey;

    if (event.target !== event.target.getStage() && event.target.name() !== "drawing-surface") {
      return;
    }

    const point = getPointerPoint();
    if (!point) {
      return;
    }

    if (activeTool === "select") {
      if (analysisMode === "picking-path") {
        handlePathPick(point);
        return;
      }

      setSelectedId(null);
      panLastPointRef.current = point;
      return;
    }

    if (activeTool === "erase") {
      return;
    }

    if (activeTool === "signal") {
      pushObject({
        id: createId("signal"),
        point: onScreenPointToMap(point),
        type: "signal"
      });
      return;
    }

    if (!chainPoints) {
      setChainPoints([point]);
    }

    setDraftStart(point);
    setDraftEnd(point);
  }

  function handleStagePointerMove(event: Konva.KonvaEventObject<PointerEvent>) {
    shiftHeldRef.current = event.evt.shiftKey;

    if (activeTool === "select" && panLastPointRef.current) {
      const point = getPointerPoint();
      if (!point) {
        return;
      }

      onMapPan({
        x: point.x - panLastPointRef.current.x,
        y: point.y - panLastPointRef.current.y
      });
      panLastPointRef.current = point;
      return;
    }

    if (!draftStart) {
      return;
    }

    const point = getPointerPoint();
    if (!point) {
      return;
    }

    // Anchor for the Shift constraint: the last placed chain vertex while a
    // click-chain is active, otherwise the drag origin.
    const anchor = chainPoints?.[chainPoints.length - 1] ?? draftStart;

    setDraftEnd(applyAngleConstraint(anchor, point));
  }

  /** Commits every vertex of the active click-chain as one multi-segment object. */
  function commitChain() {
    if (!chainPoints || chainPoints.length < 2 || !isLineTool(activeTool)) {
      clearDrafting();
      return;
    }

    pushObject({
      id: createId(activeTool),
      path: chainPoints.map((point) => onScreenPointToMap(point)),
      snapped: false,
      type: activeTool
    });
    clearDrafting();
  }

  function handleStagePointerUp() {
    panLastPointRef.current = null;

    if (!draftStart || !draftEnd) {
      return;
    }

    const distance = getDistance(draftStart, draftEnd);

    if (distance < 6) {
      // A click while a line tool is active places a chain vertex instead of
      // cancelling; the polyline commits on Enter / double-click / tool switch.
      if (isLineTool(activeTool)) {
        const anchor = chainPoints?.[chainPoints.length - 1] ?? draftStart;

        setChainPoints((current) => [...(current ?? [anchor])]);
        setDraftStart(anchor);
        setDraftEnd(anchor);
      } else {
        clearDrafting();
      }

      return;
    }

    const constrainedEnd = draftEnd;

    if (isLineTool(activeTool)) {
      const snappedLine = snapPreview?.type === "line" ? snapPreview : null;
      const anchor = chainPoints?.[chainPoints.length - 1] ?? draftStart;

      pushObject({
        id: createId(activeTool),
        path:
          snappedLine?.path ?? [onScreenPointToMap(anchor), onScreenPointToMap(constrainedEnd)],
        snapped: Boolean(snappedLine),
        type: activeTool
      });
      clearDrafting();
      return;
    }

    if (activeTool === "crossing") {
      const crossing = snapPreview?.type === "crossing" ? snapPreview : null;
      const start = crossing?.start ?? draftStart;
      const end = crossing?.end ?? constrainedEnd;

      pushObject({
        anchor: onScreenPointToMap(start),
        id: createId("crossing"),
        pixelVector: getVector(start, end),
        type: "crossing"
      });
    }

    if (activeTool === "roundabout") {
      const roundabout = snapPreview?.type === "roundabout" ? snapPreview : null;

      pushObject({
        center: roundabout ? roundabout.centerMap : onScreenPointToMap(draftStart),
        id: createId("roundabout"),
        pixelRadius: Math.max(12, distance),
        type: "roundabout"
      });
    }

    clearDrafting();
  }

  function pushObject(object: DrawingObject) {
    // Migrate at the boundary: pointer output is legacy-shaped (pixels), but
    // component state only ever holds shared-model DrawingObjectV1 objects.
    const [migrated] = migrateLegacyDrawingArray([object], {
      pixelsToMetres: migrationPixelsToMetres
    }).document.objects;

    if (!migrated) {
      return;
    }

    dispatchHistory({ object: migrated, type: "add" });
    setSelectedId(migrated.id);
  }

  function updateSelectedProperty(key: string, value: string) {
    const id = selectedIdRef.current;
    const object = objectsRef.current.find((candidate) => candidate.id === id);

    if (!object) {
      return;
    }

    // Coerce/filter through the inspector's patch logic, then commit as an
    // in-place property update — the object keeps its identity and undo works.
    const patched = applyPropertyPatch(object, { [key]: value });

    dispatchHistory({ id: object.id, properties: patched.properties as Record<string, unknown>, type: "update" });
  }

  useEffect(() => {
    onBindPropertyUpdate?.(updateSelectedProperty);
  });

  function removeObject(id: string) {
    dispatchHistory({ id, type: "remove" });
    setSelectedId((current) => (current === id ? null : current));
  }

  function undo() {
    dispatchHistory({ type: "undo" });
    setSelectedId(null);
    setDraftStart(null);
    setDraftEnd(null);
  }

  function redo() {
    const restored = history.future[0]?.at(-1);

    dispatchHistory({ type: "redo" });

    if (restored) {
      setSelectedId(restored.id);
    }
  }

  function handleObjectClick(event: Konva.KonvaEventObject<MouseEvent>, id: string) {
    event.cancelBubble = true;

    if (activeTool === "erase") {
      removeObject(id);
      return;
    }

    setSelectedId(id);

    // Entering a geometry editing session for line objects: snapshot for Escape.
    const object = objectsRef.current.find((candidate) => candidate.id === id);

    if (object && object.geometry.type === "LineString") {
      editSnapshotRef.current = object;
      setIsEditingGeometry(true);
    } else {
      editSnapshotRef.current = null;
      setIsEditingGeometry(false);
    }
  }

  function exitGeometryEditing() {
    setIsEditingGeometry(false);
    editSnapshotRef.current = null;
  }

  function cancelGeometryEditing() {
    const snapshot = editSnapshotRef.current;
    const id = selectedIdRef.current;

    if (snapshot && id && objectsRef.current.some((object) => object.id === id)) {
      dispatchHistory({ id, object: snapshot, type: "update-object" });
    }

    setSelectedId(null);
    exitGeometryEditing();
  }

  function commitGeometry(id: string, geometry: LineGeometry) {
    const current = objectsRef.current.find((object) => object.id === id);
    const next = current ? applyGeometryToLineObject(current, geometry) : null;

    if (!next) {
      return;
    }

    dispatchHistory({ id, object: next, type: "update-object" });
  }

  function handleDragVertex(vertexIndex: number, point: LatLng) {
    const id = selectedIdRef.current;
    const object = objectsRef.current.find((candidate) => candidate.id === id);

    if (!object || object.geometry.type !== "LineString") {
      return;
    }

    commitGeometry(object.id, {
      points: dragVertex(object.geometry.points, vertexIndex, point),
      type: "LineString"
    });
  }

  function handleAddVertex(segmentIndex: number, point: LatLng) {
    const id = selectedIdRef.current;
    const object = objectsRef.current.find((candidate) => candidate.id === id);

    if (!object || object.geometry.type !== "LineString") {
      return;
    }

    commitGeometry(object.id, {
      points: insertVertexAfter(object.geometry.points, segmentIndex, point),
      type: "LineString"
    });
  }

  function handleRemoveVertex(vertexIndex: number) {
    const id = selectedIdRef.current;
    const object = objectsRef.current.find((candidate) => candidate.id === id);

    if (!object || object.geometry.type !== "LineString") {
      return;
    }

    const points = removeVertex(object.geometry.points, vertexIndex);

    if (points) {
      commitGeometry(object.id, { points, type: "LineString" });
    }
  }

  function handleMoveObject(delta: { dLat: number; dLng: number }) {
    const id = selectedIdRef.current;
    const object = objectsRef.current.find((candidate) => candidate.id === id);

    if (!object || object.geometry.type !== "LineString") {
      return;
    }

    commitGeometry(object.id, {
      points: translateLine(object.geometry.points, delta),
      type: "LineString"
    });
  }

  /** Splits the selected line at its middle interior vertex into two objects. */
  function handleSplitSelected() {
    const object = selectedObject;

    if (!object || object.geometry.type !== "LineString") {
      return;
    }

    const parts = splitLineAtVertex(object.geometry.points, Math.floor(object.geometry.points.length / 2));

    if (!parts) {
      return;
    }

    const [head, tail] = parts;
    const newId = `${object.id}-split-${Date.now().toString(36)}`;
    const splitPart = { ...object, geometry: { ...object.geometry, points: tail }, id: newId } as DrawingObjectV1;

    commitGeometry(object.id, { points: head, type: "LineString" });
    dispatchHistory({ object: splitPart, type: "add" });
    setSelectedId(newId);
    editSnapshotRef.current = splitPart;
  }

  /** Joins the selected line with the nearest touching line of the same type. */
  function handleJoinSelected() {
    const object = selectedObject;

    if (!object || object.geometry.type !== "LineString") {
      return;
    }

    const endpoint = object.geometry.points[object.geometry.points.length - 1];

    if (!endpoint) {
      return;
    }

    const partner = objects.find(
      (candidate) =>
        candidate.id !== object.id &&
        candidate.type === object.type &&
        candidate.geometry.type === "LineString" &&
        getMapDistanceMeters(candidate.geometry.points[0], endpoint) <= JOIN_TOLERANCE_METRES
    );

    if (!partner || partner.geometry.type !== "LineString") {
      return;
    }

    const joinedPoints = joinLines(object.geometry.points, partner.geometry.points);

    commitGeometry(object.id, { points: joinedPoints, type: "LineString" });
    dispatchHistory({ id: partner.id, type: "remove" });
  }

  /** Duplicates the selected line as a parallel copy offset by its width. */
  function handleOffsetSelected() {
    const object = selectedObject;

    if (!object || object.geometry.type !== "LineString") {
      return;
    }

    const copy = duplicateLineObjectLatLng(
      object,
      `${object.id}-offset-${Date.now().toString(36)}`,
      readLineWidthMetres(object) * 2 + 2
    );

    if (!copy) {
      return;
    }

    dispatchHistory({ object: copy, type: "add" });
    setSelectedId(copy.id);
  }

  /** Duplicates the selected line in place (⌘D). */
  function handleDuplicateSelected() {
    const object = selectedObject;

    if (!object || object.geometry.type !== "LineString") {
      return;
    }

    const copy = duplicateLineObjectLatLng(
      object,
      `${object.id}-copy-${Date.now().toString(36)}`,
      0
    );

    if (!copy) {
      return;
    }

    dispatchHistory({ object: copy, type: "add" });
    setSelectedId(copy.id);
  }

  /** Numeric length entry: rescales the selected line about its first vertex. */
  function commitNumericLength(raw: string) {
    const object = selectedObject;
    const metres = coerceNumericEntry(raw, { max: 9999, min: 1 });

    if (!object || object.geometry.type !== "LineString" || metres === null) {
      return;
    }

    const points = scalePolylineLength(object.geometry.points, metres);

    if (points) {
      commitGeometry(object.id, { points, type: "LineString" });
    }
  }

  function handleCommand(id: string) {
    if (id.startsWith("tool.")) {
      setActiveTool(id.slice(5) as Tool);
      clearDrafting();
      panLastPointRef.current = null;
      return;
    }

    switch (id as CommandId | "view.toggle-grid") {
      case "edit.redo":
        redo();
        break;
      case "edit.undo":
        undo();
        break;
      case "geometry.commit":
        commitChain();
        break;
      case "object.duplicate":
        handleDuplicateSelected();
        break;
      case "object.offset":
        handleOffsetSelected();
        break;
      case "palette.open":
        setIsPaletteOpen((open) => !open);
        break;
      case "view.toggle-grid":
        setIsGridVisible((visible) => !visible);
        break;
      default:
        break;
    }
  }

  const paletteCommands: PaletteCommand[] = useMemo(
    () => [
      ...tools.map((tool) => ({ hint: tool.hint, id: `tool.${tool.id}`, title: `Draw with ${tool.label}` })),
      { hint: "G", id: "view.toggle-grid", title: effectiveGridVisible ? "Hide grid" : "Show grid" },
      { hint: "⇧O", id: "object.offset", title: "Duplicate offset parallel copy" },
      { hint: "⌘D", id: "object.duplicate", title: "Duplicate selection" },
      { hint: "Enter", id: "geometry.commit", title: "Commit multi-segment path" },
      { hint: "⌘Z", id: "edit.undo", title: "Undo" },
      { hint: "⌘⇧Z", id: "edit.redo", title: "Redo" }
    ],
    [effectiveGridVisible]
  );

  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    // The palette input handles its own keys; never intercept while it's open
    // except for its close key, which the palette itself consumes.
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
      event.preventDefault();
      setIsPaletteOpen((open) => !open);
      return;
    }

    if (isPaletteOpen) {
      return;
    }

    const command = resolveCommand(event);

    if (command) {
      event.preventDefault();
      panLastPointRef.current = null;
      handleCommand(command);
      return;
    }

    if ((event.key === "Backspace" || event.key === "Delete") && selectedId) {
      event.preventDefault();
      panLastPointRef.current = null;
      removeObject(selectedId);
      return;
    }

    if (event.key === "Enter" && chainPoints) {
      event.preventDefault();
      panLastPointRef.current = null;
      commitChain();
      return;
    }

    if (event.key === "Enter" && isEditingGeometry) {
      event.preventDefault();
      panLastPointRef.current = null;
      exitGeometryEditing();
      return;
    }

    if (event.key === "Escape") {
      setActiveTool("select");
      setAnalysisMode("idle");
      clearDrafting();
      panLastPointRef.current = null;

      if (isEditingGeometry) {
        cancelGeometryEditing();
        return;
      }

      setSelectedId(null);
    }
  }

  function handleWheel(event: WheelEvent<HTMLDivElement>) {
    event.preventDefault();
    onMapZoom(event.deltaY > 0 ? "out" : "in");
  }

  function handlePathPick(point: Point) {
    const nearestNodeId = getNearestGraphNode(point, graphAnalysis.graph, onMapPointToScreen);

    if (!nearestNodeId) {
      setAnalysisMessage("No road node nearby. Click closer to a road intersection or bend.");
      return;
    }

    if (!pathStartNodeId) {
      setPathStartNodeId(nearestNodeId);
      setAnalysisPath(null);
      setAnalysisMessage("Start point selected. Pick an end point.");
      return;
    }

    if (pathStartNodeId === nearestNodeId) {
      setAnalysisMessage("Pick a different end point.");
      return;
    }

    const nodePath = dijkstra.bidirectional(graphAnalysis.graph.graph, pathStartNodeId, nearestNodeId, "weight");

    if (!nodePath || nodePath.length < 2) {
      setAnalysisPath(null);
      setPathStartNodeId(nearestNodeId);
      setAnalysisMessage("No connected route found. Start point reset to the latest pick.");
      return;
    }

    const path = getAnalysisPath(graphAnalysis.graph, nodePath);
    setAnalysisPath(path);
    setPathStartNodeId(null);
    setAnalysisMessage(`Shortest path: ${formatDistance(path.distanceMeters)}.`);
  }

  function resetAnalysisPath() {
    setPathStartNodeId(null);
    setAnalysisPath(null);
    setAnalysisMessage("Pick two road points to show the shortest path.");
  }

  return (
    <div
      className="relative h-full w-full outline-none"
      onKeyDown={handleKeyDown}
      onMouseDown={(event) => event.currentTarget.focus()}
      onWheel={handleWheel}
      tabIndex={0}
    >
      <div className="absolute left-3 top-3 z-10 flex flex-col gap-2 rounded border border-white/20 bg-[#101311]/85 p-2 shadow-xl backdrop-blur">
        {tools.map(({ Icon, id, label }) => (
          <button
            aria-label={label}
            aria-pressed={activeTool === id}
            className={`flex h-10 w-10 items-center justify-center rounded border transition ${
              activeTool === id
                ? "border-[#f5c542] bg-[#f5c542] text-[#101311]"
                : "border-white/15 bg-white/10 text-white hover:border-[#f5c542]/70"
            }`}
            key={id}
            onMouseEnter={() => setHoveredTool(id)}
            onMouseLeave={() => setHoveredTool(null)}
            onClick={() => {
              setActiveTool(id);
              setDraftStart(null);
              setDraftEnd(null);
              setChainPoints(null);
              panLastPointRef.current = null;
            }}
            title={label}
            type="button"
          >
            <Icon size={18} />
          </button>
        ))}
        <div className="my-1 h-px bg-white/15" />
        <button
          aria-label="Undo"
          className="flex h-10 w-10 items-center justify-center rounded border border-white/15 bg-white/10 text-white transition hover:border-[#f5c542]/70 disabled:cursor-not-allowed disabled:opacity-40"
          disabled={!canUndo(history)}
          onClick={undo}
          title="Undo"
          type="button"
        >
          <RotateCcw size={18} />
        </button>
        <button
          aria-label="Redo"
          className="flex h-10 w-10 items-center justify-center rounded border border-white/15 bg-white/10 text-white transition hover:border-[#f5c542]/70 disabled:cursor-not-allowed disabled:opacity-40"
          disabled={!canRedo(history)}
          onClick={redo}
          title="Redo"
          type="button"
        >
          <RotateCw size={18} />
        </button>
        {history.historyTruncated ? (
          <span
            aria-label="Undo history limit reached. The latest 500 changes remain undoable; older changes cannot be undone."
            className="w-10 rounded border border-[#f5c542]/40 bg-[#f5c542]/10 px-1 py-1 text-center text-[9px] font-semibold leading-tight text-[#ffe6a1]"
            role="status"
            title="The latest 500 changes remain undoable; older changes cannot be undone."
          >
            500 max
          </span>
        ) : null}
      </div>

      {isEditingGeometry && selectedObject && selectedObject.geometry.type === "LineString" ? (
        <div
          aria-label="Geometry editing tools"
          className="absolute left-[4.75rem] top-3 z-10 flex flex-col gap-1 rounded border border-white/20 bg-[#101311]/85 p-2 text-white shadow-xl backdrop-blur"
          role="toolbar"
        >
          <button
            className="rounded border border-white/15 bg-white/10 px-2 py-1 text-xs transition hover:border-[#f5c542]/70"
            onClick={handleSplitSelected}
            title="Split this line into two at its middle vertex"
            type="button"
          >
            Split line
          </button>
          <button
            className="rounded border border-white/15 bg-white/10 px-2 py-1 text-xs transition hover:border-[#f5c542]/70"
            onClick={handleJoinSelected}
            title="Join this line with a touching line of the same kind"
            type="button"
          >
            Join segments
          </button>
          <p className="max-w-28 text-[9px] leading-tight text-white/40">
            Enter confirms · Escape cancels
          </p>
        </div>
      ) : null}

      {hoveredTool ? (
        <div className="absolute left-[4.75rem] top-3 z-20 rounded border border-white/20 bg-[#101311]/95 px-3 py-2 text-sm font-medium text-white shadow-xl">
          {getToolLabel(hoveredTool)}
        </div>
      ) : null}

      {selectedObject ? (
        <div className="absolute bottom-3 left-3 z-10 w-56">
          <ObjectInspector object={selectedObject} onPropertyChange={updateSelectedProperty} />
          {selectedObject.geometry.type === "LineString" ? (
            <div
              aria-label="Numeric geometry entry"
              className="mt-2 rounded border border-white/20 bg-[#101311]/85 p-2 text-white shadow-xl backdrop-blur"
            >
              <p className="text-[10px] font-semibold uppercase text-white/45">Numeric entry</p>
              <div className="mt-1.5 flex gap-2">
                <label className="flex-1 text-[10px] uppercase text-white/50">
                  Length m
                  <input
                    className="mt-0.5 w-full rounded border border-white/15 bg-white/10 px-1.5 py-1 text-xs text-white focus:border-[#f5c542] focus:outline-none"
                    data-testid="numeric-length"
                    defaultValue={String(Math.round(getPolylineLengthMetres(selectedObject.geometry.points)))}
                    key={`length-${selectedObject.id}-${selectedObject.geometry.points.length}`}
                    onBlur={(event) => commitNumericLength(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") {
                        event.preventDefault();
                        event.stopPropagation();
                        commitNumericLength(event.currentTarget.value);
                        event.currentTarget.blur();
                      }
                    }}
                    placeholder="e.g. 120"
                    type="text"
                  />
                </label>
                {widthKeyForType(selectedObject.type) ? (
                  <label className="flex-1 text-[10px] uppercase text-white/50">
                    Width m
                    <input
                      className="mt-0.5 w-full rounded border border-white/15 bg-white/10 px-1.5 py-1 text-xs text-white focus:border-[#f5c542] focus:outline-none"
                      data-testid="numeric-width"
                      defaultValue={String(readLineWidthMetres(selectedObject))}
                      key={`width-${selectedObject.id}`}
                      onBlur={(event) => {
                        const value = coerceNumericEntry(event.target.value, { max: 20, min: 0 });

                        if (value !== null && widthKeyForType(selectedObject.type)) {
                          updateSelectedProperty(widthKeyForType(selectedObject.type) as string, String(value));
                        }
                      }}
                      onKeyDown={(event) => {
                        if (event.key === "Enter") {
                          event.preventDefault();
                          event.stopPropagation();
                          const input = event.currentTarget;
                          const value = coerceNumericEntry(input.value, { max: 20, min: 0 });

                          if (value !== null && widthKeyForType(selectedObject.type)) {
                            updateSelectedProperty(widthKeyForType(selectedObject.type) as string, String(value));
                          }

                          input.blur();
                        }
                      }}
                      placeholder="e.g. 3.5"
                      type="text"
                    />
                  </label>
                ) : null}
              </div>
            </div>
          ) : null}
        </div>
      ) : null}

      <CommandPalette
        commands={paletteCommands}
        onClose={() => setIsPaletteOpen(false)}
        onRun={handleCommand}
        open={isPaletteOpen}
      />

      <div className="absolute bottom-3 right-3 z-10 flex items-center gap-2 rounded border border-white/20 bg-[#101311]/85 p-2 text-white shadow-xl backdrop-blur">
        <button
          aria-label="Zoom out"
          className="flex h-9 w-9 items-center justify-center rounded border border-white/15 bg-white/10 transition hover:border-[#f5c542]/70"
          onClick={() => onMapZoom("out")}
          type="button"
        >
          <ZoomOut size={17} />
        </button>
        <button
          className="h-9 min-w-16 rounded border border-white/15 bg-white/10 px-2 text-xs font-semibold transition hover:border-[#f5c542]/70"
          onClick={() => onMapZoom("reset")}
          type="button"
        >
          Reset
        </button>
        <button
          aria-label="Zoom in"
          className="flex h-9 w-9 items-center justify-center rounded border border-white/15 bg-white/10 transition hover:border-[#f5c542]/70"
          onClick={() => onMapZoom("in")}
          type="button"
        >
          <ZoomIn size={17} />
        </button>
      </div>

      <div className="absolute right-3 top-3 z-10 text-white">
        {isAnalysisCollapsed ? (
          <button
            className="flex items-center gap-2 rounded border border-white/20 bg-[#101311]/90 px-3 py-2 text-xs font-semibold shadow-xl backdrop-blur transition hover:border-[#f5c542]/70"
            onClick={() => setIsAnalysisCollapsed(false)}
            type="button"
          >
            <SquareChevronDown size={15} />
            Analysis
            <span className="text-[#f5c542]">{graphAnalysis.walkabilityScore}%</span>
          </button>
        ) : (
          <div className="w-64 rounded border border-white/20 bg-[#101311]/90 p-2.5 shadow-xl backdrop-blur">
            <div className="flex items-start justify-between gap-2">
              <div>
                <p className="text-[10px] font-semibold uppercase text-white/45">Road analysis</p>
                <p className="mt-0.5 text-xl font-semibold leading-none text-[#f5c542]">
                  {graphAnalysis.walkabilityScore}%
                </p>
                <p className="mt-1 text-[11px] leading-none text-white/55">sidewalk coverage</p>
              </div>
              <div className="flex items-start gap-1.5">
                <button
                  className={`rounded px-2.5 py-1.5 text-xs font-semibold transition ${
                    analysisMode === "picking-path"
                      ? "bg-[#f5c542] text-[#101311]"
                      : "border border-white/15 bg-white/10 text-white hover:border-[#f5c542]/70"
                  }`}
                  disabled={graphAnalysis.graph.nodeCount < 2}
                  onClick={() => {
                    setActiveTool("select");
                    setAnalysisMode((current) => (current === "picking-path" ? "idle" : "picking-path"));
                    resetAnalysisPath();
                  }}
                  type="button"
                >
                  {analysisMode === "picking-path" ? "Picking" : "Pick Path"}
                </button>
                <button
                  aria-label="Collapse road analysis"
                  className="flex h-8 w-8 items-center justify-center rounded border border-white/15 bg-white/10 text-white transition hover:border-[#f5c542]/70"
                  onClick={() => setIsAnalysisCollapsed(true)}
                  title="Collapse road analysis"
                  type="button"
                >
                  <SquareChevronUp size={15} />
                </button>
              </div>
            </div>
            <div className="mt-2 grid grid-cols-3 gap-1.5">
              <AnalysisStat label="Nodes" value={graphAnalysis.graph.nodeCount} />
              <AnalysisStat label="Edges" value={graphAnalysis.graph.edgeCount} />
              <AnalysisStat label="Dead ends" value={graphAnalysis.deadEndNodes.length} />
            </div>
            <p aria-live="polite" className="mt-2 text-[11px] leading-4 text-white/65">{analysisMessage}</p>
            <p className="mt-1 text-[10px] leading-4 text-white/40">Based on OSM tags and drawn sidewalks.</p>
            {analysisPath ? (
              <button
                className="mt-2 w-full rounded border border-white/15 bg-white/10 px-2.5 py-1.5 text-xs font-semibold text-white transition hover:border-[#f5c542]/70"
                onClick={resetAnalysisPath}
                type="button"
              >
                Clear Path
              </button>
            ) : null}
          </div>
        )}
      </div>

      <Stage
        height={height}
        onDblClick={() => {
          if (chainPoints) {
            commitChain();
          }
        }}
        onClick={(event) => {
          if (
            (event.target === event.target.getStage() || event.target.name() === "drawing-surface") &&
            activeTool === "select"
          ) {
            setSelectedId(null);
          }
        }}
        onPointerDown={handleStagePointerDown}
        onPointerLeave={() => {
          panLastPointRef.current = null;
        }}
        onPointerMove={handleStagePointerMove}
        onPointerUp={handleStagePointerUp}
        ref={stageRef}
        width={width}
      >
        <Layer>
          <Rect
            fill="rgba(17, 20, 18, 0.08)"
            height={height}
            name="drawing-surface"
            stroke="rgba(245, 197, 66, 0.55)"
            strokeWidth={2}
            width={width}
            x={0}
            y={0}
          />
          {effectiveGridVisible && gridSpec
            ? Array.from({ length: grid.verticalLines + 1 }, (_, index) => (
            <Line
              key={`vertical-${index}`}
              listening={false}
              points={[index * grid.spacing, 0, index * grid.spacing, height]}
              stroke="rgba(255, 255, 255, 0.18)"
              strokeWidth={1}
            />
          ))
            : null}
          {effectiveGridVisible && gridSpec
            ? Array.from({ length: grid.horizontalLines + 1 }, (_, index) => (
            <Line
              key={`horizontal-${index}`}
              listening={false}
              points={[0, index * grid.spacing, width, index * grid.spacing]}
              stroke="rgba(255, 255, 255, 0.18)"
              strokeWidth={1}
            />
          ))
            : null}

          {layerSettings.visible.osmRoads
            ? projectedRoads.map((road) => {
              const style = contextRoadStyles.get(road.id);

              if (!style) {
                return null;
              }

              return (
                <Line
                  key={`context-road-${road.id}`}
                  lineCap="round"
                  lineJoin="round"
                  opacity={effectiveContextOpacity}
                  points={road.points.flatMap((point) => [point.x, point.y])}
                  stroke={style.color}
                  strokeWidth={style.widthPx}
                />
              );
            })
            : null}

          {layerSettings.visible.analysis && renderedDeadEndEdges.map((edge) => (
            <Line
              key={edge.id}
              lineCap="round"
              lineJoin="round"
              opacity={0.78}
              points={edge.points}
              stroke="#ff6b57"
              strokeWidth={8}
            />
          ))}

          {layerSettings.visible.analysis && renderedAnalysisPath ? (
            <Line
              dash={[18, 8]}
              lineCap="round"
              lineJoin="round"
              points={renderedAnalysisPath}
              shadowBlur={8}
              shadowColor="#60a5fa"
              stroke="#60a5fa"
              strokeWidth={8}
            />
          ) : null}

          {layerSettings.visible.analysis && renderedPathStart ? (
            <Circle
              fill="#60a5fa"
              radius={8}
              stroke="#ffffff"
              strokeWidth={2}
              x={renderedPathStart.x}
              y={renderedPathStart.y}
            />
          ) : null}

          <Group opacity={layerSettings.visible.proposal ? effectiveProposalOpacity : 0}>
            {renderedObjects.map((object) => (
              <StyledDrawingObject
                isSelected={object.id === selectedId}
                key={object.id}
                object={object}
                onClick={(event) => handleObjectClick(event, object.id)}
              />
            ))}

            {snapPreview ? <SnapIndicator preview={snapPreview} /> : null}

            {isEditingGeometry && activeTool === "select" && selectedObject ? (
              <GeometryEditorOverlay
                object={selectedObject}
                onAddVertex={handleAddVertex}
                onDragVertex={handleDragVertex}
                onMoveObject={handleMoveObject}
                onRemoveVertex={handleRemoveVertex}
                projectMapPoint={onMapPointToScreen}
                unprojectScreenPoint={onScreenPointToMap}
              />
            ) : null}

            {draftStart && draftEnd ? (
              <StyledDrawingObject
                isDraft
                isSelected={false}
                object={snapPreview?.object ?? getDraftObject(activeTool, draftStart, draftEnd)}
              />
            ) : null}

            {chainPoints && draftEnd ? (
              <Line
                dash={[8, 6]}
                points={chainPoints.flatMap((point) => [point.x, point.y]).concat(draftEnd.x, draftEnd.y)}
                stroke="#f5c542"
                strokeWidth={2}
              />
            ) : null}
          </Group>
        </Layer>
        <Layer listening={false}>
          {highlightShapes.map((shape) =>
            shape.points ? (
              <Group key={`highlight-${shape.id}`}>
                <Line
                  points={shape.points}
                  stroke="rgba(99, 230, 190, 0.25)"
                  strokeWidth={9}
                  lineCap="round"
                  lineJoin="round"
                />
                <Line
                  dash={[7, 5]}
                  points={shape.points}
                  stroke="#63e6be"
                  strokeWidth={2.5}
                />
              </Group>
            ) : (
              <Group key={`highlight-${shape.id}`}>
                {shape.point ? (
                  <>
                    <Circle
                      x={shape.point.x}
                      y={shape.point.y}
                      radius={13}
                      stroke="rgba(99, 230, 190, 0.3)"
                      strokeWidth={6}
                    />
                    <Circle
                      x={shape.point.x}
                      y={shape.point.y}
                      radius={11}
                      dash={[5, 4]}
                      stroke="#63e6be"
                      strokeWidth={2}
                    />
                  </>
                ) : null}
              </Group>
            )
          )}
        </Layer>
      </Stage>
    </div>
  );
}

function AnalysisStat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded border border-white/10 bg-white/[0.05] px-1.5 py-1.5">
      <p className="text-[10px] uppercase text-white/40">{label}</p>
      <p className="mt-1 text-sm font-semibold text-white">{value}</p>
    </div>
  );
}

function SnapIndicator({ preview }: { preview: SnapPreview }) {
  if (preview.type === "roundabout") {
    return (
      <Circle
        dash={[5, 5]}
        fill="rgba(245, 197, 66, 0.16)"
        radius={18}
        stroke="#f5c542"
        strokeWidth={2}
        x={preview.center.x}
        y={preview.center.y}
      />
    );
  }

  // Intersection snaps draw as an open ring so exact crossings read
  // differently from endpoint/segment connections; all previews keep the
  // #f5c542 accent on graphite.
  if (preview.snapKind === "intersection") {
    return (
      <Circle
        dash={[3, 3]}
        fill="rgba(16, 19, 17, 0.35)"
        radius={9}
        stroke="#f5c542"
        strokeWidth={2.5}
        x={preview.point.x}
        y={preview.point.y}
      />
    );
  }

  return (
    <Circle
      fill="#f5c542"
      opacity={0.86}
      radius={6}
      stroke="#101311"
      strokeWidth={2}
      x={preview.point.x}
      y={preview.point.y}
    />
  );
}


function getSnapPreview(
  tool: Tool,
  start: Point,
  end: Point,
  roads: ProjectedRoad[],
  roundaboutSnaps: RoundaboutSnap[],
  projectMapPoint: (point: MapPoint) => Point,
  unprojectScreenPoint: (point: Point) => MapPoint,
  snapTargets: readonly SnapTarget[] = [],
  getZoom: () => number = () => 18
): SnapPreview | null {
  const snapConfig = {
    latitudeDegrees: unprojectScreenPoint(end).lat,
    screenThresholdPx: snapDistance,
    zoom: getZoom()
  };

  // Network continuity first: connect to exact nodes — OSM endpoints and
  // intersections, proposal object geometry, roundabout circumference — so
  // new lines join the network rather than merely approaching it.
  if (tool === "road" || tool === "bike" || tool === "sidewalk") {
    const startMap = unprojectScreenPoint(start);
    const endMap = unprojectScreenPoint(end);
    const startNode =
      resolveSnap({ map: startMap, screen: start }, snapTargets, {
        ...snapConfig,
        latitudeDegrees: startMap.lat
      }) ?? undefined;
    const endNode = resolveSnap({ map: endMap, screen: end }, snapTargets, snapConfig) ?? undefined;
    const startIsNode = startNode !== undefined && startNode.target.kind !== "segment";
    const endIsNode = endNode !== undefined && endNode.target.kind !== "segment";

    if (startIsNode || endIsNode) {
      const nodeSnap = endIsNode ? endNode : startNode;
      const path = [
        startIsNode ? startNode!.mapPoint : startMap,
        endIsNode ? endNode!.mapPoint : endMap
      ];
      const points = path.flatMap((point) => {
        const projected = projectMapPoint(point);

        return [projected.x, projected.y];
      });

      return {
        object: {
          id: "draft-node-snapped-line",
          points,
          snapped: true,
          type: tool
        },
        path,
        point: nodeSnap?.screenPoint ?? end,
        snapKind: nodeSnap?.kind,
        type: "line"
      };
    }
  }

  if (tool === "road" || tool === "bike" || tool === "sidewalk") {
    const startRoundaboutSnap = getNearestRoundaboutSnap(start, roundaboutSnaps);
    const endRoundaboutSnap = getNearestRoundaboutSnap(end, roundaboutSnaps);

    if (startRoundaboutSnap || endRoundaboutSnap) {
      const startSnap = startRoundaboutSnap ?? getNearestRoadSnap(start, roads);
      const endSnap = endRoundaboutSnap ?? getNearestRoadSnap(end, roads);
      const path = [
        startSnap?.mapPoint ?? unprojectScreenPoint(start),
        endSnap?.mapPoint ?? unprojectScreenPoint(end)
      ];
      const points = path.flatMap((point) => {
        const projected = projectMapPoint(point);

        return [projected.x, projected.y];
      });

      return {
        object: {
          id: "draft-roundabout-snapped-line",
          points,
          snapped: true,
          type: tool
        },
        path,
        point: (endRoundaboutSnap ?? startRoundaboutSnap)?.point ?? end,
        type: "line"
      };
    }

    const startSnap = getNearestRoadSnap(start, roads);
    const endSnap = getNearestRoadSnap(end, roads);

    if (!startSnap || !endSnap || startSnap.road.id !== endSnap.road.id) {
      return null;
    }

    const path = getRoadPathBetweenSnaps(startSnap, endSnap);
    const points = path.flatMap((point) => {
      const projected = projectMapPoint(point);

      return [projected.x, projected.y];
    });

    return {
      object: {
        id: "draft-snapped-line",
        points,
        snapped: true,
        type: tool
      },
      path,
      point: endSnap.point,
      type: "line"
    };
  }

  if (tool === "crossing") {
    const midpoint = getMidpoint(start, end);
    const midpointMap = unprojectScreenPoint(midpoint);

    // Prefer a perpendicular alignment across the full target carriageway:
    // resolveSnap reports interior projections as "perpendicular" on request
    // and carries the segment's screen geometry for exact endpoints.
    const perpendicular =
      resolveSnap(
        { map: midpointMap, screen: midpoint },
        snapTargets,
        { ...snapConfig, latitudeDegrees: midpointMap.lat },
        { interiorSnapKind: "perpendicular" }
      ) ?? undefined;

    if (perpendicular && perpendicular.target.kind === "segment") {
      const length = Math.max(30, getDistance(start, end));
      const tangent = normalizePoint({
        x: perpendicular.target.screenEnd.x - perpendicular.target.screenStart.x,
        y: perpendicular.target.screenEnd.y - perpendicular.target.screenStart.y
      });
      const normal = normalizePoint({ x: -tangent.y, y: tangent.x });
      const crossingStart = {
        x: perpendicular.screenPoint.x - normal.x * (length / 2),
        y: perpendicular.screenPoint.y - normal.y * (length / 2)
      };
      const crossingEnd = {
        x: perpendicular.screenPoint.x + normal.x * (length / 2),
        y: perpendicular.screenPoint.y + normal.y * (length / 2)
      };

      return {
        end: crossingEnd,
        object: {
          end: crossingEnd,
          id: "draft-snapped-crossing",
          start: crossingStart,
          type: "crossing"
        },
        point: perpendicular.screenPoint,
        snapKind: "perpendicular",
        start: crossingStart,
        type: "crossing"
      };
    }

    const snap = getNearestRoadSnap(midpoint, roads);
    if (!snap) {
      return null;
    }

    const length = Math.max(30, getDistance(start, end));
    const normal = normalizePoint({ x: -snap.tangent.y, y: snap.tangent.x });
    const crossingStart = {
      x: snap.point.x - normal.x * (length / 2),
      y: snap.point.y - normal.y * (length / 2)
    };
    const crossingEnd = {
      x: snap.point.x + normal.x * (length / 2),
      y: snap.point.y + normal.y * (length / 2)
    };

    return {
      end: crossingEnd,
      object: {
        end: crossingEnd,
        id: "draft-snapped-crossing",
        start: crossingStart,
        type: "crossing"
      },
      point: snap.point,
      start: crossingStart,
      type: "crossing"
    };
  }

  if (tool === "roundabout") {
    const vertex = getNearestRoadVertex(start, roads);
    if (!vertex) {
      return null;
    }

    return {
      center: vertex.point,
      centerMap: vertex.mapPoint,
      object: {
        center: vertex.point,
        id: "draft-snapped-roundabout",
        radius: Math.max(12, getDistance(start, end)),
        type: "roundabout"
      },
      type: "roundabout"
    };
  }

  return null;
}

function getNearestRoadSnap(point: Point, roads: ProjectedRoad[]): RoadSnap | null {
  let nearest: RoadSnap | null = null;

  for (const road of roads) {
    for (let index = 0; index < road.points.length - 1; index += 1) {
      const start = road.points[index];
      const end = road.points[index + 1];
      const closest = getClosestPointOnSegment(point, start, end);

      if (!nearest || closest.distance < nearest.distance) {
        nearest = {
          distance: closest.distance,
          mapPoint: interpolateMapPoint(road.geometry[index], road.geometry[index + 1], closest.t),
          point: closest.point,
          road,
          segmentIndex: index,
          tangent: normalizePoint({
            x: end.x - start.x,
            y: end.y - start.y
          })
        };
      }
    }
  }

  return nearest && nearest.distance <= snapDistance ? nearest : null;
}

function getNearestRoadVertex(point: Point, roads: ProjectedRoad[]) {
  let nearest: { distance: number; mapPoint: MapPoint; point: Point } | null = null;

  for (const road of roads) {
    for (let index = 0; index < road.points.length; index += 1) {
      const candidate = road.points[index];
      const distance = getDistance(point, candidate);

      if (!nearest || distance < nearest.distance) {
        nearest = {
          distance,
          mapPoint: road.geometry[index],
          point: candidate
        };
      }
    }
  }

  return nearest && nearest.distance <= snapDistance + 10 ? nearest : null;
}

function getRoundaboutSnapPoints(
  objects: DrawingObjectV1[],
  projectMapPoint: (point: MapPoint) => Point,
  unprojectScreenPoint: (point: Point) => MapPoint,
  converter: PixelMetreConverter
) {
  const snapPoints: RoundaboutSnap[] = [];

  for (const object of objects) {
    if (object.type !== "roundabout") {
      continue;
    }

    const centerMap = object.geometry.point;
    const center = projectMapPoint(centerMap);
    const pixelRadius = Math.max(
      MIN_ROUNDABOUT_RADIUS_PX,
      converter.metresToPixels(object.properties.inscribedCircleDiameterMetres / 2, centerMap)
    );

    for (let index = 0; index < 8; index += 1) {
      const angle = (Math.PI * 2 * index) / 8;
      const point = {
        x: center.x + Math.cos(angle) * pixelRadius,
        y: center.y + Math.sin(angle) * pixelRadius
      };

      snapPoints.push({
        distance: 0,
        mapPoint: unprojectScreenPoint(point),
        point,
        roundaboutId: object.id
      });
    }
  }

  return snapPoints;
}

function getNearestRoundaboutSnap(point: Point, snapPoints: RoundaboutSnap[]) {
  let nearest: RoundaboutSnap | null = null;

  for (const snapPoint of snapPoints) {
    const distance = getDistance(point, snapPoint.point);

    if (!nearest || distance < nearest.distance) {
      nearest = {
        ...snapPoint,
        distance
      };
    }
  }

  return nearest && nearest.distance <= snapDistance + 12 ? nearest : null;
}

function getRoadPathBetweenSnaps(start: RoadSnap, end: RoadSnap) {
  const road = start.road;
  const path: MapPoint[] = [start.mapPoint];

  if (start.segmentIndex <= end.segmentIndex) {
    for (let index = start.segmentIndex + 1; index <= end.segmentIndex; index += 1) {
      path.push(road.geometry[index]);
    }
  } else {
    for (let index = start.segmentIndex; index > end.segmentIndex; index -= 1) {
      path.push(road.geometry[index]);
    }
  }

  path.push(end.mapPoint);

  return path;
}

function buildGraphAnalysis(roads: OsmRoad[], objects: DrawingObjectV1[]): GraphAnalysis {
  const graph = new UndirectedGraph<RoadGraphNode, RoadGraphEdge>();
  const edges: RoadGraphEdge[] = [];
  const sidewalkPaths = objects
    .filter((object): object is Extract<DrawingObjectV1, { type: "footpath" }> => object.type === "footpath")
    .map((object) => object.geometry.points)
    .filter((path) => path.length >= 2);

  for (const road of roads) {
    if (road.geometry.length < 2 || isNonRoadPath(road.kind)) {
      continue;
    }

    for (let index = 0; index < road.geometry.length - 1; index += 1) {
      const start = road.geometry[index];
      const end = road.geometry[index + 1];
      const lengthMeters = getMapDistanceMeters(start, end);

      if (lengthMeters < 1) {
        continue;
      }

      const startId = getGraphNodeId(start);
      const endId = getGraphNodeId(end);
      if (startId === endId) {
        continue;
      }

      const hasSidewalk = roadImpliesSidewalk(road) || hasNearbySidewalk(start, end, sidewalkPaths);
      const edge: RoadGraphEdge = {
        end,
        hasSidewalk,
        kind: road.kind,
        lengthMeters,
        roadId: road.id,
        segmentIndex: index,
        start,
        weight: lengthMeters
      };

      graph.mergeNode(startId, { point: start });
      graph.mergeNode(endId, { point: end });
      graph.mergeUndirectedEdgeWithKey(`${road.id}-${index}`, startId, endId, edge);
      edges.push(edge);
    }
  }

  const deadEndNodes = graph.nodes().filter((nodeId) => graph.degree(nodeId) <= 1);
  const deadEndSet = new Set(deadEndNodes);
  const deadEndEdges = edges.filter((edge) => deadEndSet.has(getGraphNodeId(edge.start)) || deadEndSet.has(getGraphNodeId(edge.end)));
  const sidewalkEdgeCount = edges.filter((edge) => edge.hasSidewalk).length;

  return {
    deadEndEdges,
    deadEndNodes,
    graph: {
      edgeCount: graph.size,
      edges,
      graph,
      nodeCount: graph.order,
      nodeIds: graph.nodes()
    },
    sidewalkEdgeCount,
    walkabilityScore: edges.length > 0 ? Math.round((sidewalkEdgeCount / edges.length) * 100) : 0
  };
}

function getAnalysisPath(roadGraph: RoadGraph, nodeIds: string[]): AnalysisPath {
  const points = nodeIds.map((nodeId) => roadGraph.graph.getNodeAttributes(nodeId).point);
  let distanceMeters = 0;

  for (let index = 0; index < nodeIds.length - 1; index += 1) {
    const edgeAttributes = roadGraph.graph.getEdgeAttributes(nodeIds[index], nodeIds[index + 1]);
    distanceMeters += edgeAttributes.lengthMeters;
  }

  return {
    distanceMeters,
    nodeIds,
    points
  };
}

function getNearestGraphNode(
  point: Point,
  roadGraph: RoadGraph,
  projectMapPoint: (point: MapPoint) => Point
) {
  let nearest: { distance: number; nodeId: string } | null = null;

  for (const nodeId of roadGraph.nodeIds) {
    const nodePoint = projectMapPoint(roadGraph.graph.getNodeAttributes(nodeId).point);
    const distance = getDistance(point, nodePoint);

    if (!nearest || distance < nearest.distance) {
      nearest = { distance, nodeId };
    }
  }

  return nearest && nearest.distance <= 42 ? nearest.nodeId : null;
}

function getMapLinePoints(points: MapPoint[], projectMapPoint: (point: MapPoint) => Point) {
  return points.flatMap((point) => {
    const projected = projectMapPoint(point);

    return [projected.x, projected.y];
  });
}

function getGraphNodeId(point: MapPoint) {
  return `${point.lat.toFixed(6)},${point.lng.toFixed(6)}`;
}

function roadImpliesSidewalk(road: OsmRoad) {
  const sidewalkTag = road.tags?.sidewalk;

  return (
    ["footway", "path", "pedestrian", "steps", "living_street"].includes(road.kind) ||
    Boolean(sidewalkTag && !["no", "none", "separate"].includes(sidewalkTag))
  );
}

function isNonRoadPath(kind: string) {
  return ["construction", "proposed", "abandoned", "raceway"].includes(kind);
}

function hasNearbySidewalk(start: MapPoint, end: MapPoint, sidewalkPaths: MapPoint[][]) {
  const midpoint = {
    lat: (start.lat + end.lat) / 2,
    lng: (start.lng + end.lng) / 2
  };

  return sidewalkPaths.some((path) =>
    path.some((point, index) => {
      if (index === path.length - 1) {
        return false;
      }

      return getPointToSegmentDistanceMeters(midpoint, path[index], path[index + 1]) <= 18;
    })
  );
}

function getPointToSegmentDistanceMeters(point: MapPoint, start: MapPoint, end: MapPoint) {
  const referenceLat = ((point.lat + start.lat + end.lat) / 3) * (Math.PI / 180);
  const pointXY = mapPointToLocalMeters(point, referenceLat);
  const startXY = mapPointToLocalMeters(start, referenceLat);
  const endXY = mapPointToLocalMeters(end, referenceLat);
  const closest = getClosestPointOnSegment(pointXY, startXY, endXY);

  return closest.distance;
}

function mapPointToLocalMeters(point: MapPoint, referenceLat: number): Point {
  const metersPerDegree = 111320;

  return {
    x: point.lng * metersPerDegree * Math.cos(referenceLat),
    y: point.lat * metersPerDegree
  };
}

function formatDistance(distanceMeters: number) {
  if (distanceMeters >= 1000) {
    return `${(distanceMeters / 1000).toFixed(2)} km`;
  }

  return `${Math.round(distanceMeters)} m`;
}

function getRenderedObject(
  object: DrawingObjectV1,
  projectMapPoint: (point: MapPoint) => Point,
  converter: PixelMetreConverter
): RenderedDrawingObject {
  if (object.type === "roundabout") {
    const center = projectMapPoint(object.geometry.point);

    return {
      center,
      id: object.id,
      metResPerPixel: converter.metresPerPixel(object.geometry.point),
      properties: {
        inscribedCircleDiameterMetres: object.properties.inscribedCircleDiameterMetres,
        lanes: object.properties.lanes
      },
      radius: Math.max(
        MIN_ROUNDABOUT_RADIUS_PX,
        converter.metresToPixels(object.properties.inscribedCircleDiameterMetres / 2, object.geometry.point)
      ),
      type: "roundabout"
    };
  }

  if (object.type === "traffic-signal") {
    return {
      id: object.id,
      metResPerPixel: converter.metresPerPixel(object.geometry.point),
      point: projectMapPoint(object.geometry.point),
      properties: { kind: object.properties.kind },
      type: "signal"
    };
  }

  if (object.type === "crossing") {
    const anchor = object.geometry.point;
    const start = projectMapPoint(anchor);
    const { bearingDegrees, lengthMetres, widthMetres } = object.properties;
    const lengthPx = Math.max(MIN_CROSSING_LENGTH_PX, converter.metresToPixels(lengthMetres, anchor));
    // Bearing runs clockwise from north; screen y grows southwards.
    const bearingRadians = (bearingDegrees * Math.PI) / 180;
    const direction = { x: Math.sin(bearingRadians), y: -Math.cos(bearingRadians) };

    return {
      end: {
        x: start.x + direction.x * lengthPx,
        y: start.y + direction.y * lengthPx
      },
      id: object.id,
      metResPerPixel: converter.metresPerPixel(anchor),
      properties: { control: object.properties.control },
      start,
      strokeWidth: Math.max(MIN_CROSSING_WIDTH_PX, converter.metresToPixels(widthMetres, anchor)),
      type: "crossing"
    };
  }

  const points = object.geometry.points;
  const midAnchor = points[Math.floor(points.length / 2)] ?? points[0];
  const widthPx = Math.max(
    object.type === "road" ? MIN_ROAD_WIDTH_PX : MIN_PATH_WIDTH_PX,
    converter.metresToPixels(getLineObjectWidthMetres(object), midAnchor)
  );

  if (object.type === "road") {
    return {
      id: object.id,
      metResPerPixel: midAnchor ? converter.metresPerPixel(midAnchor) : undefined,
      points: getProjectedPoints(points, projectMapPoint),
      properties: { ...object.properties },
      strokeWidth: widthPx,
      type: "road"
    };
  }

  if (object.type === "cycleway") {
    return {
      id: object.id,
      metResPerPixel: midAnchor ? converter.metresPerPixel(midAnchor) : undefined,
      points: getProjectedPoints(points, projectMapPoint),
      properties: { ...object.properties },
      strokeWidth: widthPx,
      type: "bike"
    };
  }

  return {
    id: object.id,
    metResPerPixel: midAnchor ? converter.metresPerPixel(midAnchor) : undefined,
    points: getProjectedPoints(points, projectMapPoint),
    properties: { ...object.properties },
    strokeWidth: widthPx,
    type: "sidewalk"
  };
}

function getProjectedPoints(points: MapPoint[], projectMapPoint: (point: MapPoint) => Point): number[] {
  return points.flatMap((point) => {
    const projected = projectMapPoint(point);

    return [projected.x, projected.y];
  });
}

function getDraftObject(tool: Tool, start: Point, end: Point): RenderedDrawingObject {
  if (tool === "roundabout") {
    return {
      center: start,
      id: "draft-roundabout",
      radius: Math.max(12, getDistance(start, end)),
      type: "roundabout"
    };
  }

  if (tool === "crossing") {
    return {
      end,
      id: "draft-crossing",
      start,
      type: "crossing"
    };
  }

  if (tool === "bike") {
    return {
      id: "draft-bike",
      points: [start.x, start.y, end.x, end.y],
      snapped: false,
      type: "bike"
    };
  }

  if (tool === "sidewalk") {
    return {
      id: "draft-sidewalk",
      points: [start.x, start.y, end.x, end.y],
      snapped: false,
      type: "sidewalk"
    };
  }

  return {
    id: "draft-road",
    points: [start.x, start.y, end.x, end.y],
    snapped: false,
    type: "road"
  };
}

function getMidpoint(start: Point, end: Point): Point {
  return {
    x: (start.x + end.x) / 2,
    y: (start.y + end.y) / 2
  };
}

function getVector(start: Point, end: Point): Point {
  return {
    x: end.x - start.x,
    y: end.y - start.y
  };
}

/** Approximate real-world length of a map polyline, in metres. */
function getPolylineLengthMetres(points: MapPoint[]): number {
  let total = 0;

  for (let index = 1; index < points.length; index += 1) {
    total += getMapDistanceMeters(points[index - 1], points[index]);
  }

  return total;
}

function createId(type: DrawingObject["type"]) {
  return `${type}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function getToolLabel(tool: Tool) {
  return tools.find((item) => item.id === tool)?.label ?? "Tool";
}
