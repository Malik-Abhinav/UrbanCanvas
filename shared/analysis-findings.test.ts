import { describe, expect, it } from "vitest";

import type { CyclingFeedbackIssue } from "./cycling-analysis";
import { buildCyclingFindings, isAnalysisFindingArray } from "./analysis-findings";

function issue(overrides: Partial<CyclingFeedbackIssue> = {}): CyclingFeedbackIssue {
  return {
    code: "abrupt-termination",
    message: "Cycle lane ends without a transition.",
    objectIds: ["bike-1"],
    ...overrides
  };
}

describe("buildCyclingFindings", () => {
  it("returns an empty array for no issues", () => {
    expect(buildCyclingFindings([])).toEqual([]);
  });

  it("maps every known rule code to a label and severity", () => {
    const codes = [
      "protection-discontinuity",
      "abrupt-termination",
      "direction-conflict",
      "implausible-width",
      "implausible-road-section",
      "missing-intersection-transition",
      "roundabout-cycle-conflict",
      "uncoordinated-signal-crossing",
      "orphaned-signal"
    ] as const;

    const findings = buildCyclingFindings(codes.map((code) => issue({ code })));

    expect(findings).toHaveLength(codes.length);
    for (const finding of findings) {
      expect(finding.ruleLabel).not.toEqual("Cycling design heuristic");
      expect(["info", "warning", "critical"]).toContain(finding.severity);
    }
  });

  it("marks conflicts and roundabout issues as critical, orphaned signals as info", () => {
    const [direction] = buildCyclingFindings([issue({ code: "direction-conflict" })]);
    const [roundabout] = buildCyclingFindings([issue({ code: "roundabout-cycle-conflict" })]);
    const [orphan] = buildCyclingFindings([issue({ code: "orphaned-signal" })]);

    expect(direction?.severity).toEqual("critical");
    expect(roundabout?.severity).toEqual("critical");
    expect(orphan?.severity).toEqual("info");
  });

  it("builds stable ids from the rule code and affected objects", () => {
    const first = buildCyclingFindings([issue({ objectIds: ["a", "b"] })])[0];
    const second = buildCyclingFindings([issue({ objectIds: ["a", "b"] })])[0];

    expect(first?.id).toEqual(second?.id);
    expect(first?.id).toEqual("abrupt-termination:a+b");
  });

  it("copies objectIds so callers cannot mutate the source issue", () => {
    const source = issue({ objectIds: ["bike-1"] });
    const [finding] = buildCyclingFindings([source]);

    finding?.objectIds.push("mutated");

    expect(source.objectIds).toEqual(["bike-1"]);
  });

  it("falls back to a generic descriptor for unknown codes", () => {
    const [finding] = buildCyclingFindings([issue({ code: "something-new" as CyclingFeedbackIssue["code"] })]);

    expect(finding?.severity).toEqual("info");
    expect(finding?.ruleLabel).toEqual("Cycling design heuristic");
  });
});

describe("isAnalysisFindingArray", () => {
  it("accepts well-formed findings", () => {
    const findings = buildCyclingFindings([issue()]);

    expect(isAnalysisFindingArray(findings)).toBe(true);
  });

  it("rejects non-arrays and malformed entries", () => {
    expect(isAnalysisFindingArray(null)).toBe(false);
    expect(isAnalysisFindingArray(["nope"])).toBe(false);
    expect(isAnalysisFindingArray([{ id: 1, message: "x", objectIds: [] }])).toBe(false);
    expect(isAnalysisFindingArray([{ id: "a", message: "x" }])).toBe(false);
  });
});
