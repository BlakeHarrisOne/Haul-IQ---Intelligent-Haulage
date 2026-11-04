# hAIul SIM: visual design QA

Reviewer: senior product design (independent; I did not build this). Date: 2026-11-04. Build: `f09ab02`, served by the
Vite dev server at `http://127.0.0.1:5173/?demo`. No code under `src/` was changed.

**The bar:** "absolutely world class … a sleek, professional haulage scenario software package", with graphics, points of
reference, simulation and animation that **exceed** Haul Road Lab (HRL) and Rain Model (RM).

**What I checked against:**
- the design specs `docs/spec/02-design-haulroadlab.md` and `docs/spec/03-design-rainmodel.md` (RM §11.5 acceptance
  table, HRL §11 section and profile views, and the "steal" and "beat" lists in both);
- the tokens in `src/styles/tokens.css`;
- the HRL and RM reference screenshots.

**How it was captured:** Playwright Chromium with software WebGL (SwiftShader), device scale factor 1. Light and dark at
1920×1080 and 1366×768. All screenshots are in
`/tmp/claude-0/-home-user-Haul-IQ---Intelligent-Haulage/6a799533-cbdc-5f2c-b7d8-1a1fb31b2822/scratchpad/design_qa/`,
written as `design_qa/…` below. Zoomed crops are in `design_qa/crops/`. The capture scripts are in `…/scratchpad/dqa_tools/`.

**Limits of this review.**
- **POV and chase were captured at 1366×768.** Software GL takes about 80 s to draw one cab frame at that size, and a
  1080p cab frame did not finish within six minutes.
- **The page screenshots of the rested POV and of chase timed out** after 400 s each. The chase still is the scene's own
  canvas capture (`10_chase_canvas.png`), so it has no HUD on it.
- **Frame rate and animation smoothness were not measured.** Where I comment on motion, I am going on the code
  (`timeline.module.css`, `hooks.ts`, `scene/actors`) and on the motion cues in the stills.
- I made no judgement about performance on real GPUs.

---

## 0. Summary

**On the product UI and the simulation, hAIul SIM is already well past both reference apps.**
- It is far broader: shift simulation, fleet sizing, OEM curves, manning rules, priority planning, a scenario library
  and Insights. HRL and RM have none of this.
- It is far more open about its working: every number traces to a formula and a workbook cell.
- The analysis sheets (Assumptions, Truck curves, Compare, Manning, Priority) are the best-made screens in the product.
- The chrome follows the HRL v6 anatomy closely, one token set drives it, and dark mode is good everywhere. HRL has no
  dark mode, and RM's dark accent is grey.

**It is not yet world class**, for three kinds of reason:

1. **Layout bugs a first-time user hits in the first minute.**
   - At 1920 px (the commonest desktop width) the view switcher runs under the "Show" bar, which hides Priority and
     Scenarios (#1).
   - At 1366 px the scale bar spills off-screen and the timeline chips are cut off (#3, #4).
   - In driver view the HUD is covered by the rest pill and the map chrome (#2).
2. **The 3D scene does not tell the shift's story.**
   - A 12 h shift depletes 1–6 % of a block. Even a forced 60 % depletion looks almost the same from above (#5).
   - Dig blocks read as painted rectangles (#17).
   - The haul road has no width (#9).
   - The "Contours" toggle makes no visible difference (#7).
3. **POV realism trails HRL's cab.** The ground has no texture and the road is drawn as a bright green carpet (#8). Our
   cockpit HUD (speed, limit, grade, phase, route profile) is a real step past HRL, though.

**Verdict:**
- **UI, data and simulation already exceed HRL and RM.**
- **3D graphics and POV do not yet.** They are about level with RM and behind HRL on terrain legibility and the cab view.
- The 17 P0/P1 items below are each small to medium in scope. Fixing them is what it takes to sign off "exceeds".

---

## 1. Verdict per view

Verdict scale:
- **Ready**: polish items only.
- **Close**: fix the P1 items before a demo.
- **Not ready**: a P0, or a P1 that undermines the view's purpose.

| View | Verdict | Screenshots | What works / what doesn't |
|---|---|---|---|
| **Site overview, light, 1920** | **Not ready** | `01_site_light_1920.png`, `crops/01_top.png`, `crops/01_pit.png`, `crops/01_skirt.png` | Switcher overlaps "Show" by 235 px (#1). Contours are not legible (#7). Skirt labels look embossed (#24). Otherwise the four-corner chrome, 14 px gutters, inspector summary, legend, compass and timeline read clearly and calmly. |
| **Site overview, dark, 1920** | **Not ready** (same P0) | `02_site_dark_1920.png` | The palette is very good. The moonlit scene with lit areas at the dumps adds atmosphere. The saturated accent stays visible on dark terrain. |
| **Site overview, 1366, light / dark** | **Close** | `03_site_light_1366.png`, `04_site_dark_1366.png` | The switcher collapses to icons. Problems: the scale bar ends 19 px past the viewport (#3); the "LDR1" chip is cut off and "of shift PT" is dropped (#4); "Fit" leaves the east dump under the inspector (#16). |
| **Circuit selected (inspector + trucks chooser)** | **Close** | `05_circuit_selected.png`, `05b_circuit_inspector_scrolled.png`, `05c_circuit_inspector_scrolled2.png` | The trucks chooser (n · production vs target · lost h · queue h · MF, with recommended and assigned rows marked) is excellent: better than the workbook's row-28 buttons and anything in HRL. Problems: the profile header (#10); the legend wraps "Idle trucks" alone (#29); a deliberate choice is styled as a red error (#30); inputs show "36000" (#25). |
| **String selected (point table) + profile strip** | **Close** | `06_string_selected.png`, `06b_string_point_selected.png` | Strong: the map grade chips (▲ 8.9 %), the point table with tabular E/N/RL, and the point ↔ profile ↔ 3D sync (point 6 highlighted in all three). Problems: the end pin covers the block label and a grade chip (#6); the profile header is cut off and repeats itself (#10); the speed lane has one tick (#10). |
| **Section panel** | **Close** | `07_section.png`, `07b_section_with_profile_tabs.png` | "True scale" really is 1:1 (1.04 px/m on both axes). The Profile / Section A–B tabs are clear. Missing: a vehicle drawn to scale and a road-width band, both in HRL `04c` (#9). The 3D model is not cut away (RM `42_section_clip_3d`). Chart labels collide (#28). |
| **Playback mid-shift + depletion** | **Not ready** as a showcase | `08_playback_mid.png`, `29_seek_probe.png`, `08b_shift_end_depletion.png`, `08c_depletion_override_60pct.png` | Trucks spread along the strings, the elapsed fill and head move, event bands show, and the "43 % of shift PT" ring updates. But the blocks read 1 % at 11:34 and the scene looks as it did at 06:00. A 60 % override looks almost the same as 3–6 % (#5). The time bar has no production data (#11). At "End-of-shift park-up" the trucks stop wherever they are on the road (#39). |
| **POV (driver view)** | **Not ready** | `09_pov.png`, `crops/09_hud.png`, `09c_pov_dark_ex04_canvas.png` | The cab frame (pillars, roof, yellow handrails) and the glass HUD read well. The HUD shows speed with the posted-limit tick, loaded/empty phase, distance to the dump, a route profile with the truck's position, grade and the limiting factor; HRL's cab has none of this. Problems: the rest pill and the map chrome sit on top of the HUD and "Loaded · C…" is cut off (#2); the ground has no texture; the road is a green carpet; the mirror is a black placeholder; the horizon is a hard edge (#8). In the dark theme at 07:35 the sky turns to a starry night while the ground stays lit as if by day, with no headlights (`09c`, #8). |
| **Chase** | **Close** | `10_chase_canvas.png`, `crops/10_chase_detail.png` | The truck model is convincing at this range: loaded body heap, dual rear wheels, tail lights, a real cast shadow. Behind it, the same green-carpet road with kinked polyline edges, a dark quad artefact on the road surface, and no haze at the horizon (#8). |
| **Plan view** | **Close** | `11_plan.png`, `11b_plan_dark.png` | Grade chips and string colours read well. Dark plan with light pools looks premium. Problems: about 40 % of the site sits under the inspector at 1366 (#16); the hover card draws *under* the scene labels (#6); there is no hillshade or contour "engineer's plot" look like RM `10_plan_view_top` (#7). |
| **Assumptions** | **Ready** | `12_assumptions_light.png`, `12b_assumptions_light_scrolled.png`, `12c_assumptions_light_bottom.png`, `12d_assumptions_dark.png`, `18_assumptions_1366.png` | Best screen in the product. Each step shows formula → numbers substituted → result → workbook cell chip. The spreadsheet-vs-rimpull Δ panel stays in view while you scroll. Problems: shift-profile colours differ from the Site timeline (#13); card titles are cut off at 1366 (#19); the summary line is ambiguous (#40). |
| **Truck curves** | **Ready** | `13_curves_light.png`, `13b_curves_light_scrolled.png`, `13c_curves_light_bottom.png`, `13d_curves_dark.png` | An OEM-grade rimpull/retarder chart: gear numbers, operating points, labelled resistance lines, limit line, and a provenance badge on every spec value. Problems: the optimistic and pessimistic fills look the same (#27); one badge uses the accent colour (#20). |
| **Compare** | **Close** | `14_compare_light.png`, `14b_compare_light_scrolled.png`, `14c_compare_light_bottom.png`, `14d_compare_dark.png`, `18_compare_1366.png` | Strong: the grouped-header table with totals and status badges, and the truck-count curve. Problems: the table is cut off at 1366 and the Status column is lost (#14); the chart cards differ in height (#31); there is no 3D A/B compare (§4). |
| **Manning** | **Close** | `15_manning_light.png`, `15b_manning_light_scrolled.png`, `15c_manning_light_bottom.png`, `15d_manning_dark.png`, `18_manning_1366.png` | "Why this many" names the rule that fired for every line, and the rule set reads like plain English: outstanding. Problems: the page header is a second design (#12); the role bars use the selection accent (#20); the equipment table scrolls inside the page; "Spare" is shown in the caution colour (#20). |
| **Priority** | **Close** | `16_priority_light.png`, `16b_priority_light_scrolled.png`, `16d_priority_dark.png`, `18_priority_1366.png` | The crew-budget bar with its "30 available · 6 short" flag is a strong visual. Problems: signals contradict each other (#26); white text on amber segments (#23); third header pattern (#12). |
| **Scenarios** | **Close** | `17_scenarios_light.png`, `17d_scenarios_dark.png` | The thumbnail card is good. Problems: the blurred pit behind the sheet looks like a smear on the empty page (#21); in dark mode the thumbnail is a light-theme render (#21); third header style (#12). |
| **Command palette** | **Ready** | `22_palette.png`, `22b_palette_query.png` | Grouped results, key hints, colour dots for circuits and strings, a match highlight and a footer with the result count. Problems: no scrim (#32); for "ex09" an asset ranks above the circuit (#36). |
| **Import modal** | **Ready** | `21_import_modal.png` | Excellent: per-file role picker, closed-solid detection, stats readouts, material, depletion mode and swatches, all in one undoable step. Problems: "OB · Overburder" is cut off; a 250 × 100 m block shows **250 bcm** with full confidence (#38). |
| **Welcome (empty scenario)** | **Ready** | `20_welcome_light.png`, `20b_welcome_dark.png`, `20c_welcome_1366.png` | Calm survey-contour backdrop, one clear primary action (the demo), file tiles, and the key hints. The map chrome (grade ramp, fit, compass, "50 m") shows over an empty scene (#35). |
| **Insights** | **Close** | `23_insights.png`, `23b_insights_dark.png`, `23c_insights_over_sheet.png` | Ranked findings with evidence chips, "Show me" and "Explain": exactly the right pattern. Problems: over a sheet it covers the page's Export button and table columns and the page does not reflow (#15); two primary buttons at once (#37). |
| **Settings / shortcuts / file menu** | **Ready** | `24_settings.png`, `25_shortcuts.png`, `26_file_menu.png` | Well grouped and in plain English. Problems: the "File" tooltip stays over the open menu; the menu shows shortcuts as plain text ("CtrlO") while the shortcuts sheet uses key caps (#33). |
| **UI kit (`/?gallery`)** | **Ready** | `28_gallery.png` | One icon weight across about 100 glyphs, consistent controls and status chips. |

### 1.1 Grid, gutters and measurements

Measured from the DOM (`s05_overlays.cjs`, MEASURE lines in `dqa_tools/s05.log`):

- **What is right.** Every chrome surface sits on the 14 px gutter. The tool rail and inspector start at y = 66
  (14 + 44 + 8). The timeline is 92 px tall, 14 px from the bottom. The inspector is 400 px wide. The dock and the
  timeline have an 8 px gap between them. Control and surface heights are 36 and 44 px throughout. Tabular figures are
  used everywhere I looked.
- **The view switcher at 1920.** It spans x 554–1366; the right chrome spans x 1131–1906. They overlap by 235 px (#1).
- **The scale element at 1920.** It ends at x 1913.9, past the 1906 gutter line.
- **The scale element at 1366.** It ends at x 1385.3, past the 1366 viewport (#3).
- **The document name.** It is cut off at 140 of 160 px at both widths ("Demo – Strip pit, we…") (#34).

---

## 2. Ranked issues

Severity:
- **P0**: broken; a user cannot do something, or the screen is visibly wrong at a common resolution.
- **P1**: clearly unprofessional; a customer would notice in a demo.
- **P2**: polish.

| # | Sev | View | What's wrong | Where | Fix |
|---|---|---|---|---|---|
| 1 | **P0** | Site, every width ≥ 1880 px (including 1920×1080) | The view switcher and the "Show" bar overlap by 235 px. **Priority and Scenarios are hidden and cannot be clicked**; the "Manning" label touches "Show". Cause: nav labels appear from 1680 px and Show labels from 1880 px, and nothing checks for a collision. | `src/features/workspace/shell.module.css` L68–76 (`.navLabel`, `.showLabel` media queries); `TopBar.tsx` `ViewSwitcher` / `RightChrome` | Make the layout collision-aware: measure both bars with a ResizeObserver and drop labels in priority order (Show labels first, then nav labels). Or fold the five layer toggles into a "Show ▾" popover, as HRL does with only three. Add a layout test at 1280 / 1440 / 1680 / 1920 / 2560 that fails if any two chrome rectangles intersect. |
| 2 | **P1** | POV | The cockpit HUD collides with two other pieces of chrome. The rest pill ("07:35 paused · driver view") sits on the HUD's bottom-left and hides the "EX09 OB" label. The bottom-right map chrome (legend · fit · compass · "25 m" scale) sits on the HUD's right column, which cuts "Loaded · C…". The rest-pill overlap happens at any width: the pill is centred on the timeline column and the HUD on the viewport, both about 20 px from the bottom. It is also the normal state of a ride, because the chrome rests after 2.5 s. The map-chrome overlap happens at ≤ 1366. | `src/scene/strings/ui.module.css` `.hud` (bottom 24 px, centred); `shell.module.css` `.restPill`; `src/scene/core/core.module.css` `.chromeDock` | In POV and chase, hide the scale bar and the grade legend: a scale bar means nothing in perspective from the cab. Move the rest pill to the top centre in ride modes. Give the HUD fixed-width columns and never cut its text off. |
| 3 | **P1** | Site, every width | The scale bar spills out of its chrome surface. It ends at x 1913.9 at 1920, and at 1366 it runs **19 px off-screen**. | `src/scene/core/Chrome.tsx` (`maxPx = 72`, label width not reserved); `core.module.css` `.chromeDock` (width forced to `--right-col`), `.scale` | Let the dock size to its content and grow left (`width: auto`). Or compute `maxPx` from the space left in the dock. Clip the bar inside its pill. |
| 4 | **P1** | Site timeline at ≤ 1366 | The circuit chips overflow under the panel toggle ("LDR1" shows as "LDI"). "of shift PT" disappears. A long event label is cut off ("Fuel &…"). | `src/features/workspace/Timeline.tsx` `.chips`; `timeline.module.css` | When chips overflow, collapse them to colour dots plus "+N", or scroll them horizontally behind an edge fade. Keep the profile toggle out of the chip flow. |
| 5 | **P1** | Playback / depletion | **The animation shows nothing visible over a shift.** The blocks deplete 1–6 % per shift, so 06:00 and 17:55 look the same (`01` vs `08b`). Even `setDepletionOverride(0.6)` (`08c`) is barely different from 3–6 % (`08b`). Dump "placement" shows as a flat painted footprint even at 0–1 % (`29_seek_probe`). | `src/scene/core/solids.ts`; `SceneCore.ts` (`setFractions`) | Make the shift's work the hero: draw the volume mined this shift as a bright slab on the block's advancing face, and grow the dump lift as a real mesh. Use RM's cut/fill recolour that keeps the hillshade (carved blue, built sage; RM steal #3). Add a floating "+7,050 bcm this shift" counter on each block. Offer a horizon switch (shift / week / to completion) and a time-lapse mode so planners can watch a bench go. |
| 6 | **P1** | Site, string selected, plan | **Scene text overlaps scene text.** The string end pins ("S51 West lift · Dump") are not part of the label placer, so they land on the block label "S51 West lift 0 % placed" and hide a grade chip (`06`, `07b`). In plan view the string hover card is drawn *underneath* the block labels (`11_plan`). | `src/scene/strings/index.ts` `placePin`; `src/scene/core/labels.ts` `LabelPlacer` (used only by `solids.ts`); hover card z-order | Feed the pins, grade chips and block labels to one placer, with priorities. Put the hover card above the label layer (`--z-card`). |
| 7 | **P1** | Site / plan terrain | **"Contours" makes no visible difference**: `30_contours_off` and `30b_contours_on` are the same image. The default 5 m interval on a flat demo gives a few faint lines on the pit floor and none on the dump faces. HRL `01_pit_home` and RM both lead with clear contours. | `src/scene/core/terrain.ts` (contour block near L247); default `settings.contourIntervalM` | Default to 2 m minor and 10 m index contours. Label index contours with their RL. Raise the ink alpha to HRL's level. Stop fading contours on steep faces. Use the RM 4-light hillshade "plot" look in plan view. |
| 8 | **P1** | POV / chase | **The cab view looks less real than HRL's.** The ground is blurred, untextured sand. The haul road is a flat, saturated green ribbon (the grade colour) with kinked edges. The mirror is a black rectangle. The horizon is a hard line with no haze. There is a dark quad artefact on the road in chase. In the dark theme the sky becomes a starry night at 07:35 while the ground stays lit as if by day, with no headlights (`09c_pov_dark_ex04_canvas`): the theme is being treated as the time of day. Compare HRL `17_cab_hv_hd1500_ahead`: photo-textured gravel, road edges and haze. | `src/scene/strings/ribbon.ts` (road look in ride modes); `terrain.ts` (near-field material); `scene/core/atmosphere.ts`; `scene/core/theme.ts` (the dark palette is "night, moonlit", `stars: 1`, whatever the clock says); `scene/actors` (mirror) | In ride modes, draw the road as a gravel strip with windrows or bunds and edge delineators. Keep the grade colour for the HUD profile and the map. Add tiled, triplanar detail texture near the camera and distance haze (HRL steal #16–17). Render the mirrors to a render target, or leave them out. Drive sky and light from the shift clock, not the UI theme. At night, darken the terrain (about ×0.35, per spec 03 §11.3) and add headlights. |
| 9 | **P1** | Site / section | **The haul road has no width anywhere** (map, section or POV): strings are centre lines only. The section panel draws no vehicle to scale and no "width needed" band. HRL's core visual is exactly this (`04c_road_section_truescale`, `07_pit_road_layers_all`). | `src/features/haulage/SectionPanel.tsx`; `src/scene/strings/ribbon.ts`; `core/types.ts` `HaulString` | Add a road-width (and bund) property to strings. Draw the carriageway edges in 3D. In the A–B section, draw the selected truck's rear view to scale with the width-needed band (HRL steal #11). |
| 10 | **P1** | Profile strip | The header cuts the name off ("EX09 OB → S51 Wes…") and then repeats it in the meta line ("… · EX09 OB → S51 West lift · cycle 1…"). The legend is squeezed beside the VE buttons. The speed lane has one tick ("40") and no zero, and the "grade", "40" and "km/h" labels collide. | `src/features/haulage/ProfileStrip.tsx` | Header: show the full name only, and move the meta to a second line or a tooltip. Put the legend under the chart. Give the speed lane ticks at 0 / 20 / 40 / 60 and its own label column. |
| 11 | **P1** | Timeline | The time bar shows events but **no production data**. The chips show "% of block mined" (1–6 %), which means nothing at shift scale. There is no "so far" running total. This misses RM steal #11 and spec 03 §11.4 ("head + flag 'D 10:30 · 12,400 bcm so far'"). | `src/features/workspace/Timeline.tsx` | Draw 15-minute production bars in the track (played bars opaque, future bars at 38 %). Add a head flag "10:30 · 12,400 bcm so far". Change the chips to "EX09 7.1k / 15.7k bcm". |
| 12 | **P1** | Sheets | **Three page-header designs.** Assumptions, Curves and Compare use an eyebrow with a 28 px title and Export/Print on the right. Manning and Priority use an icon tile with the title, and a select or a primary button on the right. Scenarios uses a smaller tile with a 22 px title. The titles sit at different y positions (102 vs 125 px). | `src/features/assumptions/shared/PageHeader.tsx` vs `src/features/manning/page.module.css` vs `src/features/scenarios/scenarios.module.css` | Move one `PageHeader` into `src/ui` (eyebrow, title, lede, actions) and use it on all six sheets. |
| 13 | **P1** | Site timeline vs Assumptions | **The same shift events have different colours in two views.** The timeline uses status and accent tokens: crib = clay, fuel = **accent blue**, blast = rust. The Assumptions shift profile uses the categorical **circuit** palette: crib = `--c4` green, fuel = `--c5` indigo, blast = `--c6` pink. The prestart icon is a tick ✓, which reads as "OK" for a stoppage. | `src/features/assumptions/SiteAssumptions.tsx` L289 `KIND_COLOR`; `src/features/workspace/timeline.module.css` L61–68; `Timeline.tsx` `EVENT_ICON` | Define one `EVENT_COLOR` set: neutral tints with hatching, rust only for blast. Never use the accent or the circuit palette for events. Use a hard-hat or flag icon for prestart. |
| 14 | **P1** | Compare at 1366 | The circuits table is cut off on the right: the Status badges show as "Under-" and "Over-tr", with no sign that it scrolls. | `src/features/compare/CircuitsCompare.tsx`, `compare.module.css` | Make the first column sticky and scroll horizontally behind an edge fade. Below 1440 px, drop the sub-line or the Haulage group. |
| 15 | **P1** | Insights over a sheet | The drawer covers the page's right edge ("Expor…" button, table columns, Status) and the page does not reflow (`23c`). | `src/features/workspace/Panels.tsx` `InsightsCard`; `shell.module.css` `.insightsSheet` | When Insights is open over a sheet, add `padding-right: 428px` to `.page`, or make the drawer push the page rather than float over it. |
| 16 | **P1** | Site / plan at 1366 | "Fit" and the plan camera frame the site against the whole viewport, so the east dump and about 40 % of the pit sit under the inspector (`03`, `11_plan`). | `src/scene/core/SceneCore.ts` fit and plan framing vs `--right-col` and `setSafeInsets` | Frame into the safe rectangle, or apply HRL's lens shift (steal #6) when the inspector is open. |
| 17 | **P1** | Site 3D solids | Dig blocks look like flat painted rectangles at overview (`crops/01_pit.png`): no side walls and no sense of volume. The dump ghost is a faint dashed outline. | `src/scene/core/solids.ts` | Shade the side faces darker than the top and add a crisp top-edge line. Let solids cast and receive shadows. Use the translucent `--dig` volume from spec 03 §11.3. |
| 18 | P2 | Sheets | Content scrolls under the floating top chrome with no fade (`12b`, `14b`, `16b`, `13c`). Card titles slide behind the doc chip and the switcher. | `shell.module.css` `.sheet` / `.page` | Add a 72 px top mask gradient on the sheet scroller, or a solid band behind the chrome on sheets. |
| 19 | P2 | Assumptions at 1366 | Card titles are cut off: "Calculation led…", "Spreadsheet vs rim…", "CAT 78…". | `src/features/assumptions/Ledger.tsx`, `ModelCompare.tsx`, `assumptions.module.css` | Let the meta text wrap or shrink before the title does; give the title `flex: none`. |
| 20 | P2 | Several | **The accent colour is used as a data or emphasis colour**, against the token rule "one accent for selected / active / focus". Instances: Manning role bars; the "OEM-derived", "Closed solid" and "circuit setting" badges; Assumptions key-result rows; the timeline fuel band; about 40 accent toggles in the equipment table. "Spare" is in the caution colour. | `manning.module.css` `.fill`; `curves/SpecSheet.tsx`; `ImportModal.tsx`; `assumptions.module.css` | Use neutral ink-2 bars for counts and neutral "info" badges. Reserve the accent for selection, focus and the single primary action. Show "Spare" as neutral. |
| 21 | P2 | Sheets (Scenarios most) | The blurred 3D behind the sheets reads as a dirty smear on empty pages. In dark mode the scenario thumbnail is a light-theme render. | `shell.module.css` `.sheet` backdrop; `src/features/scenarios/thumbnail.ts` | Make the sheet ground ≥ 94 % `--bg-app` with a heavier blur and less saturation. Render thumbnails on a neutral background, or once per theme. |
| 22 | P2 | Dark theme | Dark `--c2` is olive (`#9B8D14`), but EX04's circuit dot stays amber (`#EDA100`, stored as hex in the scenario). The same series shows in two colours on one screen (`12d`: the "empty" bars are olive and the EX04 dot is amber). | `src/styles/tokens.css` dark `--c2`; circuit colour stored as hex | Store circuit colours as palette slots and resolve them per theme. Re-tune dark `--c2` towards amber. |
| 23 | P2 | Priority | White labels on the amber (`#EDA100`) crew-budget segments fail contrast ("EX04 7"). | `src/features/priority/CrewBudget.tsx` | Use dark ink on `--c2`, `--c4` and `--c6`, or put the labels outside the bar. |
| 24 | P2 | Site 3D | The easting labels on the skirt are light text with a dark halo on the light theme, so they look embossed and blurred (`crops/01_skirt.png`). | `src/scene/core/refs.ts` `label()` | In light mode use dark ink with a light halo, 11 px semibold, as in the RL ruler. |
| 25 | P2 | Several | Number and typography formatting is inconsistent. "0 % mined" has a space; the timeline shows "0%". Number inputs show "36000" next to "36,000" in tables. Hyphen-minus appears where an en dash belongs ("Deterministic - n × PT", "13.1 h/day - below"). The shift shows as "−6" in one place and "- 6" in another. | `src/core/format.ts`; copy in `CircuitCard.tsx`, `insights/engine.ts` | Pick one percent style. Format numbers in inputs when they are not focused. Use "–" and "−" correctly throughout. |
| 26 | P2 | Priority | Signals contradict each other. "Full ✓" (green) sits beside a red "Under-trucked −1". LDR1 says "Over-trucked +1" although it got its full rate (2 of 2). "Trucks used 11 / 12" disagrees with the truck bar "12 of 12". Production is 65.9k here and 60,107 on Compare, with no note of the difference in scope. | `src/features/priority/PriorityView.tsx`, `CircuitCard.tsx`, `CrewBudget.tsx` | Make "Full" mean "full rate", or rename it "Got 5 of 5". Compute over/under against what was granted. Label the production scope ("incl. push dozers"). |
| 27 | P2 | Truck curves | The "Table optimistic" (pink) and "Table pessimistic" (peach) fills look the same (`13b`). | `src/features/curves/SpeedGradeChart.tsx` | Hatch one of the two fills, or use rust for one and a neutral for the other. |
| 28 | P2 | Section panel | String labels inside the chart collide and are cut off ("EX04 OB → S52 East li" runs under a marker). | `src/features/haulage/SectionPanel.tsx` | Place labels greedily, using the same placer as #6. |
| 29 | P2 | Circuit inspector | The trucks-chooser legend wraps so that "Idle trucks" sits alone on its own line. | `src/features/haulage/CircuitCard.tsx`, `haulage.module.css` | Shorten the labels or set the legend in a two-column grid. |
| 30 | P2 | Circuit inspector | "Deliberately under-trucked by 1" is styled as a red error callout, although it is a deliberate choice. | `src/features/haulage/parts.tsx` `Callout` | Use clay or neutral, and keep the "Use recommended" action. |
| 31 | P2 | Compare | The three chart cards differ in height because the "over" legend item wraps. | `src/features/compare/CompareCharts.tsx` | Stretch the cards to equal height and keep the legend on one line. |
| 32 | P2 | Overlays | Modals are treated differently: Import has a scrim, while the palette and the shortcuts sheet sit on the live scene with none. | `src/features/workspace/Overlays.tsx` | Add one 28 % scrim (`--scrim`) to every modal surface. |
| 33 | P2 | File menu | The "File" tooltip stays visible over the open menu. The menu shows shortcuts as plain text ("CtrlO", "Ctrl⇧S"), while the shortcuts sheet uses key caps. | `src/ui/primitives.tsx` `MenuButton` / `Ctl` tip | Hide the tooltip while a menu is open. Render menu shortcuts as key caps. |
| 34 | P2 | Top-left chrome | The scenario name is cut off at 1920 inside a 400 px chrome. | `TopBar.tsx` `DocTitle` | Allow about 220 px for the name, or show the full name on hover. |
| 35 | P2 | Welcome | The map chrome (grade ramp, fit, compass, "50 m") shows over an empty scene. | `src/scene/core/Chrome.tsx` | Hide `SceneChrome` until the scenario has assets. |
| 36 | P2 | Palette | For "ex09", an asset ranks above the circuit with the same name. | `src/features/workspace/fuzzy.ts` / `commands.ts` | Rank by kind: circuit, then string, then asset. |
| 37 | P2 | Insights | Two primary buttons are visible at once ("Optimise fleet" and "Apply allocation"). | `src/features/insights/InsightsPanel.tsx` | Keep one primary. Make the finding-level actions secondary. |
| 38 | P2 (trust) | Import | "OB · Overburder" is cut off by the select chevron. A 250 × 100 m dig block reports **250 bcm** with full confidence, which looks like the mixed-winding volume defect (code-review #2). | `ImportModal.tsx`; `geom` volume | Widen the select. Flag implausible volumes (volume ÷ plan area < 0.5 m) with a warning. |
| 39 | P2 | Playback | At "End-of-shift park-up" the trucks stop wherever they are on the road rather than driving to a park-up area. | `src/scene/actors` | Send the trucks to the dig park-up line during park-up events, or fade them out. |
| 40 | P2 | Assumptions | The shift-profile summary reads "Productive minutes = 720 − Σ(duration × fleet stopped)" with "120" under "Lost fleet-min", which reads as if productive minutes = 120. | `src/features/assumptions/SiteAssumptions.tsx` | Show "= 600 productive min (120 lost)". |

---

## 3. Acceptance checklists

### 3.1 RM §11.5 "exceeds Rain Model"

| Area | RM ships | Status | Evidence |
|---|---|---|---|
| Terrain shading | Hillshade, curvature, baked AO, sun visibility | **Partial** | Benches are well shaded, with baked AO and truck shadows. Analytic contours exist but cannot be seen (#7). There is a grade overlay on the strings only. The ground has a noise texture. |
| Model edge | 9 m brown skirt | **Exceeds** | The strata skirt carries a coal seam band, an RL ruler ("RL 300 / RL 275") and easting ticks (`01`). |
| Atmosphere | Weather `state()`, sky, haze, rain | **Partial** | A moonlit night with lit areas at the dumps, but it follows the **UI theme, not the shift clock**: night appears at 07:35 in dark mode. No haze in POV, and no dust or rain seen. Tone mapping not verified. |
| Objects | None | **Exceeds** | Trucks with loaded bodies, dual wheels and cast shadows, plus POV and chase cameras (`10_chase_canvas`, `09_pov`). There are articulated excavator, loader and dozer models in `scene/actors/machines.ts`, but at overview scale I could not tell them from the trucks; a "watch the face" close-up camera would show them off. LOD and instancing not verified. |
| Camera | Orbit at pointer, glide, inertia, log-FOV flights | **Partial** | Orbit, plan, POV, chase and fit exist. No keyframed tours. No multi-view compare with synced cameras. |
| Playback | 24 h in 5 s, smoothstep | **Partial** | ×1–×120, event markers, 5/30 min steps, Home/End, keyboard scrubbing. No loop range, no J/K/L shuttle. The at-rest view is a time pill only, with no production ribbon or KPIs (#11). |
| Digitiser | Click lines, snap ring, undo 200 | **Partial** (not exercised) | The point table has numeric E/N/RL entry, Paste XYZ, densify, simplify, reverse and re-snap. I did not test drawing; grade-constrained drawing was not seen. |
| Profiles | Long section, A–B 1:1/fit | **Pass** | The haul profile has chainage, a grade strip and loaded/empty speed lanes, with 1×–10× and Fit VE. The A–B section has a true-scale toggle and solids drawn in. No section boxes or polyline sections. |
| HUD | Glass, 24 px controls, folded time bar | **Pass** with bugs | 44/36 px chrome, a visible shift bar and KPIs, and leaders on displaced labels. Overlap bugs #1–#4. |
| Perf | Governor, perf HUD | **Not assessed** | Software GL only. Note: a seek was cheap (0.1 s), but the ride modes could not be drawn at 1080p in software GL. |

### 3.2 HRL §11 sections and profiles

| HRL item | Status | Evidence |
|---|---|---|
| 11.1 True-scale road cross-section, vehicle drawn to scale, drag-to-edit edges | **Partial** | True scale is correct. No vehicle, no road edges, no width band (#9). |
| 11.2 Grade place chart (100 m fit, 10 % limit line) | **Partial** | Grade-class strip and chips are present. No 100 m fitted grade and no limit line in the profile. |
| 11.3 / 11.4 Verdict sentence first, then evidence | **Pass** in the sheets and Insights; **missing** in the profile and section | Insights and callouts lead with the sentence. The profile and section have no verdict line (for example, "Max 9.0 % over 100 m on the S51 ramp – within 10 %"). |
| 11.5 Report charts | Not reviewed | "Print a summary report" exists. |
| HRL §13.2 steal #4: big "add" cards as the empty state | **Pass** | `20_welcome_light`. |
| HRL §13.2 steal #5: "Show" toggles in one surface | **Pass**, but the surface causes P0 #1 | |
| HRL §13.2 steal #6: lens shift when a panel opens | **Fail** | #16. |
| HRL §13.2 steal #12: numbers (tabular, units, limits beside labels) | **Pass** | Throughout. |
| HRL §13.1 beat #1: dark theme | **Pass, exceeds** | `02`, `12d`–`17d`, `23b`, `11b`. |
| HRL §13.1 beat #4: legend and north arrow | **Pass, exceeds** | Bottom-right dock. |
| HRL §13.1 beat #5: chainage on the map | **Fail** | No chainage ticks on the strings (only in the profile). |
| HRL §13.1 beat #11: route-following POV with HUD and profile | **Pass, exceeds** | `09_pov`. |
| HRL §13.1 beat #13: time dimension | **Pass, exceeds** | Timeline, but see #5 and #11. |
| HRL §13.1 beat #14: scenario compare | **Partial** | Tables and charts only. No 3D A/B split. |

---

## 4. Honest comparison with Haul Road Lab and Rain Model

### 4.1 Where hAIul SIM already exceeds them

- **Time and simulation.** HRL has no time dimension. RM animates water only. We play a full shift: trucks move,
  queue, load and dump on their strings, and events (prestart, crib, fuel, park-up) stop part of the fleet. Lost PT, the
  trucks chooser and the truck-count curve turn that into planning decisions.
- **Showing the working.** The calculation ledger (formula, substitution, workbook cell lineage), the provenance badge
  on every OEM spec, and Manning's "rule that fired" go far beyond either reference app. This is the product's signature.
- **One design system, two good themes.** There is one token set, the chrome follows HRL v6 faithfully, and the dark
  mode keeps a saturated accent. HRL shows two design systems at once and has no dark mode; RM's dark accent is grey.
- **Points of reference.** The strata skirt has a coal seam band, an RL ruler and easting ticks. A grade-ramp legend,
  compass, scale bar and pinned labels with leaders complete it. HRL v6 hides its north arrow and legend; RM has no
  scale or coordinates.
- **The cockpit HUD.** Speed with the posted-limit tick, phase, distance to go, a live route profile, grade and the
  limiting factor: HRL's cab has none of these.
- **Charts.** One SVG chart layer driven by the tokens across about 15 charts. True-scale sections. A three-lane profile
  synced to the 3D view.

### 4.2 Where we do not yet exceed them

- **Terrain legibility.** HRL's cool-grey "engineer's plot" with clear contours (`hrl_study/shots/01_pit_home.png`) and
  RM's hillshade plan (`rain_study/shots/10_plan_view_top.png`) read better than our sandy texture with invisible
  contours (#7).
- **The cab view.** HRL's photo-textured gravel, road edges, chequer-plate deck and haze (`17_cab_hv_hd1500_ahead`) look
  real. Ours has untextured ground and a green-carpet road (#8).
- **Road geometry.** HRL draws road width, edges and a truck to scale in the cross-section. We draw centre lines (#9).
- **Time you can see in 3D.** RM's time bar carries the data and its close-up choreography shows change happening. Our
  depletion is invisible at shift scale and the time bar has no production (#5, #11).
- **Robust layout.** HRL's four corners never collide. We collide at 1920 and at 1366 (#1–#4, #15, #16).
- **Sections in 3D.** RM clips the model along the section line. We draw a line on the terrain.

### 4.3 Bottom line

- **UI, analysis and simulation:** clearly ahead of both today.
- **3D presentation and POV:** about level with RM and behind HRL on terrain legibility and the cab view.

Fixing P0 #1 and P1 #2–#17 (most are contained CSS, layout or rendering changes; #5, #8 and #9 are the larger graphics
work) is what it takes to say, credibly, that hAIul SIM exceeds both on every axis the user named.

---

### Fixed: crew-planning views (Manning, Priority, Insights): #12, #20, #22, #23, #25, #26, #37

Files: `src/features/manning/**`, `src/features/priority/**`, `src/features/insights/**`. Screenshots (light and dark,
1920×1080 and 1366×768) are in `…/scratchpad/fix_views_b/`. `r_*` are the real app with the WebGL canvas hidden behind
the sheet to keep software GL fast; `h_*` are the Manning dev harness.

- **#12 Fixed.** Manning and Priority now use the shared `PageHeader` from `@/ui`: eyebrow "Crew" or "Planning", the
  crew or priority icon, a 28 px title, the lede, and actions on the right. This is the same component, position and
  sizes as Assumptions, Curves and Compare. The old icon-tile header classes in `manning/page.module.css` are removed. The
  page wrapper uses the same padding as the analytics sheets (4 px top, 16 px gap). Measured at 1366 and 1920, the
  eyebrow and the 28 px title sit at the same x and y on Assumptions, Curves, Compare, Manning and Priority.
- **#20 Fixed.** Manning's role bars and its required-vs-available gauge are now neutral `--ink-2` on a `--surface-3`
  track. Status colour appears only for the shortfall (hatched rust past the cut-off) and for an exceeded ticket cap.
  - The equipment-table switches (about 40) and the rule-set switches now use a quiet neutral "on" track (`.quiet`). The
    accent stays on the focus ring only.
  - "Spare" is a neutral badge. "Parked" is neutral with a pause glyph.
  - The rule "fires" counts are neutral badges. "Off" and "Not firing" are muted text.
  - Priority's "Use this option" is now a secondary button, so "Apply allocation" is the only primary on the page.
- **#22 Fixed.** Every circuit colour these views draw now goes through `circuitColor()`, so dark mode shows the dark
  step of the same hue: EX04 is olive in every element, with no amber/olive mix. This covers:
  - Manning: the Why-this-many dots, the week grid and the equipment task dots.
  - Priority: the card stripe, the production mini-bar, the crew-budget blocks, the truck bar, the legend and the
    inactive-circuit chips.
  - Insights: the optimiser rows.
- **#23 Fixed.** In the crew budget, the loader block is solid. The truck block is a 60 % tint and carries the label. The
  support block is a 32 % tint. Labels are `var(--ink)`, which is dark ink in light mode and light ink in dark mode.
  - Measured contrast across all eight slots `--c1`…`--c8` is at least 6.0:1 in light and 5.08:1 in dark. White on the
    old 80 % tints was 1.9–3.9:1.
  - Fixed site roles are a 30 % `--ink-3` tint with an ink label: 10.4:1 in light and 9.0:1 in dark. White on `--ink-4`
    was 3.1:1.
- **#25 Fixed (one item left).** Percentages now follow `format.ts`, with no space: "70% of plan", "steeper than 10%",
  "8% of block".
  - En dashes replace hyphens in the copy: the ledes, the footnotes, the switch titles, "Last priority – gives first",
    the crew-budget subtitle, and the Insights hero, footer, optimiser and headlines (for example "13.1 h/day – below
    the 18 h minimum").
  - A true minus comes from `signed()`: the Manning shortfall shows "−6", and the rule line and fire counts use it too.
  - **Not done:** thousands separators in `NumberField` inputs when they are not focused. That is a change to the shared
    `src/ui/fields.tsx`. In these folders, only the rule modal's bcm/day field can go above 999.
- **#26 Fixed.** The Priority signals now agree with each other.
  - The status badge reads "Got 5 of 5". It gets the green tick only when nothing was cut and the grant runs at full
    rate. It is neutral when the grant is below or above full rate, and when idle trucks were released at no cost ("Got 2
    of 3"). It is caution when a cut costs production, and "Parked" or "Stood down" when nothing was granted. Site tasks
    and the last-priority card use the same badge.
  - Over- and under-trucking are computed against the trucks **granted**. LDR1, trimmed 3 → 2 at its full rate of 2, no
    longer says "Over-trucked +1".
  - A circuit the plan cut below its full rate shows "under-trucked at the N granted (… cut by the plan)" and has no
    "Mark deliberate" button.
  - The truck bar shows the granted trucks ("Trucks 11 of 12"), with the released trucks hatched. It now matches "Trucks
    used 11 / 12".
  - The bcm/day KPI reads "incl. push dozers · haul 60.1k". The haul figure is the one Compare shows, and the tooltip
    gives the full reconciliation.
  - The Lost KPI counts "reduced" separately from "released".
  - The KPI strip and the circuit cards reflow on their own width (container queries), so they still fit when Insights
    narrows the sheet.
- **Added: a verdict line at the top of Priority.** It is built from the plan by `planVerdict` in `priority/plan.ts`. For
  example: "Crew 30 of 36 needed: bulk push stands 5 down, LDR1 releases 1 idle truck, EX09 and EX04 under-trucked
  (−1, −3)."
- **#37 Fixed.** In Insights, "Optimise fleet" is the only primary button. The finding-level "apply" actions, such as
  "Apply allocation", are secondary. While the optimiser's proposal is open, its "Apply" becomes the primary and the
  hero button steps down to a secondary "Re-optimise fleet".

---

### Fixed: haulage and analytics views (profile, section, inspector, Assumptions, Truck curves, Compare): #9 (section), #10, #12, #13, #14, #19, #20, #22, #25, #27, #28, #29, #30, #31, #40, HRL §11.1–11.3

Files: `src/features/haulage/**`, `src/features/assumptions/**`, `src/features/curves/**`, `src/features/compare/**`.
Screenshots (light and dark, 1920×1080 and 1366×768) are in `…/scratchpad/fix_views_a/`. While this round ran, opening a
section in the full app crashed in `src/scene/core/Chrome.tsx` (a scene fix in progress, outside these folders), so the
section panel was checked in the haulage harness (`/src/features/haulage/harness/index.html?sel=circuit:0&section=1`,
files `5x_section_harness_*.png`) as well as in the app.

- **#9 (section part) Fixed.** Where A–B crosses a haul string, the section now shows the road.
  - On the section itself, each crossing shows its carriageway at `roadWidthM` (30 m by default), widened by 1 / sin θ
    for an oblique cut. The running surface sits at the string's RL, with a 1.5 : 1 bund at `bundHeightM` (1.8 m by
    default) on each edge.
  - A true-scale road detail sits beside the section, cut square across the road. It shows the ground, both bunds (with
    their height), and the truck in rear view drawn from `TruckModel.dims` (width, height, tyre code → dual tyres) in
    the left lane. An oncoming ghost of the same truck sits in the right lane.
  - Behind them is the "width needed" band: 3.5 × the widest vehicle on that road (two-way), measured from the left edge.
    It is sage when the road passes; when it fails it is rust, with the shortfall hatched past the right edge. A dimension
    line reads "two-way 3.5 × 7.6 m = 26.8 m", and a second one under the ground reads "30.0 m carriageway".
  - The truck drawn is the selected circuit's. The check uses the widest truck on the road (its circuits, main or
    alternative haul). A select picks the road when several cross.
  - The pure helpers live in `haulage/model.ts` (`roadCheck`, `trucksOnString`, `tyreSize`, `apparentWidth`, `bundBase`)
    and are unit-tested.
  - The string inspector has a new **Road** section: carriageway width and bund height fields (undoable), led by the two
    verdicts.
- **HRL §11.2 / §11.3 Fixed (profile and section).**
  - `maxFittedGrade` finds the steepest least-squares grade over any 100 m (sampled every 2 m), so a short spike between
    two survey points does not set it. It is unit-tested.
  - The profile shades that 100 m window in its verdict colour and draws the fitted grade as a 3 px line. The 10 % limit
    is dashed through the same point (±70 m). The caption "+9.0% over 100 m" is placed clear of the end labels.
  - Both panels lead with a verdict sentence. The profile reads "✓ Max 9.0% over 100 m on the S51 ramp – within 10%":
    the place comes from the segment zone and the nearer end, else the chainage. The section reads "✓ Road wide enough
    for two-way CAT 789D: 30.0 m, needs 26.8 m", or "Road 3.2 m too narrow for …" in rust. The evidence follows.
- **#10 Fixed.** The profile header shows the full string name (it no longer shrinks) and the verdict. The meta (length,
  RL range, max grades, cycle) moved to the footer and the name's tooltip, and the circuit name is no longer repeated.
  - The legend sits under the chart, in a footer row aligned to the plot.
  - The speed lane has ticks at 0 / 20 / 40 / 60 (the domain rounds up to a multiple of 20) with light gridlines.
  - The left gutter now has two columns: lane names (RL m, Grade, km/h, Ch m) on the left and tick values on the right,
    so "grade", "40" and "km/h" can no longer collide.
  - Limit labels in the speed lane skip a label that would overlap the one before. The Dig / Dump end labels sit on a
    solid plate, so lines no longer show through the gaps between words.
- **#12 Fixed.** Assumptions, Truck curves and Compare import `PageHeader` straight from `@/ui`. The old header classes
  are gone from `assumptions/shared/page.module.css`, and the page wrapper is 4 px top with a 16 px gap, the same as
  Manning and Priority. The in-page "Site assumptions" heading has its own sub-heading style.
- **#13 Fixed.** The Assumptions shift profile uses `EVENT_STYLE` and `eventBackground` from `@/ui`, exactly as the Site
  timeline does: neutral tints, hatched where the fleet stops, and rust only for blasting. Each block carries the event
  icon (a flag for prestart) and its label.
  - Each event row shows the icon tile and the kind's proper label ("Prestart", not "prestart").
  - A legend under the strip lists the kinds used plus "Productive".
- **#14 Fixed.** The Compare circuits table has a sticky first column. It scrolls sideways inside a frame with a right
  edge fade while columns are hidden, and a soft shadow at the sticky column once you have scrolled. The scroller can
  take keyboard focus.
  - Below 1440 px the secondary sub-line (loader · truck · material) is dropped. It stays in the name's tooltip, and the
    route is no longer repeated when it equals the name.
- **#19 Fixed.** In card heads on all three sheets (`.headSafe` in the shared page CSS), the title never shrinks
  (`flex: none`). The meta text takes what is left and ends in an ellipsis. When even the title and the actions do not
  fit, the actions wrap to a second row.
  - At 1366 the heads read "Calculation ledger", "Spreadsheet vs rimpull" and "CAT 789D" in full.
- **#20 Fixed (these folders).** The accent is no longer used for data:
  - the spec sheet's "OEM-derived" badge is neutral;
  - Assumptions key-result rows use weight and a neutral `--ink-3` rule;
  - formula cell references and info callouts are neutral;
  - the "circuit setting" badge is neutral;
  - the trucks-used meter and the needed-trucks tick are ink;
  - the "Loaded" truck badge is neutral with a truck glyph;
  - the fleet chooser's achieved bars use the circuit's own colour.
  The accent remains on selection, focus and the primary action.
- **#22 Fixed (these folders).** Every circuit or string colour drawn here goes through `circuitColor()`:
  - the inspector dots and keys, the profile and section keys, and the section markers;
  - the fleet chooser fill;
  - the Assumptions circuit picker and loader table;
  - the Compare rows, charts and what-if (`compareData` resolves `color` once).
- **#25 Fixed (these folders).**
  - Percentages follow `format.ts` with no space: "≤4 / 8 / 10 / >10%", "±16%", "82% of 73,700 target", "+10.0%".
  - Number inputs show grouped digits when not focused ("36,000"). A new `assumptions/shared/NumField` is used in the
    circuit assumptions, the Assumptions edit cells, the circuit parameters, the asset card and the road fields. Esc now
    reverts correctly without committing.
  - Spaced hyphens and em dashes became en dashes ("Deterministic – n × PT × productivity"), and an empty value is "–".
  - Negative grades use a true minus via `signed()`: the grade chips, the slider readout, the balance table, the chart
    axes and the resistance legend. `smart()` also emits "−".
- **#27 Fixed.** In Speed vs grade, "Table optimistic" stays a solid rust tint and "Table pessimistic" is a neutral 45°
  hatch, in the chart and in its legend key. The "pessimistic" verdict word is neutral with a dotted underline. Signed
  ranges read "+3 to +7%".
- **#28 Fixed.** The section's string labels are placed greedily:
  - the focused string goes first, then left to right;
  - nine candidate positions are tried (above, below, beside, then further out with a leader);
  - every candidate is checked against labels already placed, every crossing marker and the A / B pills, and is kept
    inside the plot;
  - names are no longer cut at 24 characters;
  - when there is no room, a label is left out, and the hover readout still lists the crossing (now with its road width).
- **#29 Fixed.** The trucks-chooser legend is a two-column grid, so it lays out as two rows of two with no orphan.
  "Idle trucks" became "Idle capacity".
- **#30 Fixed.** "Deliberately under-trucked by N" is now a clay (`--warn`) callout with an info glyph, and "over-trucked"
  is neutral. "Use recommended · N" is kept. Rust stays for real faults. `truckingCall` and its test are updated.
- **#31 Fixed.** The three Compare chart cards stretch to the same height, and their legends sit on the bottom line on
  one row. The dot-plot labels are shortened ("needed", "rec.", "under", "over"), with the full wording in tooltips.
- **#40 Fixed.** The shift-profile footer reads "720 − Σ(duration × fleet stopped) = 600 productive min (120 lost)".

---

### Fixed: workspace shell and scenario library: #1, #2 (shell part), #4, #11, #12, #13, #15, #18, #21, #22, #32, #33, #34, #36, #38

Files: `src/features/workspace/**` and `src/features/scenarios/**`. Screenshots (light and dark, 1920×1080 and 1366×768)
are in `…/scratchpad/fix_shell/`. While this round ran, the shared dev server kept crashing on scene-core work in
progress (`atmos.setTheme`, a terrain shader). So these were captured from a snapshot of `HEAD` plus only these two
folders, served on port 5174 (`fix_shell/snap`).

- **#1 Fixed (P0).** The top row no longer relies on breakpoints: it checks for collisions.
  - `layout.ts` `useTopRowFit` measures the document chip, the view switcher and the right chrome, then steps down a
    density level until no two of them come within 8 px. It re-fits from full labels whenever the viewport width, the
    view, the assets or the web fonts change. All of this runs in layout effects, before paint.
  - The levels drop labels in priority order:
    0. All labels.
    1. Show icons only.
    2. Switcher icons only, except the active view.
    3. The five layer toggles fold into a **"Show ▾" popover** (toggle rows with hints), and the document name narrows
       to 150 px.
    4. The active view drops its label too.
    5. The switcher moves to a second row (last resort).
  - The 1679 / 1880 / 1180 px media queries are gone.
  - Measured in Chromium: 2560 px uses level 0, 1920 uses level 1 (every switcher label is visible, including Priority
    and Scenarios), 1366–1790 uses level 2, and 1280 uses level 3.
  - A sweep from 1100 to 2600 px in 30 px steps found no overlaps.
  - `layout.test.ts` checks that at 1280, 1366, 1440, 1680, 1920 and 2560 px no two top-row rectangles touch, on site
    and on sheets. It uses the measured widths per level, and also checks the order in which labels drop.
- **#2 (shell part) Fixed.** In POV and chase (`.ride`), the rest pill rests at the top centre, under the scene's ride
  tag (y 58–90, the tag is at 18–48). It uses the same dark glass as the tag and never sits on the cockpit HUD
  (`31_pov_rest_pill_glass_1366.png`). Hiding the scale bar and the legend in rides is scene-core work.
- **#4 Fixed.** The circuit chips fit the space they have. In a layout effect they step down from full ("EX09 5.6k /
  15.6k bcm") to compact ("EX09 5.6k"), then to the name only (the progress underline stays), then to colour dots. When
  even the dots don't fit, the rest sit behind a "+N" menu.
  - Every chip keeps its numbers in the tooltip.
  - The chips no longer expand on hover, so the layout cannot change under the pointer.
  - The long-section toggle sits after its own separator, outside the chip flow.
  - "of shift PT" stays visible at 1366.
  - Event labels choose the full label, then the kind's short label ("Fuel"), then an icon only. Each event keeps its
    full label, times and "% of fleet stopped" in a tooltip. The clock line drops the parenthetical and ends in an
    ellipsis.
- **#11 Fixed.** The time bar now shows production.
  - The track carries 15-minute production bars from the engine's simulated shift (`simulateShift` + `simProductionAt`,
    summed over the active circuits). Played bars are drawn at full strength and future bars at 38 %, so crib and
    prestart show as dips.
  - A head flag "10:32 · 10,931 bcm so far" rides under the head, clamped inside the bar. The hour labels it covers step
    aside.
  - The hover flag reads "12:37 16,183 bcm so far · Crib".
  - The chips read "EX09 5.6k / 15.6k bcm", with a so-far / shift underline in the circuit colour.
  - A compact **horizon** menu (calendar icon: Shift · Week · To completion) sits next to the speed control and sets
    `store.timeline.horizon`.
  - The helpers in `timelineData.ts` are unit-tested.
- **#12 Fixed.** The Scenarios page uses the shared `PageHeader` (eyebrow "Library", folder icon, 28 px title). Its
  title sits at the same height as Compare.
- **#13 Fixed.** Timeline events use `EVENT_STYLE`, `eventBackground` and `EVENT_STYLE[kind].icon` (a flag for prestart),
  and so do the clock's event line and the palette's "Jump to …" commands. Event edges are drawn in the event's own ink.
  No accent or circuit colours remain.
- **#15 Fixed.** When Insights is open over a sheet, the sheet scroller gets `padding-right: 428px` (400 + 2 gutters), so
  the page reflows into the space left of the drawer. On Compare, Export CSV, Print and the Status column are fully
  visible (`14_insights_over_compare_*.png`).
- **#18 Fixed.** Sheets scroll inside `.sheetScroll`, which has a 72 px top mask (transparent to 28 px, then fades in).
  Content fades out under the floating chrome instead of sliding visibly beneath it. The backdrop lives on the unmasked
  outer layer.
- **#21 Fixed.**
  - The sheet ground is 95 % `--bg-app` with `blur(48px) saturate(70%)`. Empty pages read as a calm surface.
  - Thumbnails are drawn per theme. The plan renderer has light and dark palettes (dark ground, darker hillshade, dark
    string halos, `circuitHex`). The live "Open now" card redraws when the theme changes.
  - A save records `thumbnailTheme`. A thumbnail saved in the other theme is toned down to sit on the card (dimmed with a
    vignette in dark) until the scenario is saved again.
- **#22 Fixed (these folders).** Timeline chips, the "+N" menu, palette dots for circuits and strings, the import strings
  preview and the plan thumbnails all use `circuitColor()` / `circuitHex()`.
- **#32 Fixed.** The command palette now uses the same full `--scrim` as `Modal`, so the palette, shortcuts, import and
  dialogs share one scrim.
- **#33 Fixed.** File-menu shortcuts use `MenuItem.shortcut`, shown as key caps: Ctrl O, Ctrl S, Ctrl ⇧ S, and the new
  Ctrl I and Ctrl E. Extension hints stay as plain text.
- **#34 Fixed.** The document name gets a fixed 232 px button (about 220 px of text): "Demo – Strip pit, week 45" is now
  shown in full. Hovering shows the full name in the shared tooltip ("… · Click to rename"). It narrows to 150 px only at
  top-row level 3 and above.
- **#36 Fixed.** `fuzzyFilter` takes a kind boost (circuit 2.4 > string 1.6 > asset 0.8). The boost outweighs target
  length but not match quality. For "ex09" the order is now the circuit, the two strings, then the block. This is
  unit-tested.
- **#38 Fixed.** The material select is 212 px wide, so "OB · Overburden" fits. `importChecks.ts` `sheetLikeSolid` flags
  a closed solid whose volume ÷ plan area is under 0.5 m. Such a solid gets a warning ("Encloses 250 bcm over 2.5 ha –
  an average of 0.01 m thick. It looks like a sheet, check the solid.") and an amber Volume readout. The footer counts it
  under "with notes". This is unit-tested.
