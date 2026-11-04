# hAIul SIM: end-to-end verification (real browser, real UI)

Scope: the eleven user workflows below, driven through the running app in headless Chromium (Playwright, SwiftShader
WebGL). Every action goes through the UI: clicks, keyboard shortcuts, the native file chooser, drag-and-drop. The store
is not exposed on `window`, so where the DOM does not print a number the suite reads the app's own store / engine
modules **read-only** through the Vite dev server's module graph (same module instance the page uses), and
`window.__haiulScene` for render stats. I did not change anything under `src/`.

**Suite:** `tests/e2e/` (plain Node + Playwright, not picked up by vitest).

```bash
node tests/e2e/run.cjs --isolated        # all flows; private dev server with HMR off (recommended while src/ is being edited)
node tests/e2e/run.cjs 3 5               # selected flows against the running dev server (E2E_URL, default :5173)
```

Screenshots and `results.json` go to `E2E_OUT` (this run: the QA scratchpad `e2e/` folder). Fixtures: `E2E_TOPO`
(Vulcan topo `.00t`), `E2E_SOLID` (defaults to `src/io/__fixtures__/demo_dump_S51_lift.00t`), and string 0 of
`docs/spec/fixtures/raw-data-strings.json` written out as CSV.

## Result: 7 of 11 flows PASS, 4 FAIL (265 checks, 9 failed)

Every workflow runs end to end. Each FAIL comes from a real defect that a check catches. No flow failed on a timeout or
a harness problem. There were **no uncaught page errors and no console errors** in any flow of the final run. The only
console warnings were SwiftShader "GPU stall due to ReadPixels" driver messages at load, which the suite treats as
environment noise. Screenshots are in `/tmp/claude-0/-home-user-Haul-IQ---Intelligent-Haulage/6a799533-cbdc-5f2c-b7d8-1a1fb31b2822/scratchpad/e2e/` (file names below). The machine-readable results are in
`results.json` in the same folder.

| # | Flow | Result | Evidence (screenshots) | Notes |
|---|---|---|---|---|
| 1 | Cold start → welcome → Open demo | **PASS** | `01_welcome.png`, `01_demo.png` | The welcome card shows on an empty scenario with no timeline. "Open the demo site" loads 3 circuits, 4 strings, 3 dig + 3 dump solids and the topo. The inspector counts match the document and every circuit calculates (19.90 / 25.06 / 14.79 min). |
| 2 | Import .00t topo (file picker) + closed solid (drag-and-drop) | **PASS** | `02_topo_modal.png`, `02_topo_added.png`, `02_solid_modal.png`, `02_solid_added.png` | The 11.8 MB topo parses in 0.5 s (worker) and is detected as a **Surface**. Role Topo is selected and the topo is added. The dropped dump solid is detected as a **Closed solid** with a volume of 1.43 M bcm. Its role is guessed as Dump from the file name, with fill set to bottom-up. Neither file produced parse warnings: the modal's warning list was compared with the importer's own list, and both were empty. Each import is one undo step. |
| 3 | Strings: import XYZ, draw, edit RL, undo/redo | **FAIL** | `03_strings_import_modal.png`, `03_draw_rubberband.png`, `03_drawn_string.png`, `03_rl_edited.png`, `03_rl_redo.png` | **Import:** the CSV imports 17 points and 2,106 m, with Easting and Northing not swapped. **Draw:** four clicks and Enter give 22 points after the 25 m follow-surface densify, all snapped. The string opens in the inspector with all six metrics (472 m). **Edit:** RL +12 m changes Rise from +49.5 to +61.0 m, and the EX09 cycle goes from 19.900 to 19.718 min. **Undo/redo:** Ctrl+Z restores the RL and cycle exactly, and Ctrl+⇧Z re-applies the edit. **Fails:** D1 (D over the 3D view) and D2 (Finish / Follow surface hidden under the inspector). |
| 4 | Circuit: create, # trucks chooser, speed model | **FAIL** | `04_new_circuit_modal.png`, `04_new_circuit_kpis.png`, `04_trucks_chooser.png`, `04_rimpull.png` | **Create:** the new circuit (EX07, CAT 789D, OB, long haul) shows all six KPIs, matching the engine (21.8 min). **Chooser:** rows 1, 9 and 7 give the badges Under (8.41 h/shift lost), Over (0.00) and Balanced (the recommended row), and the Lost PT KPI always equals the engine value. **Speed model:** Rimpull changes the cycle from 21.80 to 15.11 min, and switching back restores it exactly. **Fails:** D3 (3 checks). |
| 5 | Timeline: play, production, moving trucks, crib | **PASS** | `05_playing_paused.png`, `05_later.png`, `05_crib.png` | **Play:** Space plays and pauses, and the clock runs from 06:00 to 07:50. Dig %, dump % and bcm so far rise for all 3 circuits, in the engine state, the timeline chips and the scene labels. **Moving trucks:** over +30 min, 9 of 12 trucks move more than 5 m and 2.5 % of the 3D view's pixels change. **Crib:** a click on the scrubber's Crib block lands in "Crib 1 · 100% stopped". All 12 trucks are held by the event and the view stays static (0.075 % of pixels change). |
| 6 | Cameras & tools: POV, plan, section, measure | **FAIL** | `06_pov_hud.png`, `06_plan.png`, `06_section.png`, `06_measure.png`, `06_measure_near_dock.png` | **POV (P):** the cockpit HUD shows speed, limit, grade, and a route strip with the dig and dump ends and the distance. **Plan (T):** the camera flies to plan, and the HUD is hidden outside POV. **Section (X):** two clicks give a 1,277 m line, and the Cross-section panel shows 3 filled solid cuts and the topo. **Measure (M):** three points read 300 m in 3D and in plan, which matches the picked geometry. **Fails:** D5 (readout hidden under the long-section dock). |
| 7 | Views: Assumptions, Curves, Compare, Manning, Priority, Scenarios | **PASS** | `07_assumptions.png`, `07_curves.png`, `07_compare.png`, `07_manning.png`, `07_priority.png`, `07_scenarios.png` | All six views render without errors and without empty states, and they agree with the site view. **Assumptions:** cycle 19.90 min against 19.9 in the inspector, trucks needed 5.74 in both, and a ledger with `ActiveRoute!` references. **Curves:** 35 charts, including the CAT 789D. **Compare:** the cycles 19.90 / 25.06 / 14.79 equal the engine's. **Manning:** crew required 36, the same as the engine. **Priority:** crew available 30, the same as Manning. **Scenarios:** the card counts (3 / 4 / 7) and 60,107 bcm/d match the inspector. |
| 8 | Manning rules, Priority crew cut, Apply | **PASS** | `08_rule_toggled.png`, `08_crew_cut.png`, `08_manning_after_apply.png` | **Rule toggle:** disabling the "+1 truck operator per truck" rule drops required crew from 36 to 24 (the engine agrees), and re-enabling restores it. **Crew cut:** at crew 30 → 28, the lowest-priority circuit, LDR1 (P3), is reduced to 2 of 3 trucks. EX09 and EX04 keep theirs, the cuts land at the bottom of the list first, and 34.6k bcm/day is lost. **Apply:** after Apply, Manning's crew required is 28, the same as the plan's crew used (28). Ctrl+Z restores the request. |
| 9 | Insights: open, apply, undo | **FAIL** | `09_insights_open.png`, `09_insight_applied.png`, `09_insight_undone.png` | The panel opens with 7 findings, and Explain shows the working. Applying the top suggestion is one undoable step (LDR1 goes from 3 to 2 trucks), and Ctrl+Z restores the scenario exactly. **Fails:** D4 (the crew-shortfall suggestion does not fix the shortfall). |
| 10 | Persistence: save → reload → open; export → import | **PASS** | `10_saved.png`, `10_library.png`, `10_reopened.png`, `10_imported.png` | **Save:** Ctrl+S shows a toast and "Saved just now". After a reload the welcome card lists the scenario under Recent. **Reopen:** Scenarios → Open gives an identical document: counts, 374,056 triangles, 418 points, a geometry and parameter digest, 60,107 bcm/d and the cycle. **Export/import:** Ctrl+E writes a 12.2 MB `.haiul.json`. Import file opens it "as a copy" and it is identical again. |
| 11 | Theme (dark) + 1366×768 layout | **PASS** | `11_dark_site.png`, `11_dark_circuit.png`, `11_dark_assumptions.png`, `11_1366_overview.png`, `11_1366_circuit.png`, `11_1366_tool.png`, `11_1366_assumptions.png` | **Dark:** the page background is rgb(14,17,22), the inspector and sheet cards are dark with light text, and the 3D sky follows the theme (luminance 0.90 → 0.09). The preference is remembered, and the document stays clean. **1366×768:** with the overview, with a circuit and its profile dock, and with a tool hint, 8 or 9 pieces of chrome are on screen. None overlap, none go past the window, and the page does not scroll. The Assumptions sheet fits the width. |

## Ranked defects

Line numbers are as of this run; `src/` was being edited by other agents during it.

### D1. High: the Draw (D) and Edit (E) shortcuts do nothing while the pointer is over the 3D view; they pan the camera
- **What I did:** loaded the demo, rested the pointer on the 3D view and pressed **D**. Flow 3 check: *"D (cursor over the 3D view) selects the draw tool"*.
- **What happened:** the tool stayed **Select**, and the camera took D as a pan key. With the pointer over chrome, D works. **E** goes through the same code path (`KeyE` is in the same camera key set); I read this in the code but did not exercise it separately.
- **Expected:** D selects Draw (and E selects Edit points) wherever the pointer is, because the 3D view is where a planner's pointer
  normally is.
- **Cause:**
  - The scene's window `keydown` listener runs before the shell's global key map, because the Viewport effect is registered first.
  - That listener passes the key to `rig.keyDown`, whose WASD/QE pan set includes `KeyD` and `KeyE` (`src/scene/core/camera.ts:497`), and then calls `preventDefault()` (`src/scene/core/SceneCore.ts:732`).
  - The shell then ignores the event, because of `if (e.defaultPrevented) return;` (`src/features/workspace/commands.ts:135`).
- **Fix:** remove D and E (and other tool letters) from the camera keys, or give tool shortcuts priority.

### D2. Medium-High: the Draw tool's **Finish** button and **Follow surface** toggle are hidden under the inspector
- **What I did:** opened Draw with the inspector open (the default) and clicked 4 points. Flow 3 checks: *"draw hint Finish button visible and clickable"* and *"Follow surface toggle not covered"*.
- **What happened:** the hint chip is centred on the full viewport, so its right end runs under the 400 px inspector.
  - **Finish** is completely covered (hit-test returns the Inspector at all 5 sample points).
  - **Follow surface (25 m)** is covered by the inspector and the timeline bar (`03_draw_rubberband.png`: the text is cut at "Follow surface (25").
  - Enter or double-click still finishes the string, but the visible controls cannot be reached.
- **Expected:** the chip sits in the free stage area (between the rail and the inspector, above the timeline and dock) and above the shell chrome.
- **Cause:**
  - The chip is placed with `.hint { left: 50%; bottom: 96px; transform: translate(-50%) }` (`src/scene/strings/ui.module.css:87-91`).
  - It is appended to the scene's `hudLayer` (`src/scene/tools/index.ts:36`), which sits under the shell HUD.
  - It ignores the safe insets the shell already gives the scene (`sceneApi.setSafeInsets`).

### D3. Medium-High: field captions are `<label>` elements wrapping their controls, so clicking a caption changes the circuit
- **What I did:** opened a circuit and set Rimpull, then clicked the **"Speed model"** caption text. Also clicked the **"Haul string"** caption. Flow 4 checks: *"clicking the Speed model caption does not change the model"*, *"clicking the Haul string caption keeps the circuit open"* and *"speed-model tabs are named by their own text"*.
- **What happened:**
  - Clicking the caption silently switched the circuit back to **Spreadsheet** (an undoable edit that changes every result).
  - Clicking the "Grades steeper than ±16 %" caption resets **Clamp → Drop** in the same way (reproduced separately).
  - Clicking "Haul string" opens the string editor, because the label's first labelable descendant is the "Edit string" button.
  - The first segment button gets the caption as its accessible name (`tab "Speed model Rimpull": Spreadsheet`), so screen readers announce the wrong control.
- **Expected:** a caption click does nothing (or focuses the group), and each segment is named by its own text.
- **Cause:**
  - `Field` renders `<label className={s.field}>…{children}</label>` (`src/ui/fields.tsx:8`).
  - `CircuitCard` uses it around segmented controls and a nested button: `src/features/haulage/CircuitCard.tsx:205` (Speed model), `:210` (Haul string + Edit string), `:262` (±16 % rule) and `:269` (Motion).
  - The same pattern affects any `Field` that wraps a `Segmented` or a button.

### D4. Medium: Insights "Apply allocation" leaves the crew short, unlike Priority's "Apply allocation"
- **What I did:** opened Insights on the demo and clicked **Apply allocation** on the top finding, "Crew short by 6 … Bulk push dozers (P4) 6 → 1, LDR1 (P3) cut to 2 trucks". Flow 9 checks: *"after Apply allocation the crew fits"* and *"the crew-shortfall finding is resolved"*.
- **What happened:** only the truck cut was applied (LDR1 3 → 2). Required crew is still **35 against 30** available, and the same finding comes back as "Crew short by 5 …" (`09_insight_applied.png`).
- **Expected:** the same result as Priority → Apply allocation. Flow 8 shows that one also stands down the push dozers, so Manning's required total equals the plan's crew used (28 = 28).
- **Cause:** the insight's action only maps `circuits[].trucks` (`src/features/insights/engine.ts:406-408`). `PriorityView.apply` also writes `crew.taskCaps` for the site tasks the plan cuts (`src/features/priority/PriorityView.tsx:79-89`).

### D5. Medium: the measure readout (and tool hint) render underneath the long-section / section dock
- **What I did:** selected a circuit, so the long-section dock opens, then measured two points about 40 px above the dock. Flow 6 check: *"measure readout near the long-section dock stays visible"*.
- **What happened:** the readout ("433 m 3D …") is drawn under the dock. Hit-tests return "Long section", and only the first line shows (`06_measure_near_dock.png`). The bottom-centre tool hint is also under the dock and timeline (`06_section.png`, `06_measure_near_dock.png`).
- **Expected:** the readout stays above or beside the dock and inside the free stage area.
- **Cause:** the tooltip lives in the scene `hudLayer`, below the shell chrome. It only flips against the full canvas height (`if (y + th > h - 8)`, `src/scene/tools/index.ts:443`), not against the docked panels.

### D6. Medium: there is no error boundary, so one exception in the 3D viewport blanks the whole app
- **What I did:** reloaded the app while another agent was mid-edit on `src/scene/core` (10:05–10:17).
- **What happened:** `this.atmos.setTheme is not a function`, and later `this.solids.drawLeaders is not a function`, were thrown in `<ViewportInner>`. React unmounted the entire tree, leaving `#root` empty: no welcome card, chrome, inspector, Save or Export. React itself logs "Consider adding an error boundary".
- **Expected:** a broken viewport degrades to an error card while the sheets, inspector, Save and Export keep working.
- **Cause:** `<Viewport/>` is rendered unguarded (`src/features/workspace/index.tsx:88`), and there is no `componentDidCatch` / `getDerivedStateFromError` anywhere in `src/`. Wrap the Viewport and each sheet view.

### D7. Low: playback speed follows the frame rate, so "×120" runs much slower on a slow GPU
- **Observation:** each frame advances at most `0.25 s × speed` (`src/scene/actors/index.ts:350`). In software GL, 110 sim-min took between 100 s and 344 s, i.e. 0.3–1.1 sim-min per second, against the label's 120. This is fine on real GPUs, but the label is wrong when frames are slow. Driving the advance from wall-clock time, or showing the effective rate, would fix it.

### D8. Low (performance): one selection change triggers several full scene renders
- **Observation:** one click on the inspector's back button (string editor → overview) rendered 5 full frames (frames 13 → 18) as the dock closes. With about 1 M triangles in software GL, each such click took 15–50 s.
  - This is invisible on real hardware.
  - It suggests the canvas is re-rendered (resized) on every step of the dock animation.
  - Rendering is otherwise on demand: 0 frames while idle.

## Observations (not defects)
- Raising a mid-haul point by 12 m made the EX09 cycle **shorter** (19.90 → 19.72 min). The new segments are steeper than ±16 %, so they are timed at 0 s, exactly as `calc.xlsm` does. The inspector flags them in red and offers "Show first" / clamp. This is workbook parity, by design.
- The demo is crew-short at the default shift (36 required, 30 available), so Priority already reduces LDR1 to 2 of 3 trucks and the push dozers to 1 of 6 at the default crew. The flows assert relative behaviour.
- Other agents changed the cockpit HUD wording, the Priority grant badges ("Got n of m") and toast roles during the run. The suite asserts content (speed, limit, grade, grant numbers), not wording.

## How the suite works (and why it is shaped this way)
- `tests/e2e/run.cjs` runs `flows/NN-*.cjs` in order, each in a fresh browser context (clean IndexedDB and localStorage). Each check is recorded with its detail. Any uncaught page error, or any console error that is not environment noise, fails the flow.
- `--isolated` starts a private Vite dev server (`tests/e2e/vite.e2e.config.mjs`) with HMR off, a separate dependency cache and a free port. Without it, a file saved by someone else mid-run reloads the page and wipes the flow's scenario; in this session `store.ts` and `atmosphere.ts` were both edited during runs.
- A flow that loses its page to a dev-server reload, or a boot crash, is retried at most twice.
- Store reads resolve the module URL the page actually loaded (`/src/state/store.ts?t=…` after HMR), so they hit the same zustand instance.
- Chromium uses SwiftShader WebGL with `--disable-gpu-compositing`. GPU compositing over SwiftShader stalled the first screenshot after each change for 20–120 s.
- Timeouts are generous: this run shared 4 cores with about 6 other agents' browsers, vitest and tsc (load average 15–45). The final run took about 35 minutes; flow 3 alone took 20 minutes because of D8.

