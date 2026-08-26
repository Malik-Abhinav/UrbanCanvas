"use client";

import { Trash2 } from "lucide-react";
import type { FormEvent } from "react";
import type { AnalysisFinding } from "../../../shared/analysis-findings";
import type { DrawingObjectV1 } from "../../../shared/drawing-document";
import type { OsmData } from "../../canvas-renderer";
import {
  setContextOpacity,
  setProposalOpacity,
  toggleLayer,
  type LayerSettings
} from "../../layer-semantics";
import { AnalysisInspector } from "./analysis-inspector";
import { SaveStatusIndicator } from "./save-status";
import type { SaveStatus } from "./save-status";
import ContextInspector from "./context-inspector";
import LayersPanel from "./layers-panel";
import {
  AnalysisMessageBanner,
  OsmErrorBanner,
  ProjectDeleteErrorBanner,
  ProjectMessageBanner,
  SearchErrorBanner,
  SelectionErrorBanner
} from "./status-bar";

const projectNameEditingLimit = 80;

export type SearchResult = {
  id: string;
  place_name: string;
  center: [number, number];
};

export type BoundingBox = {
  north: number;
  south: number;
  east: number;
  west: number;
};

export type ProjectSummary = {
  bbox: BoundingBox;
  created_at: string;
  id: string;
  name: string;
  updated_at: string;
};

export type ChangeAnalysis = {
  disclaimer: string;
  findings?: AnalysisFinding[];
  pedestrianImpact: string[];
  provider: "rules";
  safetyObservations: string[];
  suggestions: string[];
  summary: string;
};

type ProjectRailProps = {
  // Layer visibility + context inspector (shown once an area is confirmed).
  isAreaConfirmed: boolean;
  layerSettings: LayerSettings;
  onUpdateLayerSettings: (update: (current: LayerSettings) => LayerSettings) => void;
  inspectedObject: DrawingObjectV1 | null;
  onInspectPropertyChange: (key: string, value: string) => void;

  // Location search.
  query: string;
  onQueryChange: (value: string) => void;
  isSearching: boolean;
  onSearch: (event: FormEvent<HTMLFormElement>) => void;
  searchError: string | null;
  results: SearchResult[];
  onFlyToResult: (result: SearchResult) => void;
  selectedPlace: string;

  // Area selection.
  isMapLoaded: boolean;
  isSelectingArea: boolean;
  onToggleAreaSelection: () => void;
  selectedBounds: BoundingBox | null;
  onClearSelection: () => void;
  selectionError: string | null;
  selectionAreaKm2: number | null;
  onConfirmSelectedArea: () => void;
  osmData: OsmData | null;
  osmError: string | null;
  canRetryOsm: boolean;
  isFetchingOsm: boolean;
  osmRetrySeconds: number;
  onRetryOsm: () => void;

  // Saved projects.
  projects: ProjectSummary[];
  isLoadingProjects: boolean;
  onRefreshProjects: () => void;
  projectName: string;
  onProjectNameChange: (value: string) => void;
  currentProjectId: string | null;
  isSignedIn: boolean;
  isSavingProject: boolean;
  lastAutoSaveFailed: boolean;
  saveStatus: SaveStatus;
  onSaveProject: () => void;
  onLoadProject: (id: string) => void;
  deletingProjectId: string | null;
  onDeleteProject: (id: string) => void;
  projectMessage: string | null;
  projectDeleteError: string | null;

  // Change analysis.
  isAnalyzingChanges: boolean;
  onAnalyzeChanges: () => void;
  analysisMessage: string | null;
  changeAnalysis: ChangeAnalysis | null;
  activeFindings: AnalysisFinding[];
  isAnalysisStale: boolean;
  selectedFindingId: string | null;
  onSelectFinding: (finding: AnalysisFinding | null) => void;
};

/** Expanded left-rail content of the workspace: search, area selection, saved projects, and analysis. */
export default function ProjectRail({
  activeFindings,
  canRetryOsm,
  changeAnalysis,
  currentProjectId,
  deletingProjectId,
  inspectedObject,
  isAnalyzingChanges,
  isAreaConfirmed,
  isAnalysisStale,
  isFetchingOsm,
  isLoadingProjects,
  isMapLoaded,
  isSavingProject,
  isSearching,
  isSelectingArea,
  isSignedIn,
  lastAutoSaveFailed,
  saveStatus,
  layerSettings,
  analysisMessage,
  onAnalyzeChanges,
  onClearSelection,
  onConfirmSelectedArea,
  onDeleteProject,
  onFlyToResult,
  onInspectPropertyChange,
  onLoadProject,
  onProjectNameChange,
  onQueryChange,
  onRefreshProjects,
  onRetryOsm,
  onSaveProject,
  onSearch,
  onSelectFinding,
  onToggleAreaSelection,
  osmData,
  osmError,
  osmRetrySeconds,
  projectDeleteError,
  projectName,
  projectMessage,
  projects,
  query,
  results,
  searchError,
  selectedBounds,
  selectedFindingId,
  selectedPlace,
  selectionAreaKm2,
  selectionError,
  onUpdateLayerSettings
}: ProjectRailProps) {
  return (
    <>
      {isAreaConfirmed ? (
        <div className="mt-6">
          <LayersPanel
            onContextOpacityChange={(value) =>
              onUpdateLayerSettings((current) => setContextOpacity(current, value))
            }
            onLayerToggle={(id) => onUpdateLayerSettings((current) => toggleLayer(current, id))}
            onProposalOpacityChange={(value) =>
              onUpdateLayerSettings((current) => setProposalOpacity(current, value))
            }
            settings={layerSettings}
          />
        </div>
      ) : null}
      <ContextInspector
        isActive={isAreaConfirmed}
        object={inspectedObject}
        onPropertyChange={onInspectPropertyChange}
      />
      <form className="mt-8" onSubmit={onSearch}>
        <label className="text-sm font-medium text-white/75" htmlFor="location-search">
          Search location
        </label>
        <div className="mt-2 flex gap-2">
          <input
            id="location-search"
            className="field-input min-w-0 flex-1"
            onChange={(event) => onQueryChange(event.target.value)}
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

      <SearchErrorBanner message={searchError} />

      <section className="mt-6">
        <p className="text-xs font-semibold uppercase text-white/45">Focused place</p>
        <p className="mt-2 text-sm leading-6 text-white/80">{selectedPlace}</p>
      </section>

      <section className="mt-6 border-t border-white/10 pt-5">
        <div className="flex gap-2">
          <button
            aria-describedby={!isMapLoaded ? "area-selection-readiness" : undefined}
            aria-pressed={isSelectingArea}
            className={`flex-1 rounded-lg px-4 py-2.5 text-sm font-semibold transition ${
              isSelectingArea
                ? "bg-[#63e6be] text-[#06110e] shadow-[0_14px_35px_rgba(99,230,190,0.18)] hover:bg-[#7ff2cf]"
                : "border border-white/15 bg-white/[0.04] text-white hover:border-[#63e6be]/50 hover:bg-white/[0.08]"
            }`}
            disabled={!isMapLoaded}
            onClick={onToggleAreaSelection}
            type="button"
          >
            {isSelectingArea ? "Selecting..." : "Select Area"}
          </button>
          <span className="sr-only" id="area-selection-readiness">
            Wait for the satellite map to finish loading before selecting an area.
          </span>
          <button
            className="secondary-button px-4 py-2.5 text-sm"
            disabled={!selectedBounds}
            onClick={onClearSelection}
            type="button"
          >
            Clear
          </button>
        </div>

        <SelectionErrorBanner message={selectionError} />

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
              onClick={onConfirmSelectedArea}
              type="button"
            >
              {isAreaConfirmed ? "Area Confirmed" : "Confirm Area"}
            </button>
          </div>
        ) : null}

        <OsmErrorBanner
          canRetry={canRetryOsm}
          isFetchingOsm={isFetchingOsm}
          message={osmError}
          onRetry={onRetryOsm}
          retrySeconds={osmRetrySeconds}
        />

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
            onClick={onRefreshProjects}
            type="button"
          >
            {isLoadingProjects ? "Loading" : "Refresh"}
          </button>
        </div>

        <label className="mt-4 block text-sm font-medium text-white/70" htmlFor="project-name">
          Project name
        </label>
        <input
          aria-describedby="project-name-count"
          className="field-input mt-2 w-full"
          id="project-name"
          maxLength={Math.max(projectNameEditingLimit, projectName.length)}
          onChange={(event) => onProjectNameChange(event.target.value)}
          value={projectName}
        />
        <p
          aria-live="polite"
          className="mt-1 text-right text-xs leading-5 text-white/45"
          id="project-name-count"
          role="status"
        >
          {projectName.length} / {projectNameEditingLimit} characters
          {projectName.length > projectNameEditingLimit
            ? " — Legacy name preserved; shorten it to 80 characters to use the standard editing limit."
            : ""}
        </p>
        <button
          className="primary-button mt-3 w-full px-4 py-2.5 text-sm"
          disabled={isSavingProject || !isSignedIn || !isAreaConfirmed || !osmData}
          onClick={onSaveProject}
          type="button"
        >
          {isSavingProject ? "Saving" : lastAutoSaveFailed ? "Retry Save" : currentProjectId ? "Save Changes" : "Save Project"}
        </button>
        <p aria-live="polite" className="mt-2 text-xs leading-5 text-white/45">
          {isSignedIn
            ? lastAutoSaveFailed
              ? "The last auto-save did not go through. Press Retry Save."
              : "Auto-saves 2 minutes after the latest saved-area change."
            : "Sign in to save and reload projects."}
        </p>

        <SaveStatusIndicator onRetry={onSaveProject} status={saveStatus} />

        <ProjectMessageBanner message={projectMessage} />

        <ProjectDeleteErrorBanner message={projectDeleteError} />

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
                  onClick={() => onLoadProject(project.id)}
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
                  onClick={() => onDeleteProject(project.id)}
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
          onClick={onAnalyzeChanges}
          type="button"
        >
          {isAnalyzingChanges ? "Analyzing" : "Analyze Changes"}
        </button>
        <p className="mt-2 text-xs leading-5 text-white/45">
          Free rule-based feedback now; this endpoint can support Ollama later.
        </p>

        <AnalysisMessageBanner message={analysisMessage} />

        {changeAnalysis ? (
          <div className="info-panel mt-4 space-y-3 p-3">
            <p className="text-sm leading-6 text-white/80">{changeAnalysis.summary}</p>
            <AnalysisList title="Safety observations" items={changeAnalysis.safetyObservations} />
            <AnalysisList title="Pedestrian impact" items={changeAnalysis.pedestrianImpact} />
            <AnalysisList title="Suggestions" items={changeAnalysis.suggestions} />
            <p className="rounded border border-[#f5c542]/20 bg-[#f5c542]/10 px-2.5 py-2 text-xs leading-5 text-[#ffe6a1]">
              {changeAnalysis.disclaimer}
            </p>

            <AnalysisInspector
              findings={activeFindings}
              isStale={isAnalysisStale}
              onSelectFinding={onSelectFinding}
              selectedFindingId={selectedFindingId}
            />
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
                onClick={() => onFlyToResult(result)}
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
    </>
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
    <div
      aria-label={`${label}: ${value}`}
      className="rounded border border-white/10 bg-white/[0.04] px-2 py-2"
    >
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

export function formatProjectDate(value: string) {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short"
  }).format(new Date(value));
}
