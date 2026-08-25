# Phase 2 workflow regression fixes

Branch: `hermes/stabilization-02-workflow-regressions`

## Fixed behavior

- Area selection remains disabled with an accessible readiness explanation until the live Mapbox style is ready. Style unload/error events return it to the disabled state.
- Playwright controls the fixture map readiness handshake explicitly, proving disabled → released → enabled deterministically; 10 concurrent repeats passed.
- Undo/redo retains the latest 500 complete snapshots, supports a full 500-edit round trip, and visibly announces when older history is truncated at edit 501.
- Project save and analysis accept 501 edits, removing the former user-visible 500-edit cliff.
- Project persistence enforces a 6 MB serialized state budget; analysis enforces a 10,000-edit CPU bound; Express retains its 8 MB request-body guard.
- New project names use a visible 80-character UI/server affordance. Existing long legacy names remain saveable only when unchanged; the update SQL prevents using an existing ID to bypass the limit with a different long name.
- The project-name counter is connected through `aria-describedby`, announced as a polite status, and covered by browser accessibility assertions.

## RED → GREEN evidence

- Map readiness E2E failed before the disabled/loading behavior and explicit fixture release were implemented; it then passed and passed 10/10 repeated runs.
- The 500-edit history test failed under the former 50-snapshot cap; it passes with ordered undo/redo verification.
- The 501-edit project and analysis tests failed under the former limit; both pass after removing the cliff.
- Legacy long-name save failed under the former unconditional backend cap; new long-name rejection and unchanged-legacy preservation now both pass.
- New resource-bound tests failed before the 6 MB project-state and 10,000-edit analysis guards; both now pass.

## Final verification

- `npm run test`: 7 files, 58 tests passed.
- `npm run lint`: passed.
- `npm run typecheck`: passed.
- `npm run build`: frontend and API passed.
- `npm run test:e2e:production-bundle`: passed.
- `npm run test:e2e:production-safety`: passed without mutating `.next`.
- Post-safety `npm run typecheck`: passed.
- `npm run test:e2e -- --project=chromium`: 1/1 passed.
- `npm run test:e2e -- --project=chromium --repeat-each=10`: 10/10 passed.
- `git diff --check`: passed.
