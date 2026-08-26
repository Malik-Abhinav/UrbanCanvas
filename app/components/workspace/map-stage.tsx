"use client";

import type { ComponentProps, PointerEvent, RefObject } from "react";
import type { DrawingObjectV1 } from "../../../shared/drawing-document";
import type { LayerSettings } from "../../layer-semantics";
import SatelliteOverlay from "../../satellite-overlay";
import { MapLegend } from "./map-legend";
import { OfflineBanner } from "./status-bar";

export type SelectionBox = {
  left: number;
  top: number;
  width: number;
  height: number;
};

export type OverlayBox = {
  left: number;
  top: number;
  width: number;
  height: number;
};

type MapStageProps = {
  /** Mapbox container element; the ref is owned by the workspace state host. */
  mapContainerRef: RefObject<HTMLDivElement | null>;
  isMapLoaded: boolean;
  mapError: string | null;

  // Area-selection drag layer.
  isSelectingArea: boolean;
  isAreaConfirmed: boolean;
  selectionBox: SelectionBox | null;
  isDraggingSelection: boolean;
  onSelectionPointerDown: (event: PointerEvent<HTMLDivElement>) => void;
  onSelectionPointerMove: (event: PointerEvent<HTMLDivElement>) => void;
  onSelectionPointerUp: (event: PointerEvent<HTMLDivElement>) => void;

  // Drawing overlay embedding.
  overlayBox: OverlayBox | null;
  loadedProjectObjects: DrawingObjectV1[];
  layerSettings: LayerSettings;
  getMapZoom: () => number;
  onBindPropertyUpdate: ComponentProps<typeof SatelliteOverlay>["onBindPropertyUpdate"];
  onSelectionChange: (object: DrawingObjectV1 | null) => void;
  highlightObjectIds?: string[];
  mapRevision: number;
  objectsRevision: number;
  onObjectsChange: (objects: DrawingObjectV1[]) => void;
  onMapPointToScreen: ComponentProps<typeof SatelliteOverlay>["onMapPointToScreen"];
  onMapPan: ComponentProps<typeof SatelliteOverlay>["onMapPan"];
  onMapZoom: ComponentProps<typeof SatelliteOverlay>["onMapZoom"];
  onScreenPointToMap: ComponentProps<typeof SatelliteOverlay>["onScreenPointToMap"];
  osmRoads: ComponentProps<typeof SatelliteOverlay>["osmRoads"];

  // Status badges.
  isFetchingOsm: boolean;
  showTokenNotice: boolean;
};

/** The map canvas section: Mapbox container, selection drag layer, drawing overlay, and status badges. */
export default function MapStage({
  getMapZoom,
  highlightObjectIds,
  isAreaConfirmed,
  isDraggingSelection,
  isFetchingOsm,
  isMapLoaded,
  isSelectingArea,
  layerSettings,
  loadedProjectObjects,
  mapContainerRef,
  mapError,
  mapRevision,
  objectsRevision,
  onBindPropertyUpdate,
  onMapPan,
  onMapPointToScreen,
  onMapZoom,
  onObjectsChange,
  onScreenPointToMap,
  onSelectionChange,
  onSelectionPointerDown,
  onSelectionPointerMove,
  onSelectionPointerUp,
  osmRoads,
  overlayBox,
  selectionBox,
  showTokenNotice
}: MapStageProps) {
  return (
    <section
      aria-label="Map canvas"
      className="relative h-[100dvh] min-h-[62vh] overflow-hidden bg-[#050706] lg:h-auto lg:min-h-screen"
      id="map-canvas"
    >
      <div ref={mapContainerRef} className="mapbox-panel absolute inset-0" />
      <OfflineBanner />
      <MapLegend />
      {!isMapLoaded && !mapError ? (
        <div className="pointer-events-none absolute left-4 top-4 z-10">
          <div aria-live="polite" className="rounded border border-white/15 bg-[#111612]/90 px-4 py-3 text-sm text-white/70 shadow-2xl">
            Loading satellite map...
          </div>
        </div>
      ) : null}
      {mapError ? (
        <div className="absolute inset-0 flex items-center justify-center bg-[#050706] p-6">
          <div className="max-w-md rounded border border-[#ff7968]/30 bg-[#111612] p-5 shadow-2xl">
            <h2 role="alert" className="text-lg font-semibold text-[#ffd1ca]">Map failed to load</h2>
            <p className="mt-3 text-sm leading-6 text-white/70">{mapError}</p>
          </div>
        </div>
      ) : null}
      <div
        className={`absolute inset-0 ${
          isSelectingArea && !isAreaConfirmed ? "cursor-crosshair" : "pointer-events-none"
        }`}
        onPointerDown={onSelectionPointerDown}
        onPointerMove={onSelectionPointerMove}
        onPointerUp={onSelectionPointerUp}
      >
        {selectionBox && isDraggingSelection && !isAreaConfirmed ? (
          <div
            className="absolute border-2 border-[#f5c542] bg-[#f5c542]/20"
            style={{
              height: selectionBox.height,
              left: selectionBox.left,
              top: selectionBox.top,
              width: selectionBox.width
            }}
          />
        ) : null}
      </div>

      {isAreaConfirmed && overlayBox ? (
        <div
          aria-label="Drawing canvas overlay"
          className="absolute overflow-hidden"
          role="region"
          style={{
            height: overlayBox.height,
            left: overlayBox.left,
            top: overlayBox.top,
            width: overlayBox.width
          }}
        >
          <SatelliteOverlay
            getMapZoom={getMapZoom}
            height={overlayBox.height}
            initialObjects={loadedProjectObjects}
            layerSettings={layerSettings}
            onBindPropertyUpdate={onBindPropertyUpdate}
            onSelectionChange={onSelectionChange}
            highlightObjectIds={highlightObjectIds}
            mapRevision={mapRevision}
            objectsRevision={objectsRevision}
            onObjectsChange={onObjectsChange}
            onMapPointToScreen={onMapPointToScreen}
            onMapPan={onMapPan}
            onMapZoom={onMapZoom}
            onScreenPointToMap={onScreenPointToMap}
            osmRoads={osmRoads}
            width={overlayBox.width}
          />
        </div>
      ) : null}

      {isAreaConfirmed ? (
        <div className="absolute right-4 top-4 rounded border border-white/15 bg-[#111612]/90 px-3 py-2 text-sm text-white/75 shadow-xl">
          Satellite base frozen. Canvas overlay ready.
          {isFetchingOsm ? <span className="ml-2 text-[#f5c542]">Fetching OSM...</span> : null}
        </div>
      ) : null}

      {showTokenNotice ? (
        <div className="absolute inset-0 flex items-center justify-center p-6">
          <div className="max-w-md rounded border border-white/15 bg-[#111612] p-5 shadow-2xl">
            <h2 className="text-xl font-semibold">Mapbox token needed</h2>
            <p className="mt-3 text-sm leading-6 text-white/70">
              Add your public Mapbox token to `.env` as `NEXT_PUBLIC_MAPBOX_TOKEN`,
              then restart `npm run dev`.
            </p>
          </div>
        </div>
      ) : null}
    </section>
  );
}
