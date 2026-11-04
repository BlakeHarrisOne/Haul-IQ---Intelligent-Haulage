# hAIul SIM — Architecture

hAIul SIM is a browser application for open-cut haulage planning: import Vulcan `.00t` surfaces and dig/dump
solids, digitise haul strings directly on the surface, run physics-based (or spreadsheet-compatible) cycle
calculations, size truck fleets per circuit, allocate crews by rule sets, plan by fleet/task priority, animate
the shift (trucks, POV, depletion of dig and fill of dump) and compare scenarios — with every calculation shown.

## Stack

| Layer | Choice | Why |
|---|---|---|
| Build | Vite 8, TypeScript 5.9 (strict) | fast dev server; `npm run build:single` emits one self-contained HTML file like the team's other site tools |
| UI | React 19 + CSS Modules + design tokens (`src/styles/tokens.css`) | component isolation across many contributors; light + dark themes |
| 3D | Three.js 0.187 (WebGL2) with custom shader chunks | terrain hillshade + contours, solids with live depletion caps, instanced trucks, POV cameras |
| State | Zustand (`src/state/store.ts`) | immutable scenario document + undo/redo; UI state beside it |
| Tests | Vitest (Node) | engine + geometry verified against the spreadsheet and analytic shapes |

## Data flow

```
 .00t / CSV / DXF ──► io/ (parse) ──► geom/ (stats, height index, sections, depletion, routes)
                                         │
                       Scenario document (core/types.ts) ◄── UI edits via store.commit()
                                         │
                       engine/ (pure): circuits → fleet options → manning → priority → shift state
                                         │                    (CalcStep traces for transparency)
                     ┌───────────────────┼────────────────────┐
                 scene/ (Three.js)   features/* (React)    scenarios (IndexedDB + .haiul.json)
```

## Coordinate frames
World = site grid metres `[E, N, Z]`. Scene = Three.js Y-up: `x = E − E0`, `y = (Z − Z0) × VE`, `z = −(N − N0)`
(`core/frame.ts`). Never put raw MGA coordinates in a GPU buffer.

## Module ownership (parallel build)

| Path | Owner | Public entry |
|---|---|---|
| `src/core/**`, `src/state/**`, `src/App.tsx`, `src/main.tsx`, `src/styles/**`, `src/ui/**` | integrator | `@/core/types`, `@/state/store`, `@/state/derived`, `@/ui` |
| `src/engine/**`, `src/data/**` | engine agent | `@/engine`, `@/data` |
| `src/geom/**`, `src/io/**`, `src/demo/**` | geometry agent | `@/geom` |
| `src/scene/**` | scene agent | `@/scene` → `Viewport`, `sceneApi` |
| `src/features/workspace/**`, `src/features/scenarios/**` | shell agent | `Shell`, `ScenariosView` |
| `src/features/haulage/**` | haulage agent | `HaulageInspector`, `ProfileStrip`, `SectionPanel` |
| `src/features/assumptions/**`, `curves/**`, `compare/**` | analytics agent | `AssumptionsView`, `CurvesView`, `CompareView` |
| `src/features/manning/**`, `priority/**`, `insights/**` | manning agent | `ManningView`, `PriorityView`, `InsightsPanel` |

Rules: only edit files you own; import other modules only through their public entry; request contract
changes (types, store actions) from the integrator.

## Specs
`docs/spec/01-spreadsheet-calcs.md` (the Excel calculator, reverse-engineered, with test vectors),
`02-design-haulroadlab.md`, `03-design-rainmodel.md` (visual references), `04-market-and-methods.md`
(HaulSim/Spry feature map, haulage physics, queuing, OEM curves), fixtures in `docs/spec/fixtures/`.
