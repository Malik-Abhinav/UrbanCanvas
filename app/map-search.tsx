"use client";

import { Show, SignInButton, SignUpButton, UserButton, useAuth } from "@clerk/nextjs";
import { useCallback, useEffect, useRef, useState } from "react";
import type { FormEvent, PointerEvent } from "react";
import mapboxgl, { Marker } from "mapbox-gl";
import type { GeoJSONSource, LngLatLike, Map } from "mapbox-gl";
import { PanelLeftClose, PanelLeftOpen, Trash2 } from "lucide-react";
import type { OsmData, OsmFeature } from "./canvas-renderer";
import { apiFetch } from "./api-fetch";
import SatelliteOverlay from "./satellite-overlay";
import type { DrawingObject } from "./satellite-overlay";

const mapboxToken = process.env.NEXT_PUBLIC_MAPBOX_TOKEN;
const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001";
const delhiCenter: [number, number] = [77.209, 28.6139];
const maxSelectionAreaKm2 = 5;
const autoSaveDelayMs = 120_000;
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

type ProjectSummary = {
  bbox: BoundingBox;
  created_at: string;
  id: string;
  name: string;
  updated_at: string;
};

type ProjectDetail = ProjectSummary & {
  osm_data: OsmData;
  user_edits: DrawingObject[];
};

type ProjectsResponse = {
  status: "ok" | "error";
  message?: string;
  projects?: ProjectSummary[];
};

type ProjectResponse = {
  status: "ok" | "error";
  message?: string;
  project?: ProjectDetail;
};

type ChangeAnalysis = {
  disclaimer: string;
  pedestrianImpact: string[];
  provider: "rules";
  safetyObservations: string[];
  suggestions: string[];
  summary: string;
};

type AnalysisResponse = {
  status: "ok" | "error";
  analysis?: ChangeAnalysis;
  message?: string;
};

export default function MapSearch() {
  const { getToken, isSignedIn } = useAuth();
  const mapContainerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<Map | null>(null);
  const markerRef = useRef<Marker | null>(null);
  const dragStartRef = useRef<ScreenPoint | null>(null);
  const lastSavedSignatureRef = useRef<string | null>(null);
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
  const [isMapLoaded, setIsMapLoaded] = useState(false);
  const [mapError, setMapError] = useState<string | null>(null);
  const [projectName, setProjectName] = useState("Untitled project");
  const [currentProjectId, setCurrentProjectId] = useState<string | null>(null);
  const [projectObjects, setProjectObjects] = useState<DrawingObject[]>([]);
  const [loadedProjectObjects, setLoadedProjectObjects] = useState<DrawingObject[]>([]);
  const [projectObjectsRevision, setProjectObjectsRevision] = useState(0);
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [isSavingProject, setIsSavingProject] = useState(false);
  const [isLoadingProjects, setIsLoadingProjects] = useState(false);
  const [projectMessage, setProjectMessage] = useState<string | null>(null);
  const [changeAnalysis, setChangeAnalysis] = useState<ChangeAnalysis | null>(null);
  const [isAnalyzingChanges, setIsAnalyzingChanges] = useState(false);
  const [analysisMessage, setAnalysisMessage] = useState<string | null>(null);
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [deletingProjectId, setDeletingProjectId] = useState<string | null>(null);
  const [projectDeleteError, setProjectDeleteError] = useState<string | null>(null);

  const handleObjectsChange = useCallback((objects: DrawingObject[]) => {
    setProjectObjects(objects);
  }, []);

  useEffect(() => {
    window.setTimeout(() => {
      mapRef.current?.resize();
      setMapRevision((current) => current + 1);
    }, 260);
  }, [isSidebarCollapsed]);

  const getProjectRequestHeaders = useCallback(async () => {
    const token = await getToken();

    if (!token) {
      throw new Error("Sign in before using saved projects.");
    }

    return {
      authorization: `Bearer ${token}`,
      "content-type": "application/json"
    };
  }, [getToken]);

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
      setMapError(null);
      setIsMapLoaded(true);
      map.resize();
      ensureSelectionLayer(map);
    });
    map.on("idle", () => {
      setMapError(null);
      setIsMapLoaded(true);
    });
    map.on("styledata", () => {
      if (map.isStyleLoaded()) {
        setMapError(null);
        setIsMapLoaded(true);
      }
    });
    map.on("error", (event) => {
      const message = event.error?.message ?? "Mapbox failed to load satellite imagery.";
      setMapError(message);
    });
    map.on("move", () => {
      setMapRevision((current) => current + 1);
    });

    const resizeObserver = new ResizeObserver(() => {
      map.resize();
    });
    resizeObserver.observe(mapContainerRef.current);

    window.requestAnimationFrame(() => {
      map.resize();
    });
    window.setTimeout(() => {
      map.resize();
      if (map.loaded() || map.isStyleLoaded()) {
        setIsMapLoaded(true);
      }
    }, 250);

    return () => {
      resizeObserver.disconnect();
      markerRef.current?.remove();
      map.remove();
      mapRef.current = null;
      markerRef.current = null;
      setIsMapLoaded(false);
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
    setCurrentProjectId(null);
    setProjectObjects([]);
    setLoadedProjectObjects([]);
    setProjectObjectsRevision((current) => current + 1);
    setChangeAnalysis(null);
    setAnalysisMessage(null);
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
    setCurrentProjectId(null);
    setProjectObjects([]);
    setLoadedProjectObjects([]);
    setProjectObjectsRevision((current) => current + 1);
    setChangeAnalysis(null);
    setAnalysisMessage(null);
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
      const response = await apiFetch(`${apiUrl}/api/osm`, {
        method: "POST",
        headers: {
          "content-type": "application/json"
        },
        body: JSON.stringify({
          bbox: bounds
        })
      });
      const payload = await readApiJson<OsmResponse>(response);

      if (!response.ok || payload.status !== "ok" || !payload.data) {
        throw new Error(payload.message ?? "Unable to fetch map data.");
      }

      if (!isOsmData(payload.data)) {
        throw new Error("Map data response was not in the expected format.");
      }

      setOsmData(payload.data);
      if (payload.data.counts.roads === 0) {
        setOsmError("No OSM roads were found in this selection. You can still draw, but snapping and graph analysis will be limited.");
      }
    } catch (fetchError) {
      setOsmData(null);
      setOsmError(fetchError instanceof Error ? fetchError.message : "Unable to fetch map data.");
    } finally {
      setIsFetchingOsm(false);
    }
  }

  const fetchProjects = useCallback(async () => {
    if (!isSignedIn) {
      setProjects([]);
      setProjectMessage(null);
      setIsLoadingProjects(false);
      return;
    }

    setIsLoadingProjects(true);

    try {
      const response = await apiFetch(`${apiUrl}/api/projects`, {
        headers: await getProjectRequestHeaders()
      });
      const payload = await readApiJson<ProjectsResponse>(response);

      if (!response.ok || payload.status !== "ok") {
        throw new Error(payload.message ?? "Unable to load projects.");
      }

      setProjects(payload.projects ?? []);
    } catch (fetchError) {
      setProjectMessage(fetchError instanceof Error ? fetchError.message : "Unable to load projects.");
    } finally {
      setIsLoadingProjects(false);
    }
  }, [getProjectRequestHeaders, isSignedIn]);

  useEffect(() => {
    void fetchProjects();
  }, [fetchProjects]);

  const saveCurrentProject = useCallback(
    async ({ silent = false }: { silent?: boolean } = {}) => {
    if (!selectedBounds || !osmData) {
      if (!silent) {
        setProjectMessage("Confirm an area and wait for OSM data before saving.");
      }
      return;
    }

    const signature = getProjectSaveSignature({
      bbox: selectedBounds,
      name: projectName,
      osmData,
      userEdits: projectObjects
    });

    if (silent && signature === lastSavedSignatureRef.current) {
      return;
    }

    if (!silent) {
      setIsSavingProject(true);
      setProjectMessage(null);
    }

    try {
      const response = await apiFetch(`${apiUrl}/api/projects`, {
        method: "POST",
        headers: await getProjectRequestHeaders(),
        body: JSON.stringify({
          bbox: selectedBounds,
          id: currentProjectId,
          name: projectName,
          osmData,
          userEdits: projectObjects
        })
      });
      const payload = await readApiJson<ProjectResponse>(response);

      if (!response.ok || payload.status !== "ok" || !payload.project) {
        throw new Error(payload.message ?? "Unable to save project.");
      }

      setCurrentProjectId(payload.project.id);
      setProjectName(payload.project.name);
      lastSavedSignatureRef.current = signature;

      if (silent) {
        setProjectMessage(`Auto-saved ${formatProjectDate(new Date().toISOString())}.`);
      } else {
        setProjectMessage("Project saved.");
      }

      if (!silent) {
        await fetchProjects();
      }
    } catch (saveError) {
      setProjectMessage(saveError instanceof Error ? saveError.message : "Unable to save project.");
    } finally {
      if (!silent) {
        setIsSavingProject(false);
      }
    }
    },
    [currentProjectId, fetchProjects, getProjectRequestHeaders, osmData, projectName, projectObjects, selectedBounds]
  );

  useEffect(() => {
    if (!isSignedIn || !isAreaConfirmed || !osmData || !selectedBounds) {
      return;
    }

    const timeoutId = window.setTimeout(() => {
      void saveCurrentProject({ silent: true });
    }, autoSaveDelayMs);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [isAreaConfirmed, isSignedIn, osmData, projectName, projectObjects, saveCurrentProject, selectedBounds]);

  const deleteProject = useCallback(
    async (id: string) => {
      setProjectDeleteError(null);

      if (!window.confirm("Delete this saved project? This cannot be undone.")) {
        return;
      }

      setDeletingProjectId(id);

      try {
        const response = await apiFetch(`${apiUrl}/api/projects/${id}`, {
          method: "DELETE",
          headers: await getProjectRequestHeaders()
        });
        const payload = await readApiJson<{ status: "ok" | "error"; message?: string }>(response);

        if (!response.ok || payload.status !== "ok") {
          throw new Error(payload.message ?? "Unable to delete project.");
        }

        if (currentProjectId === id) {
          clearSelection();
        }

        setProjects((current) => current.filter((project) => project.id !== id));
        setProjectMessage("Project deleted.");
      } catch (deleteError) {
        setProjectDeleteError(deleteError instanceof Error ? deleteError.message : "Unable to delete project.");
      } finally {
        setDeletingProjectId(null);
      }
    },
    [currentProjectId, getProjectRequestHeaders]
  );

  async function loadProject(id: string) {
    const map = mapRef.current;
    if (!map) {
      setProjectMessage("Map is not ready yet.");
      return;
    }

    setProjectMessage(null);

    try {
      const response = await apiFetch(`${apiUrl}/api/projects/${id}`, {
        headers: await getProjectRequestHeaders()
      });
      const payload = await readApiJson<ProjectResponse>(response);

      if (!response.ok || payload.status !== "ok" || !payload.project) {
        throw new Error(payload.message ?? "Unable to load project.");
      }

      const project = payload.project;
      setCurrentProjectId(project.id);
      setProjectName(project.name);
      setSelectedBounds(project.bbox);
      setSelectionAreaKm2(getApproximateAreaKm2(project.bbox));
      setOsmData(project.osm_data);
      setOsmError(null);
      setIsSelectingArea(false);
      setIsAreaConfirmed(true);
      setOverlayBox(null);
      setProjectObjects(project.user_edits);
      setLoadedProjectObjects(project.user_edits);
      setProjectObjectsRevision((current) => current + 1);
      setChangeAnalysis(null);
      setAnalysisMessage(null);
      lastSavedSignatureRef.current = getProjectSaveSignature({
        bbox: project.bbox,
        name: project.name,
        osmData: project.osm_data,
        userEdits: project.user_edits
      });
      disableMapInteractions(map);
      syncSelectionLayer(map, null);

      map.fitBounds(
        [
          [project.bbox.west, project.bbox.south],
          [project.bbox.east, project.bbox.north]
        ],
        {
          duration: 500,
          padding: 48
        }
      );

      map.once("moveend", () => {
        disableMapInteractions(map);
        setOverlayBox(getOverlayBoxFromBounds(map, project.bbox));
      });
      setProjectMessage("Project loaded.");
    } catch (loadError) {
      setProjectMessage(loadError instanceof Error ? loadError.message : "Unable to load project.");
    }
  }

  async function analyzeCurrentChanges() {
    if (!selectedBounds || !osmData) {
      setAnalysisMessage("Confirm an area and wait for OSM data before analyzing changes.");
      return;
    }

    setIsAnalyzingChanges(true);
    setAnalysisMessage(null);

    try {
      const response = await apiFetch(`${apiUrl}/api/analyze`, {
        method: "POST",
        headers: await getProjectRequestHeaders(),
        body: JSON.stringify({
          bbox: selectedBounds,
          osmData,
          projectName,
          userEdits: projectObjects
        })
      });
      const payload = await readApiJson<AnalysisResponse>(response);

      if (!response.ok || payload.status !== "ok" || !payload.analysis) {
        throw new Error(payload.message ?? "Unable to analyze changes.");
      }

      setChangeAnalysis(payload.analysis);
      setAnalysisMessage(null);
    } catch (analysisError) {
      setChangeAnalysis(null);
      setAnalysisMessage(analysisError instanceof Error ? analysisError.message : "Unable to analyze changes.");
    } finally {
      setIsAnalyzingChanges(false);
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
              <Show when="signed-out">
                <SignInButton mode="modal">
                  <button
                    className={`secondary-button px-2.5 py-1 text-xs ${isSidebarCollapsed ? "hidden" : ""}`}
                    type="button"
                  >
                    Sign in
                  </button>
                </SignInButton>
                <SignUpButton mode="modal">
                  <button
                    className={`primary-button px-2.5 py-1 text-xs ${isSidebarCollapsed ? "hidden" : ""}`}
                    type="button"
                  >
                    Sign up
                  </button>
                </SignUpButton>
              </Show>
              <Show when="signed-in">
                <UserButton />
              </Show>
              <button
                aria-label={isSidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"}
                className="icon-button"
                onClick={() => setIsSidebarCollapsed((current) => !current)}
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
          <form className="mt-8" onSubmit={handleSearch}>
            <label className="text-sm font-medium text-white/75" htmlFor="location-search">
              Search location
            </label>
            <div className="mt-2 flex gap-2">
              <input
                id="location-search"
                className="field-input min-w-0 flex-1"
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Delhi"
                type="search"
                value={query}
              />
              <button
                className="primary-button px-4 py-2.5 text-sm"
                disabled={isSearching}
                type="submit"
              >
                {isSearching ? "Searching" : "Search"}
              </button>
            </div>
          </form>

          {error ? (
            <p className="mt-4 rounded border border-[#f5c542]/30 bg-[#f5c542]/10 px-3 py-2 text-sm leading-6 text-[#ffe6a1]" role="alert">
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
                aria-pressed={isSelectingArea}
                className={`flex-1 rounded-lg px-4 py-2.5 text-sm font-semibold transition ${
                  isSelectingArea
                    ? "bg-[#63e6be] text-[#06110e] shadow-[0_14px_35px_rgba(99,230,190,0.18)] hover:bg-[#7ff2cf]"
                    : "border border-white/15 bg-white/[0.04] text-white hover:border-[#63e6be]/50 hover:bg-white/[0.08]"
                }`}
                onClick={toggleAreaSelection}
                type="button"
              >
                {isSelectingArea ? "Selecting..." : "Select Area"}
              </button>
              <button
                className="secondary-button px-4 py-2.5 text-sm"
                disabled={!selectedBounds}
                onClick={clearSelection}
                type="button"
              >
                Clear
              </button>
            </div>

            {selectionError ? (
              <p className="mt-3 rounded border border-[#f5c542]/30 bg-[#f5c542]/10 px-3 py-2 text-sm leading-6 text-[#ffe6a1]" role="alert">
                {selectionError}
              </p>
            ) : null}

            {selectedBounds ? (
              <div className="info-panel mt-4 p-3">
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
                  className="primary-button mt-4 w-full px-4 py-2.5 text-sm"
                  disabled={isAreaConfirmed}
                  onClick={confirmSelectedArea}
                  type="button"
                >
                  {isAreaConfirmed ? "Area Confirmed" : "Confirm Area"}
                </button>
              </div>
            ) : null}

            {osmError ? (
              <p className="mt-3 rounded border border-[#ff6b57]/30 bg-[#ff6b57]/10 px-3 py-2 text-sm leading-6 text-[#ffd1ca]" role="alert">
                {osmError}
              </p>
            ) : null}

            {osmData ? (
              <div className="info-panel mt-4 p-3">
                <p className="text-xs font-semibold uppercase text-white/45">OSM data stored</p>
                <div className="mt-3 grid grid-cols-3 gap-2">
                  <Count label="Buildings" value={osmData.counts.buildings} />
                  <Count label="Roads" value={osmData.counts.roads} />
                  <Count label="Open land" value={osmData.counts.openLand} />
                </div>
              </div>
            ) : null}
          </section>

          <section className="mt-6 border-t border-white/10 pt-5">
            <div className="flex items-center justify-between gap-3">
              <p className="text-xs font-semibold uppercase text-white/45">Projects</p>
              <button
                className="secondary-button px-2.5 py-1 text-xs"
                disabled={isLoadingProjects}
                onClick={() => void fetchProjects()}
                type="button"
              >
                {isLoadingProjects ? "Loading" : "Refresh"}
              </button>
            </div>

            <label className="mt-4 block text-sm font-medium text-white/70" htmlFor="project-name">
              Project name
            </label>
            <input
              className="field-input mt-2 w-full"
              id="project-name"
              onChange={(event) => setProjectName(event.target.value)}
              value={projectName}
            />
            <button
              className="primary-button mt-3 w-full px-4 py-2.5 text-sm"
              disabled={isSavingProject || !isSignedIn || !isAreaConfirmed || !osmData}
              onClick={() => void saveCurrentProject()}
              type="button"
            >
              {isSavingProject ? "Saving" : currentProjectId ? "Save Changes" : "Save Project"}
            </button>
            <p className="mt-2 text-xs leading-5 text-white/45">
              {isSignedIn
                ? "Auto-saves 2 minutes after the latest saved-area change."
                : "Sign in to save and reload projects."}
            </p>

            {projectMessage ? (
              <p aria-live="polite" className="mt-3 rounded border border-white/10 bg-white/[0.04] px-3 py-2 text-sm leading-6 text-white/70">
                {projectMessage}
              </p>
            ) : null}

            {projectDeleteError ? (
              <p className="mt-3 rounded border border-[#ff6b57]/30 bg-[#ff6b57]/10 px-3 py-2 text-sm leading-6 text-[#ffd1ca]" role="alert">
                {projectDeleteError}
              </p>
            ) : null}

            {isLoadingProjects ? (
              <div className="mt-4 space-y-2">
                <SidebarSkeleton />
                <SidebarSkeleton />
              </div>
            ) : projects.length > 0 ? (
              <div className="mt-4 space-y-2">
                {projects.map((project) => (
                  <div
                    className={`flex items-center gap-2 rounded-lg border px-3 py-3 transition ${
                      currentProjectId === project.id
                        ? "border-[#63e6be]/70 bg-[#63e6be]/10"
                        : "border-white/10 bg-white/[0.04]"
                    }`}
                    key={project.id}
                  >
                    <button
                      className="min-w-0 flex-1 text-left"
                      onClick={() => void loadProject(project.id)}
                      type="button"
                    >
                      <span className="block truncate text-sm font-semibold text-white/85">{project.name}</span>
                      <span className="mt-1 block text-xs text-white/45">
                        Updated {formatProjectDate(project.updated_at)}
                      </span>
                    </button>
                    <button
                      aria-label={`Delete project ${project.name}`}
                      className="icon-button shrink-0 hover:border-[#ff6b57]/60 hover:text-[#ffd1ca]"
                      disabled={deletingProjectId !== null}
                      onClick={() => void deleteProject(project.id)}
                      title="Delete project"
                      type="button"
                    >
                      {deletingProjectId === project.id ? "…" : <Trash2 size={15} />}
                    </button>
                  </div>
                ))}
              </div>
            ) : (
              <p className="mt-4 text-sm leading-6 text-white/45">
                {isSignedIn ? "No saved projects yet." : "Saved projects appear here after sign-in."}
              </p>
            )}
          </section>

          <section className="mt-6 border-t border-white/10 pt-5">
            <div className="flex items-center justify-between gap-3">
              <p className="text-xs font-semibold uppercase text-white/45">Change analysis</p>
              <span className="rounded-md border border-[#63e6be]/20 bg-[#63e6be]/10 px-2 py-1 text-[11px] text-[#9ff5da]">
                Rules
              </span>
            </div>
            <button
              className="primary-button mt-3 w-full px-4 py-2.5 text-sm"
              disabled={isAnalyzingChanges || !isSignedIn || !isAreaConfirmed || !osmData}
              onClick={() => void analyzeCurrentChanges()}
              type="button"
            >
              {isAnalyzingChanges ? "Analyzing" : "Analyze Changes"}
            </button>
            <p className="mt-2 text-xs leading-5 text-white/45">
              Free rule-based feedback now; this endpoint can support Ollama later.
            </p>

            {analysisMessage ? (
              <p className="mt-3 rounded border border-[#ff6b57]/30 bg-[#ff6b57]/10 px-3 py-2 text-sm leading-6 text-[#ffd1ca]" role="alert">
                {analysisMessage}
              </p>
            ) : null}

            {changeAnalysis ? (
              <div className="info-panel mt-4 space-y-3 p-3">
                <p className="text-sm leading-6 text-white/80">{changeAnalysis.summary}</p>
                <AnalysisList title="Safety observations" items={changeAnalysis.safetyObservations} />
                <AnalysisList title="Pedestrian impact" items={changeAnalysis.pedestrianImpact} />
                <AnalysisList title="Suggestions" items={changeAnalysis.suggestions} />
                <p className="rounded border border-[#f5c542]/20 bg-[#f5c542]/10 px-2.5 py-2 text-xs leading-5 text-[#ffe6a1]">
                  {changeAnalysis.disclaimer}
                </p>
              </div>
            ) : null}
          </section>

          {results.length > 0 ? (
            <section className="mt-6">
              <p className="text-xs font-semibold uppercase text-white/45">Results</p>
              <div className="mt-3 space-y-2">
                {results.map((result) => (
                  <button
                    className="w-full rounded-lg border border-white/10 bg-white/[0.04] px-3 py-3 text-left text-sm leading-5 text-white/80 transition hover:border-[#63e6be]/50 hover:bg-white/[0.08]"
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
          </div>
        </aside>

        <section
          aria-label="Map canvas"
          className="relative min-h-[62vh] overflow-hidden bg-[#071114] lg:min-h-screen"
          id="map-canvas"
        >
          <div ref={mapContainerRef} className="mapbox-panel absolute inset-0" />
          {!isMapLoaded && !mapError ? (
            <div className="pointer-events-none absolute left-4 top-4 z-10">
              <div aria-live="polite" className="rounded border border-white/15 bg-[#161a18]/90 px-4 py-3 text-sm text-white/70 shadow-2xl">
                Loading satellite map...
              </div>
            </div>
          ) : null}
          {mapError ? (
            <div className="absolute inset-0 flex items-center justify-center bg-[#0d100f] p-6">
              <div className="max-w-md rounded border border-[#ff6b57]/30 bg-[#161a18] p-5 shadow-2xl">
                <h2 role="alert" className="text-lg font-semibold text-[#ffd1ca]">Map failed to load</h2>
                <p className="mt-3 text-sm leading-6 text-white/70">{mapError}</p>
              </div>
            </div>
          ) : null}
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
                initialObjects={loadedProjectObjects}
                mapRevision={mapRevision}
                objectsRevision={projectObjectsRevision}
                onObjectsChange={handleObjectsChange}
                onMapPointToScreen={(point) => mapPointToScreenPoint(point)}
                onMapPan={(delta) => panConfirmedMap(delta)}
                onMapZoom={(direction) => zoomConfirmedMap(direction)}
                onScreenPointToMap={(point) => screenPointToMapPoint(point)}
                osmRoads={osmData?.roads ?? []}
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

async function readApiJson<T>(response: Response) {
  const contentType = response.headers.get("content-type") ?? "";

  if (contentType.includes("application/json")) {
    return (await response.json()) as T;
  }

  const text = await response.text();
  const message = text.trim() || `Request failed with status ${response.status}.`;
  throw new Error(message.slice(0, 220));
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

function SidebarSkeleton() {
  return (
    <div className="rounded border border-white/10 bg-white/[0.04] px-3 py-3">
      <div className="h-4 w-2/3 rounded bg-white/10" />
      <div className="mt-2 h-3 w-1/2 rounded bg-white/[0.07]" />
    </div>
  );
}

function AnalysisList({ items, title }: { items: string[]; title: string }) {
  return (
    <div>
      <p className="text-xs font-semibold uppercase text-white/45">{title}</p>
      <ul className="mt-2 space-y-1.5 text-sm leading-5 text-white/70">
        {items.map((item) => (
          <li className="border-l border-[#f5c542]/40 pl-2" key={item}>
            {item}
          </li>
        ))}
      </ul>
    </div>
  );
}

function formatProjectDate(value: string) {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short"
  }).format(new Date(value));
}

function getProjectSaveSignature({
  bbox,
  name,
  osmData,
  userEdits
}: {
  bbox: BoundingBox;
  name: string;
  osmData: OsmData;
  userEdits: DrawingObject[];
}) {
  return JSON.stringify({
    bbox,
    name,
    osmData,
    userEdits
  });
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
