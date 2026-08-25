"use client";

import type { DrawingObjectV1 } from "../../../shared/drawing-document";

/**
 * Property inspector for a selected DrawingObjectV1.
 *
 * Presentational only: it renders the editable properties of the selected
 * object and reports raw edits upward through onPropertyChange(key, value).
 * The overlay owns state — edits flow into the existing drawing history as an
 * in-place property update, never a remove + recreate, so undo restores
 * properties while the object keeps its identity.
 */

export type InspectorField =
  | { key: string; kind: "enum"; label: string; options: string[] }
  | {
      key: string;
      kind: "number";
      label: string;
      maximum?: number;
      minimum?: number;
      step?: number;
    };

type EnumSpec = { key: string; label: string; options: readonly string[] };
type NumberSpec = {
  key: string;
  label: string;
  maximum?: number;
  minimum?: number;
  step?: number;
};

const ROAD_ENUMS: EnumSpec[] = [
  {
    key: "direction",
    label: "Direction",
    options: ["two-way", "one-way-forward", "one-way-reverse"]
  }
];

const ROAD_NUMBERS: NumberSpec[] = [
  { key: "lanes", label: "Lanes", minimum: 1, step: 1 },
  { key: "laneWidthMetres", label: "Lane width (m)", minimum: 1, step: 0.25 }
];

const FOOTPATH_ENUMS: EnumSpec[] = [
  { key: "surface", label: "Surface", options: ["paved", "unpaved", "unknown"] }
];

const FOOTPATH_NUMBERS: NumberSpec[] = [
  { key: "clearWidthMetres", label: "Clear width (m)", minimum: 0, step: 0.1 }
];

const CYCLEWAY_ENUMS: EnumSpec[] = [
  {
    key: "protection",
    label: "Protection",
    options: ["protected", "painted", "mixed-traffic"]
  }
];

const CYCLEWAY_NUMBERS: NumberSpec[] = [
  { key: "widthMetres", label: "Path width (m)", minimum: 0, step: 0.1 },
  { key: "bufferMetres", label: "Buffer width (m)", minimum: 0, step: 0.1 }
];

const CROSSING_ENUMS: EnumSpec[] = [
  {
    key: "control",
    label: "Crossing type",
    options: ["uncontrolled", "zebra", "signal-controlled", "raised"]
  }
];

const ROUNDABOUT_NUMBERS: NumberSpec[] = [
  {
    key: "inscribedCircleDiameterMetres",
    label: "Radius (m)",
    maximum: 999,
    minimum: 1,
    step: 1
  }
];

const SIGNAL_ENUMS: EnumSpec[] = [
  {
    key: "kind",
    label: "Signal serves",
    options: ["vehicle", "pedestrian", "cycle", "mixed"]
  }
];

/** Editable fields for an object, in display order. Empty for unknown types. */
export function getInspectorFields(object: DrawingObjectV1): InspectorField[] {
  const fields = INSPECTOR_SPECS[object.type];
  if (!fields?.order) {
    return [];
  }

  return fields.order.map((key) => {
    const enumSpec = fields.enums.find((spec) => spec.key === key);

    if (enumSpec) {
      return { key: enumSpec.key, kind: "enum" as const, label: enumSpec.label, options: [...enumSpec.options] };
    }

    const numberSpec = fields.numbers.find((spec) => spec.key === key);

    return numberSpec
      ? {
          key: numberSpec.key,
          kind: "number" as const,
          label: numberSpec.label,
          maximum: numberSpec.maximum,
          minimum: numberSpec.minimum,
          step: numberSpec.step
        }
      : null;
  }).filter((field): field is InspectorField => field !== null);
}

const INSPECTOR_SPECS: Partial<
  Record<DrawingObjectV1["type"], { enums: EnumSpec[]; numbers: NumberSpec[]; order: string[] }>
> = {
  crossing: { enums: CROSSING_ENUMS, numbers: [], order: ["control"] },
  cycleway: {
    enums: CYCLEWAY_ENUMS,
    numbers: CYCLEWAY_NUMBERS,
    order: ["widthMetres", "protection", "bufferMetres"]
  },
  footpath: {
    enums: FOOTPATH_ENUMS,
    numbers: FOOTPATH_NUMBERS,
    order: ["clearWidthMetres", "surface"]
  },
  road: {
    enums: ROAD_ENUMS,
    numbers: ROAD_NUMBERS,
    order: ["lanes", "direction", "laneWidthMetres"]
  },
  roundabout: { enums: [], numbers: ROUNDABOUT_NUMBERS, order: ["inscribedCircleDiameterMetres"] },
  "traffic-signal": { enums: SIGNAL_ENUMS, numbers: [], order: ["kind"] }
};

const TYPE_LABELS: Record<DrawingObjectV1["type"], string> = {
  crossing: "Crossing",
  cycleway: "Cycleway",
  footpath: "Footpath",
  road: "Road",
  roundabout: "Roundabout",
  "traffic-signal": "Traffic signal"
};

/**
 * Pure in-place-style property update: same id, same geometry, merged
 * properties. Numeric values arrive as strings from inputs and are coerced;
 * non-finite results keep the current value; unknown keys are dropped.
 */
export function applyPropertyPatch<T extends DrawingObjectV1>(
  object: T,
  patch: Record<string, unknown>
): T {
  const numericKeys = new Set(
    getInspectorFields(object)
      .filter((field) => field.kind === "number")
      .map((field) => field.key)
  );
  const allowedKeys = new Set(getInspectorFields(object).map((field) => field.key));
  const nextProperties: Record<string, unknown> = { ...object.properties };

  for (const [key, raw] of Object.entries(patch)) {
    if (!allowedKeys.has(key)) {
      continue;
    }

    if (numericKeys.has(key)) {
      const value = typeof raw === "number" ? raw : Number(raw);

      if (Number.isFinite(value)) {
        nextProperties[key] = value;
      }
      continue;
    }

    nextProperties[key] = raw;
  }

  return { ...object, properties: nextProperties } as T;
}

function formatOption(option: string): string {
  const trimmed = option.trim();
  return trimmed.length === 0 ? trimmed : trimmed.charAt(0).toUpperCase() + trimmed.slice(1);
}

type ObjectInspectorProps = {
  /** Raw edit reports; the parent decides parsing/commit semantics. */
  onPropertyChange?: (key: string, value: string) => void;
  object: DrawingObjectV1 | null;
};

export function ObjectInspector({ object, onPropertyChange }: ObjectInspectorProps) {
  if (!object) {
    return (
      <section
        aria-label="Object inspector"
        className="rounded-md border border-white/10 bg-[#1b1f1d] text-[#ece7da]"
        data-testid="object-inspector"
      >
        <header className="border-b border-white/10 px-3 py-2">
          <h2 className="text-[11px] font-semibold uppercase tracking-wider text-white/50">
            Properties
          </h2>
        </header>
        <p className="px-3 py-3 text-xs text-white/45">No object selected.</p>
      </section>
    );
  }

  const fields = getInspectorFields(object);
  const properties = object.properties as unknown as Record<string, unknown>;

  return (
    <section
      aria-label="Object inspector"
      className="rounded-md border border-white/10 bg-[#1b1f1d] text-[#ece7da]"
      data-testid="object-inspector"
    >
      <header className="flex items-baseline justify-between border-b border-white/10 px-3 py-2">
        <h2 className="text-[11px] font-semibold uppercase tracking-wider text-white/50">
          Properties
        </h2>
        <span className="text-[11px] font-medium text-[#f5c542]">{TYPE_LABELS[object.type]}</span>
      </header>

      <div className="divide-y divide-white/5">
        {fields.map((field) => (
          <div className="px-3 py-2" key={field.key}>
            <label
              className="block text-[10px] uppercase tracking-wide text-white/45"
              htmlFor={`inspector-${field.key}`}
            >
              {field.label}
            </label>
            {field.kind === "number" ? (
              <input
                className="mt-1 w-full rounded-sm border border-white/15 bg-[#121513] px-2 py-1.5 text-xs text-[#ece7da] outline-none focus:border-[#f5c542]/70"
                defaultValue={String(properties[field.key] ?? "")}
                id={`inspector-${field.key}`}
                max={field.maximum}
                min={field.minimum}
                onChange={(event) => onPropertyChange?.(field.key, event.target.value)}
                step={field.step}
                type="number"
                data-testid={`inspector-${field.key}`}
              />
            ) : (
              <select
                className="mt-1 w-full rounded-sm border border-white/15 bg-[#121513] px-2 py-1.5 text-xs text-[#ece7da] outline-none focus:border-[#f5c542]/70"
                id={`inspector-${field.key}`}
                onChange={(event) => onPropertyChange?.(keyOrEmpty(field.key), event.target.value)}
                value={String(properties[field.key] ?? "")}
                data-testid={`inspector-${field.key}`}
              >
                {field.options.map((option) => (
                  <option key={option} value={option}>
                    {formatOption(option)}
                  </option>
                ))}
              </select>
            )}
          </div>
        ))}
      </div>

      <footer className="border-t border-white/10 px-3 py-2">
        <p className="text-[10px] leading-4 text-white/35">Concept values only — not design guidance.</p>
      </footer>
    </section>
  );
}

function keyOrEmpty(key: string): string {
  return key || "";
}

export default ObjectInspector;
