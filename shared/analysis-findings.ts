import type { CyclingFeedbackIssue } from "./cycling-analysis";

/**
 * Structured, geometry-linked finding produced by the rule-based analyzers
 * (Task 24). `objectIds` reference drawn object ids so the workspace can
 * highlight the affected segment when a finding is selected.
 */
export type AnalysisFindingSeverity = "info" | "warning" | "critical";

export type AnalysisFinding = {
  /** Stable within one analysis run; derived from rule code and objects. */
  id: string;
  source: "cycling";
  code: string;
  severity: AnalysisFindingSeverity;
  /** Human-readable name of the heuristic rule that fired. */
  ruleLabel: string;
  objectIds: string[];
  message: string;
};

type RuleDescriptor = {
  severity: AnalysisFindingSeverity;
  label: string;
};

const RULE_DESCRIPTORS: Record<CyclingFeedbackIssue["code"], RuleDescriptor> = {
  "protection-discontinuity": {
    label: "Protected vs painted continuity",
    severity: "warning"
  },
  "abrupt-termination": {
    label: "Abrupt cycle-lane termination",
    severity: "warning"
  },
  "direction-conflict": {
    label: "Direction conflict",
    severity: "critical"
  },
  "implausible-width": {
    label: "Implausible lane/width combination",
    severity: "warning"
  },
  "implausible-road-section": {
    label: "Implausible road section",
    severity: "warning"
  },
  "missing-intersection-transition": {
    label: "Missing intersection transition",
    severity: "warning"
  },
  "roundabout-cycle-conflict": {
    label: "Roundabout / cycle conflict",
    severity: "critical"
  },
  "uncoordinated-signal-crossing": {
    label: "Signal / crossing coordination",
    severity: "warning"
  },
  "orphaned-signal": {
    label: "Orphaned signal",
    severity: "info"
  }
};

/**
 * Converts structured cycling heuristics into presentation-ready findings.
 * Ids are deterministic so repeated analyses of unchanged geometry produce
 * identical ids (stable selection across re-runs).
 */
export function buildCyclingFindings(issues: readonly CyclingFeedbackIssue[]): AnalysisFinding[] {
  return issues.map((issue) => {
    const descriptor = RULE_DESCRIPTORS[issue.code] ?? {
      label: "Cycling design heuristic",
      severity: "info" as AnalysisFindingSeverity
    };

    return {
      id: `${issue.code}:${issue.objectIds.join("+")}`,
      source: "cycling",
      code: issue.code,
      severity: descriptor.severity,
      ruleLabel: descriptor.label,
      objectIds: [...issue.objectIds],
      message: issue.message
    };
  });
}

/** Runtime guard for API payloads; never trust the wire blindly. */
export function isAnalysisFindingArray(value: unknown): value is AnalysisFinding[] {
  if (!Array.isArray(value)) {
    return false;
  }

  return value.every(
    (item) =>
      typeof item === "object" &&
      item !== null &&
      typeof (item as Partial<AnalysisFinding>).id === "string" &&
      typeof (item as Partial<AnalysisFinding>).message === "string" &&
      Array.isArray((item as Partial<AnalysisFinding>).objectIds)
  );
}
