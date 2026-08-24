import { describe, expect, it } from "vitest";
import { getRetryAfterMilliseconds } from "./retry-after";

describe("getRetryAfterMilliseconds", () => {
  it("parses delta seconds", () => {
    expect(getRetryAfterMilliseconds("3", 1_000)).toBe(3_000);
  });

  it("parses an HTTP date relative to now", () => {
    expect(getRetryAfterMilliseconds("Thu, 01 Jan 1970 00:00:05 GMT", 1_000)).toBe(4_000);
  });

  it("uses a safe fallback for missing, malformed, or elapsed values", () => {
    expect(getRetryAfterMilliseconds(null, 1_000)).toBe(60_000);
    expect(getRetryAfterMilliseconds("later", 1_000)).toBe(60_000);
    expect(getRetryAfterMilliseconds("Thu, 01 Jan 1970 00:00:00 GMT", 1_000)).toBe(60_000);
  });
});
