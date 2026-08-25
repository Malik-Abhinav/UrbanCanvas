"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { FormEvent, PointerEvent } from "react";
import mapboxgl, { Marker } from "mapbox-gl";
import type { GeoJSONSource, LngLatLike, Map } from "mapbox-gl";
import type { OsmData, OsmFeature } from "./canvas-renderer";
import { createE2eFixtureMap } from "./e2e-fixture-map";
import { apiFetch } from "./api-fetch";
import { normalizeSavedProject } from "./project-normalization";
import { getRetryAfterMilliseconds } from "./retry-after";
import ProjectRail, {
  formatProjectDate,
  type BoundingBox,
  type ChangeAnalysis,
  type ProjectSummary,
  type SearchResult
} from "./components/workspace/project-rail";
import MapStage, { type OverlayBox, type SelectionBox } from "./components/workspace/map-stage";
import {
  createLayerSettings,
  type LayerSettings
} from "./layer-semantics";
import {
  createMigrationPixelsToMetres,
  createPixelMetreConverter,
  hashDrawingObjects,
  parseStoredUserEdits,
  toLegacyAnalysisEdits,
  toUserEditsPayload
} from "./drawing-document-bridge";
import type { DrawingObjectV1 } from "../shared/drawing-document";
import type { AnalysisFinding } from "../shared/analysis-findings";
import { AnalysisInspector } from "./components/workspace/analysis-inspector";
import { useWorkspaceAuth } from "./workspace-auth";
import WorkspaceShell from "./components/workspace/workspace-shell";

const mapboxToken = process.env.NEXT_PUBLIC_MAPBOX_TOKEN;
const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001";
const fixturesEnabled =
  process.env.NODE_ENV !== "production" && process.env.NEXT_PUBLIC_E2E_TEST_FIXTURES === "1";
const delhiCenter: [number, number] = [77.209, 28.6139];
const maxSelectionAreaKm2 = 5;
const autoSaveDelayMs = 120_000;
const osmRequestTimeoutMs = 65_000;
const selectionSourceId = "selected-area";
const selectionFillLayerId = "selected-area-fill";
const selectionLineLayerId = "selected-area-line";

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

type OsmResponse = {
  status: "ok" | "error";
  data?: OsmData;
  message?: string;
};

type ProjectsResponse = {
  status: "ok" | "error";
  message?: string;
  projects?: ProjectSummary[];
};

type ProjectResponse = {
  status: "ok" | "error";
  message?: string;
  project?: unknown;
};

type AnalysisResponse = {
  status: "ok" | "error";
  analysis?: ChangeAnalysis;
  message?: string;
};

export default function MapSearch() {
  const { getToken, isSignedIn } = useWorkspaceAuth();
  const mapContainerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<Map | null>(null);
  const markerRef = useRef<Marker | null>(null);
  const dragStartRef = useRef<ScreenPoint | null>(null);
  const moveFrameRef = useRef<number | null>(null);
  const lastSavedSignatureRef = useRef<string | null>(null);
  const pendingProjectIdRef = useRef<string | null>(null);
  // The overlay owns selection + property commits; these mirror them into the sidebar.
  const [inspectedObject, setInspectedObject] = useState<DrawingObjectV1 | null>(null);
  const propertyUpdateRef = useRef<((key: string, value: string) => void) | null>(null);
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
  const [osmRetryAvailableAt, setOsmRetryAvailableAt] = useState<number | null>(null);
  const [osmRetrySeconds, setOsmRetrySeconds] = useState(0);
  const [isAreaConfirmed, setIsAreaConfirmed] = useState(false);
  const [overlayBox, setOverlayBox] = useState<OverlayBox | null>(null);
  const [mapRevision, setMapRevision] = useState(0);
  const [isMapLoaded, setIsMapLoaded] = useState(false);
  const [mapError, setMapError] = useState<string | null>(null);
  const [projectName, setProjectName] = useState("Untitled project");
  const [currentProjectId, setCurrentProjectId] = useState<string | null>(null);
  const [projectObjects, setProjectObjects] = useState<DrawingObjectV1[]>([]);
  const [loadedProjectObjects, setLoadedProjectObjects] = useState<DrawingObjectV1[]>([]);
  const [projectObjectsRevision, setProjectObjectsRevision] = useState(0);
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [isSavingProject, setIsSavingProject] = useState(false);
  const [isLoadingProjects, setIsLoadingProjects] = useState(false);
  const [projectMessage, setProjectMessage] = useState<string | null>(null);
  const [changeAnalysis, setChangeAnalysis] = useState<ChangeAnalysis | null>(null);
  const [isAnalyzingChanges, setIsAnalyzingChanges] = useState(false);
  const [analysisMessage, setAnalysisMessage] = useState<string | null>(null);
  // Task 24: selected analysis finding + the objects revision it was produced
  // from; a mismatch means findings are stale and highlights must clear.
  const [selectedFindingId, setSelectedFindingId] = useState<string | null>(null);
  const [analysisObjectsRevision, setAnalysisObjectsRevision] = useState<number | null>(null);

  // Any geometry change invalidates the current selection (Task 24 acceptance:
  // stale findings clear when geometry changes).
  useEffect(() => {
    setSelectedFindingId(null);
  }, [projectObjectsRevision]);

  const isAnalysisStale =
    changeAnalysis !== null && analysisObjectsRevision !== null && analysisObjectsRevision !== projectObjectsRevision;
  const activeFindings = isAnalysisStale ? [] : (changeAnalysis?.findings ?? []);
  const selectedFinding = activeFindings.find((finding) => finding.id === selectedFindingId) ?? null;
  const highlightObjectIds = selectedFinding?.objectIds;
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);
  const [layerSettings, setLayerSettings] = useState<LayerSettings>(createLayerSettings);
  const [error, setError] = useState<string | null>(null);
  const [deletingProjectId, setDeletingProjectId] = useState<string | null>(null);
  const [projectDeleteError, setProjectDeleteError] = useState<string | null>(null);
  const [lastAutoSaveFailed, setLastAutoSaveFailed] = useState(false);

  const handleObjectsChange = useCallback((objects: DrawingObjectV1[]) => {
    setProjectObjects(objects);
  }, []);

  useEffect(() => {
    window.setTimeout(() => {
      mapRef.current?.resize();
      setMapRevision((current) => current + 1);
    }, 260);
  }, [isSidebarCollapsed]);

  // Satellite toggle fades the Mapbox raster; the canvas overlay stays crisp
  // so proposals remain readable even with imagery hidden.
  useEffect(() => {
    const container = mapContainerRef.current;

    if (container) {
      container.style.opacity = layerSettings.visible.satellite ? "1" : "0.12";
    }
  }, [isAreaConfirmed, layerSettings.visible.satellite]);

  useEffect(() => {
    if (osmRetryAvailableAt === null) {
      setOsmRetrySeconds(0);
      return;
    }

    const updateCountdown = () => {
      setOsmRetrySeconds(Math.max(0, Math.ceil((osmRetryAvailableAt - Date.now()) / 1_000)));
    };
    updateCountdown();
    const intervalId = window.setInterval(updateCountdown, 250);

    return () => window.clearInterval(intervalId);
  }, [osmRetryAvailableAt]);

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

  // Coalesce revision bumps to one per animation frame: "move" fires far more
  // often than frames render, and every bump re-renders the workspace.
  const attachMoveRevisionHandler = useCallback((map: Map) => {
    map.on("move", () => {
      if (moveFrameRef.current !== null) {
        return;
      }

      moveFrameRef.current = window.requestAnimationFrame(() => {
        moveFrameRef.current = null;
        setMapRevision((current) => current + 1);
      });
    });
  }, []);

  useEffect(() => {
    if (!mapContainerRef.current || mapRef.current) {
      return;
    }

    if (fixturesEnabled) {
      const map = createE2eFixtureMap(mapContainerRef.current);
      mapRef.current = map;
      attachMoveRevisionHandler(map);
      map.on("load", () => {
        setMapError(null);
        setIsMapLoaded(true);
        ensureSelectionLayer(map);
      });

      return () => {
        map.remove();
        mapRef.current = null;
        setIsMapLoaded(false);
      };
    }

    if (!mapboxToken) {
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
      if (map.isStyleLoaded()) {
        setMapError(null);
        setIsMapLoaded(true);
      }
    });
    map.on("styledata", () => {
      const isStyleReady = map.isStyleLoaded();
      setIsMapLoaded(isStyleReady);
      if (isStyleReady) {
        setMapError(null);
      }
    });
    map.on("error", (event) => {
      const message = event.error?.message ?? "Mapbox failed to load satellite imagery.";
      setIsMapLoaded(false);
      setMapError(message);
    });
    // Coalesce revision bumps to one per animation frame: "move" fires far
    // more often than frames render, and every bump re-renders the workspace.
    attachMoveRevisionHandler(map);

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
      if (moveFrameRef.current !== null) {
        window.cancelAnimationFrame(moveFrameRef.current);
        moveFrameRef.current = null;
      }
      resizeObserver.disconnect();
      markerRef.current?.remove();
      map.remove();
      mapRef.current = null;
      markerRef.current = null;
      setIsMapLoaded(false);
    };
  }, [attachMoveRevisionHandler]);

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
    if (!isMapLoaded || !mapRef.current?.isStyleLoaded()) {
      return;
    }

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
    setOsmRetryAvailableAt(null);
    setIsAreaConfirmed(false);
    setOverlayBox(null);
    setLastAutoSaveFailed(false);
    setCurrentProjectId(null);
    pendingProjectIdRef.current = null;
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
    if (!isSelectingArea || !mapRef.current || !mapRef.current.isStyleLoaded()) {
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
    setOsmRetryAvailableAt(null);
    setIsAreaConfirmed(false);
    setOverlayBox(null);
    setLastAutoSaveFailed(false);
    setCurrentProjectId(null);
    pendingProjectIdRef.current = null;
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
    setOsmRetryAvailableAt(null);

    try {
      const response = await apiFetch(`${apiUrl}/api/osm`, {
        method: "POST",
        headers: {
          "content-type": "application/json"
        },
        body: JSON.stringify({
          bbox: bounds
        }),
        timeoutMs: osmRequestTimeoutMs
      });
      const payload = await readApiJson<OsmResponse>(response);

      if (!response.ok || payload.status !== "ok" || !payload.data) {
        if (response.status === 429) {
          setOsmRetryAvailableAt(Date.now() + getRetryAfterMilliseconds(response.headers.get("retry-after")));
        }
        throw new Error(payload.message ?? "Unable to fetch map data.");
      }

      if (!isOsmData(payload.data)) {
        throw new Error("Map data response was not in the expected format.");
      }

      setOsmData(payload.data);
      setOsmRetryAvailableAt(null);
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
      contentHash: hashDrawingObjects(projectObjects),
      name: projectName,
      osmDataId: getOsmDataId(osmData),
      userEdits: projectObjects
    });

    if (silent && signature === lastSavedSignatureRef.current) {
      return;
    }

    if (!silent) {
      setIsSavingProject(true);
      setProjectMessage(null);
    }

    const projectId = currentProjectId ?? pendingProjectIdRef.current ?? window.crypto.randomUUID();
    if (!currentProjectId) {
      pendingProjectIdRef.current = projectId;
    }

    try {
      const response = await apiFetch(`${apiUrl}/api/projects`, {
        method: "POST",
        headers: await getProjectRequestHeaders(),
        body: JSON.stringify({
          bbox: selectedBounds,
          id: projectId,
          name: projectName,
          osmData,
          userEdits: toUserEditsPayload(projectObjects)
        })
      });
      const payload = await readApiJson<ProjectResponse>(response);

      const normalized = normalizeSavedProject(payload.project);

      if (!response.ok || payload.status !== "ok" || !normalized) {
        throw new Error(payload.message ?? "Unable to save project.");
      }

      setCurrentProjectId(normalized.project.id);
      pendingProjectIdRef.current = null;
      setProjectName(normalized.project.name);
      lastSavedSignatureRef.current = signature;

      if (silent) {
        setLastAutoSaveFailed(false);
        setProjectMessage(`Auto-saved ${formatProjectDate(new Date().toISOString())}.`);
      } else {
        setProjectMessage("Project saved.");
      }

      if (!silent) {
        await fetchProjects();
      }
    } catch (saveError) {
      const message = saveError instanceof Error ? saveError.message : "Unable to save project.";

      if (silent) {
        setLastAutoSaveFailed(true);
        setProjectMessage(`Auto-save failed: ${message}`);
      } else {
        setProjectMessage(message);
      }
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

      if (!window.confirm("Delete this saved project? Your current canvas will stay open as an unsaved project.")) {
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
          setCurrentProjectId(null);
          pendingProjectIdRef.current = null;
          lastSavedSignatureRef.current = null;
          setLastAutoSaveFailed(false);
        }

        setProjects((current) => current.filter((project) => project.id !== id));
        setProjectMessage(
          currentProjectId === id
            ? "Saved project deleted. Your canvas remains open as an unsaved project."
            : "Project deleted."
        );
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

      const normalized = normalizeSavedProject(payload.project);
      if (!normalized) {
        throw new Error("Saved project data is incomplete or corrupted.");
      }
      const { project, skippedDrawingCount } = normalized;
      // Stored payloads may be legacy arrays or versioned documents; both are
      // parsed into V1 objects here, with legacy pixel measurements converted
      // through the live map projection.
      const parsedEdits = parseStoredUserEdits(project.user_edits, {
        pixelsToMetres: createMigrationPixelsToMetres(
          createPixelMetreConverter({ getZoom: () => map.getZoom() })
        )
      });
      const skippedCount = skippedDrawingCount + parsedEdits.skippedCount;

      setCurrentProjectId(project.id);
      pendingProjectIdRef.current = null;
      setProjectName(project.name);
      setSelectedBounds(project.bbox);
      setSelectionAreaKm2(getApproximateAreaKm2(project.bbox));
      setOsmData(project.osm_data);
      setOsmError(null);
      setOsmRetryAvailableAt(null);
      setIsSelectingArea(false);
      setIsAreaConfirmed(true);
      setOverlayBox(null);
      setProjectObjects(parsedEdits.objects);
      setLoadedProjectObjects(parsedEdits.objects);
      setProjectObjectsRevision((current) => current + 1);
      setChangeAnalysis(null);
      setAnalysisMessage(null);
      setLastAutoSaveFailed(false);
      lastSavedSignatureRef.current = getProjectSaveSignature({
        bbox: project.bbox,
        contentHash: hashDrawingObjects(parsedEdits.objects),
        name: project.name,
        osmDataId: getOsmDataId(project.osm_data),
        userEdits: parsedEdits.objects
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
      setProjectMessage(
        skippedCount > 0
          ? `Project loaded with ${skippedCount} invalid drawing${skippedCount === 1 ? "" : "s"} skipped.`
          : "Project loaded."
      );
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
          userEdits: toLegacyAnalysisEdits(projectObjects)
        })
      });
      const payload = await readApiJson<AnalysisResponse>(response);

      if (!response.ok || payload.status !== "ok" || !payload.analysis) {
        throw new Error(payload.message ?? "Unable to analyze changes.");
      }

      setChangeAnalysis(payload.analysis);
      setAnalysisObjectsRevision(projectObjectsRevision);
      setSelectedFindingId(null);
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
    <WorkspaceShell
      isSidebarCollapsed={isSidebarCollapsed}
      mapStage={
        <MapStage
          getMapZoom={() => mapRef.current?.getZoom() ?? 12}
          highlightObjectIds={highlightObjectIds}
          isAreaConfirmed={isAreaConfirmed}
          isDraggingSelection={isDraggingSelection}
          isFetchingOsm={isFetchingOsm}
          isMapLoaded={isMapLoaded}
          isSelectingArea={isSelectingArea}
          layerSettings={layerSettings}
          loadedProjectObjects={loadedProjectObjects}
          mapContainerRef={mapContainerRef}
          mapError={mapError}
          mapRevision={mapRevision}
          objectsRevision={projectObjectsRevision}
          onBindPropertyUpdate={(update) => {
            propertyUpdateRef.current = update;
          }}
          onMapPan={(delta) => panConfirmedMap(delta)}
          onMapPointToScreen={(point) => mapPointToScreenPoint(point)}
          onMapZoom={(direction) => zoomConfirmedMap(direction)}
          onObjectsChange={handleObjectsChange}
          onScreenPointToMap={(point) => screenPointToMapPoint(point)}
          onSelectionChange={setInspectedObject}
          onSelectionPointerDown={handleSelectionPointerDown}
          onSelectionPointerMove={handleSelectionPointerMove}
          onSelectionPointerUp={handleSelectionPointerUp}
          osmRoads={osmData?.roads ?? []}
          overlayBox={overlayBox}
          selectionBox={selectionBox}
          showTokenNotice={!mapboxToken && !fixturesEnabled && !isAreaConfirmed}
        />
      }
      onToggleSidebar={() => setIsSidebarCollapsed((current) => !current)}
      rail={<ProjectRail
        activeFindings={activeFindings}
        analysisMessage={analysisMessage}
        canRetryOsm={!osmData && isAreaConfirmed && selectedBounds !== null}
        changeAnalysis={changeAnalysis}
        currentProjectId={currentProjectId}
        deletingProjectId={deletingProjectId}
        inspectedObject={inspectedObject}
        isAnalyzingChanges={isAnalyzingChanges}
        isAreaConfirmed={isAreaConfirmed}
        isAnalysisStale={isAnalysisStale}
        isFetchingOsm={isFetchingOsm}
        isLoadingProjects={isLoadingProjects}
        isMapLoaded={isMapLoaded}
        isSavingProject={isSavingProject}
        isSearching={isSearching}
        isSelectingArea={isSelectingArea}
        isSignedIn={isSignedIn}
        lastAutoSaveFailed={lastAutoSaveFailed}
        layerSettings={layerSettings}
        onAnalyzeChanges={() => void analyzeCurrentChanges()}
        onClearSelection={clearSelection}
        onConfirmSelectedArea={() => void confirmSelectedArea()}
        onDeleteProject={(id) => void deleteProject(id)}
        onFlyToResult={flyToResult}
        onInspectPropertyChange={(key, value) => propertyUpdateRef.current?.(key, value)}
        onLoadProject={(id) => void loadProject(id)}
        onProjectNameChange={setProjectName}
        onQueryChange={setQuery}
        onRefreshProjects={() => void fetchProjects()}
        onRetryOsm={() => {
          if (selectedBounds) {
            void fetchSelectedAreaData(selectedBounds);
          }
        }}
        onSaveProject={() => void saveCurrentProject()}
        onSearch={handleSearch}
        onSelectFinding={(finding) => setSelectedFindingId(finding?.id ?? null)}
        onToggleAreaSelection={toggleAreaSelection}
        onUpdateLayerSettings={setLayerSettings}
        osmData={osmData}
        osmError={osmError}
        osmRetrySeconds={osmRetrySeconds}
        projectDeleteError={projectDeleteError}
        projectName={projectName}
        projectMessage={projectMessage}
        projects={projects}
        query={query}
        results={results}
        searchError={error}
        selectedBounds={selectedBounds}
        selectedFindingId={selectedFindingId}
        selectedPlace={selectedPlace}
        selectionAreaKm2={selectionAreaKm2}
        selectionError={selectionError}
      />}
    />
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

function getProjectSaveSignature({
  bbox,
  contentHash,
  name,
  osmDataId,
  userEdits
}: {
  bbox: BoundingBox;
  contentHash: string;
  name: string;
  osmDataId: string;
  userEdits: DrawingObjectV1[];
}) {
  // The OSM payload is immutable once fetched for a selection, so its
  // identity (bbox + counts) stands in for hashing megabytes of geometry.
  // The drawings contribute a content hash so property or geometry changes
  // (not just adds/removes) trigger autosave.
  return [
    bbox.north,
    bbox.south,
    bbox.east,
    bbox.west,
    name,
    osmDataId,
    userEdits.length,
    contentHash
  ].join("|");
}

function getOsmDataId(osmData: OsmData) {
  const { bbox, counts } = osmData;

  return [bbox.north, bbox.south, bbox.east, bbox.west, counts.buildings, counts.roads, counts.openLand].join(":");
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
