# Visual regression baselines (Task 32)

Specs: `visual.spec.ts`. Baseline directory (when locked): `e2e/visual-baselines/`.

## Owner review flow

1. Start dev stack, then generate candidates:
   `VISUAL_BASELINES_REVIEWED=1 npx playwright test visual.spec.ts --update-snapshots`
2. Move the generated `e2e/visual-baselines/**` PNGs under version control
   only after the owner approves the design direction.
3. CI enforcement then just needs `VISUAL_BASELINES_REVIEWED=1` in the env.

Without that env var the visual specs skip themselves — the rest of the
Playwright suite is unaffected.
