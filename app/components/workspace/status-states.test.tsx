import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { SaveStatusIndicator } from "./save-status";
import { OfflineBanner } from "./status-bar";

describe("SaveStatusIndicator (Task 29)", () => {
  it("renders nothing while idle", () => {
    const html = renderToStaticMarkup(<SaveStatusIndicator status="idle" />);

    expect(html).toEqual("");
  });

  it("announces saving as a quiet status", () => {
    const html = renderToStaticMarkup(<SaveStatusIndicator status="saving" />);

    expect(html).toContain("Autosaving");
    expect(html).toContain('role="status"');
  });

  it("confirms saved state", () => {
    const html = renderToStaticMarkup(<SaveStatusIndicator status="saved" />);

    expect(html).toContain("All changes saved");
  });

  it("alerts on failure and offers retry", () => {
    const onRetry = vi.fn();
    const html = renderToStaticMarkup(<SaveStatusIndicator onRetry={onRetry} status="failed" />);

    expect(html).toContain('role="alert"');
    expect(html).toContain("Autosave failed");
    expect(html).toContain("Retry save");
  });
});

describe("OfflineBanner (Task 29)", () => {
  it("renders nothing while online", () => {
    const html = renderToStaticMarkup(<OfflineBanner />);

    expect(html).toEqual("");
  });
});
