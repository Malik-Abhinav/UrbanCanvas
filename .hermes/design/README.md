# UrbanCanvas interface prototypes

Three standalone, dependency-free explorations of the same **Operate** workspace. Each uses UrbanCanvas’s existing place search, area selection, OSM import/sync, project save, drawing tools, undo/redo, object inspection, shortest-path work, and rule-based change analysis.

| Variant | Stance | Composition | Best quality | Trade-off |
|---|---|---|---|---|
| [`threeui-workbench.html`](threeui-workbench.html) | **Strong-fit / recommended** | Quiet project rail, map-first workbench, persistent object/analysis inspector | Best balance of density, hierarchy, direct manipulation, and clear responsive rails | Less conventional than a standard GIS package |
| [`urban-survey-desk.html`](urban-survey-desk.html) | Conservative technical | Light survey-plan canvas with drawing register and specification-style inspector | Familiar to planners, surveyors, and technical reviewers; prints mentally like a working drawing | More austere and less fluid for rapid scenario work |
| [`civic-command-center.html`](civic-command-center.html) | Divergent professional | Command/search band, operations queue, live review, activity-oriented inspector | Fast keyboard-led operation and strong multi-scenario situational awareness | Highest information density; needs careful onboarding |

## Recommendation

Advance **ThreeUI Workbench**. It most clearly treats UrbanCanvas as an operating surface: map edits remain central, object state is legible without floating-card clutter, and the project/search and inspection rails collapse cleanly at tablet and mobile widths. Its visual language transforms ThreeUI’s compact hierarchy, hairline separation, and selected-row discipline without copying its branded shell.

## Interaction coverage

- Select any proposed road, cycleway, footpath, crossing, roundabout, or signal from the map or object list.
- Switch drawing tools and object/analysis inspector tabs.
- Exercise search/command, area-selection, save/commit, layer, analysis, and mobile rail states.
- Workbench includes keyboard tool shortcuts; Command Center includes a command palette (`Cmd/Ctrl+K`).
- All variants include visible hover/focus states and `prefers-reduced-motion` handling.

## Slop diagnostic (final)

Each variant scored **0/10** after the explicit ten-tell audit: no tech gradient, generic indigo, feature-tile grid, accent-rail cards, blur/glass surface, monument stat, icon toppers, centered stack, default Inter typography, or wrong-surface composition. The colored selection markers in the Workbench and Command Center are functional navigation state, not decorative card accent rails.

Open any file directly in a browser; no server, external font, image, script, or stylesheet is required.
