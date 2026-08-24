import { describe, expect, it } from "vitest";

import {
  CONTEXT_EDITING_DIM_FACTOR,
  DEFAULT_LAYER_SETTINGS,
  LAYER_LEGEND,
  PROPOSAL_MIN_OPACITY,
  clampOpacity,
  createLayerSettings,
  resolveContextOpacity,
  resolveProposalOpacity,
  setContextOpacity,
  setProposalOpacity,
  setLayerVisibility,
  toggleLayer
} from "./layer-semantics";

describe("layer settings model", () => {
  it("starts with every layer visible at full default opacities", () => {
    const settings = createLayerSettings();

    expect(settings).toEqual({
      visible: {
        analysis: true,
        buildings: true,
        grid: true,
        openSpace: true,
        osmRoads: true,
        proposal: true,
        satellite: true
      },
      contextOpacity: 1,
      proposalOpacity: 1
    });
    expect(DEFAULT_LAYER_SETTINGS).toEqual(createLayerSettings());
  });

  it("toggles a single layer without mutating the original", () => {
    const settings = createLayerSettings();
    const next = toggleLayer(settings, "osmRoads");

    expect(next.visible.osmRoads).toBe(false);
    expect(settings.visible.osmRoads).toBe(true);
    expect(toggleLayer(next, "osmRoads").visible.osmRoads).toBe(true);
  });

  it("sets visibility explicitly and immutably", () => {
    const next = setLayerVisibility(createLayerSettings(), "grid", false);

    expect(next.visible.grid).toBe(false);
    expect(createLayerSettings().visible.grid).toBe(true);
  });
});

describe("opacity controls", () => {
  it("clamps opacities into a sane range", () => {
    expect(clampOpacity(-1)).toBe(0);
    expect(clampOpacity(0.5)).toBe(0.5);
    expect(clampOpacity(2)).toBe(1);
  });

  it("stores clamped proposal and context opacities immutably", () => {
    const lowered = setProposalOpacity(createLayerSettings(), 0.6);

    expect(lowered.proposalOpacity).toBe(0.6);
    expect(createLayerSettings().proposalOpacity).toBe(1);
    expect(setProposalOpacity(createLayerSettings(), 9).proposalOpacity).toBe(1);
    expect(setProposalOpacity(createLayerSettings(), -3).proposalOpacity).toBe(0);

    const dimmed = setContextOpacity(createLayerSettings(), 0.4);

    expect(dimmed.contextOpacity).toBe(0.4);
    expect(setContextOpacity(createLayerSettings(), 42).contextOpacity).toBe(1);
  });
});

describe("effective layer semantics", () => {
  it("keeps proposals visually dominant even when the slider is dragged low", () => {
    const settings = setProposalOpacity(createLayerSettings(), 0.05);

    expect(resolveProposalOpacity(settings)).toBe(PROPOSAL_MIN_OPACITY);
    expect(resolveProposalOpacity(setProposalOpacity(settings, 0.8))).toBe(0.8);
  });

  it("uses the raw context opacity while not editing", () => {
    const settings = setContextOpacity(createLayerSettings(), 0.7);

    expect(resolveContextOpacity(settings, false)).toBe(0.7);
    expect(resolveContextOpacity(settings, true)).toBeCloseTo(0.7 * CONTEXT_EDITING_DIM_FACTOR);
  });

  it("dims existing context during editing so proposals dominate the canvas", () => {
    const editing = resolveContextOpacity(createLayerSettings(), true);
    const idle = resolveContextOpacity(createLayerSettings(), false);

    expect(editing).toBeLessThan(idle);
    expect(editing).toBeGreaterThan(0);
  });
});

describe("legend", () => {
  it("covers the infrastructure types with distinct entries", () => {
    const ids = LAYER_LEGEND.map((entry) => entry.id);

    expect(new Set(ids).size).toBe(LAYER_LEGEND.length);
    for (const entry of LAYER_LEGEND) {
      expect(entry.label.length).toBeGreaterThan(0);
      expect(entry.color).toMatch(/^#[0-9a-f]{3,8}$/i);
    }
  });

  it("includes proposal and existing-context entries", () => {
    const kinds = LAYER_LEGEND.map((entry) => entry.kind);

    expect(kinds).toContain("proposal");
    expect(kinds).toContain("existing");
  });
});
