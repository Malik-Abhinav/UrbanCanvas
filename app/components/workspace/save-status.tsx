"use client";

/**
 * Autosave status surfacing (Task 29).
 *
 * One honest indicator for the four save phases the plan requires:
 * saving / saved / failed (+ retry), rendered as a quiet live-region chip —
 * no decorative clutter. Idle renders nothing at all.
 */

export type SaveStatus = "idle" | "saving" | "saved" | "failed";

export type SaveStatusIndicatorProps = {
  status: SaveStatus;
  /** Offered only on failure; re-triggers the workspace save flow. */
  onRetry?: () => void;
};

export function SaveStatusIndicator({ onRetry, status }: SaveStatusIndicatorProps) {
  if (status === "idle") {
    return null;
  }

  if (status === "failed") {
    return (
      <p
        className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 rounded border border-[#ff7968]/30 bg-[#ff7968]/10 px-3 py-2 text-xs leading-5 text-[#ffd1ca]"
        role="alert"
      >
        <span>Autosave failed — latest changes are not saved.</span>
        {onRetry ? (
          <button className="secondary-button px-2.5 py-1 text-xs" onClick={onRetry} type="button">
            Retry save
          </button>
        ) : null}
      </p>
    );
  }

  return (
    <p
      aria-live="polite"
      className={`mt-2 rounded border px-3 py-1.5 text-xs leading-5 ${
        status === "saving"
          ? "border-white/10 bg-white/[0.04] text-white/60"
          : "border-[#63e6be]/25 bg-[#63e6be]/10 text-[#9ff5da]"
      }`}
      role="status"
    >
      {status === "saving" ? "Autosaving…" : "All changes saved"}
    </p>
  );
}
