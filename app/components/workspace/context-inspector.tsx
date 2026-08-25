"use client";

import ObjectInspector from "./object-inspector";
import type { DrawingObjectV1 } from "../../../shared/drawing-document";

type ContextInspectorProps = {
  isActive: boolean;
  object: DrawingObjectV1 | null;
  onPropertyChange: (key: string, value: string) => void;
};

/** Sidebar mirror of the overlay's current selection and its editable properties. */
export default function ContextInspector({ isActive, object, onPropertyChange }: ContextInspectorProps) {
  if (!isActive) {
    return null;
  }

  return (
    <div className="mt-4">
      <ObjectInspector object={object} onPropertyChange={onPropertyChange} />
    </div>
  );
}
