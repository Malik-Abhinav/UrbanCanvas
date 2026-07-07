"use client";

import { Layer, Line, Rect, Stage } from "react-konva";

type SatelliteOverlayProps = {
  height: number;
  width: number;
};

const gridSize = 32;

export default function SatelliteOverlay({ height, width }: SatelliteOverlayProps) {
  const verticalLines = Math.ceil(width / gridSize);
  const horizontalLines = Math.ceil(height / gridSize);

  return (
    <Stage height={height} width={width}>
      <Layer>
        <Rect
          fill="rgba(17, 20, 18, 0.08)"
          height={height}
          stroke="rgba(245, 197, 66, 0.55)"
          strokeWidth={2}
          width={width}
          x={0}
          y={0}
        />
        {Array.from({ length: verticalLines + 1 }, (_, index) => (
          <Line
            key={`vertical-${index}`}
            points={[index * gridSize, 0, index * gridSize, height]}
            stroke="rgba(255, 255, 255, 0.18)"
            strokeWidth={1}
          />
        ))}
        {Array.from({ length: horizontalLines + 1 }, (_, index) => (
          <Line
            key={`horizontal-${index}`}
            points={[0, index * gridSize, width, index * gridSize]}
            stroke="rgba(255, 255, 255, 0.18)"
            strokeWidth={1}
          />
        ))}
      </Layer>
    </Stage>
  );
}
