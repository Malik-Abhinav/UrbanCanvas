import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import DrawingToolbar from "./drawing-toolbar";
import WorkspaceShell from "./workspace-shell";

// The real control pulls in Clerk context, which static-markup tests lack.
vi.mock("../../workspace-auth", () => ({
  WorkspaceAuthControls: ({ collapsed }: { collapsed?: boolean }) => (
    <div data-collapsed={String(collapsed === true)} data-testid="auth-controls" />
  )
}));

describe("WorkspaceShell responsive drawer (Task 28)", () => {
  function renderShell() {
    return renderToStaticMarkup(
      <WorkspaceShell
        isSidebarCollapsed={false}
        mapStage={<div id="map-canvas" />}
        onToggleSidebar={vi.fn()}
        rail={<div>rail-content</div>}
      />
    );
  }

  it("renders a floating toggle wired to the panel", () => {
    const html = renderShell();

    expect(html).toContain('aria-controls="workspace-panel"');
    expect(html).toContain('aria-expanded="false"');
    expect(html).toContain('aria-label="Open workspace controls"');
  });

  it("keeps the closed panel out of the accessibility tree", () => {
    const html = renderShell();

    // SSR/mobile-first: closed drawer is inert + hidden until desktop corrects.
    expect(html).toMatch(/aria-hidden="true"/);
    expect(html).toMatch(/inert/);
  });

  it("still renders rail content inside the panel for desktop", () => {
    const html = renderShell();

    expect(html).toContain("rail-content");
    expect(html).toContain('id="workspace-panel"');
  });
});

describe("DrawingToolbar touch targets (Task 28)", () => {
  it("uses 44px (h-11 w-11) buttons for touch-safe targets", () => {
    const html = renderToStaticMarkup(
      <DrawingToolbar
        activeTool="select"
        canRedo={false}
        canUndo={true}
        historyTruncated={false}
        onRedo={vi.fn()}
        onSelectTool={vi.fn()}
        onUndo={vi.fn()}
      />
    );

    expect(html).not.toContain("h-10");
    expect(html).toContain("h-11 w-11");
  });

  it("docks horizontally at the bottom on mobile", () => {
    const html = renderToStaticMarkup(
      <DrawingToolbar
        activeTool="road"
        canRedo={false}
        canUndo={false}
        historyTruncated={false}
        onRedo={vi.fn()}
        onSelectTool={vi.fn()}
        onUndo={vi.fn()}
      />
    );

    expect(html).toContain("max-sm:flex-row");
    expect(html).toContain("max-sm:bottom-3");
  });
});
