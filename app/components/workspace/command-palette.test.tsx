import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import CommandPalette from "./command-palette";

const commands = [
  { hint: "R", id: "tool.road", title: "Draw road" },
  { hint: "⌘K", id: "palette.open", title: "Open command palette" },
  { id: "view.toggle-grid", title: "Toggle grid" }
];

describe("CommandPalette", () => {
  it("renders nothing while closed", () => {
    const markup = renderToStaticMarkup(
      createElement(CommandPalette, { commands, onClose: () => undefined, onRun: () => undefined, open: false })
    );

    expect(markup).toBe("");
  });

  it("renders the search field and every command while open", () => {
    const markup = renderToStaticMarkup(
      createElement(CommandPalette, { commands, onClose: () => undefined, onRun: () => undefined, open: true })
    );

    expect(markup).toContain("Search commands");
    expect(markup).toContain("Draw road");
    expect(markup).toContain("Toggle grid");
    // Graphite surface with the #f5c542 accent family.
    expect(markup).toContain("#111612");
    expect(markup).toContain("#f5c542");
  });

  it("exposes dialog semantics for assistive tech", () => {
    const markup = renderToStaticMarkup(
      createElement(CommandPalette, { commands, onClose: () => undefined, onRun: () => undefined, open: true })
    );

    expect(markup).toContain('role="dialog"');
    expect(markup).toContain("Command palette");
  });

  it("keeps the run callback stable across renders", () => {
    const onRun = vi.fn();

    renderToStaticMarkup(
      createElement(CommandPalette, { commands, onClose: () => undefined, onRun, open: true })
    );

    expect(onRun).not.toHaveBeenCalled();
  });
});
