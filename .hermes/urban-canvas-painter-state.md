# UrbanCanvas Painter — persistent run state

## Progress
- Successful batches: **1 / 10**
- Last merged PR: #15 — fix(api): add timeout and safe parsing for Overpass fetches (merged into dev 2026-08-23)
- Current branch: dev
- Current batch theme: TBD (batch 2)

## Product understanding
- Next.js 15 app (`app/`): map-search.tsx (~1460 lines, main workspace), satellite-overlay.tsx (~1644 lines, Konva canvas editor), canvas-renderer.tsx, Clerk auth (middleware.ts protects all non-public routes).
- Express API (`server/src/`): index.ts (routes), osm.ts (Overpass proxy, bbox validation, timeout), projects.ts (Postgres CRUD, schema auto-create), analysis.ts (rule-based change analysis), db.ts (pg pool).
- Auth: Clerk on both sides; API routes require Bearer token via getAuth.
- No test framework installed yet. Verify = lint + typecheck + build via GitHub Actions "Verify".

## Candidate improvement areas (post-batch-1 reassessment)
- Project lifecycle: no way to DELETE saved projects (API or UI); weak save-input validation (no name length cap, id not validated as UUID, userEdits unbounded); no tests for projects module. → BATCH 2 THEME
- Security/reliability: POST /api/osm is unauthenticated + unthrottled (open Overpass proxy abuse vector); no rate limiting anywhere.
- satellite-overlay.tsx is very large; undo/redo and keyboard shortcuts unknown — inspect during canvas batch.
- Frontend fetches have no client-side timeouts; auto-save failure only surfaces as text message.
- Accessibility pass needed (focus states, aria-live for async messages).
- Mobile/responsive behavior of workspace grid untested.

## Constraints
- Never touch main; PRs target dev only. Required check: "Verify".
- Do not print .env contents.

<!-- UPDATED 2026-08-23 after batch 2 -->
## Progress (current)
- Successful batches: **2 / 10**
- Last merged PR: #16 — feat(projects): project deletion, stricter save validation, first test suite (dev 1996b8f)
- Current branch: dev
- Current batch theme: TBD (batch 3)

## Batch log
1. PR #15 Overpass timeout/safe parsing (pre-existing)
2. PR #16 project delete API+UI, save validation hardening, shared bbox.ts, vitest suite (20 tests), CI Test step

<!-- UPDATED 2026-08-23 after batch 3 -->
## Progress (current)
- Successful batches: **3 / 10**
- Last merged PR: #17 — fix(canvas): snapshot-based undo/redo history + shared geometry module
- Current branch: dev
- Current batch theme: TBD (batch 4)

## Batch log
1. PR #15 Overpass timeout/safe parsing
2. PR #16 project delete API+UI, save validation, bbox.ts, vitest (20 tests), CI Test step
3. PR #17 canvas undo/redo snapshot history, erase reversible, ctrl+y, canvas-geometry.ts, 17 tests
   - NOTE: briefly committed batch 3 to local dev by mistake; fixed by moving commit to branch and resetting local dev to origin/dev before any push of dev. No remote damage.

<!-- UPDATED 2026-08-23 after batch 4 -->
## Progress (current)
- Successful batches: **4 / 10**
- Last merged PR: #18 — feat(api): rate-limit OSM proxy + client-side fetch timeouts
- Current branch: dev
- Current batch theme: TBD (batch 5)

## Batch log
1. PR #15 Overpass timeout/safe parsing
2. PR #16 project delete API+UI, save validation, bbox.ts, vitest (20 tests), CI Test step
3. PR #17 canvas undo/redo snapshot history, erase reversible, ctrl+y, canvas-geometry.ts, +17 tests (brief local-dev commit mistake, fixed before push)
4. PR #18 rate limiter on /api/osm (10/min/IP, OSM_RATE_LIMIT), app/api-fetch.ts timeouts on all frontend calls, +4 tests

<!-- UPDATED 2026-08-23 after batch 5 -->
## Progress (current)
- Successful batches: **5 / 10**
- Last merged PR: #19 — feat(a11y): screen-reader announcements, focus visibility, landmarks
- Current branch: dev
- Current batch theme: TBD (batch 6)

## Batch log
1. PR #15 Overpass timeout/safe parsing
2. PR #16 project delete API+UI, save validation, bbox.ts, vitest (20 tests), CI Test step
3. PR #17 canvas undo/redo snapshot history, erase reversible, ctrl+y, canvas-geometry.ts, +17 tests
4. PR #18 rate limiter on /api/osm (10/min/IP), app/api-fetch.ts timeouts, +4 tests
5. PR #19 a11y: role=alert banners, aria-live statuses, focus-visible, reduced motion, skip link, aria-pressed

<!-- UPDATED 2026-08-23 after batch 6 -->
## Progress (current)
- Successful batches: **6 / 10**
- Last merged PR: #20 — perf(save): cheap save signatures + auto-save failure surfacing
- Current branch: dev
- Current batch theme: TBD (batch 7)

## Batch log
1. #15 Overpass timeout/safe parsing | 2. #16 project delete+validation+bbox.ts+vitest(20) | 3. #17 canvas history reducer+canvas-geometry(+17) | 4. #18 rate limiter+api-fetch timeouts(+4) | 5. #19 a11y pass | 6. #20 O(edits) save signature + retry-save UX

<!-- UPDATED 2026-08-23 after batch 7 -->
## Progress (current)
- Successful batches: **7 / 10**
- Last merged PR: #21 — perf(map): rAF-coalesced revisions + drag guard
- Current branch: dev
- Current batch theme: batch 8 — project loading robustness

## Batch log
1. #15 Overpass timeout/safe parsing | 2. #16 delete+validation+bbox.ts+vitest(20) | 3. #17 history reducer(+17) | 4. #18 rate limit+fetch timeouts(+4) | 5. #19 a11y | 6. #20 save signature+retry UX | 7. #21 rAF map revisions

<!-- UPDATED 2026-08-23 after batch 8 -->
## Progress (current)
- Successful batches: **8 / 10**
- Last merged PR: #22 — fix(projects): validate loaded project payloads
- Current branch: dev
- Current batch theme: batch 9 — DX/docs/env

## Batch log
1. #15 | 2. #16 | 3. #17 | 4. #18 | 5. #19 | 6. #20 | 7. #21 | 8. #22

<!-- UPDATED 2026-08-23 after batch 9 -->
## Progress (current)
- Successful batches: **9 / 10**
- Last merged PR: #23 — docs catch-up
- Current branch: dev
- Current batch theme: batch 10 — analyze endpoint input hardening

## Batch log
1. #15 | 2. #16 | 3. #17 | 4. #18 | 5. #19 | 6. #20 | 7. #21 | 8. #22 | 9. #23

<!-- UPDATED 2026-08-23 — RUN COMPLETE -->
## Progress (current)
- Successful batches: **10 / 10 — RUN COMPLETE**
- Last merged PR: #24 — fix(api): harden analyze endpoint input validation (dev a5445fd)
- All 10 batches merged into dev; main untouched; no dev->main PR created.

## Batch log
1. #15 | 2. #16 | 3. #17 | 4. #18 | 5. #19 | 6. #20 | 7. #21 | 8. #22 | 9. #23 | 10. #24
