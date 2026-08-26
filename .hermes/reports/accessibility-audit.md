# Accessibility verification (Task 31)

Status of each check from the stabilization plan, with evidence locations.
Verified against the decomposed workspace (Tasks 27–30).

## 1. Keyboard tool use and property editing — ✅ satisfied

- All tool dock controls are native `<button>`s (`drawing-toolbar.tsx`) with
  `aria-pressed` state; single-key shortcuts (V/R/B/S/C/O/T/E) documented via
  `title` and implemented in `satellite-overlay.tsx` keydown handling; shortcuts
  are suppressed while typing in inputs.
- Property editing happens through labelled inspector fields
  (`object-inspector.tsx`), reachable by Tab; commits flow through the overlay
  property pipeline.

## 2. Predictable focus after panel/tool changes — ✅ satisfied

- Opening the workspace drawer moves focus to its close button; Escape closes
  and returns focus to the toggle (`workspace-shell.tsx`). The closed drawer is
  `inert` + `aria-hidden`, so nothing inside is tabbable while off-canvas.
- Tool selection keeps focus on the pressed button (native behaviour).
- Global `:focus-visible` ring uses the accent token on every interactive
  element (`globals.css`).

## 3. Announcements for saves, retries, and analysis — ✅ satisfied

- Save lifecycle: `SaveStatusIndicator` — `role="status"` for saving/saved,
  `role="alert"` for failures with a Retry action (Task 29).
- Manual save/load/delete outcomes: `ProjectMessageBanner` (`aria-live="polite"`).
- Analysis: running state on the button, findings in `AnalysisInspector`
  (stale notice is `role="status"`), failures via `role="alert"`
  (`AnalysisMessageBanner`).
- OSM retry availability/countdown announced inside `OsmErrorBanner`.

## 4. Non-color-only drawing distinctions and legend — ✅ satisfied

- Proposal types differ by casing, dash pattern, and width in
  `drawing-renderer.tsx` (roads carry casing + dashed centreline; bike lanes a
  solid fill with dashed edge; footpaths pale double lines; crossings render as
  zebra bands).
- New `MapLegend` renders text-labelled visual samples of every proposal type
  (`map-stage.tsx`, bottom-left toggle).

## 5. Contrast over satellite imagery — ✅ satisfied

- All map overlays sit on opaque/near-opaque dark chips (`#101820/95`,
  `#161a18/90+`) with light text; accent text pairs (`#63e6be`, `#f5c542`,
  `#ffd1ca`, `#9ff5da`) are used only on those darkened surfaces.
- Proposal strokes draw above a dimmed satellite base
  (`resolveContextOpacity`) rather than raw imagery.

## 6. Reduced motion — ✅ satisfied

- Global `prefers-reduced-motion` block neutralizes animations/transitions
  globally (`globals.css`); drawer slide, spinner, and hover lifts are covered.

## 7. Screen-reader labels and reading order — ✅ satisfied

- Landmarks: `<main>` shell, labelled `aside` ("Map workspace controls"),
  labelled map `section` (#map-canvas) with skip link from document start.
- Drawing overlay region has `aria-label="Drawing canvas overlay"`.
- Icon-only controls carry `aria-label` (tools, undo/redo, delete project,
  collapse/close buttons); decorative icons are `aria-hidden`.
- DOM order follows visual order inside both desktop grid and mobile sheet.

## Known limitations (honest gaps)

- Vertex editing handles are pointer-drag based; there is no keyboard path to
  add/move/delete individual vertices (property edits remain fully keyboard
  accessible). Tracked as future work; not a regression vs `origin/main`.
- Map pan/zoom itself remains pointer/wheel driven (Mapbox control surface);
  keyboard camera nudge exists only through the app-level zoom buttons.
