"use client";

import { useMemo, useRef, useState } from "react";
import type { KeyboardEvent, WheelEvent } from "react";
import { Circle, Group, Layer, Line, Rect, Stage, Text } from "react-konva";
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
  Waypoints,
  ZoomIn,
  ZoomOut
} from "lucide-react";

type SatelliteOverlayProps = {
  height: number;
  mapRevision: number;
  onMapPointToScreen: (point: MapPoint) => Point;
  onMapPan: (delta: Point) => void;
  onScreenPointToMap: (point: Point) => MapPoint;
  onMapZoom: (direction: "in" | "out" | "reset") => void;
  width: number;
};

type MapPoint = {
  lat: number;
  lng: number;
};

type Point = {
  x: number;
  y: number;
};

type Tool = "select" | "road" | "bike" | "sidewalk" | "crossing" | "roundabout" | "signal" | "erase";

type DrawingObject =
  | {
      id: string;
      type: "road" | "bike" | "sidewalk";
      anchor: MapPoint;
      pixelVector: Point;
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

type RenderedDrawingObject =
  | {
      id: string;
      type: "road" | "bike" | "sidewalk";
      start: Point;
      end: Point;
    }
  | {
      id: string;
      type: "crossing";
      start: Point;
      end: Point;
    }
  | {
      center: Point;
      id: string;
      radius: number;
      type: "roundabout";
    }
  | {
      id: string;
      point: Point;
      type: "signal";
    };

const gridSize = 32;
const defaultRoadWidth = 22;
const bikeLaneWidth = 10;
const sidewalkWidth = 6;

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
  height,
  mapRevision,
  onMapPan,
  onMapPointToScreen,
  onMapZoom,
  onScreenPointToMap,
  width
}: SatelliteOverlayProps) {
  const stageRef = useRef<Konva.Stage | null>(null);
  const panLastPointRef = useRef<Point | null>(null);
  const [activeTool, setActiveTool] = useState<Tool>("select");
  const [hoveredTool, setHoveredTool] = useState<Tool | null>(null);
  const [objects, setObjects] = useState<DrawingObject[]>([]);
  const [redoStack, setRedoStack] = useState<DrawingObject[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [draftStart, setDraftStart] = useState<Point | null>(null);
  const [draftEnd, setDraftEnd] = useState<Point | null>(null);

  const grid = useMemo(() => {
    const verticalLines = Math.ceil(width / gridSize);
    const horizontalLines = Math.ceil(height / gridSize);

    return { horizontalLines, verticalLines };
  }, [height, width]);
  const renderedObjects = useMemo(() => {
    void mapRevision;

    return objects.map((object) => getRenderedObject(object, onMapPointToScreen));
  }, [mapRevision, objects, onMapPointToScreen]);

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
      pushObject({
        anchor: onScreenPointToMap(draftStart),
        id: createId(activeTool),
        pixelVector: getVector(draftStart, draftEnd),
        type: activeTool
      });
    }

    if (activeTool === "crossing") {
      pushObject({
        anchor: onScreenPointToMap(draftStart),
        id: createId("crossing"),
        pixelVector: getVector(draftStart, draftEnd),
        type: "crossing"
      });
    }

    if (activeTool === "roundabout") {
      pushObject({
        center: onScreenPointToMap(draftStart),
        id: createId("roundabout"),
        pixelRadius: Math.max(12, distance),
        type: "roundabout"
      });
    }

    setDraftStart(null);
    setDraftEnd(null);
  }

  function pushObject(object: DrawingObject) {
    setObjects((current) => [...current, object]);
    setRedoStack([]);
    setSelectedId(object.id);
  }

  function removeObject(id: string) {
    setObjects((current) => current.filter((object) => object.id !== id));
    setSelectedId((current) => (current === id ? null : current));
    setRedoStack([]);
  }

  function undo() {
    setObjects((current) => {
      const removed = current.at(-1);
      if (!removed) {
        return current;
      }

      setRedoStack((redo) => [...redo, removed]);
      setSelectedId(null);

      return current.slice(0, -1);
    });
    setDraftStart(null);
    setDraftEnd(null);
  }

  function redo() {
    setRedoStack((current) => {
      const restored = current.at(-1);
      if (!restored) {
        return current;
      }

      setObjects((objects) => [...objects, restored]);
      setSelectedId(restored.id);

      return current.slice(0, -1);
    });
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
          disabled={objects.length === 0}
          onClick={undo}
          title="Undo"
          type="button"
        >
          <RotateCcw size={18} />
        </button>
        <button
          aria-label="Redo"
          className="flex h-10 w-10 items-center justify-center rounded border border-white/15 bg-white/10 text-white transition hover:border-[#f5c542]/70 disabled:cursor-not-allowed disabled:opacity-40"
          disabled={redoStack.length === 0}
          onClick={redo}
          title="Redo"
          type="button"
        >
          <RotateCw size={18} />
        </button>
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

      <div className="absolute right-3 top-3 z-10 max-w-72 rounded border border-white/20 bg-[#101311]/85 px-3 py-2 text-sm text-white/80 shadow-xl backdrop-blur">
        {getToolHint(activeTool)} Scroll to zoom the satellite image without resizing the selected area.
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

          {renderedObjects.map((object) => (
            <DrawingObjectShape
              isSelected={object.id === selectedId}
              key={object.id}
              object={object}
              onClick={(event) => handleObjectClick(event, object.id)}
            />
          ))}

          {draftStart && draftEnd ? (
            <DrawingObjectShape
              isDraft
              isSelected={false}
              object={getDraftObject(activeTool, draftStart, draftEnd)}
            />
          ) : null}
        </Layer>
      </Stage>
    </div>
  );
}

function DrawingObjectShape({
  isDraft = false,
  isSelected,
  object,
  onClick
}: {
  isDraft?: boolean;
  isSelected: boolean;
  object: RenderedDrawingObject;
  onClick?: (event: Konva.KonvaEventObject<MouseEvent>) => void;
}) {
  const opacity = isDraft ? 0.72 : 1;
  const selectionStroke = isSelected ? "#f5c542" : "transparent";

  if (object.type === "road") {
    return (
      <Group opacity={opacity} onClick={onClick}>
        <Line
          lineCap="round"
          points={[object.start.x, object.start.y, object.end.x, object.end.y]}
          stroke="#222729"
          strokeWidth={defaultRoadWidth}
        />
        <Line
          dash={[12, 10]}
          lineCap="round"
          points={[object.start.x, object.start.y, object.end.x, object.end.y]}
          stroke="#d8d2c4"
          strokeWidth={2}
        />
        {isSelected ? <SelectionLine end={object.end} start={object.start} width={defaultRoadWidth + 7} /> : null}
      </Group>
    );
  }

  if (object.type === "bike") {
    return (
      <Group opacity={opacity} onClick={onClick}>
        <Line
          lineCap="round"
          points={[object.start.x, object.start.y, object.end.x, object.end.y]}
          stroke="#22c55e"
          strokeWidth={bikeLaneWidth}
        />
        <Line
          dash={[6, 7]}
          lineCap="round"
          points={[object.start.x, object.start.y, object.end.x, object.end.y]}
          stroke="#ddffe9"
          strokeWidth={1.5}
        />
        {isSelected ? <SelectionLine end={object.end} start={object.start} width={bikeLaneWidth + 7} /> : null}
      </Group>
    );
  }

  if (object.type === "sidewalk") {
    return (
      <Group opacity={opacity} onClick={onClick}>
        <Line
          lineCap="round"
          points={[object.start.x, object.start.y, object.end.x, object.end.y]}
          stroke="#e5e7eb"
          strokeWidth={sidewalkWidth}
        />
        {isSelected ? <SelectionLine end={object.end} start={object.start} width={sidewalkWidth + 7} /> : null}
      </Group>
    );
  }

  if (object.type === "crossing") {
    const { angle, length, midpoint } = getSegmentMetrics(object.start, object.end);

    return (
      <Group onClick={onClick} opacity={opacity} rotation={angle} x={midpoint.x} y={midpoint.y}>
        <Rect fill="#1f2425" height={28} offsetX={length / 2} offsetY={14} width={length} />
        {[-10, -2, 6].map((x) => (
          <Rect fill="#f8fafc" height={24} key={x} offsetY={12} width={4} x={x} y={0} />
        ))}
        <Rect
          height={34}
          offsetX={length / 2}
          offsetY={17}
          stroke={selectionStroke}
          strokeWidth={isSelected ? 2 : 0}
          width={length}
        />
      </Group>
    );
  }

  if (object.type === "roundabout") {
    return (
      <Group onClick={onClick} opacity={opacity}>
        <Circle
          fill="rgba(31, 36, 37, 0.78)"
          radius={object.radius}
          stroke="#d8d2c4"
          strokeWidth={4}
          x={object.center.x}
          y={object.center.y}
        />
        <Circle
          fill="rgba(16, 19, 17, 0.75)"
          radius={Math.max(8, object.radius * 0.42)}
          stroke="#f5c542"
          strokeWidth={isSelected ? 3 : 1.5}
          x={object.center.x}
          y={object.center.y}
        />
        {[0, 90, 180, 270].map((rotation) => (
          <Line
            key={rotation}
            points={[object.center.x, object.center.y - object.radius, object.center.x, object.center.y - object.radius - 20]}
            rotation={rotation}
            stroke="#1f2425"
            strokeWidth={10}
          />
        ))}
      </Group>
    );
  }

  if (object.type === "signal") {
    return (
      <Group onClick={onClick} opacity={opacity} x={object.point.x} y={object.point.y}>
        <Circle fill="#60a5fa" radius={13} stroke={isSelected ? "#f5c542" : "#dbeafe"} strokeWidth={2} />
        <Text align="center" fill="#101311" fontSize={14} fontStyle="bold" text="T" width={26} x={-13} y={-8} />
      </Group>
    );
  }

  return null;
}

function SelectionLine({ end, start, width }: { end: Point; start: Point; width: number }) {
  return (
    <Line
      lineCap="round"
      points={[start.x, start.y, end.x, end.y]}
      stroke="#f5c542"
      strokeWidth={width}
      opacity={0.34}
    />
  );
}

function getRenderedObject(
  object: DrawingObject,
  projectMapPoint: (point: MapPoint) => Point
): RenderedDrawingObject {
  if (object.type === "roundabout") {
    const center = projectMapPoint(object.center);

    return {
      center,
      id: object.id,
      radius: object.pixelRadius,
      type: "roundabout"
    };
  }

  if (object.type === "signal") {
    return {
      id: object.id,
      point: projectMapPoint(object.point),
      type: "signal"
    };
  }

  const start = projectMapPoint(object.anchor);

  return {
    id: object.id,
    end: {
      x: start.x + object.pixelVector.x,
      y: start.y + object.pixelVector.y
    },
    start,
    type: object.type
  };
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
      end,
      id: "draft-bike",
      start,
      type: "bike"
    };
  }

  if (tool === "sidewalk") {
    return {
      end,
      id: "draft-sidewalk",
      start,
      type: "sidewalk"
    };
  }

  return {
    end,
    id: "draft-road",
    start,
    type: "road"
  };
}

function getSegmentMetrics(start: Point, end: Point) {
  const dx = end.x - start.x;
  const dy = end.y - start.y;

  return {
    angle: (Math.atan2(dy, dx) * 180) / Math.PI,
    length: Math.max(26, Math.sqrt(dx * dx + dy * dy)),
    midpoint: {
      x: (start.x + end.x) / 2,
      y: (start.y + end.y) / 2
    }
  };
}

function getDistance(start: Point, end: Point) {
  return Math.sqrt((end.x - start.x) ** 2 + (end.y - start.y) ** 2);
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

function getToolHint(tool: Tool) {
  if (tool === "select") {
    return "Drag empty space to pan the satellite image. Select objects to delete or edit.";
  }

  if (tool === "signal") {
    return "Click to place a traffic signal.";
  }

  if (tool === "erase") {
    return "Click any drawn proposal to erase it.";
  }

  if (tool === "roundabout") {
    return "Click and drag from center to set roundabout radius.";
  }

  return "Click and drag to draw on the satellite image.";
}

function getToolLabel(tool: Tool) {
  return tools.find((item) => item.id === tool)?.label ?? "Tool";
}
