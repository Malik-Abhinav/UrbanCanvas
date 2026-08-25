"use client";

import type { ButtonHTMLAttributes, ReactNode } from "react";

/**
 * Production button (Task 26 design system).
 *
 * Wraps the stabilized .primary-button/.secondary-button classes; adds size,
 * loading (aria-busy + spinner), and a leading icon slot. All colors, radii,
 * motion, and disabled styling come from design tokens.
 */

export type ButtonVariant = "primary" | "secondary";
export type ButtonSize = "sm" | "md";

export type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** Shows a spinner and disables interaction while true. */
  isLoading?: boolean;
  leadingIcon?: ReactNode;
};

export function Button({
  variant = "primary",
  size = "md",
  isLoading = false,
  leadingIcon,
  className = "",
  children,
  disabled,
  type = "button",
  ...rest
}: ButtonProps) {
  const baseClass = variant === "primary" ? "primary-button" : "secondary-button";
  const sizeClass = size === "sm" ? "uc-button-sm" : "";

  return (
    <button
      aria-busy={isLoading || undefined}
      className={`uc-button uc-${variant} ${baseClass} ${sizeClass} ${className}`.trim()}
      disabled={disabled ?? isLoading}
      type={type}
      {...rest}
    >
      {isLoading ? <span aria-hidden="true" className="uc-spinner" /> : leadingIcon}
      <span>{children}</span>
    </button>
  );
}
