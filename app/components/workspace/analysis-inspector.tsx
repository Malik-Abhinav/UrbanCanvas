"use client";

import type { AnalysisFinding, AnalysisFindingSeverity } from "../../../shared/analysis-findings";

/**
 * Inspector for structured rule-based analysis findings (Task 24).
 *
 * Presentational only: renders findings with severity and the rule rationale,
 * reports selection upward via onSelectFinding (null clears), and shows a
 * stale notice when geometry changed since the analysis ran.
 */

const SEVERITY_STYLES: Record<AnalysisFindingSeverity, string> = {
  critical: "border-[#ff6b57]/40 bg-[#ff6b57]/15 text-[#ffd1ca]",
  info: "border-white/20 bg-white/[0.06] text-white/70",
  warning: "border-[#f5c542]/40 bg-[#f5c542]/10 text-[#ffe6a1]"
};

export type AnalysisInspectorProps = {
  findings: AnalysisFinding[];
  /** Id of the currently highlighted finding; null when nothing is selected. */
  selectedFindingId: string | null;
  onSelectFinding: (finding: AnalysisFinding | null) => void;
  /** True when geometry changed after this analysis was produced. */
  isStale?: boolean;
};

export function AnalysisInspector({
  findings,
  selectedFindingId,
  onSelectFinding,
  isStale = false
}: AnalysisInspectorProps) {
  if (findings.length === 0 && !isStale) {
    return null;
  }

  return (
    <div className="mt-3">
      {isStale ? (
        <p
          className="rounded border border-[#f5c542]/30 bg-[#f5c542]/10 px-2.5 py-2 text-xs leading-5 text-[#ffe6a1]"
          role="status"
        >
          Geometry changed since this analysis — re-run Analyze Changes for current findings.
        </p>
      ) : null}

      {findings.length > 0 ? (
        <ul className="space-y-2" role="list">
          {findings.map((finding) => {
            const isSelected = finding.id === selectedFindingId;

            return (
              <li key={finding.id}>
                <button
                  aria-pressed={isSelected}
                  className={`w-full rounded-lg border px-3 py-2.5 text-left transition ${
                    isSelected
                      ? "border-[#63e6be]/70 bg-[#63e6be]/10"
                      : "border-white/10 bg-white/[0.04] hover:border-[#63e6be]/40 hover:bg-white/[0.07]"
                  }`}
                  onClick={() => onSelectFinding(isSelected ? null : finding)}
                  type="button"
                >
                  <span className="flex items-center gap-2">
                    <span
                      className={`rounded border px-1.5 py-0.5 text-[10px] font-semibold uppercase ${SEVERITY_STYLES[finding.severity]}`}
                    >
                      {finding.severity}
                    </span>
                    <span className="text-xs font-semibold text-white/85">{finding.ruleLabel}</span>
                  </span>
                  <span className="mt-1.5 block text-xs leading-5 text-white/65">{finding.message}</span>
                </button>
              </li>
            );
          })}
        </ul>
      ) : null}

      {findings.length > 0 ? (
        <p className="mt-2 text-[11px] leading-4 text-white/40">
          Heuristic rules over drawn geometry only — not an engineering certification.
        </p>
      ) : null}
    </div>
  );
}
