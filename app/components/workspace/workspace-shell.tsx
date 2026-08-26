"use client";

import { PanelLeftClose, PanelLeftOpen, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { WorkspaceAuthControls } from "../../workspace-auth";

type WorkspaceShellProps = {
  isSidebarCollapsed: boolean;
  onToggleSidebar: () => void;
  /** Expanded left-rail content, rendered inside the collapsible sidebar body. */
  rail: ReactNode;
  /** The map canvas section, rendered as the second grid column. */
  mapStage: ReactNode;
};

/**
 * Responsive workspace layout (Task 28).
 *
 * - Desktop (lg+): static two-column grid — control sidebar left, map right,
 *   with the existing collapse-to-76px behavior untouched.
 * - Tablet (640–1023px): the sidebar becomes a left slide-over summoned by a
 *   floating toggle over the map.
 * - Mobile (<640px): the same panel presents as a bottom sheet over the
 *   full-screen map.
 *
 * The drawer overlays the map instead of resizing it, so the map viewport is
 * preserved during panel transitions by construction; the existing
 * ResizeObserver keeps projections honest when real resizes do happen.
 */
export default function WorkspaceShell({ isSidebarCollapsed, mapStage, onToggleSidebar, rail }: WorkspaceShellProps) {
  const [isDrawerOpen, setIsDrawerOpen] = useState(false);
  // SSR/mobile-first default: closed panel is inert. Desktop corrects on mount.
  const [isDesktop, setIsDesktop] = useState(false);
  const toggleButtonRef = useRef<HTMLButtonElement | null>(null);
  const closeButtonRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    const query = window.matchMedia("(min-width: 1024px)");
    const update = () => setIsDesktop(query.matches);

    update();
    query.addEventListener("change", update);

    return () => query.removeEventListener("change", update);
  }, []);

  const closeDrawer = () => {
    setIsDrawerOpen(false);
    toggleButtonRef.current?.focus();
  };

  useEffect(() => {
    if (isDrawerOpen) {
      closeButtonRef.current?.focus();
    }

    if (!isDrawerOpen) {
      return;
    }

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        closeDrawer();
      }
    };

    document.addEventListener("keydown", onKeyDown);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = previousOverflow;
    };
  }, [isDrawerOpen]);

  const isPanelHidden = !isDrawerOpen && !isDesktop;

  return (
    <main className="relative min-h-screen bg-[#050706] text-[#f8fafc]">
      <a
        className="sr-only focus:not-sr-only focus:absolute focus:left-3 focus:top-3 focus:z-50 focus:rounded focus:border focus:border-[#63e6be] focus:bg-[#0b0e0c] focus:px-3 focus:py-2 focus:text-sm"
        href="#map-canvas"
      >
        Skip to map canvas
      </a>

      <button
        aria-controls="workspace-panel"
        aria-expanded={isDrawerOpen}
        aria-label="Open workspace controls"
        className="icon-button uc-drawer-toggle fixed left-3 top-3 z-30 lg:hidden"
        onClick={() => setIsDrawerOpen(true)}
        ref={toggleButtonRef}
        type="button"
      >
        <PanelLeftOpen size={20} />
      </button>

      {isDrawerOpen ? (
        <div aria-hidden="true" className="uc-backdrop lg:hidden" onClick={closeDrawer} />
      ) : null}

      <div
        className={`grid min-h-screen transition-[grid-template-columns] duration-300 ease-out ${
          isSidebarCollapsed ? "lg:grid-cols-[76px_1fr]" : "lg:grid-cols-[400px_1fr]"
        }`}
      >
        <aside
          aria-hidden={isPanelHidden || undefined}
          aria-label="Map workspace controls"
          className={`uc-drawer border-white/10 bg-[#0b0e0c]/95 shadow-2xl backdrop-blur ${
            isSidebarCollapsed ? "px-3 py-4" : "px-5 py-5"
          } ${isDrawerOpen ? "uc-drawer-open" : ""} ${isSidebarCollapsed ? "" : "max-lg:border-t"} z-40`}
          id="workspace-panel"
          inert={isPanelHidden || undefined}
        >
          <div className="flex items-start justify-between gap-4">
            <div className={`max-lg:block ${isSidebarCollapsed ? "lg:hidden" : "lg:block"}`}>
              <p className="text-sm font-semibold text-[#63e6be]">UrbanCanvas</p>
              <h1 className="mt-2 text-3xl font-semibold leading-tight tracking-normal">Map workspace</h1>
            </div>
            <div className="flex items-center gap-2">
              <WorkspaceAuthControls collapsed={isSidebarCollapsed} />
              <button
                aria-label="Collapse sidebar"
                className="icon-button max-lg:hidden"
                onClick={onToggleSidebar}
                title="Collapse sidebar"
                type="button"
              >
                <PanelLeftClose size={18} />
              </button>
              <button
                aria-label="Close workspace controls"
                className="icon-button lg:hidden"
                onClick={closeDrawer}
                ref={closeButtonRef}
                title="Close"
                type="button"
              >
                <X size={18} />
              </button>
            </div>
          </div>

          <div className={`mt-8 flex flex-col items-center gap-3 ${isSidebarCollapsed ? "max-lg:hidden" : "hidden"}`}>
            <p className="vertical-brand text-[#63e6be]">UrbanCanvas</p>
          </div>

          <div className={`max-lg:block ${isSidebarCollapsed ? "lg:hidden" : "lg:block"}`}>{rail}</div>
        </aside>

        {mapStage}
      </div>
    </main>
  );
}
