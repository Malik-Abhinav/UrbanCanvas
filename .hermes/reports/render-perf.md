# Render performance budgets (Task 30)

## Konva layer isolation

The drawing stage renders on four independent layers so expensive repaints
stay scoped to what actually changed:

| Layer | Content | Hit-testing |
|---|---|---|
| 1 · static context | drawing surface, scale-aware grid, OSM context roads | off |
| 2 · analysis | dead-end edges, shortest-path overlay, path endpoints | off |
| 3 · proposal (interactive) | drawn objects, snap preview, geometry editor handles, draft/chain previews | **on** |
| 4 · finding highlights | analysis-finding outlines | off |

Because layers 1–2 and 4 never receive pointer events, Konva skips their
hit-graph work during pan/zoom/draw; editing churn repaints layer 3 only.
Static projections (`renderedObjects`, `projectedRoads`, `contextRoadStyles`,
`snapTargets`) are memoized against `mapRevision`, so map pans/zooms that do
not change projection revision do not rebuild them.

## Explicit budgets

| Operation | Budget | Guard |
|---|---|---|
| Render-plan generation, 500-object proposal | < 400 ms per full pass (typical ≪100 ms) | `app/render-perf.test.ts` |
| Projection scaling | linear — doubling objects must stay < 3× time | `app/render-perf.test.ts` |
| Interactive frame feel (manual) | pan/zoom and object edits remain responsive at 500 objects | owner acceptance script |

Regression guards run in CI via `npx vitest run app/render-perf.test.ts`.
Interactive frame-rate measurement is part of the owner acceptance script
(plan Phase "Final promotion and owner handoff"), not CI.
