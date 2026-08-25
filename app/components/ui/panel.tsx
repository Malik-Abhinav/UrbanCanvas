"use client";

import type { HTMLAttributes, ReactNode } from "react";

/**
 * Production panel (Task 26 design system).
 *
 * The standard surfaced container: optional title row with an actions slot on
 * a single line, body content below. Uses .info-panel plus token spacing.
 */

export type PanelTone = "default" | "warning";

export type PanelProps = HTMLAttributes<HTMLElement> & {
  title?: ReactNode;
  actions?: ReactNode;
  tone?: PanelTone;
};

export function Panel({ title, actions, tone = "default", className = "", children, ...rest }: PanelProps) {
  return (
    <section
      className={`info-panel uc-panel ${className}`.trim()}
      style={
        tone === "warning"
          ? { borderColor: "rgba(245, 197, 66, 0.35)" }
          : undefined
      }
      {...rest}
    >
      {title || actions ? (
        <header
          style={{
            alignItems: "center",
            display: "flex",
            gap: "var(--uc-space-3)",
            justifyContent: "space-between",
            padding: "var(--uc-space-3) var(--uc-space-4)",
            borderBottom: "1px solid var(--uc-color-border-subtle)"
          }}
        >
          <h2
            style={{
              fontSize: "var(--uc-font-size-sm)",
              fontWeight: "var(--uc-font-weight-bold)",
              letterSpacing: "0.04em",
              margin: 0,
              textTransform: "uppercase"
            }}
          >
            {title}
          </h2>
          {actions}
        </header>
      ) : null}
      <div style={{ padding: "var(--uc-space-4)" }}>{children}</div>
    </section>
  );
}
