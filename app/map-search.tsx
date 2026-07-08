"use client";

import { useEffect, useRef, useState } from "react";
import type { FormEvent, PointerEvent } from "react";
import mapboxgl, { Marker } from "mapbox-gl";
import type { GeoJSONSource, LngLatLike, Map } from "mapbox-gl";
import type { OsmData, OsmFeature } from "./canvas-renderer";
import SatelliteOverlay from "./satellite-overlay";

const mapboxToken = process.env.NEXT_PUBLIC_MAPBOX_TOKEN;
const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001";
const delhiCenter: [number, number] = [77.209, 28.6139];
const maxSelectionAreaKm2 = 5;
const selectionSourceId = "selected-area";
const selectionFillLayerId = "selected-area-fill";
const selectionLineLayerId = "selected-area-line";

type SearchResult = {
  id: string;
  place_name: string;
  center: [number, number];
};

type GeocodingResponse = {
  features?: SearchResult[];
  message?: string;
};

type ScreenPoint = {
  x: number;
  y: number;
};

type MapPoint = {
  lat: number;
  lng: number;
};

type SelectionBox = {
  left: number;
  top: number;
  width: number;
  height: number;
};

type BoundingBox = {
  north: number;
  south: number;
  east: number;
  west: number;
};

type OverlayBox = {
  left: number;
  top: number;
  width: number;
  height: number;
};

type OsmResponse = {
  status: "ok" | "error";
  data?: OsmData;
  message?: string;
};

export default function MapSearch() {
  const mapContainerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<Map | null>(null);
  const markerRef = useRef<Marker | null>(null);
  const dragStartRef = useRef<ScreenPoint | null>(null);
  const [query, setQuery] = useState("Delhi");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [selectedPlace, setSelectedPlace] = useState("Delhi, India");
  const [isSearching, setIsSearching] = useState(false);
  const [isSelectingArea, setIsSelectingArea] = useState(false);
  const [isDraggingSelection, setIsDraggingSelection] = useState(false);
  const [selectionBox, setSelectionBox] = useState<SelectionBox | null>(null);
  const [selectedBounds, setSelectedBounds] = useState<BoundingBox | null>(null);
  const [selectionAreaKm2, setSelectionAreaKm2] = useState<number | null>(null);
  const [selectionError, setSelectionError] = useState<string | null>(null);
  const [osmData, setOsmData] = useState<OsmData | null>(null);
  const [isFetchingOsm, setIsFetchingOsm] = useState(false);
  const [osmError, setOsmError] = useState<string | null>(null);
  const [isAreaConfirmed, setIsAreaConfirmed] = useState(false);
  const [overlayBox, setOverlayBox] = useState<OverlayBox | null>(null);
  const [mapRevision, setMapRevision] = useState(0);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!mapContainerRef.current || !mapboxToken || mapRef.current) {
      return;
    }

    mapboxgl.accessToken = mapboxToken;

    const map = new mapboxgl.Map({
      container: mapContainerRef.current,
      style: "mapbox://styles/mapbox/satellite-v9",
      center: delhiCenter,
      zoom: 10.8,
      pitch: 0,
      attributionControl: false
    });

    map.addControl(new mapboxgl.NavigationControl({ showCompass: false }), "bottom-right");
    map.addControl(new mapboxgl.AttributionControl({ compact: true }), "bottom-left");

    markerRef.current = new mapboxgl.Marker({ color: "#f5c542" })
      .setLngLat(delhiCenter)
      .addTo(map);
    mapRef.current = map;
    map.on("load", () => {
      ensureSelectionLayer(map);
    });
    map.on("move", () => {
      setMapRevision((current) => current + 1);
    });

    return () => {
      markerRef.current?.remove();
      map.remove();
      mapRef.current = null;
      markerRef.current = null;
    };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) {
      return;
    }

    if (isSelectingArea) {
      disableMapInteractions(map);
      map.getCanvas().style.cursor = "crosshair";
      return;
    }

    if (!isAreaConfirmed) {
      enableMapInteractions(map);
    }
    map.getCanvas().style.cursor = "";
    setIsDraggingSelection(false);
    dragStartRef.current = null;
  }, [isAreaConfirmed, isSelectingArea]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !map.isStyleLoaded()) {
      return;
    }

    syncSelectionLayer(map, selectedBounds);
  }, [selectedBounds]);

  async function handleSearch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const trimmedQuery = query.trim();
    if (!trimmedQuery) {
      setError("Enter a place name to search.");
      setResults([]);
      return;
    }

    if (!mapboxToken) {
      setError("Add NEXT_PUBLIC_MAPBOX_TOKEN to .env and restart npm run dev.");
      return;
    }

    setIsSearching(true);
    setError(null);

    try {
      const params = new URLSearchParams({
        access_token: mapboxToken,
        limit: "5",
        types: "place,locality,neighborhood,address",
        autocomplete: "true"
      });
      const response = await fetch(
        `https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(
          trimmedQuery
        )}.json?${params.toString()}`
      );
      const data = (await response.json()) as GeocodingResponse;

      if (!response.ok) {
        throw new Error(data.message ?? "Mapbox search failed.");
      }

      const nextResults = data.features ?? [];
      setResults(nextResults);

      if (nextResults.length === 0) {
        setError("No matching places found.");
        return;
      }

      flyToResult(nextResults[0]);
    } catch (searchError) {
      setResults([]);
      setError(searchError instanceof Error ? searchError.message : "Search failed.");
    } finally {
      setIsSearching(false);
    }
  }

  function flyToResult(result: SearchResult) {
    setSelectedPlace(result.place_name);
    setQuery(result.place_name);
    setError(null);

    const center = result.center as LngLatLike;
    markerRef.current?.setLngLat(center);
    mapRef.current?.flyTo({
      center,
      zoom: 12.4,
      speed: 0.9,
      curve: 1.35,
      essential: true
    });
  }

  function toggleAreaSelection() {
    setIsSelectingArea((current) => !current);
    setSelectionError(null);
    setSelectionBox(null);
    dragStartRef.current = null;
  }

  function clearSelection() {
    setSelectionBox(null);
    setSelectedBounds(null);
    setSelectionAreaKm2(null);
    setSelectionError(null);
    setOsmData(null);
    setOsmError(null);
    setIsAreaConfirmed(false);
    setOverlayBox(null);
    const map = mapRef.current;
    if (map) {
      enableMapInteractions(map);
    }
  }

  function handleSelectionPointerDown(event: PointerEvent<HTMLDivElement>) {
    if (!isSelectingArea || !mapRef.current) {
      return;
    }

    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);

    const point = getRelativePoint(event);
    dragStartRef.current = point;
    setIsDraggingSelection(true);
    setSelectionError(null);
    setSelectionBox({
      left: point.x,
      top: point.y,
      width: 0,
      height: 0
    });
  }

  function handleSelectionPointerMove(event: PointerEvent<HTMLDivElement>) {
    if (!isDraggingSelection || !dragStartRef.current) {
      return;
    }

    event.preventDefault();
    setSelectionBox(getSelectionBox(dragStartRef.current, getRelativePoint(event)));
  }

  function handleSelectionPointerUp(event: PointerEvent<HTMLDivElement>) {
    if (!isDraggingSelection || !dragStartRef.current || !mapRef.current) {
      return;
    }

    event.preventDefault();
    event.currentTarget.releasePointerCapture(event.pointerId);

    const finalBox = getSelectionBox(dragStartRef.current, getRelativePoint(event));
    setIsDraggingSelection(false);
    dragStartRef.current = null;

    if (finalBox.width < 8 || finalBox.height < 8) {
      setSelectionBox(null);
      setSelectionError("Drag a larger box to select an area.");
      return;
    }

    const bounds = getBoundsFromSelection(finalBox);
    const areaKm2 = getApproximateAreaKm2(bounds);

    if (areaKm2 > maxSelectionAreaKm2) {
      setSelectionBox(null);
      setSelectedBounds(null);
      setSelectionAreaKm2(null);
      setSelectionError(`Select a smaller area. Keep it under ${maxSelectionAreaKm2} km2 for now.`);
      return;
    }

    setSelectionBox(null);
    setSelectedBounds(bounds);
    setSelectionAreaKm2(areaKm2);
    setOsmData(null);
    setOsmError(null);
    setIsAreaConfirmed(false);
    setOverlayBox(null);
    setSelectionError(null);
    setIsSelectingArea(false);
  }

  async function confirmSelectedArea() {
    if (!selectedBounds) {
      setOsmError("Select an area first.");
      return;
    }

    const map = mapRef.current;
    if (!map) {
      return;
    }

    setIsAreaConfirmed(true);
    setOverlayBox(null);
    setResults([]);
    setSelectionError(null);
    disableMapInteractions(map);
    syncSelectionLayer(map, null);

    map.fitBounds(
      [
        [selectedBounds.west, selectedBounds.south],
        [selectedBounds.east, selectedBounds.north]
      ],
      {
        duration: 700,
        padding: 48
      }
    );

    map.once("moveend", () => {
      disableMapInteractions(map);
      setOverlayBox(getOverlayBoxFromBounds(map, selectedBounds));
    });

    void fetchSelectedAreaData(selectedBounds);
  }

  async function fetchSelectedAreaData(bounds: BoundingBox) {
    setIsFetchingOsm(true);
    setOsmError(null);

    try {
      const response = await fetch(`${apiUrl}/api/osm`, {
        method: "POST",
        headers: {
          "content-type": "application/json"
        },
        body: JSON.stringify({
          bbox: bounds
        })
      });
      const payload = (await response.json()) as OsmResponse;

      if (!response.ok || payload.status !== "ok" || !payload.data) {
        throw new Error(payload.message ?? "Unable to fetch map data.");
      }

      if (!isOsmData(payload.data)) {
        throw new Error("Map data response was not in the expected format.");
      }

      setOsmData(payload.data);
    } catch (fetchError) {
      setOsmData(null);
      setOsmError(fetchError instanceof Error ? fetchError.message : "Unable to fetch map data.");
    } finally {
      setIsFetchingOsm(false);
    }
  }

  function getRelativePoint(event: PointerEvent<HTMLDivElement>): ScreenPoint {
    const rect = event.currentTarget.getBoundingClientRect();

    return {
      x: event.clientX - rect.left,
      y: event.clientY - rect.top
    };
  }

  function getBoundsFromSelection(box: SelectionBox): BoundingBox {
    const map = mapRef.current;
    if (!map) {
      return {
        north: 0,
        south: 0,
        east: 0,
        west: 0
      };
    }

    const northwest = map.unproject([box.left, box.top]);
    const southeast = map.unproject([box.left + box.width, box.top + box.height]);

    return {
      north: Math.max(northwest.lat, southeast.lat),
      south: Math.min(northwest.lat, southeast.lat),
      east: Math.max(northwest.lng, southeast.lng),
      west: Math.min(northwest.lng, southeast.lng)
    };
  }

  function screenPointToMapPoint(point: ScreenPoint): MapPoint {
    const map = mapRef.current;
    if (!map || !overlayBox) {
      return { lat: 0, lng: 0 };
    }

    const lngLat = map.unproject([overlayBox.left + point.x, overlayBox.top + point.y]);

    return {
      lat: lngLat.lat,
      lng: lngLat.lng
    };
  }

  function mapPointToScreenPoint(point: MapPoint): ScreenPoint {
    const map = mapRef.current;
    if (!map || !overlayBox) {
      return { x: 0, y: 0 };
    }

    const projected = map.project([point.lng, point.lat]);

    return {
      x: projected.x - overlayBox.left,
      y: projected.y - overlayBox.top
    };
  }

  function panConfirmedMap(delta: ScreenPoint) {
    const map = mapRef.current;
    if (!map || !selectedBounds) {
      return;
    }

    map.panBy([-delta.x, -delta.y], {
      duration: 0
    });
  }

  function zoomConfirmedMap(direction: "in" | "out" | "reset") {
    const map = mapRef.current;
    if (!map || !selectedBounds) {
      return;
    }

    if (direction === "reset") {
      map.fitBounds(
        [
          [selectedBounds.west, selectedBounds.south],
          [selectedBounds.east, selectedBounds.north]
        ],
        {
          duration: 260,
          padding: 48
        }
      );
      map.once("moveend", () => {
        disableMapInteractions(map);
        setOverlayBox(getOverlayBoxFromBounds(map, selectedBounds));
      });
      return;
    }

    const overlayCenter = overlayBox
      ? map.unproject([overlayBox.left + overlayBox.width / 2, overlayBox.top + overlayBox.height / 2])
      : map.getCenter();

    map.easeTo({
      around: overlayCenter,
      duration: 180,
      zoom: map.getZoom() + (direction === "in" ? 0.45 : -0.45)
    });
  }

  return (
    <main className="min-h-screen bg-[#111412] text-[#f7faf4]">
      <div className="grid min-h-screen lg:grid-cols-[380px_1fr]">
        <aside className="z-10 border-b border-white/10 bg-[#161a18] px-5 py-5 shadow-2xl lg:border-b-0 lg:border-r">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-sm font-semibold text-[#f5c542]">UrbanCanvas</p>
              <h1 className="mt-2 text-3xl font-semibold leading-tight">Map workspace</h1>
            </div>
            <span className="rounded border border-white/15 px-2.5 py-1 text-xs text-white/70">
              Milestone 4
            </span>
          </div>

          <form className="mt-8" onSubmit={handleSearch}>
            <label className="text-sm font-medium text-white/75" htmlFor="location-search">
              Search location
            </label>
            <div className="mt-2 flex gap-2">
              <input
                id="location-search"
                className="min-w-0 flex-1 rounded border border-white/15 bg-white px-3 py-2.5 text-sm text-[#111412] outline-none transition focus:border-[#f5c542] focus:ring-2 focus:ring-[#f5c542]/35"
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Delhi"
                type="search"
                value={query}
              />
              <button
                className="rounded bg-[#f5c542] px-4 py-2.5 text-sm font-semibold text-[#111412] transition hover:bg-[#ffd85a] disabled:cursor-not-allowed disabled:opacity-60"
                disabled={isSearching}
                type="submit"
              >
                {isSearching ? "Searching" : "Search"}
              </button>
            </div>
          </form>

          {error ? (
            <p className="mt-4 rounded border border-[#f5c542]/30 bg-[#f5c542]/10 px-3 py-2 text-sm leading-6 text-[#ffe6a1]">
              {error}
            </p>
          ) : null}

          <section className="mt-6">
            <p className="text-xs font-semibold uppercase text-white/45">Focused place</p>
            <p className="mt-2 text-sm leading-6 text-white/80">{selectedPlace}</p>
          </section>

          <section className="mt-6 border-t border-white/10 pt-5">
            <div className="flex gap-2">
              <button
                className={`flex-1 rounded px-4 py-2.5 text-sm font-semibold transition ${
                  isSelectingArea
                    ? "bg-[#f5c542] text-[#111412] hover:bg-[#ffd85a]"
                    : "border border-white/15 bg-white/[0.04] text-white hover:border-[#f5c542]/50 hover:bg-white/[0.08]"
                }`}
                onClick={toggleAreaSelection}
                type="button"
              >
                {isSelectingArea ? "Selecting..." : "Select Area"}
              </button>
              <button
                className="rounded border border-white/15 px-4 py-2.5 text-sm font-semibold text-white/75 transition hover:border-white/30 hover:bg-white/[0.06] disabled:cursor-not-allowed disabled:opacity-45"
                disabled={!selectedBounds}
                onClick={clearSelection}
                type="button"
              >
                Clear
              </button>
            </div>

            {selectionError ? (
              <p className="mt-3 rounded border border-[#f5c542]/30 bg-[#f5c542]/10 px-3 py-2 text-sm leading-6 text-[#ffe6a1]">
                {selectionError}
              </p>
            ) : null}

            {selectedBounds ? (
              <div className="mt-4 rounded border border-white/10 bg-white/[0.04] p-3">
                <p className="text-xs font-semibold uppercase text-white/45">Selected bounds</p>
                <dl className="mt-3 grid grid-cols-2 gap-3 text-sm">
                  <Coordinate label="North" value={selectedBounds.north} />
                  <Coordinate label="South" value={selectedBounds.south} />
                  <Coordinate label="East" value={selectedBounds.east} />
                  <Coordinate label="West" value={selectedBounds.west} />
                </dl>
                {selectionAreaKm2 !== null ? (
                  <p className="mt-3 text-xs text-white/55">
                    Approx. area: {selectionAreaKm2.toFixed(2)} km2
                  </p>
                ) : null}
                <button
                  className="mt-4 w-full rounded bg-[#f5c542] px-4 py-2.5 text-sm font-semibold text-[#111412] transition hover:bg-[#ffd85a] disabled:cursor-not-allowed disabled:opacity-60"
                  disabled={isAreaConfirmed}
                  onClick={confirmSelectedArea}
                  type="button"
                >
                  {isAreaConfirmed ? "Area Confirmed" : "Confirm Area"}
                </button>
              </div>
            ) : null}

            {osmError ? (
              <p className="mt-3 rounded border border-[#ff6b57]/30 bg-[#ff6b57]/10 px-3 py-2 text-sm leading-6 text-[#ffd1ca]">
                {osmError}
              </p>
            ) : null}

            {osmData ? (
              <div className="mt-4 rounded border border-white/10 bg-[#0d100f] p-3">
                <p className="text-xs font-semibold uppercase text-white/45">OSM data stored</p>
                <div className="mt-3 grid grid-cols-3 gap-2">
                  <Count label="Buildings" value={osmData.counts.buildings} />
                  <Count label="Roads" value={osmData.counts.roads} />
                  <Count label="Open land" value={osmData.counts.openLand} />
                </div>
              </div>
            ) : null}
          </section>

          {results.length > 0 ? (
            <section className="mt-6">
              <p className="text-xs font-semibold uppercase text-white/45">Results</p>
              <div className="mt-3 space-y-2">
                {results.map((result) => (
                  <button
                    className="w-full rounded border border-white/10 bg-white/[0.04] px-3 py-3 text-left text-sm leading-5 text-white/80 transition hover:border-[#f5c542]/50 hover:bg-white/[0.08]"
                    key={result.id}
                    onClick={() => flyToResult(result)}
                    type="button"
                  >
                    {result.place_name}
                  </button>
                ))}
              </div>
            </section>
          ) : null}

          <div className="mt-8 border-t border-white/10 pt-5 text-sm leading-6 text-white/55">
            Confirm an area to freeze satellite imagery and place a transparent canvas over it.
          </div>
        </aside>

        <section className="relative min-h-[62vh] overflow-hidden bg-[#0d100f] lg:min-h-screen">
          <div ref={mapContainerRef} className="absolute inset-0" />
          <div
            className={`absolute inset-0 ${
              isSelectingArea && !isAreaConfirmed ? "cursor-crosshair" : "pointer-events-none"
            }`}
            onPointerDown={handleSelectionPointerDown}
            onPointerMove={handleSelectionPointerMove}
            onPointerUp={handleSelectionPointerUp}
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
              className="absolute overflow-hidden"
              style={{
                height: overlayBox.height,
                left: overlayBox.left,
                top: overlayBox.top,
                width: overlayBox.width
              }}
            >
              <SatelliteOverlay
                height={overlayBox.height}
                key="screen-size-drawing-model"
                mapRevision={mapRevision}
                onMapPointToScreen={(point) => mapPointToScreenPoint(point)}
                onMapPan={(delta) => panConfirmedMap(delta)}
                onMapZoom={(direction) => zoomConfirmedMap(direction)}
                onScreenPointToMap={(point) => screenPointToMapPoint(point)}
                width={overlayBox.width}
              />
            </div>
          ) : null}

          {isAreaConfirmed ? (
            <div className="absolute right-4 top-4 rounded border border-white/15 bg-[#161a18]/90 px-3 py-2 text-sm text-white/75 shadow-xl">
              Satellite base frozen. Canvas overlay ready.
              {isFetchingOsm ? <span className="ml-2 text-[#f5c542]">Fetching OSM...</span> : null}
            </div>
          ) : null}

          {!mapboxToken && !isAreaConfirmed ? (
            <div className="absolute inset-0 flex items-center justify-center p-6">
              <div className="max-w-md rounded border border-white/15 bg-[#161a18] p-5 shadow-2xl">
                <h2 className="text-xl font-semibold">Mapbox token needed</h2>
                <p className="mt-3 text-sm leading-6 text-white/70">
                  Add your public Mapbox token to `.env` as `NEXT_PUBLIC_MAPBOX_TOKEN`,
                  then restart `npm run dev`.
                </p>
              </div>
            </div>
          ) : null}
        </section>
      </div>
    </main>
  );
}

function isOsmData(value: unknown): value is OsmData {
  if (!value || typeof value !== "object") {
    return false;
  }

  const data = value as Partial<OsmData>;

  return (
    isFeatureArray(data.buildings) &&
    isFeatureArray(data.roads) &&
    isFeatureArray(data.openLand) &&
    Boolean(data.bbox) &&
    Boolean(data.counts)
  );
}

function isFeatureArray(value: unknown): value is OsmFeature[] {
  return (
    Array.isArray(value) &&
    value.every((feature) => {
      if (!feature || typeof feature !== "object") {
        return false;
      }

      const candidate = feature as Partial<OsmFeature>;

      return (
        typeof candidate.id === "number" &&
        typeof candidate.kind === "string" &&
        Array.isArray(candidate.geometry)
      );
    })
  );
}

function Coordinate({ label, value }: { label: string; value: number }) {
  return (
    <div>
      <dt className="text-xs text-white/45">{label}</dt>
      <dd className="mt-1 font-mono text-xs text-white/85">{value.toFixed(6)}</dd>
    </div>
  );
}

function Count({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded border border-white/10 bg-white/[0.04] px-2 py-2">
      <p className="text-[11px] text-white/45">{label}</p>
      <p className="mt-1 text-sm font-semibold text-white">{value}</p>
    </div>
  );
}

function getOverlayBoxFromBounds(map: Map, bounds: BoundingBox): OverlayBox {
  const northwest = map.project([bounds.west, bounds.north]);
  const southeast = map.project([bounds.east, bounds.south]);

  return {
    left: Math.min(northwest.x, southeast.x),
    top: Math.min(northwest.y, southeast.y),
    width: Math.abs(southeast.x - northwest.x),
    height: Math.abs(southeast.y - northwest.y)
  };
}

function getSelectionBox(start: ScreenPoint, end: ScreenPoint): SelectionBox {
  return {
    left: Math.min(start.x, end.x),
    top: Math.min(start.y, end.y),
    width: Math.abs(end.x - start.x),
    height: Math.abs(end.y - start.y)
  };
}

function getApproximateAreaKm2(bounds: BoundingBox) {
  const centerLatitude = ((bounds.north + bounds.south) / 2) * (Math.PI / 180);
  const kmPerLatitudeDegree = 111.32;
  const kmPerLongitudeDegree = 111.32 * Math.cos(centerLatitude);
  const heightKm = Math.abs(bounds.north - bounds.south) * kmPerLatitudeDegree;
  const widthKm = Math.abs(bounds.east - bounds.west) * kmPerLongitudeDegree;

  return widthKm * heightKm;
}

function disableMapInteractions(map: Map) {
  map.dragPan.disable();
  map.scrollZoom.disable();
  map.boxZoom.disable();
  map.dragRotate.disable();
  map.keyboard.disable();
  map.doubleClickZoom.disable();
  map.touchZoomRotate.disable();
}

function enableMapInteractions(map: Map) {
  map.dragPan.enable();
  map.scrollZoom.enable();
  map.boxZoom.enable();
  map.dragRotate.enable();
  map.keyboard.enable();
  map.doubleClickZoom.enable();
  map.touchZoomRotate.enable();
}

function ensureSelectionLayer(map: Map) {
  if (!map.getSource(selectionSourceId)) {
    map.addSource(selectionSourceId, {
      type: "geojson",
      data: getEmptyFeatureCollection()
    });
  }

  if (!map.getLayer(selectionFillLayerId)) {
    map.addLayer({
      id: selectionFillLayerId,
      source: selectionSourceId,
      type: "fill",
      paint: {
        "fill-color": "#f5c542",
        "fill-opacity": 0.2
      }
    });
  }

  if (!map.getLayer(selectionLineLayerId)) {
    map.addLayer({
      id: selectionLineLayerId,
      source: selectionSourceId,
      type: "line",
      paint: {
        "line-color": "#f5c542",
        "line-width": 2
      }
    });
  }
}

function syncSelectionLayer(map: Map, bounds: BoundingBox | null) {
  ensureSelectionLayer(map);

  const source = map.getSource(selectionSourceId) as GeoJSONSource | undefined;
  source?.setData(bounds ? getBoundsFeatureCollection(bounds) : getEmptyFeatureCollection());
}

function getBoundsFeatureCollection(bounds: BoundingBox): Parameters<GeoJSONSource["setData"]>[0] {
  return {
    type: "FeatureCollection",
    features: [
      {
        type: "Feature",
        properties: {},
        geometry: {
          type: "Polygon",
          coordinates: [
            [
              [bounds.west, bounds.north],
              [bounds.east, bounds.north],
              [bounds.east, bounds.south],
              [bounds.west, bounds.south],
              [bounds.west, bounds.north]
            ]
          ]
        }
      }
    ]
  };
}

function getEmptyFeatureCollection(): Parameters<GeoJSONSource["setData"]>[0] {
  return {
    type: "FeatureCollection",
    features: []
  };
}
