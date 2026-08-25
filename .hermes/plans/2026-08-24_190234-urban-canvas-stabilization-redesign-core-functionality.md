# UrbanCanvas Stabilization, Redesign, and Core Functionality Implementation Plan

> **For Hermes:** Use subagent-driven-development skill to implement this plan task-by-task.

**Goal:** Turn the current `dev` branch into a reliable, visually intentional urban-planning workspace with substantially better road, footpath, cycling, crossing, roundabout, signal, editing, snapping, persistence, and analysis behavior—without touching `main` until the complete product is verified.

**Architecture:** Work on a dedicated stabilization branch created from current `dev`. First establish browser-level safety and repair confirmed regressions. Then introduce a versioned, real-world-unit drawing model and modular rendering/editing engine. Finally rebuild the workspace shell in an original ThreeUI-inspired “Operate + Command/Inspect” composition, preserving the map as the primary surface. Every behavioral change follows RED→GREEN TDD and every user-facing batch is exercised in a deployed preview.

**Tech Stack:** Next.js 15, React 19, TypeScript, Mapbox GL JS, Konva/React-Konva, Express, PostgreSQL/Neon, Clerk, Graphology, Vitest, proposed Playwright and React Testing Library.

---

## Product principles and non-negotiable constraints

1. `main` remains untouched until final owner approval.
2. No fixed PR or iteration count. Stop only when acceptance criteria pass.
3. Preserve the valuable fixes already on `dev`; do not blindly revert the branch.
4. A green build is not product verification. Core workflows require browser tests and preview use.
5. The map/canvas is the product. UI chrome must support it rather than compete with it.
6. ThreeUI is a reference for density, hierarchy, typography, borders, and interaction posture—not a template to clone and not a reason to add gratuitous Three.js effects.
7. Geometry is stored in map coordinates and real-world units. Pixel widths are render outputs, not domain data.
8. Proposed roads, footpaths, cycle lanes, crossings, roundabouts, and signals must be editable after creation.
9. Persistence schemas are versioned and backward-compatible.
10. New functionality receives a failing test first, then the smallest implementation, then refactoring.

## Desired product composition

UrbanCanvas is primarily an **Operate** surface, with a secondary **Command / Inspect** surface.

```text
┌──────────────┬─────────────────────────────────────┬──────────────────┐
│ Project rail │                                     │ Context inspector│
│ Search       │                                     │ Object properties│
│ Locations    │       Map + proposal canvas         │ Layers / analysis│
│ Saved plans  │                                     │ Save / warnings  │
├──────────────┴─────────────────────────────────────┴──────────────────┤
│ Coordinates · scale · area · OSM · edits · autosave · connectivity   │
└───────────────────────────────────────────────────────────────────────┘
```

Visual posture:

- graphite/charcoal surfaces, warm off-white text, one infrastructure accent;
- crisp 1px separators and restrained 6–8px radii;
- a chosen technical sans plus monospace for coordinates and measurements;
- no teal/yellow gradients, generic glass cards, giant shadows, or decorative stats;
- animation only for state continuity, loading, and tool feedback;
- desktop-first professional workspace with a deliberate mobile/tablet mode.

---

## Phase 0: Protect the baseline and define promotion gates

### Task 1: Create the stabilization branch and baseline report

**Objective:** Preserve `main` and `dev`, and establish a reproducible baseline before changing code.

**Files:**
- Create: `.hermes/reports/stabilization-baseline.md`
- Do not modify product code.

**Steps:**
1. Refresh remote refs and confirm `origin/main` and `origin/dev` SHAs.
2. Create `hermes/dev-stabilization` from current `dev`; never branch from stale local `main`.
3. Record current test, lint, typecheck, and build results.
4. Record confirmed regressions and exact reproductions.
5. Record current desktop/mobile screenshots where browser access permits.
6. Commit only the baseline report on the stabilization branch.

**Verification:**
- `git diff origin/dev...HEAD` contains only the report.
- `main` and `dev` refs remain unchanged.

### Task 2: Define the promotion matrix

**Objective:** Make “better than main” measurable.

**Files:**
- Create: `.hermes/reports/promotion-matrix.md`

**Required workflows:**
- map initialization;
- location search;
- area selection during and after map load;
- OSM fetch success, timeout, upstream failure, and throttling;
- create each proposal type;
- select, inspect, edit, undo, redo, and erase;
- 100+ operation history;
- manual save, autosave, timeout reconciliation, reload, deletion;
- legacy/high-edit project loading;
- rule analysis;
- keyboard-only flow;
- desktop, tablet, and mobile layouts.

**Exit gate:** No promoted workflow may be worse than `origin/main`; all new functionality must have explicit expected behavior.

---

## Phase 1: Add a real product-level test harness

### Task 3: Install and configure Playwright

**Objective:** Add deterministic browser tests before modifying user workflows.

**Files:**
- Modify: `package.json`
- Modify: `package-lock.json`
- Create: `playwright.config.ts`
- Create: `e2e/fixtures/`
- Create: `e2e/workspace-smoke.spec.ts`
- Modify: `.github/workflows/ci.yml`

**RED:** Add a smoke test that expects the workspace shell and map-ready state; run it before adding required test plumbing and verify the expected failure.

**GREEN:** Configure local web/API startup, deterministic fixture data, traces/screenshots on failure, and desktop/mobile projects.

**Commands:**
- `npm run test:e2e -- e2e/workspace-smoke.spec.ts`
- `npm run test`
- `npm run lint`
- `npm run typecheck`
- `npm run build`

### Task 4: Create safe service adapters for E2E

**Objective:** Prevent Clerk, Mapbox, Overpass, Render, and Neon availability from making CI unreliable.

**Files likely to change:**
- Create: `app/services/api-client.ts`
- Create: `app/services/geocoding-client.ts`
- Create: `server/src/services/overpass-client.ts`
- Create: `e2e/fixtures/osm-delhi.json`
- Create: `e2e/fixtures/projects.ts`
- Modify: `app/map-search.tsx`
- Modify: `server/src/osm.ts`

**Requirements:**
- Production keeps real providers.
- E2E uses explicit test-mode adapters enabled only in test environment.
- No credentials or `.env` values are committed.
- Production build cannot accidentally enable test auth or fixtures.

### Task 5: Protect the existing happy path

**Objective:** Capture the functionality `main` already provides before large refactors.

**Tests:**
- `e2e/location-selection.spec.ts`
- `e2e/drawing-tools.spec.ts`
- `e2e/project-lifecycle.spec.ts`
- `e2e/analysis.spec.ts`

**Acceptance:** Search → select → confirm → load OSM → draw every object → save → reload → analyze passes in a real browser.

---

## Phase 2: Repair the confirmed `dev` regressions

### Task 6: Make area selection readiness explicit

**Objective:** Eliminate the silent pre-style-load selection no-op.

**Files:**
- Modify: `app/map-search.tsx:391-394,1005-1018`
- Test: `e2e/location-selection.spec.ts`

**RED:** Test that clicking Select Area before map readiness produces a disabled/loading affordance rather than entering a broken mode.

**GREEN:** Disable selection until the style is ready and display a concise map-loading state.

### Task 7: Make saves and deletes idempotent

**Objective:** Ensure timeouts never create duplicate projects or ambiguous deletion state.

**Files:**
- Modify: `app/api-fetch.ts`
- Modify: `app/map-search.tsx:572-765`
- Modify: `server/src/projects.ts`
- Modify: `server/src/index.ts`
- Test: `server/test/projects.test.ts`
- Test: `e2e/project-lifecycle.spec.ts`

**Requirements:**
- Generate a stable project UUID or idempotency key before the first request.
- A retry updates the same project.
- After timeout, reconcile by reading server state.
- Verify deletion state after an ambiguous response.
- Use endpoint-specific timeout policies.

### Task 8: Fix active-project deletion data loss

**Objective:** Deleting a saved record must not silently discard unsaved canvas work.

**Files:**
- Modify: `app/map-search.tsx:661-695`
- Test: `e2e/project-lifecycle.spec.ts`

**Preferred behavior:** Delete the persisted record but keep the active canvas open as an unsaved project. If clearing is retained, require an explicit unsaved-work warning.

### Task 9: Replace arbitrary edit/history limits with coherent policy

**Objective:** Ensure users cannot create work that the product later refuses to save, analyze, or undo.

**Files:**
- Modify: `app/drawing-history.ts`
- Modify: `app/drawing-history.test.ts`
- Modify: `server/src/projects.ts`
- Modify: `server/src/analysis.ts`
- Modify: `app/map-search.tsx`
- Test: `e2e/drawing-tools.spec.ts`

**Requirements:**
- Support at least the complete normal-session history; prefer a memory budget over a silent 50-operation cutoff.
- Display any unavoidable history truncation.
- Replace the 500-object server-only rejection with payload-size policy or visible client-side limits.
- Legacy/high-edit projects remain saveable and analyzable.

### Task 10: Unify project validation and migration

**Objective:** Prevent the API from saving records that the UI later refuses.

**Files:**
- Create: `shared/project-schema.ts`
- Create: `shared/project-migrations.ts`
- Create: `shared/project-schema.test.ts`
- Modify: `server/src/projects.ts`
- Modify: `server/src/analysis.ts`
- Modify: `app/map-search.tsx:697-765,1340-1416`

**Requirements:**
- One versioned schema at save, load, and analysis boundaries.
- Normalize legacy records.
- Recover valid drawing objects and report skipped malformed entries.
- Never reject an entire recoverable project without migration guidance.

### Task 11: Make OSM throttling user-aware and retryable

**Objective:** Protect Overpass without punishing normal retries or shared-IP users.

**Files:**
- Modify: `server/src/rate-limit.ts`
- Modify: `server/src/index.ts`
- Modify: `app/api-fetch.ts`
- Modify: `app/map-search.tsx`
- Test: `server/test/rate-limit.test.ts`
- Test: `e2e/location-selection.spec.ts`

**Requirements:**
- Validate limiter configuration at startup.
- Do not charge malformed requests.
- Respect and expose `Retry-After`.
- Show a recoverable countdown/retry action.
- Verify real client-IP behavior in the Render preview environment.

**Phase 2 exit gate:** All previously confirmed regressions have browser-level tests and pass on a preview deployment.

---

## Phase 3: Introduce a real urban proposal domain model

### Task 12: Define versioned drawing objects in real-world units

**Objective:** Replace visually hard-coded proposal objects with a model that can represent meaningful infrastructure.

**Files:**
- Create: `shared/urban-model.ts`
- Create: `shared/urban-model.test.ts`
- Modify: `app/satellite-overlay.tsx:70-122`
- Modify: `server/src/analysis.ts`
- Modify: `shared/project-schema.ts`
- Modify: `shared/project-migrations.ts`

**Proposed model capabilities:**

- `road`: classification, lane count, one/two-way direction, width in meters, surface, optional median and parking;
- `footpath`: width in meters, side/independent alignment, surface, accessibility status, buffer;
- `cycleway`: protected/painted/shared type, width, direction, buffer;
- `crossing`: zebra/raised/signalized/unmarked type, width and orientation;
- `roundabout`: radius in meters, lane count, entry geometry;
- `signal`: controlled approaches, pedestrian phase, orientation;
- common: id, geometry, created/updated timestamps, source, schema version.

**Migration:** Convert existing pixel widths/radii to stable defaults while preserving positions and object IDs.

### Task 13: Extract immutable domain operations

**Objective:** Make every drawing edit explicit, testable, undoable, and serializable.

**Files:**
- Create: `app/drawing-operations.ts`
- Create: `app/drawing-operations.test.ts`
- Modify: `app/drawing-history.ts`
- Modify: `app/satellite-overlay.tsx`

**Operations:** add, remove, replace geometry, move vertex, insert vertex, remove vertex, update properties, split segment, join segments, duplicate, and batch change.

**Acceptance:** Every operation round-trips through undo/redo and project serialization.

---

## Phase 4: Make roads, footpaths, cycleways, and street objects look credible

### Task 14: Build scale-aware infrastructure styling

**Objective:** Render proposal dimensions consistently as the map zoom changes.

**Files:**
- Create: `app/drawing-style.ts`
- Create: `app/drawing-style.test.ts`
- Create: `app/drawing-renderer.tsx`
- Modify: `app/satellite-overlay.tsx:897-1040`
- Modify: `app/canvas-renderer.tsx:203-225`

**Road rendering:**
- outer casing/edge;
- carriageway fill;
- lane separators based on lane count;
- optional centerline and one-way direction markers;
- hierarchy-specific treatment without cartoonish widths.

**Footpath rendering:**
- real width converted to screen width;
- curb/edge treatment;
- distinguish attached sidewalk from independent pedestrian path;
- accessible surface/continuity indicators where useful.

**Cycleway rendering:**
- protected, painted, and shared treatments;
- directional marks at non-noisy intervals;
- buffer/physical separation where configured.

**Other objects:**
- full-length zebra stripe distribution for crossings rather than three fixed rectangles;
- roundabout lane rings and entry alignment;
- readable signal poles/heads at appropriate zooms;
- selected/draft states independent from object colors.

**Acceptance:** Screenshot tests at multiple zoom levels show stable real-world proportions and readable contrast over satellite imagery.

### Task 15: Add proposal-vs-existing layer semantics

**Objective:** Make existing OSM infrastructure and proposed infrastructure immediately distinguishable.

**Files:**
- Create: `app/components/workspace/layers-panel.tsx`
- Modify: `app/satellite-overlay.tsx`
- Modify: `app/map-search.tsx`

**Capabilities:**
- toggle satellite, OSM roads, buildings, open space, proposal, analysis, grid;
- adjust proposal and context opacity;
- dim existing context during editing;
- legend for infrastructure types;
- proposal objects remain visually dominant without hiding the map.

### Task 16: Improve map-derived canvas rendering

**Objective:** Improve `CanvasRenderer`, whose current roads are single strokes with very limited classification.

**Files:**
- Refactor: `app/canvas-renderer.tsx`
- Reuse: `app/drawing-style.ts`
- Create: `app/canvas-renderer.test.tsx`

**Requirements:**
- casing and fill hierarchy for OSM roads;
- separate pedestrian/cycle paths;
- meaningful building and open-land hierarchy;
- responsive canvas dimensions rather than fixed 1200×820 assumptions;
- clear scale/legend and export-ready rendering.

---

## Phase 5: Make the editor work like a real planning tool

### Task 17: Add object selection and property inspection

**Objective:** Selecting an object exposes meaningful editable properties.

**Files:**
- Create: `app/components/workspace/object-inspector.tsx`
- Create: `app/components/workspace/object-inspector.test.tsx`
- Modify: `app/satellite-overlay.tsx`
- Modify: `app/map-search.tsx`

**Acceptance:** Update road lanes/width/direction, footpath width/surface, cycleway protection, crossing type, roundabout radius, and signal options without recreating the object.

### Task 18: Add vertex and geometry editing

**Objective:** Let users repair and refine geometry after drawing.

**Files:**
- Create: `app/geometry-editor.tsx`
- Create: `app/geometry-editor.test.tsx`
- Modify: `app/satellite-overlay.tsx`
- Modify: `app/drawing-operations.ts`

**Capabilities:**
- visible handles on selected geometry;
- drag, add, and remove vertices;
- move whole objects;
- split/join segments;
- Escape cancels, Enter confirms;
- all edits are undoable.

### Task 19: Improve snapping and network continuity

**Objective:** Produce connected infrastructure rather than merely nearby-looking lines.

**Files:**
- Create: `app/drawing-snap.ts`
- Create: `app/drawing-snap.test.ts`
- Refactor: `app/canvas-geometry.ts`
- Modify: `app/satellite-overlay.tsx`

**Capabilities:**
- snap to OSM segments, endpoints, intersections, and proposal objects;
- distinguish endpoint, segment, perpendicular, and intersection snaps;
- configurable screen threshold with map-distance sanity limits;
- visual preview of the exact connection;
- crossings align across the full target carriageway;
- roundabout entries connect to its circumference and nearby road endpoints.

### Task 20: Add drawing precision tools

**Objective:** Make proposal creation fast and controllable.

**Capabilities:**
- click-to-place multi-segment paths in addition to drag-only drawing;
- angle constraints with Shift;
- numeric length/width entry;
- duplicate and offset parallel geometry;
- sensible tool persistence;
- command palette and keyboard shortcuts;
- scale-aware grid that can be hidden.

**Tests:** Component tests plus Playwright workflows for mouse and keyboard editing.

---

## Phase 6: Improve analysis from counts to connected urban outcomes

### Task 21: Build a combined existing-plus-proposed transport graph

**Objective:** Analyze whether proposals actually connect to the existing network.

**Files:**
- Create: `shared/network-analysis.ts`
- Create: `shared/network-analysis.test.ts`
- Refactor: graph logic from `app/satellite-overlay.tsx`
- Modify: `server/src/analysis.ts`

**Metrics:**
- connected/disconnected proposal segments;
- new intersections;
- dead ends introduced or resolved;
- route-distance changes;
- connected pedestrian coverage;
- cycle-network continuity;
- crossings connected to footpaths;
- roundabout approach completeness.

### Task 22: Improve pedestrian and accessibility analysis

**Objective:** Evaluate continuous walking infrastructure rather than counting sidewalks.

**Checks:**
- sidewalk gaps;
- crossings between connected footpaths;
- excessive crossing distances;
- isolated footpaths;
- missing curb/access connections represented by the model;
- dangerous discontinuities near junctions;
- warnings clearly labeled as heuristics, not engineering certification.

### Task 23: Improve cycling and road-design feedback

**Objective:** Produce useful rule-based feedback tied to actual geometry and properties.

**Checks:**
- protected vs painted continuity;
- abrupt cycle-lane termination;
- direction conflicts;
- excessive or implausible lane/width combinations;
- intersections lacking transitions;
- roundabout/cycle conflict warnings;
- signal/crossing coordination.

### Task 24: Present explainable analysis on the map

**Objective:** Every warning links to visible geometry and an understandable reason.

**Files:**
- Create: `app/components/workspace/analysis-inspector.tsx`
- Modify: `app/satellite-overlay.tsx`
- Modify: `app/map-search.tsx`

**Acceptance:** Clicking a finding highlights the affected segment; severity and rule rationale are visible; stale findings clear when geometry changes.

---

## Phase 7: Rebuild the frontend around the ThreeUI-inspired workbench

### Task 25: Produce three high-fidelity workspace prototypes

**Objective:** Lock composition before production styling.

**Artifacts:**
- `.hermes/design/threeui-workbench.html`
- `.hermes/design/urban-survey-desk.html`
- `.hermes/design/civic-command-center.html`

**Requirements:** Use real UrbanCanvas controls/content and show default, loading, selected-object, error, and analysis states. Include desktop and mobile frames. Run the anti-slop diagnostic; the chosen direction must score no compositional slop tells.

**Default recommendation:** ThreeUI Workbench.

### Task 26: Define the production design system

**Objective:** Create stable tokens and component rules before replacing layout.

**Files:**
- Create: `app/design-tokens.css`
- Modify: `app/globals.css`
- Create: `app/components/ui/button.tsx`
- Create: `app/components/ui/input.tsx`
- Create: `app/components/ui/panel.tsx`
- Create: `app/components/ui/tooltip.tsx`

**Requirements:** Colors, type, spacing, borders, radii, elevation, focus, disabled/error/success states, motion, and reduced-motion behavior.

### Task 27: Decompose the monolithic workspace

**Objective:** Move layout and UI responsibilities out of the ~1,600-line `map-search.tsx` without changing behavior.

**Files:**
- Create: `app/components/workspace/workspace-shell.tsx`
- Create: `app/components/workspace/project-rail.tsx`
- Create: `app/components/workspace/map-stage.tsx`
- Create: `app/components/workspace/context-inspector.tsx`
- Create: `app/components/workspace/status-bar.tsx`
- Create: `app/components/workspace/drawing-toolbar.tsx`
- Refactor: `app/map-search.tsx`

**Method:** One extraction at a time with existing E2E tests green after each extraction.

### Task 28: Implement responsive workspace modes

**Objective:** Make the editor usable on desktop, tablet, and mobile without merely stacking a 400px sidebar above the map.

**Behavior:**
- desktop: project rail + map + inspector;
- tablet: compact rail + map + slide-over inspector;
- mobile: full-screen map, bottom tool dock, inspector sheet, touch-safe 44px targets;
- preserve map viewport during panel transitions;
- verify portrait and landscape.

### Task 29: Add disciplined loading, empty, error, and success states

**Objective:** Make system state obvious without decorative card clutter.

**States:** Map loading, OSM loading/retry, empty project, autosaving/saved/failed/reconciling, analysis stale/running/complete, offline API, throttled OSM, corrupted-item recovery.

---

## Phase 8: Performance, accessibility, and product hardening

### Task 30: Profile and isolate render layers

**Objective:** Keep large maps and proposals responsive.

**Work:**
- separate static OSM, proposal, handles, previews, and analysis into Konva layers;
- cache stable projections;
- avoid rebuilding graph analysis on unrelated UI state;
- measure pan/zoom and 500-object editing;
- set explicit performance budgets.

### Task 31: Complete accessibility verification

**Objective:** Ensure the redesign improves rather than cosmetically claims accessibility.

**Checks:**
- keyboard tool use and property editing;
- predictable focus after panel/tool changes;
- announcements for saves, retries, and analysis;
- non-color-only drawing distinctions and legend;
- contrast over satellite imagery;
- reduced motion;
- screen-reader labels and reading order.

### Task 32: Add visual regression coverage

**Objective:** Prevent the frontend from drifting back into inconsistent or broken states.

**Files:**
- Add Playwright screenshot specs for desktop/tablet/mobile and key workspace states.
- Store reviewed baselines only after owner selects the final design direction.

---

## Phase 9: Autonomous PR and review protocol

Each coherent batch follows this exact gate:

1. Create a fresh branch from `hermes/dev-stabilization`.
2. Write one failing behavioral test.
3. Run it and confirm the expected failure.
4. Implement the smallest complete vertical slice.
5. Run targeted tests until green.
6. Run `npm run test`, `npm run lint`, `npm run typecheck`, and `npm run build`.
7. Run relevant Playwright desktop and mobile flows.
8. Inspect the complete diff and secret safety.
9. Open a PR only into `hermes/dev-stabilization`.
10. Verify the Vercel preview by using the changed workflow—not merely loading the page.
11. Dispatch an independent spec-compliance review.
12. Dispatch an independent code-quality/security/accessibility review.
13. Fix findings and rerun all relevant gates.
14. Merge only when tests, preview behavior, and both reviews pass.
15. Do not merge or open a PR into `main`.

There is no target PR count. Closely related work stays together; unrelated work waits.

---

## Final promotion and owner handoff

The agent produces:

- completed main-vs-stabilized promotion matrix;
- list of all behavior changes and migrations;
- desktop/tablet/mobile screenshots;
- performance measurements;
- test and CI evidence;
- preview URL;
- known limitations;
- a 20–30 minute owner acceptance script.

Only after the owner completes final product acceptance should a human-authorized PR be opened from the stabilization branch toward `main`.

## Primary risks and mitigations

- **Risk: Large simultaneous redesign and engine rewrite.** Mitigation: stabilize first; vertical slices; shell refactor after browser tests.
- **Risk: Mapbox/Konva coordinate drift.** Mitigation: store map coordinates; test projection at multiple zooms; real-world width conversion tests.
- **Risk: Old saved projects become inaccessible.** Mitigation: versioned migrations and legacy fixtures before schema changes.
- **Risk: ThreeUI inspiration becomes visual copying or gratuitous animation.** Mitigation: transform principles into an original workbench and keep Three.js outside the core editor.
- **Risk: Analysis overclaims planning validity.** Mitigation: explainable heuristic rules and explicit disclaimer; do not claim simulation or certification.
- **Risk: Autonomous agent repeats count optimization.** Mitigation: no iteration target; acceptance-criteria completion only.

## Completion definition

The work is complete only when:

- all confirmed `dev` regressions are fixed and protected;
- every core workflow passes browser tests;
- proposed infrastructure is visually scale-aware and editable;
- snapping creates meaningful network connections;
- analysis considers connected geometry and object properties;
- the ThreeUI-inspired workspace is coherent, responsive, and passes visual/accessibility review;
- previews have been exercised, not merely deployed;
- no core workflow is worse than `origin/main`;
- `main` remains untouched pending explicit owner approval.
