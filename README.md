# hAIul SIM

**Intelligent haulage scenario simulation for open-cut mines.** Import Vulcan `.00t` surfaces and dig / dump solids,
digitise haul strings directly on the 3D surface, size truck fleets per circuit with fully transparent calculations,
allocate crews by rule set, plan by fleet / task priority, and watch the shift play out — trucks, loaders, depletion of
the dig and fill of the dump — from orbit, plan or the driver's seat.

It replaces the *draw in Deswik/Vulcan → export XYZ → paste into the Haulage Calculator spreadsheet → click the
"# trucks" buttons* workflow, reproduces that spreadsheet to the last decimal, and then goes further with OEM-curve
physics, queuing, crew rules and scenario comparison.

## Workspaces

| View | What it does |
|---|---|
| **Site** | 3D pit with hill-shaded terrain, labelled contours, true-width haul roads (grade-coloured on the map; gravel carriageway with windrows and guide posts in the cab view), dig blocks that carve away and dump lifts that build up as the shift plays (horizon: this shift, a week, or time-lapse to completion), animated trucks, loaders and dozers, sky and lighting driven by the shift clock. Tools: select, draw string, edit points, auto-route (least-cost path under a max grade), cross-section A–B, measure. Cameras: orbit, plan, driver POV (3D cab + HUD), chase. Right inspector: circuits, the **# trucks chooser** (the spreadsheet's row-28 buttons, generalised: production vs target, lost PT, queue, match factor, deliberate over/under-trucking), point-table editor, solid stats. Bottom: shift timeline with 15-minute production bars and a running bcm total, prestart / crib / fuel / changeover events; long-section profile (steepest 100 m vs the 10 % limit, verdict first) and a true-scale A–B section with the truck drawn to scale and a road-width check. |
| **Assumptions** | The calculation ledger: every step as a formula, the substituted numbers, the result and the **equivalent workbook cell** (e.g. `ActiveRoute!C16`); the Travel Time table reborn; editable loader, truck-load, material, speed-table and shift assumptions; spreadsheet vs rimpull comparison. |
| **Truck curves** | Rimpull per gear, envelope and retarder curves with resistance lines and each segment's operating point; speed-vs-grade (workbook table vs physics); spec sheets with per-field provenance (OEM / third party / estimated). |
| **Compare** | Every circuit side by side (haul, cycle, trucks assigned / needed, truck and loader PT h/day vs the 18 h minimum, lost PT, queue, bcm/day), what-if truck steppers, and scenario-vs-scenario deltas. |
| **Manning** | Equipment table, crew rule set editor (rules read as sentences, each traceable to the workbook), shift crews, required-vs-available by role with the reason for every person. |
| **Priority** | Circuits and site tasks in priority order against the crew budget: who gets cut first when crew is short, the lost production, and long/short haul alternatives for the last-priority fleet. |
| **Scenarios** | Save, open, duplicate, export / import (`.haiul.json`) scenarios; pick several to compare. |
| **Insights** ✦ | Ranked, explainable findings (under/over-trucked circuits, truck transfers that gain production, crew shortfalls, steep or dropped segments, blocks exhausted mid-shift) with Apply / Show me / Explain, and an exact fleet optimiser. |

## Run it

```bash
npm install
```

```bash
npm run dev
```

Open http://localhost:5173 — `?demo` loads the built-in demo site ("Brigalow Creek", a synthetic Queensland strip pit).

```bash
npm run build:single
```

produces `dist-single/index.html`: the whole app in one file, like the team's other site tools — copy it anywhere and
double-click. `npm run build` produces a regular multi-file build in `dist/`.

```bash
npm test
```

runs the unit and verification suite (engine parity with the workbook, physics sanity, geometry, I/O, planners, UI
helpers). With the dev server running, `node tests/e2e/run.cjs` drives the real app through the main workflows in a
headless browser.

## Data in and out

- **Surfaces and solids:** Vulcan `.00t` triangulations, raw or compressed (vulZ). Closed triangulations are treated as
  solids (volume, centroid); assign each a role — topo, dig, dump — and, for dig/dump, a material and depletion mode.
- **Haul strings:** draw them on the surface, auto-route them, or paste/import XYZ text (CSV/TSV/space separated,
  Vulcan/Deswik property exports, the workbook's *Raw Data* / *Data Dump* layouts — the swapped Northing/Easting header
  is detected). Export as CSV, XYZ, DXF 3D polylines (Deswik/Vulcan) or the workbook's Data Dump layout.
- **Scenarios:** stored in the browser (IndexedDB) and exportable as `.haiul.json`.

## Calculations

Two speed models per circuit:

- **Spreadsheet** — the Haulage Calculator exactly: 3D segment distance, grade rounded to 2 dp, the workbook's loaded /
  empty grade→speed tables, haul efficiency on travel, fixed spot / load / dump times, 60 s per stop sign, the
  macro-button truck options and lost PT per shift. Verified to ≤ 1e-9 against every cached workbook value. Its quirks
  are reproduced but flagged: segments steeper than ±16 % are dropped (0 s) by the workbook; hAIul SIM warns and offers
  a "clamp" fix.
- **Rimpull** — force balance on OEM-style rimpull (per gear) and retarder curves with rolling resistance, speed limits
  and a kinematic acceleration / braking pass; optional finite-source queuing for loader hang and truck queue time.

Every number in the UI traces to a calculation step with its formula and inputs. Specs and verification:
[`docs/spec/01-spreadsheet-calcs.md`](docs/spec/01-spreadsheet-calcs.md) (workbook reverse-engineered, 3,872 / 3,872
values reproduced), [`docs/spec/04-market-and-methods.md`](docs/spec/04-market-and-methods.md) (methods, HaulSim /
Spry feature map), [`docs/verification/`](docs/verification/) (independent calculation audit, code review, design QA and end-to-end results — every defect found was reproduced by a test before it was fixed).

> **Truck curves are estimates.** Gear speeds and the CAT 789C stall rimpull are OEM figures; the remaining rimpull /
> retarder points are modelled from engine power and drivetrain efficiency and sanity-checked against published climb
> speeds. Each value carries its provenance in the Truck curves view. Calibrate against OEM charts or site GPS data
> before relying on absolute speeds.

## Architecture

Vite + TypeScript + React + Three.js (WebGL2) + Zustand. Pure-TypeScript engine and geometry (no DOM) shared by the UI,
workers and tests. See [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md).
