"use client";

import { useId } from "react";
import type { InputHTMLAttributes, ReactNode } from "react";

/**
 * Production text input (Task 26 design system).
 *
 * Label + input + one status message (error takes precedence over success),
 * wired for assistive tech: aria-invalid on the field and aria-describedby
 * pointing at hint/status text. Styling consumes design tokens exclusively.
 */

export type InputProps = Omit<InputHTMLAttributes<HTMLInputElement>, "id" | "className"> & {
  label: string;
  /** Supporting text shown when there is no error/success message. */
  hint?: string;
  error?: string;
  success?: string;
  /** Visually hide the label while keeping it for screen readers. */
  hideLabel?: boolean;
  trailing?: ReactNode;
};

export function Input({
  label,
  hint,
  error,
  success,
  hideLabel = false,
  trailing,
  required,
  ...rest
}: InputProps) {
  const id = useId();
  const messageId = `${id}-message`;
  const statusMessage = error ?? success;
  const describedBy = [hint ? messageId : null, statusMessage ? messageId : null]
    .filter(Boolean)
    .join(" ");

  return (
    <div className="uc-field">
      <label
        className={`uc-field-label${hideLabel ? " sr-only" : ""}`}
        htmlFor={id}
      >
        {label}
        {required ? <span aria-hidden="true"> *</span> : null}
      </label>
      <div style={{ display: "flex", gap: "var(--uc-space-2)" }}>
        <input
          aria-describedby={describedBy || undefined}
          aria-invalid={error ? true : undefined}
          className="field-input"
          id={id}
          required={required}
          {...rest}
        />
        {trailing}
      </div>
      {hint && !statusMessage ? (
        <p className="uc-field-hint" id={messageId}>
          {hint}
        </p>
      ) : null}
      {statusMessage ? (
        <p
          className={`uc-field-hint ${error ? "uc-field-error" : "uc-field-success"}`}
          id={messageId}
          role={error ? "alert" : "status"}
        >
          {statusMessage}
        </p>
      ) : null}
    </div>
  );
}
