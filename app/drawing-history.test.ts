import { describe, expect, it } from "vitest";
import {
  canRedo,
  canUndo,
  emptyHistoryState,
  historyReducer
} from "./drawing-history";
import type { DrawingObject } from "./satellite-overlay";

function signal(id: string): DrawingObject {
  return { id, point: { lat: 28.61, lng: 77.21 }, type: "signal" };
}

describe("historyReducer", () => {
  it("adds objects and clears the redo future", () => {
    let state = historyReducer(emptyHistoryState, { object: signal("a"), type: "add" });
    state = historyReducer(state, { object: signal("b"), type: "add" });
    state = historyReducer(state, { type: "undo" });
    state = historyReducer(state, { object: signal("c"), type: "add" });

    expect(state.present.map((object) => object.id)).toEqual(["a", "c"]);
    expect(canRedo(state)).toBe(false);
  });

  it("supports undo and redo of adds", () => {
    let state = historyReducer(emptyHistoryState, { object: signal("a"), type: "add" });
    state = historyReducer(state, { object: signal("b"), type: "add" });

    state = historyReducer(state, { type: "undo" });
    expect(state.present.map((object) => object.id)).toEqual(["a"]);
    expect(canRedo(state)).toBe(true);

    state = historyReducer(state, { type: "redo" });
    expect(state.present.map((object) => object.id)).toEqual(["a", "b"]);

    // Extra redo with an empty future is a safe no-op.
    state = historyReducer(state, { type: "redo" });
    expect(state.present.map((object) => object.id)).toEqual(["a", "b"]);
  });

  it("makes erases fully reversible — the erased shapes come back exactly", () => {
    let state = historyReducer(emptyHistoryState, { object: signal("a"), type: "add" });
    state = historyReducer(state, { object: signal("b"), type: "add" });

    state = historyReducer(state, { id: "a", type: "remove" });
    expect(state.present.map((object) => object.id)).toEqual(["b"]);

    // Undo restores BOTH shapes (the old implementation could not do this:
    // it cleared redo history on erase and only ever popped the last add).
    state = historyReducer(state, { type: "undo" });
    expect(state.present.map((object) => object.id)).toEqual(["a", "b"]);

    // Redo re-erases.
    state = historyReducer(state, { type: "redo" });
    expect(state.present.map((object) => object.id)).toEqual(["b"]);

    // A standalone erase is also reversible.
    let single = historyReducer(emptyHistoryState, { object: signal("x"), type: "add" });
    single = historyReducer(single, { id: "x", type: "remove" });
    expect(single.present).toHaveLength(0);
    single = historyReducer(single, { type: "undo" });
    expect(single.present.map((object) => object.id)).toEqual(["x"]);
  });

  it("ignores removal of unknown ids without polluting history", () => {
    let state = historyReducer(emptyHistoryState, { object: signal("a"), type: "add" });
    state = historyReducer(state, { id: "missing", type: "remove" });

    expect(state.present).toHaveLength(1);
    expect(canUndo(state)).toBe(true);
    expect(canRedo(state)).toBe(false);
  });

  it("undo with no past is a no-op", () => {
    const state = historyReducer(emptyHistoryState, { type: "undo" });

    expect(state).toBe(emptyHistoryState);
  });

  it("is pure: the same action on the same input yields the same output", () => {
    const base = historyReducer(emptyHistoryState, { object: signal("a"), type: "add" });
    const first = historyReducer(base, { object: signal("b"), type: "add" });
    const second = historyReducer(base, { object: signal("b"), type: "add" });

    expect(first).toEqual(second);
    expect(base.present).toHaveLength(1);
  });

  it("replace-all resets history for project loads", () => {
    let state = historyReducer(emptyHistoryState, { object: signal("a"), type: "add" });
    state = historyReducer(state, { type: "undo" });
    state = historyReducer(state, { objects: [signal("x")], type: "replace-all" });

    expect(state.present.map((object) => object.id)).toEqual(["x"]);
    expect(canRedo(state)).toBe(false);
    expect(canUndo(state)).toBe(false);
  });

  it("fully undoes and redoes a 500-edit drawing session", () => {
    let state = emptyHistoryState;

    for (let index = 0; index < 500; index += 1) {
      state = historyReducer(state, { object: signal(`s${index}`), type: "add" });
    }

    expect(state.present).toHaveLength(500);

    for (let index = 0; index < 500; index += 1) {
      state = historyReducer(state, { type: "undo" });
    }

    expect(state.present).toEqual([]);
    expect(canUndo(state)).toBe(false);

    for (let index = 0; index < 500; index += 1) {
      state = historyReducer(state, { type: "redo" });
    }

    expect(state.present).toHaveLength(500);
    expect(state.present.map((object) => object.id)).toEqual(
      Array.from({ length: 500 }, (_, index) => `s${index}`)
    );
    expect(canRedo(state)).toBe(false);
  });

  it("caps retained snapshots at 500 and reports when older history was dropped", () => {
    let state = emptyHistoryState;

    for (let index = 0; index < 501; index += 1) {
      state = historyReducer(state, { object: signal(`s${index}`), type: "add" });
    }

    expect(state.past).toHaveLength(500);
    expect(state.historyTruncated).toBe(true);

    for (let index = 0; index < 500; index += 1) {
      state = historyReducer(state, { type: "undo" });
    }

    expect(state.present.map((object) => object.id)).toEqual(["s0"]);
  });
});
