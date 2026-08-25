"use client";

import { PanelLeftClose, PanelLeftOpen } from "lucide-react";
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

/** Two-column workspace layout: control sidebar on the left, map stage filling the rest. */
export default function WorkspaceShell({ isSidebarCollapsed, mapStage, onToggleSidebar, rail }: WorkspaceShellProps) {
  return (
    <main className="min-h-screen bg-[#0b0f12] text-[#f8fafc]">
      <a
        className="sr-only focus:not-sr-only focus:absolute focus:left-3 focus:top-3 focus:z-50 focus:rounded focus:border focus:border-[#63e6be] focus:bg-[#101820] focus:px-3 focus:py-2 focus:text-sm"
        href="#map-canvas"
      >
        Skip to map canvas
      </a>
      <div
        className={`grid min-h-screen transition-[grid-template-columns] duration-300 ease-out ${
          isSidebarCollapsed ? "lg:grid-cols-[76px_1fr]" : "lg:grid-cols-[400px_1fr]"
        }`}
      >
        <aside
          aria-label="Map workspace controls"
          className={`z-10 border-b border-white/10 bg-[#101820]/95 shadow-2xl backdrop-blur transition-all duration-300 lg:border-b-0 lg:border-r ${
            isSidebarCollapsed ? "px-3 py-4" : "px-5 py-5"
          }`}
        >
          <div className="flex items-start justify-between gap-4">
            <div className={isSidebarCollapsed ? "hidden" : "block"}>
              <p className="text-sm font-semibold text-[#63e6be]">UrbanCanvas</p>
              <h1 className="mt-2 text-3xl font-semibold leading-tight tracking-normal">Map workspace</h1>
            </div>
            <div className="flex items-center gap-2">
              <WorkspaceAuthControls collapsed={isSidebarCollapsed} />
              <button
                aria-label={isSidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"}
                className="icon-button"
                onClick={onToggleSidebar}
                title={isSidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"}
                type="button"
              >
                {isSidebarCollapsed ? <PanelLeftOpen size={18} /> : <PanelLeftClose size={18} />}
              </button>
            </div>
          </div>

          <div className={isSidebarCollapsed ? "mt-8 flex flex-col items-center gap-3" : "hidden"}>
            <p className="vertical-brand text-[#63e6be]">UrbanCanvas</p>
          </div>

          <div className={isSidebarCollapsed ? "hidden" : "block"}>
            {rail}
          </div>
        </aside>

        {mapStage}
      </div>
    </main>
  );
}
