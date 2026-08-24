"use client";

import { UndirectedGraph } from "graphology";
import { dijkstra } from "graphology-shortest-path";
import { useEffect, useMemo, useReducer, useRef, useState } from "react";
import type { KeyboardEvent, WheelEvent } from "react";
import { Circle, Layer, Line, Rect, Stage } from "react-konva";
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
import type { DrawingObjectV1 } from "../shared/drawing-document";
import { StyledDrawingObject, type RenderedProposalObject } from "./drawing-renderer";
import {
  getClosestPointOnSegment,
  getDistance,
  getMapDistanceMeters,
  interpolateMapPoint,
  normalizePoint
} from "./canvas-geometry";

type SatelliteOverlayProps = {
  getMapZoom: () => number;
  height: number;
  initialObjects: DrawingObjectV1[];
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
      type: "line";
    }
  | {
      end: Point;
      object: RenderedDrawingObject;
      point: Point;
      start: Point;
      type: "crossing";
    }
  | {
      center: Point;
      centerMap: MapPoint;
      object: RenderedDrawingObject;
      type: "roundabout";
    };

const gridSize = 32;
const snapDistance = 34;

const tools: Array<{
  Icon: typeof MousePointer2;
  id: Tool;
  label: string;
}> = [
  { id: "select", label: "Select", Icon: MousePointer2 },
  { id: "road", label: "Road / Lane", Icon: SquareDashedMousePointer },
  { id: "bike", label: "Bike Lane", Icon: Bike },
  { id: "sidewalk", label: "Sidewalk", Icon: Waypoints },
  { id: "crossing", label: "Pedestrian Crossing", Icon: Slash },
  { id: "roundabout", label: "Roundabout", Icon: CircleDot },
  { id: "signal", label: "Traffic Signal", Icon: Signal },
  { id: "erase", label: "Erase", Icon: Eraser }
];

export default function SatelliteOverlay({
  getMapZoom,
  height,
  initialObjects,
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
  const [activeTool, setActiveTool] = useState<Tool>("select");
  const [hoveredTool, setHoveredTool] = useState<Tool | null>(null);
  const [history, dispatchHistory] = useReducer(historyReducer, emptyHistoryState);
  const objects = history.present;
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [draftStart, setDraftStart] = useState<Point | null>(null);
  const [draftEnd, setDraftEnd] = useState<Point | null>(null);
  const [analysisMode, setAnalysisMode] = useState<AnalysisMode>("idle");
  const [isAnalysisCollapsed, setIsAnalysisCollapsed] = useState(false);
  const [pathStartNodeId, setPathStartNodeId] = useState<string | null>(null);
  const [analysisPath, setAnalysisPath] = useState<AnalysisPath | null>(null);
  const [analysisMessage, setAnalysisMessage] = useState("Pick two road points to show the shortest path.");

  const grid = useMemo(() => {
    const verticalLines = Math.ceil(width / gridSize);
    const horizontalLines = Math.ceil(height / gridSize);

    return { horizontalLines, verticalLines };
  }, [height, width]);
  // The zoom is read lazily at render time through a ref so the converter's
  // identity stays stable; map revision bumps re-run the dependent memos.
  const getMapZoomRef = useRef(getMapZoom);
  const converter = useMemo(
    () => createPixelMetreConverter({ getZoom: () => getMapZoomRef.current() }),
    []
  );
  const migrationPixelsToMetres = useMemo(() => createMigrationPixelsToMetres(converter), [converter]);
  const renderedObjects = useMemo(() => {
    void mapRevision;

    return objects.map((object) => getRenderedObject(object, onMapPointToScreen, converter));
  }, [converter, mapRevision, objects, onMapPointToScreen]);
  const projectedRoads = useMemo(() => {
    void mapRevision;

    return osmRoads
      .filter((road) => road.geometry.length >= 2)
      .map((road) => ({
        ...road,
        points: road.geometry.map((point) => onMapPointToScreen(point))
      }));
  }, [mapRevision, onMapPointToScreen, osmRoads]);
  const roundaboutSnaps = useMemo(() => {
    void mapRevision;

    return getRoundaboutSnapPoints(objects, onMapPointToScreen, onScreenPointToMap, converter);
  }, [converter, mapRevision, objects, onMapPointToScreen, onScreenPointToMap]);
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
      onScreenPointToMap
    );
  }, [activeTool, draftEnd, draftStart, onMapPointToScreen, onScreenPointToMap, projectedRoads, roundaboutSnaps]);
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

  function handleStagePointerDown(event: Konva.KonvaEventObject<PointerEvent>) {
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

    setDraftStart(point);
    setDraftEnd(point);
  }

  function handleStagePointerMove() {
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

    setDraftEnd(point);
  }

  function handleStagePointerUp() {
    panLastPointRef.current = null;

    if (!draftStart || !draftEnd) {
      return;
    }

    const distance = getDistance(draftStart, draftEnd);
    if (distance < 6) {
      setDraftStart(null);
      setDraftEnd(null);
      return;
    }

    if (activeTool === "road" || activeTool === "bike" || activeTool === "sidewalk") {
      const snappedLine = snapPreview?.type === "line" ? snapPreview : null;

      pushObject({
        id: createId(activeTool),
        path: snappedLine?.path ?? [onScreenPointToMap(draftStart), onScreenPointToMap(draftEnd)],
        snapped: Boolean(snappedLine),
        type: activeTool
      });
    }

    if (activeTool === "crossing") {
      const crossing = snapPreview?.type === "crossing" ? snapPreview : null;
      const start = crossing?.start ?? draftStart;
      const end = crossing?.end ?? draftEnd;

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

    setDraftStart(null);
    setDraftEnd(null);
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
  }

  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "y") {
      event.preventDefault();
      panLastPointRef.current = null;
      redo();
      return;
    }

    if ((event.metaKey || event.ctrlKey) && event.shiftKey && event.key.toLowerCase() === "z") {
      event.preventDefault();
      panLastPointRef.current = null;
      redo();
      return;
    }

    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "z") {
      event.preventDefault();
      panLastPointRef.current = null;
      undo();
      return;
    }

    if ((event.key === "Backspace" || event.key === "Delete") && selectedId) {
      event.preventDefault();
      panLastPointRef.current = null;
      removeObject(selectedId);
      return;
    }

    if (event.key === "Escape") {
      setActiveTool("select");
      setAnalysisMode("idle");
      setDraftStart(null);
      setDraftEnd(null);
      panLastPointRef.current = null;
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

      {hoveredTool ? (
        <div className="absolute left-[4.75rem] top-3 z-20 rounded border border-white/20 bg-[#101311]/95 px-3 py-2 text-sm font-medium text-white shadow-xl">
          {getToolLabel(hoveredTool)}
        </div>
      ) : null}

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
          {Array.from({ length: grid.verticalLines + 1 }, (_, index) => (
            <Line
              key={`vertical-${index}`}
              points={[index * gridSize, 0, index * gridSize, height]}
              stroke="rgba(255, 255, 255, 0.18)"
              strokeWidth={1}
            />
          ))}
          {Array.from({ length: grid.horizontalLines + 1 }, (_, index) => (
            <Line
              key={`horizontal-${index}`}
              points={[0, index * gridSize, width, index * gridSize]}
              stroke="rgba(255, 255, 255, 0.18)"
              strokeWidth={1}
            />
          ))}

          {renderedDeadEndEdges.map((edge) => (
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

          {renderedAnalysisPath ? (
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

          {renderedPathStart ? (
            <Circle
              fill="#60a5fa"
              radius={8}
              stroke="#ffffff"
              strokeWidth={2}
              x={renderedPathStart.x}
              y={renderedPathStart.y}
            />
          ) : null}

          {renderedObjects.map((object) => (
            <StyledDrawingObject
              isSelected={object.id === selectedId}
              key={object.id}
              object={object}
              onClick={(event) => handleObjectClick(event, object.id)}
            />
          ))}

          {snapPreview ? <SnapIndicator preview={snapPreview} /> : null}

          {draftStart && draftEnd ? (
            <StyledDrawingObject
              isDraft
              isSelected={false}
              object={snapPreview?.object ?? getDraftObject(activeTool, draftStart, draftEnd)}
            />
          ) : null}
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
  unprojectScreenPoint: (point: Point) => MapPoint
): SnapPreview | null {
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

function createId(type: DrawingObject["type"]) {
  return `${type}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function getToolLabel(tool: Tool) {
  return tools.find((item) => item.id === tool)?.label ?? "Tool";
}
