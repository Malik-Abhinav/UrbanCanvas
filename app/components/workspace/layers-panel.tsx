"use client";

import { Eye, EyeOff } from "lucide-react";

import {
  LAYER_LEGEND,
  type LayerId,
  type LayerSettings
} from "../../layer-semantics";

type LayersPanelProps = {
  onContextOpacityChange: (value: number) => void;
  onLayerToggle: (id: LayerId) => void;
  onProposalOpacityChange: (value: number) => void;
  settings: LayerSettings;
};

type ToggleRow = {
  description: string;
  id: LayerId;
  label: string;
};

const TOGGLE_ROWS: ToggleRow[] = [
  { id: "satellite", label: "Satellite imagery", description: "Base raster under everything" },
  { id: "osmRoads", label: "OSM roads", description: "Existing street network" },
  { id: "buildings", label: "Buildings", description: "Existing building footprints" },
  { id: "openSpace", label: "Open space", description: "Parks, plazas, greens" },
  { id: "proposal", label: "Proposal", description: "Your drawn infrastructure" },
  { id: "analysis", label: "Analysis", description: "Routes and dead ends" },
  { id: "grid", label: "Grid", description: "Drawing guide grid" }
];

/**
 * Workspace layers panel. Graphite surface, warm off-white text, one accent,
 * crisp 1px separators. Presentational only — all state lives upstream so the
 * canvas and the Mapbox base stay in sync with these controls.
 */
export function LayersPanel({
  onContextOpacityChange,
  onLayerToggle,
  onProposalOpacityChange,
  settings
}: LayersPanelProps) {
  return (
    <section aria-label="Map layers" className="rounded-md border border-white/10 bg-[#1b1f1d] text-[#ece7da]">
      <header className="border-b border-white/10 px-3 py-2">
        <h2 className="text-[11px] font-semibold uppercase tracking-wider text-white/50">Layers</h2>
      </header>

      <ul>
        {TOGGLE_ROWS.map((row) => {
          const visible = settings.visible[row.id];

          return (
            <li className="border-b border-white/5 last:border-b-0" key={row.id}>
              <button
                aria-pressed={visible}
                className="flex w-full items-center gap-2 px-3 py-1.5 text-left transition hover:bg-white/[0.04]"
                data-testid={`layer-toggle-${row.id}`}
                onClick={() => onLayerToggle(row.id)}
                type="button"
              >
                {visible ? (
                  <Eye aria-hidden className="shrink-0 text-[#f5c542]" size={14} />
                ) : (
                  <EyeOff aria-hidden className="shrink-0 text-white/30" size={14} />
                )}
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-xs font-medium">{row.label}</span>
                  <span className="block truncate text-[10px] text-white/40">{row.description}</span>
                </span>
              </button>
            </li>
          );
        })}
      </ul>

      <div className="space-y-2 border-t border-white/10 px-3 py-2.5">
        <label className="block text-[10px] uppercase tracking-wide text-white/45" htmlFor="proposal-opacity">
          Proposal opacity
        </label>
        <input
          className="w-full accent-[#f5c542]"
          defaultValue={settings.proposalOpacity}
          id="proposal-opacity"
          max={1}
          min={0}
          onChange={(event) => onProposalOpacityChange(Number(event.target.value))}
          step={0.05}
          type="range"
        />
        <label className="block text-[10px] uppercase tracking-wide text-white/45" htmlFor="context-opacity">
          Context opacity
        </label>
        <input
          className="w-full accent-[#f5c542]"
          defaultValue={settings.contextOpacity}
          id="context-opacity"
          max={1}
          min={0}
          onChange={(event) => onContextOpacityChange(Number(event.target.value))}
          step={0.05}
          type="range"
        />
      </div>

      <div className="border-t border-white/10 px-3 py-2.5">
        <p className="text-[10px] uppercase tracking-wide text-white/45">Legend</p>
        <ul className="mt-1.5 space-y-1">
          {LAYER_LEGEND.map((entry) => (
            <li className="flex items-center gap-2 text-xs text-white/70" key={entry.id}>
              <span
                aria-hidden
                className="inline-block h-2.5 w-4 rounded-sm border border-black/40"
                style={{ backgroundColor: entry.color }}
              />
              <span>{entry.label}</span>
              <span className="ml-auto text-[9px] uppercase tracking-wide text-white/30">{entry.kind}</span>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

export default LayersPanel;
