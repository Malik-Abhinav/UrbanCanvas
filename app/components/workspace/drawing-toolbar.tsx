"use client";

import { useState } from "react";
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
  Waypoints
} from "lucide-react";

export type Tool = "select" | "road" | "bike" | "sidewalk" | "crossing" | "roundabout" | "signal" | "erase";

export const drawingTools: Array<{
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

type DrawingToolbarProps = {
  activeTool: Tool;
  onSelectTool: (id: Tool) => void;
  canUndo: boolean;
  canRedo: boolean;
  onUndo: () => void;
  onRedo: () => void;
  historyTruncated: boolean;
};

function getToolLabel(tool: Tool) {
  return drawingTools.find((item) => item.id === tool)?.label ?? "Tool";
}

/** Floating drawing-tool dock with undo/redo and hover hints. */
export default function DrawingToolbar({
  activeTool,
  canRedo,
  canUndo,
  historyTruncated,
  onRedo,
  onSelectTool,
  onUndo
}: DrawingToolbarProps) {
  const [hoveredTool, setHoveredTool] = useState<Tool | null>(null);

  return (
    <>
      <div className="absolute left-3 top-3 z-10 flex flex-col gap-2 rounded border border-white/20 bg-[#111612]/85 p-2 shadow-xl backdrop-blur max-sm:bottom-3 max-sm:left-1/2 max-sm:top-auto max-sm:-translate-x-1/2 max-sm:flex-row">
        {drawingTools.map(({ Icon, id, label }) => (
          <button
            aria-label={label}
            aria-pressed={activeTool === id}
            className={`flex h-11 w-11 items-center justify-center rounded border transition ${
              activeTool === id
                ? "border-[#f5c542] bg-[#f5c542] text-[#111612]"
                : "border-white/15 bg-white/10 text-white hover:border-[#f5c542]/70"
            }`}
            key={id}
            onMouseEnter={() => setHoveredTool(id)}
            onMouseLeave={() => setHoveredTool(null)}
            onClick={() => onSelectTool(id)}
            title={label}
            type="button"
          >
            <Icon size={18} />
          </button>
        ))}
        <div className="my-1 h-px bg-white/15 max-sm:mx-1 max-sm:my-0 max-sm:h-11 max-sm:w-px" />
        <button
          aria-label="Undo"
          className="flex h-11 w-11 items-center justify-center rounded border border-white/15 bg-white/10 text-white transition hover:border-[#f5c542]/70 disabled:cursor-not-allowed disabled:opacity-40"
          disabled={!canUndo}
          onClick={onUndo}
          title="Undo"
          type="button"
        >
          <RotateCcw size={18} />
        </button>
        <button
          aria-label="Redo"
          className="flex h-11 w-11 items-center justify-center rounded border border-white/15 bg-white/10 text-white transition hover:border-[#f5c542]/70 disabled:cursor-not-allowed disabled:opacity-40"
          disabled={!canRedo}
          onClick={onRedo}
          title="Redo"
          type="button"
        >
          <RotateCw size={18} />
        </button>
        {historyTruncated ? (
          <span
            aria-label="Undo history limit reached. The latest 500 changes remain undoable; older changes cannot be undone."
            className="max-lg:w-10 rounded border border-[#f5c542]/40 bg-[#f5c542]/10 px-1 py-1 text-center text-[9px] font-semibold leading-tight text-[#ffe6a1] lg:w-10"
            role="status"
            title="The latest 500 changes remain undoable; older changes cannot be undone."
          >
            500 max
          </span>
        ) : null}
      </div>

      {hoveredTool ? (
        <div className="absolute left-[4.75rem] top-3 z-20 hidden rounded border border-white/20 bg-[#111612]/95 px-3 py-2 text-sm font-medium text-white shadow-xl sm:block">
          {getToolLabel(hoveredTool)}
        </div>
      ) : null}
    </>
  );
}
