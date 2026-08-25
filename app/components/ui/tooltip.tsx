"use client";

import { useId } from "react";
import type { ReactNode } from "react";

/**
 * Production tooltip (Task 26 design system).
 *
 * CSS-driven: visible on hover and keyboard focus (:focus-within), so no JS
 * state or portals. The trigger is focusable and the bubble is linked via
 * aria-describedby with role="tooltip". Position below the trigger by default.
 */

export type TooltipProps = {
  content: ReactNode;
  children: ReactNode;
  /** Where the bubble appears relative to the trigger. */
  side?: "top" | "bottom";
};

export function Tooltip({ content, children, side = "bottom" }: TooltipProps) {
  const id = useId();

  return (
    <span className="uc-tooltip">
      <span aria-describedby={id} tabIndex={0}>
        {children}
      </span>
      <span
        className="uc-tooltip-bubble"
        id={id}
        role="tooltip"
        style={
          side === "top"
            ? { bottom: "calc(100% + 6px)", top: "auto" }
            : undefined
        }
      >
        {content}
      </span>
    </span>
  );
}
