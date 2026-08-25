/**
 * Proposal-vs-existing layer semantics.
 *
 * A single pure model drives which layers render, how opaque each family is,
 * and how existing context dims while a proposal is being edited. The rules:
 *
 * - Proposal infrastructure is always visually dominant: its effective opacity
 *   never drops below PROPOSAL_MIN_OPACITY, however far the slider is dragged.
 * - Existing OSM context (roads, buildings, open space) can fade, and dims
 *   further by CONTEXT_EDITING_DIM_FACTOR whenever an editing tool is active
 *   or a draft object is in flight.
 * - Toggles are immutable so React state updates stay predictable.
 */

export type LayerId =
  | "analysis"
  | "buildings"
  | "grid"
  | "openSpace"
  | "osmRoads"
  | "proposal"
  | "satellite";

export type LayerSettings = {
  /** Per-layer visibility; keys cover every toggleable layer. */
  visible: Record<LayerId, boolean>;
  /** Base opacity for proposed infrastructure, 0..1. */
  proposalOpacity: number;
  /** Base opacity for existing context layers, 0..1. */
  contextOpacity: number;
};

/** Floor for proposal opacity so proposals never vanish behind the map. */
export const PROPOSAL_MIN_OPACITY = 0.45;
/** Multiplier applied to context opacity while editing is in progress. */
export const CONTEXT_EDITING_DIM_FACTOR = 0.35;

const ALL_LAYER_IDS: LayerId[] = [
  "satellite",
  "osmRoads",
  "buildings",
  "openSpace",
  "proposal",
  "analysis",
  "grid"
];

function allVisible(): Record<LayerId, boolean> {
  return Object.fromEntries(ALL_LAYER_IDS.map((id) => [id, true])) as Record<LayerId, boolean>;
}

export function createLayerSettings(): LayerSettings {
  return {
    contextOpacity: 1,
    proposalOpacity: 1,
    visible: allVisible()
  };
}

export const DEFAULT_LAYER_SETTINGS: LayerSettings = createLayerSettings();

export function clampOpacity(value: number): number {
  if (Number.isNaN(value)) {
    return 0;
  }

  return Math.min(1, Math.max(0, value));
}

export function setLayerVisibility(settings: LayerSettings, id: LayerId, visible: boolean): LayerSettings {
  return { ...settings, visible: { ...settings.visible, [id]: visible } };
}

export function toggleLayer(settings: LayerSettings, id: LayerId): LayerSettings {
  return setLayerVisibility(settings, id, !settings.visible[id]);
}

export function setProposalOpacity(settings: LayerSettings, value: number): LayerSettings {
  return { ...settings, proposalOpacity: clampOpacity(value) };
}

export function setContextOpacity(settings: LayerSettings, value: number): LayerSettings {
  return { ...settings, contextOpacity: clampOpacity(value) };
}

/** Effective proposal opacity — clamped up to the dominance floor. */
export function resolveProposalOpacity(settings: LayerSettings): number {
  return Math.max(PROPOSAL_MIN_OPACITY, settings.proposalOpacity);
}

/** Effective context opacity — dimmed further while editing. */
export function resolveContextOpacity(settings: LayerSettings, isEditing: boolean): number {
  const base = clampOpacity(settings.contextOpacity);

  return base * (isEditing ? CONTEXT_EDITING_DIM_FACTOR : 1);
}

/* ------------------------------- Legend ---------------------------------- */

export type LegendEntry = {
  color: string;
  id: string;
  kind: "proposal" | "existing" | "overlay";
  label: string;
};

/**
 * Infrastructure legend shared by the workspace layers panel. Colours mirror
 * app/drawing-style.ts so swatches match what actually renders on canvas.
 */
export const LAYER_LEGEND: LegendEntry[] = [
  { color: "#f5c542", id: "legend-proposal-road", kind: "proposal", label: "Proposed road" },
  { color: "#22c55e", id: "legend-proposal-cycleway", kind: "proposal", label: "Proposed cycleway" },
  { color: "#e5e7eb", id: "legend-proposal-footpath", kind: "proposal", label: "Proposed footpath" },
  { color: "#60a5fa", id: "legend-signal", kind: "proposal", label: "Traffic signal" },
  { color: "#8f9a94", id: "legend-existing-road", kind: "existing", label: "Existing road" },
  { color: "#6b7480", id: "legend-building", kind: "existing", label: "Existing building" },
  { color: "#4b5d52", id: "legend-open-space", kind: "existing", label: "Open space" },
  { color: "#ff6b57", id: "legend-analysis", kind: "overlay", label: "Analysis overlay" }
];
