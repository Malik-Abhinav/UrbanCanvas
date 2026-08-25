import type { DrawingObjectV1 } from "../shared/drawing-document";
import type { LatLng } from "../shared/geo";

/**
 * Pure drawing-precision logic for Task 20.
 *
 * Everything operates in real-world units. Polyline helpers take lat/lng plus
 * a reference latitude and convert through a local equirectangular frame
 * (metres per degree latitude), matching the convention used by
 * app/drawing-snap.ts — screen-space projection happens only at the render /
 * input boundary in satellite-overlay.tsx.
 */

export type LocalPoint = { x: number; y: number };

/** Angle snap increment for Shift-constrained drawing, in degrees. */
export const ANGLE_SNAP_DEGREES = 45;

const METRES_PER_DEGREE_LATITUDE = 110_574;
const DEG_45 = Math.PI / 4;

/* --------------------------- Angle constraints ---------------------------- */

/**
 * Constrains a segment delta to the nearest multiple of 45° around `origin`,
 * preserving the pointer distance. When `enabled` is false the pointer delta
 * is returned untouched.
 */
export function constrainSegmentDelta(origin: LocalPoint, pointer: LocalPoint, enabled: boolean): LocalPoint {
  if (!enabled) {
    return { ...pointer };
  }

  const dx = pointer.x - origin.x;
  const dy = pointer.y - origin.y;
  const length = Math.hypot(dx, dy);

  if (length === 0) {
    return { ...pointer };
  }

  const snappedAngle = Math.round(Math.atan2(dy, dx) / DEG_45) * DEG_45;

  return {
    x: origin.x + Math.cos(snappedAngle) * length,
    y: origin.y + Math.sin(snappedAngle) * length
  };
}

/* ------------------------ Offset parallel geometry ------------------------ */

function lineToLocalMetres(points: LatLng[]): LocalPoint[] {
  const origin = points[0];
  const cosLat = Math.cos((origin.lat * Math.PI) / 180);

  return points.map((point) => ({
    x: (point.lng - origin.lng) * METRES_PER_DEGREE_LATITUDE * cosLat,
    y: (point.lat - origin.lat) * METRES_PER_DEGREE_LATITUDE
  }));
}

function localMetresToLine(locals: LocalPoint[], origin: LatLng): LatLng[] {
  const cosLat = Math.cos((origin.lat * Math.PI) / 180);

  return locals.map((local) => ({
    lat: origin.lat + local.y / METRES_PER_DEGREE_LATITUDE,
    lng: origin.lng + local.x / (METRES_PER_DEGREE_LATITUDE * cosLat)
  }));
}

function offsetLocals(locals: LocalPoint[], offsetMetres: number): LocalPoint[] | null {
  if (locals.length < 2) {
    return null;
  }

  // Per-segment normals averaged at shared vertices (miter join), clamped so
  // sharp bends cannot explode the offset.
  const result: LocalPoint[] = [];

  for (let index = 0; index < locals.length; index += 1) {
    const previous = locals[Math.max(0, index - 1)];
    const next = locals[Math.min(locals.length - 1, index + 1)];
    let nx = -(next.y - previous.y);
    let ny = next.x - previous.x;
    const normalLength = Math.hypot(nx, ny);

    if (normalLength === 0) {
      return null;
    }

    nx /= normalLength;
    ny /= normalLength;

    // For interior vertices halve toward each adjacent segment's own normal.
    if (index > 0 && index < locals.length - 1) {
      const segA = { x: locals[index].x - locals[index - 1].x, y: locals[index].y - locals[index - 1].y };
      const segB = { x: locals[index + 1].x - locals[index].x, y: locals[index + 1].y - locals[index].y };
      const lenA = Math.hypot(segA.x, segA.y) || 1;
      const lenB = Math.hypot(segB.x, segB.y) || 1;
      const nax = -segA.y / lenA;
      const nay = segA.x / lenA;
      const nbx = -segB.y / lenB;
      const nby = segB.x / lenB;

      let mx = nax + nbx;
      let my = nay + nby;
      const mLength = Math.hypot(mx, my);

      if (mLength > 1e-9) {
        mx /= mLength;
        my /= mLength;
        nx = mx;
        ny = my;
      }
    }

    const scale = Math.min(Math.abs(offsetMetres), 500);

    result.push({
      x: locals[index].x + nx * scale * Math.sign(offsetMetres || 1),
      y: locals[index].y + ny * scale * Math.sign(offsetMetres || 1)
    });
  }

  return result;
}

/**
 * Offsets a polyline sideways by `offsetMetres` (positive = left of travel
 * direction). Returns new point objects; the input is never mutated.
 */
export function offsetLineLatLng(points: LatLng[], offsetMetres: number): LatLng[] | null {
  const locals = lineToLocalMetres(points);
  const offset = offsetLocals(locals, offsetMetres);

  if (!offset) {
    return null;
  }

  return localMetresToLine(offset, points[0]);
}

/**
 * Duplicates a LineString object with offset geometry, a fresh id and copies
 * of its properties. Returns null for non-line objects.
 */
export function duplicateLineObjectLatLng(
  object: DrawingObjectV1,
  newId: string,
  offsetMetres: number
): DrawingObjectV1 | null {
  if (object.geometry.type !== "LineString") {
    return null;
  }

  const source = object.geometry as { points: LatLng[]; type: "LineString" };
  const points =
    offsetMetres === 0
      ? source.points.map((point) => ({ ...point }))
      : offsetLineLatLng(source.points, offsetMetres);

  if (!points) {
    return null;
  }

  return {
    ...object,
    geometry: { ...source, points },
    id: newId,
    properties: JSON.parse(JSON.stringify(object.properties)) as typeof object.properties
  } as DrawingObjectV1;
}

/* ------------------------- Numeric entry coercion ------------------------- */

export type NumericRange = { max?: number; min?: number };

/**
 * Coerces free-typed numeric entry ("12", "7,5", "12 m") into a finite
 * number clamped to `range`; returns null when nothing numeric remains.
 */
export function coerceNumericEntry(raw: string, range?: NumericRange): number | null {
  const normalized = raw.trim().replace(",", ".").replace(/m\b/gi, "").trim();
  const value = Number(normalized);

  if (normalized === "" || !Number.isFinite(value)) {
    return null;
  }

  const min = range?.min ?? Number.NEGATIVE_INFINITY;
  const max = range?.max ?? Number.POSITIVE_INFINITY;

  return Math.min(max, Math.max(min, value));
}

/* -------------------------- Length scaling -------------------------------- */

/** Scales a polyline about its first vertex so its length equals `lengthMetres`. */
export function scalePolylineLength(points: LatLng[], lengthMetres: number): LatLng[] | null {
  if (points.length < 2 || !(lengthMetres > 0)) {
    return null;
  }

  const locals = lineToLocalMetres(points);
  let current = 0;

  for (let index = 1; index < locals.length; index += 1) {
    current += Math.hypot(locals[index].x - locals[index - 1].x, locals[index].y - locals[index - 1].y);
  }

  if (current === 0) {
    return null;
  }

  const factor = lengthMetres / current;
  const scaled = locals.map((local) => ({ x: local.x * factor, y: local.y * factor }));

  scaled[0] = { ...locals[0] };

  return localMetresToLine(scaled, points[0]);
}

/* ----------------------------- Shortcut map ------------------------------- */

export type CommandId =
  | "edit.redo"
  | "edit.undo"
  | "geometry.commit"
  | "object.duplicate"
  | "object.offset"
  | "palette.open"
  | "tool.bike"
  | "tool.crossing"
  | "tool.erase"
  | "tool.road"
  | "tool.roundabout"
  | "tool.select"
  | "tool.sidewalk"
  | "tool.signal"
  | "view.toggle-grid";

export type ShortcutSpec = {
  command: CommandId;
  /** Plain key match against event.key, case-insensitive. */
  key: string;
  meta?: boolean;
  shift?: boolean;
};

export const SHORTCUTS: ShortcutSpec[] = [
  { command: "tool.select", key: "v" },
  { command: "tool.road", key: "r" },
  { command: "tool.bike", key: "b" },
  { command: "tool.sidewalk", key: "s" },
  { command: "tool.crossing", key: "c" },
  { command: "tool.roundabout", key: "o" },
  { command: "tool.signal", key: "t" },
  { command: "tool.erase", key: "e" },
  { command: "view.toggle-grid", key: "g" },
  { command: "palette.open", key: "k", meta: true },
  { command: "object.duplicate", key: "d", meta: true },
  { command: "object.offset", key: "o", shift: true },
  { command: "edit.undo", key: "z", meta: true },
  { command: "edit.redo", key: "z", meta: true, shift: true },
  { command: "edit.redo", key: "y", meta: true }
];

export type KeyEventLike = {
  ctrlKey: boolean;
  key: string;
  metaKey: boolean;
  shiftKey: boolean;
};

/** Resolves a keyboard event to a CommandId, or null when unmatched. */
export function resolveCommand(event: KeyEventLike): CommandId | null {
  const key = event.key.toLowerCase();
  const hasMeta = event.metaKey || event.ctrlKey;

  for (const shortcut of SHORTCUTS) {
    if (shortcut.key !== key) {
      continue;
    }

    const metaMatches = Boolean(shortcut.meta) === hasMeta;
    const shiftMatches = Boolean(shortcut.shift) === event.shiftKey;

    if (metaMatches && shiftMatches) {
      return shortcut.command;
    }
  }

  return null;
}

/* ---------------------------- Command palette ----------------------------- */

export type PaletteCommand = {
  hint?: string;
  id: string;
  title: string;
};

/** Case-insensitive substring filter over title and id; empty query matches all. */
export function filterCommands(commands: readonly PaletteCommand[], query: string): PaletteCommand[] {
  const needle = query.trim().toLowerCase();

  if (needle === "") {
    return [...commands];
  }

  return commands.filter(
    (command) => command.title.toLowerCase().includes(needle) || command.id.toLowerCase().includes(needle)
  );
}

/* --------------------------- Scale-aware grid ----------------------------- */

export type GridSpacing = {
  spacingMetres: number;
  spacingPx: number;
};

/** 1–2–5 decade series of grid spacings in metres, ascending. */
export const GRID_SPACING_SERIES = [1, 2, 5, 10, 20, 50, 100, 200, 500, 1000];

/**
 * Picks the smallest nice metre spacing whose on-screen size stays above
 * `minSpacingPx`. Returns null when even the largest spacing is too dense —
 * callers hide the grid rather than draw an unreadable haze.
 */
export function resolveGridSpacing(options: { metresPerPixel: number; minSpacingPx: number }): GridSpacing | null {
  const { metresPerPixel, minSpacingPx } = options;

  if (!(metresPerPixel > 0)) {
    return null;
  }

  for (const spacingMetres of GRID_SPACING_SERIES) {
    const spacingPx = spacingMetres / metresPerPixel;

    if (spacingPx >= minSpacingPx) {
      return { spacingMetres, spacingPx };
    }
  }

  return null;
}
