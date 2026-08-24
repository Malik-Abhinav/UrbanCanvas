# Phase 1 test foundation baseline

Recorded: 2026-08-24 19:35 IST
Branch: `hermes/stabilization-01-test-foundation`

## Scope

Playwright now exercises the initial workspace render, deterministic map readiness, drag selection, area confirmation, the real frontend OSM fetch/parse path through route interception, asynchronous map movement completion, and a non-zero Konva canvas overlay without Clerk, Mapbox, Overpass, Neon, API servers, keys, or other secrets.

The fixture path requires both `E2E_TEST_FIXTURES=1` and `NEXT_PUBLIC_E2E_TEST_FIXTURES=1`, is development-only, and is rejected by Next config when `NODE_ENV=production`. Client and middleware fixture branches use compile-time `NODE_ENV !== "production"` guards so normal production optimization removes them.

## RED -> GREEN evidence

- RED: `npm run test:e2e -- --project=chromium`
  - Exit 1.
  - Playwright web server timed out after 120000 ms because the secretless fixture/auth path did not exist.
- GREEN: `npm run test:e2e -- --project=chromium`
  - Exit 0.
  - 1 Chromium test passed: workspace render -> map ready -> drag selection -> confirm -> intercepted OSM fetch -> non-zero Konva overlay ready.
  - The spec aborts every non-allowlisted request before transmission and stores only sanitized origin/path evidence.
  - Playwright launches a wrapper that spawns the actual Next server with a fresh allowlisted environment; fixture config then strips known project provider credentials loaded from local env files and pins the intercepted API endpoint.

## Production safety evidence

- `npm run test:e2e:production-safety`
  - Exit 0: production build rejected E2E fixtures before compilation while preserving the existing `.next` output.
- `npm run test:e2e:production-bundle`
  - Exit 0: normal production executable bundles contain no E2E fixture code or flags.
- Clean proof: removed `.next`, then ran `npm run build` without fixture flags.
  - Exit 0; web and API builds passed.
  - Searches of `.next/static`, `.next/server/app`, and `.next/server/middleware.js` returned 0 matches for fixture payload labels, the fixture UI label, fixture env names, and the fixture middleware function name.

## Final verification

| Command | Observed result |
| --- | --- |
| `npm run test:e2e -- --project=chromium` | PASS: 1 passed |
| `npm run test:e2e:production-safety` | PASS: production fixture build rejected; `.next` preserved |
| `npm run test:e2e:production-bundle` | PASS: no fixture code/flags in production executables |
| `npm run test` | PASS: 7 files, 54 tests |
| `npm run lint` | PASS |
| `npm run typecheck` | PASS |
| `npm run build` | PASS: Next production build + API TypeScript build |
| `git diff --check` | PASS |

## Known non-blocking output

- Clerk emits its existing `createRouteMatcher` deprecation warning during the dev server run.
- Next dev emits an `allowedDevOrigins` future-warning for Playwright's `127.0.0.1` asset requests.
- Webpack emits its existing large-string cache serialization warning.
