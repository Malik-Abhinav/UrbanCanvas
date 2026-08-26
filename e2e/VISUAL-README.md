# Visual regression baselines (Task 32) — LOCKED

Baselines in `e2e/visual-baselines/` were generated from the ThreeUI workbench
look and **reviewed by the owner** on 2026-08-26. They now guard:

| Baseline | Viewport | State |
|---|---|---|
| desktop-default | 1440×900 | default workbench |
| desktop-confirmed-area | 1440×900 | area confirmed, overlay + legend |
| tablet-drawer-open | 834×1112 | slide-over controls |
| mobile-sheet-open | 390×844 | bottom sheet over full-screen map |

## Usage

- Enforce: `VISUAL_BASELINES_REVIEWED=1 npx playwright test visual.spec.ts`
- After an intentional visual change: re-run with `--update-snapshots`,
  review the diff, commit.
