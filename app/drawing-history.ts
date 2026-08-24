import type { DrawingObject } from "./satellite-overlay";

const maxHistoryEntries = 500;

/**
 * Snapshot-based drawing history. Every mutation (add or erase) records the
 * previous object list, so any sequence of edits is exactly reversible.
 *
 * Pure by design so React StrictMode's double-invoked updaters can never
 * corrupt it, and simple enough to test exhaustively.
 */
export type HistoryState = {
  future: DrawingObject[][];
  historyTruncated: boolean;
  past: DrawingObject[][];
  present: DrawingObject[];
};

export type HistoryAction =
  | { object: DrawingObject; type: "add" }
  | { id: string; type: "remove" }
  | { type: "undo" }
  | { type: "redo" }
  | { objects: DrawingObject[]; type: "replace-all" };

export const emptyHistoryState: HistoryState = {
  future: [],
  historyTruncated: false,
  past: [],
  present: []
};

export function historyReducer(state: HistoryState, action: HistoryAction): HistoryState {
  switch (action.type) {
    case "add": {
      const history = pushPast(state.past, state.present);
      return {
        future: [],
        historyTruncated: state.historyTruncated || history.truncated,
        past: history.past,
        present: [...state.present, action.object]
      };
    }

    case "remove": {
      const next = state.present.filter((object) => object.id !== action.id);

      if (next.length === state.present.length) {
        // Nothing matched; don't pollute history with a no-op.
        return state;
      }

      const history = pushPast(state.past, state.present);
      return {
        future: [],
        historyTruncated: state.historyTruncated || history.truncated,
        past: history.past,
        present: next
      };
    }

    case "undo": {
      const previous = state.past.at(-1);

      if (!previous) {
        return state;
      }

      return {
        future: [state.present, ...state.future],
        historyTruncated: state.historyTruncated,
        past: state.past.slice(0, -1),
        present: previous
      };
    }

    case "redo": {
      const next = state.future[0];

      if (!next) {
        return state;
      }

      const history = pushPast(state.past, state.present);
      return {
        future: state.future.slice(1),
        historyTruncated: state.historyTruncated || history.truncated,
        past: history.past,
        present: next
      };
    }

    case "replace-all":
      return {
        future: [],
        historyTruncated: false,
        past: [],
        present: action.objects
      };

    default:
      return state;
  }
}

export function canRedo(state: HistoryState) {
  return state.future.length > 0;
}

export function canUndo(state: HistoryState) {
  return state.past.length > 0;
}

function pushPast(past: DrawingObject[][], present: DrawingObject[]) {
  const next = [...past, present];
  return {
    past: next.slice(-maxHistoryEntries),
    truncated: next.length > maxHistoryEntries
  };
}
