"use client";

import { useState } from "react";

/**
 * Map legend (Task 31 accessibility).
 *
 * Proposal types are distinguished by more than color — casings, dash
 * patterns, and widths differ per type — and this legend makes those
 * distinctions explicit in text, so meaning never relies on hue alone.
 */

type LegendEntry = {
  label: string;
  sample: React.ReactNode;
};

const ENTRIES: LegendEntry[] = [
  {
    label: "Road / lane — dark casing, dashed centreline",
    sample: (
      <span
        aria-hidden="true"
        className="relative inline-block h-0 w-10 border-t-4 border-[#222729]"
        style={{ borderTopStyle: "solid" }}
      />
    )
  },
  {
    label: "Bike lane — solid green, dashed edge",
    sample: (
      <span aria-hidden="true" className="inline-block h-0 w-10 border-t-[3px] border-dashed border-[#22c55e]" />
    )
  },
  {
    label: "Sidewalk / footpath — pale double line",
    sample: (
      <span aria-hidden="true" className="inline-block h-1.5 w-10 rounded border-y border-[#d8d2c4]" />
    )
  },
  {
    label: "Crossing — zebra band",
    sample: (
      <span
        aria-hidden="true"
        className="inline-block h-3 w-10 rounded-sm"
        style={{
          backgroundImage:
            "repeating-linear-gradient(90deg, #f8fafc 0 3px, transparent 3px 6px)",
          border: "1px solid rgba(255,255,255,.35)"
        }}
      />
    )
  },
  {
    label: "Roundabout — inscribed circle",
    sample: <span aria-hidden="true" className="inline-block h-3.5 w-3.5 rounded-full border-2 border-[#f5c542]" />
  },
  {
    label: "Traffic signal — marked dot",
    sample: <span aria-hidden="true" className="inline-block h-3 w-3 rounded-full bg-[#78aef8]" />
  }
];

export function MapLegend({ defaultOpen = false }: { defaultOpen?: boolean }) {
  const [isOpen, setIsOpen] = useState(defaultOpen);

  return (
    <div className="absolute bottom-3 left-3 z-20 max-sm:hidden">
      {isOpen ? (
        <div
          aria-label="Map legend"
          className="mb-2 w-64 rounded-lg border border-white/15 bg-[#111612]/95 p-3 shadow-xl"
          role="group"
        >
          <p className="uc-meta-label">Proposal types</p>
          <ul className="mt-2 space-y-2">
            {ENTRIES.map((entry) => (
              <li className="flex items-center gap-2.5 text-xs leading-5 text-white/75" key={entry.label}>
                {entry.sample}
                <span>{entry.label}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      <button
        aria-expanded={isOpen}
        aria-label={isOpen ? "Hide map legend" : "Show map legend"}
        className="secondary-button px-3 py-1.5 text-xs"
        onClick={() => setIsOpen((current) => !current)}
        type="button"
      >
        {isOpen ? "Hide legend" : "Legend"}
      </button>
    </div>
  );
}
