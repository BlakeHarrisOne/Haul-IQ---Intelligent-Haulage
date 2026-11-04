# 02 — Design study: Haul Road Lab (internal app) → what hAIul SIM must match and beat

Status: research spec for builders (Vite + TypeScript + React + Three.js). Author: UI/graphics analysis, 2026-11-04.
Companion assets (all in this folder):

| File | What it is |
|---|---|
| `assets/hrl-icons.svg` | The complete Haul Road Lab icon sprite as a valid `<svg><defs><symbol>` sprite — 76 symbols: the 34 v6 symbols (`i-*`, `st-*`, verbatim) + 25 legacy rail icons + 15 legacy toolbar/driver icons + 2 vehicle pictograms. |
| `assets/hrl-icons.json` | `{ icons: { name: { viewBox, svgInner, strokeWidth, attrs, source } } }` for the same 76 icons. |
| `fixtures/hrl-fleet.json` | The FLEET library verbatim (32 machines: dimensions, eye points, tyre codes, unit ids, OEM source links). |
| Screenshots | `…/scratchpad/hrl_study/shots/*.png` — index in §15. |

## 0. Source, method, conventions

* Source: `scratchpad/src/haulroad.html` (13.68 MB single file, "Haul Road Lab – mockup", `APP_VERSION = '6.1 mockup'`, settings menu shows "SISD Lab v6.1 mockup"). It is two products merged: **SISD Lab** (intersection sight distance, driver's view) and **Road Audit** (road width/grade), restyled by a late **"v6" design system** (3 Nov 2026) that re-parents and restyles the older DOM.
* **Offsets** quoted as `@N` are character offsets into the file with CR characters removed (LF-normalised) — the same convention as the brief (e.g. FLEET `@189330`, road follower `@11906565`, v6 core `@11924727`, v6 chrome `@11948248`). A helper that reproduces them: `scratchpad/hrl_study/tools/off.py "<needle>"`. All offsets used in this document are listed in `scratchpad/hrl_study/offsets.txt`.
* App was driven headless (Playwright + SwiftShader WebGL2, 1600×900, DPR 1) with the synthetic pit `fixtures/demo_pit_surface.00t`; driver scripts in `scratchpad/hrl_study/cmd/*.js` (daemon `hrl_study/daemon.js`).
* Default runtime flags at load (from `<html class>`): `lookb ux rail ov2 v6` — i.e. "look B" art direction, UX fixes, the map "rail" view, overview v2 and the v6 chrome are all ON. Everything below describes that default unless marked *legacy*.

---

## 1. The design language in one page

* **Light, quiet, "Apple-maps-for-mining".** A cool light-grey page (`#EEF0F3`) under a light-grey, low-sun hill-shaded 3D survey with thin ink contours. All chrome is **white floating surfaces in the four map corners**: 44 px tall bars, radius 14, 1 px hairline `#E3E6EB`, one soft shadow `0 6px 20px rgba(20,30,50,.08)`. Controls inside are 36 px, radius 10, 14 px semibold text, 20 px outline icons at one stroke weight (1.7).
* **One accent, three verdict colours.** Accent blue `#0A6FE6` (v6; legacy `#0A84FF`). Verdicts use the muted **scheme A** "sage / rust / clay" (no yellow, no saturated traffic-light green): ok = sage `#5A8F6E`/`#3E6E50`, fail = rust `#B5564C`/`#9A3B32`, middle = clay `#C47A3E`/`#9A5A26`; "not measured" = grey `#8E949C` + a diagonal hatch.
* **Numbers are the UI.** Tabular figures everywhere (`font-variant-numeric: tabular-nums`), big figure + unit (22 px/700 + 15 px unit), limits in muted ink next to labels ("Level 25 m ≤ 2 %").
* **True scale, always.** Road cross-sections, the 25 m level silhouette and the lane section are drawn 1 m across = 1 m up, with the actual vehicle (truck rear view or ute) drawn to its fleet width/height.
* **Words, not jargon.** Every string is plain English ("Click where it starts and ends", "Seen from 134 m before the crossing – allows 60 km/h").
* **Map marks are drawn in 2D over the 3D** (a canvas overlay re-projected every frame), not as 3D geometry.
* **A driver's seat that feels real.** Modelled cab interior (HiLux and Komatsu HD1500), sky gradient, photo-textured ground, shadows, haze, Panini wide-angle, binoculars.
* **Motion is short and damped**: 120 ms colour transitions, 300–500 ms panel slides on `cubic-bezier(.23,1,.32,1)`, presses scale to .97; everything off under `prefers-reduced-motion`.

---

## 2. Design tokens (verbatim)

### 2.1 Legacy tokens — `:root` in the first `<style>` (`@178`)

```css
:root{
  --bg:#EEF0F3; --ink:#1D1D1F; --ink2:#3A3A3C; --muted:#6E6E73; --hair:rgba(0,0,0,.08); --hair2:rgba(0,0,0,.05);
  --glass:rgba(255,255,255,.90); --glass-strong:rgba(255,255,255,.94);
  --blue:#0A84FF; --blue-t:rgba(10,132,255,.12); --green:#3E6E50; --green-t:rgba(90,143,110,.14); --red:#9A3B32; --red-t:rgba(181,86,76,.13); --orange:#9A5A26; --orange-t:rgba(196,122,62,.14);   /* scheme A (Ben, 25 Oct 2026): sage, rust, clay - no yellow */
  --r:14px; --ease:cubic-bezier(.23,1,.32,1); --ease-io:cubic-bezier(.77,0,.175,1);
  --font:-apple-system,BlinkMacSystemFont,"SF Pro Text","Segoe UI Variable Text","Segoe UI",system-ui,sans-serif;
  --shadow:0 10px 30px rgba(0,0,0,.08),0 1px 2px rgba(0,0,0,.04);
}
html,body{margin:0;height:100%;overflow:hidden;background:var(--bg);color:var(--ink);font:13.5px/1.4 var(--font);-webkit-font-smoothing:antialiased}
button:focus-visible{outline:2px solid var(--blue);outline-offset:2px}
.glass{background:var(--glass);border:1px solid var(--hair);border-radius:var(--r);box-shadow:var(--shadow)}   /* @1612 */
```

UX-fix override (`@49323`): `html.ux{--blue:#0A6FE6}   /* white text on the blue buttons: 4.7:1 (was #0A84FF, 3.6:1) */` — i.e. the shipped accent is `#0A6FE6`.

### 2.2 v6 design system — `const CSS` in the v6 core (`@11925041`)

```css
:root{--v6-font: "Segoe UI Variable Text", "Segoe UI", system-ui, -apple-system, sans-serif;
  --v6-bg-app: #EEF0F3;
  --v6-surface: #FFFFFF;
  --v6-surface-2: #F6F7F9;
  --v6-hair: #E3E6EB;
  --v6-hair-2: #EEF0F3;
  --v6-ink: #1F2329;
  --v6-ink-2: #4A5059;
  --v6-ink-3: #646A73;
  --v6-blue: #0A6FE6; --v6-blue-ink: #0A5FC4; --v6-blue-50: #EEF4FD; --v6-blue-100: #DCE9FB;
  --v6-red: #B5564C; --v6-red-ink: #9A3B32; --v6-red-50: #FBEFED; --v6-red-100: #F3D9D5;
  --v6-green: #3E8A5A; --v6-green-ink: #2E6B45; --v6-green-50: #EDF6F0; --v6-green-100: #D5EADD;
  --v6-grey: #8E949C; --v6-grey-50: #F1F2F4;
  --v6-ground: #E4E7EB; --v6-ground-line: #3A3F47;
  --v6-clay: #B8692E;
  --v6-r-card: 14px; --v6-r-ctl: 10px; --v6-r-cell: 6px;
  --v6-shadow: 0 6px 20px rgba(20, 30, 50, .08);
  --v6-s1: 4px; --v6-s2: 8px; --v6-s3: 12px; --v6-s4: 16px; --v6-s5: 20px; --v6-s6: 24px;}
/* state layer (@11934540) */
:root{--v6-hover: #F1F3F6; --v6-press: #E6E9EE; --v6-ov1: rgba(18, 38, 70, .05); --v6-ov2: rgba(18, 38, 70, .10);}
```

Notes: the v6 sheet has a *different, brighter* green (`#3E8A5A`/`#2E6B45`) than the scheme-A sage still used on the map and in legends (`#5A8F6E`/`#3E6E50`) — two greens coexist (see §13).

### 2.3 Verdict palette (scheme A) — where each value is used

| Role | Fill / dot (`…F`) | Ink (text) | Tint (bg) | Source |
|---|---|---|---|---|
| OK / meets (sage) | `#5A8F6E` | `#3E6E50` | `rgba(90,143,110,.14)` | `--green*` @178; `.pin .dot.ok` @6109; `RBANDF/RBAND` @11737948 |
| Middle 20–50 km/h (clay) | `#C47A3E` | `#9A5A26` | `rgba(196,122,62,.14)` | `--orange*`; legend "20-50 km/h" |
| Fail / low (rust) | `#B5564C` | `#9A3B32` | `rgba(181,86,76,.13)` | `--red*` |
| Not checked | `#9AA0A8` / `#8E949C` | `#646A73` | `#F1F2F4` / hatch `repeating-linear-gradient(135deg,#F3F4F6 0 3.5px,#DCDFE4 3.5px 5px)` | `.pin .dot.nc`; `.v6-hatch` (SOP CSS @11970835) |
| v6 OK | `#3E8A5A` | `#2E6B45` | `#EDF6F0` / `#D5EADD` | v6 core |
| v6 speed pill (clay) | — | `#8F5422` | `#F7EDE3` | `.v6-speed` |

Speed banding (`@2046354`): `band = v => v < 20 ? 'low' : v < MARK ? 'mid' : 'ok'` with `MARK = 60` km/h. Legend text: "60 km/h or more / 20-50 km/h / under 20 km/h".

PowerPoint copies the same palette (`const DK` @11958933 in the deck builder): `{ W: 13.333, H: 7.5, M: .45, PPI: 200, ink: '1D1D1F', mute: '6E6E73', blue: '0A6FE6', sage: '3E6E50', sageF: '5A8F6E', rust: '9A3B32', rustF: 'B5564C', clay: '9A5A26', clayF: 'C47A3E', grey: '9AA0A8', bg: 'EEF0F3', card: 'FFFFFF', line: 'D9DCE1', font: 'Segoe UI' }`.

### 2.4 Map-canvas ink and overlay colours

* `const INK = '#2b2e35', INK2 = 'rgba(43,46,53,.55)', ACC = '#0A63D6', FONT = '"Segoe UI Variable Text","Segoe UI",-apple-system,system-ui,sans-serif';` (`@11267621`)
* Canvas text helper (`@11275624`): `c.font = \`${weight || 600} ${size || 12.5}px ${FONT}\`` — default 12.5 px / 600, `textBaseline = 'middle'`, **no halo**.
* Road overlay (v6 road module `const BLUE = '#0A6FE6'` @12072615; `r3Paint` @11717586), see §7.8 for the full list.
* Road-letter disc `.v6-road`: 22 px circle `#2B2E35`, white 12 px/700 letter; outline variant `inset 0 0 0 1.5px #2B2E35` on white.
* Section/charts: ground fill `--v6-ground #E4E7EB`, ground line `--v6-ground-line #3A3F47` 1.4–1.5 px, bund `#C4CAD2`, truck greys `#626871` (tyres) `#9BA1A9` (tray) `#7C828B` (chassis), need-band fills `#F8E4E1` fail / `#E2F0E7` ok / `#EEF0F3` n/a, shortfall `--v6-red` @ .5 (`@12026433`).

### 2.5 Typography

Font stacks: legacy `--font` (SF first, then Segoe), v6 `--v6-font` (Segoe Variable first). Cockpit speed numerals use `"SF Pro Display","Segoe UI Variable Display"`; the info "i" button uses `italic 700 13px Georgia,serif`; the FPS readout `600 12.5px ui-monospace,Consolas,monospace`.

| Use | Size / line / weight | Source |
|---|---|---|
| Body (legacy) | 13.5/1.4 | `html,body` @178+ |
| v6 body, row label, control | 14/20, 400 (label) – 600 (control) | `.v6-row .v6-lab`, `.v6-c` |
| Bar title / card title / big-add title | 16/22, 600 | `.v6-sf .v6-nm`, `.v6-card-head .v6-title`, `.v6-bigadd .v6-t` |
| Big figure | 22/28, 700, tabular | `.v6-figure .v6-big`, `.v6r-big` |
| Unit after big figure | 15, 600, margin-left 3 px | `.v6r-u` |
| Section header (caps) | 12/16, 650, `letter-spacing:.06em; uppercase`, ink-2 | `.v6-sec-h` |
| Badge | 12/16, 600, h 22, pill | `.v6-badge` |
| Speed pill in bar | 18/30, 700, tabular | `#wPill .spd.big` (chrome) |
| Chart text | 500 12px, ink-3, tabular; strong = 650 ink | `.v6-chart text` |
| Legacy pills/legend | 12.5, 600 | `.spd`, `.legend` |
| Answer figure (legacy) | 40/1, 800, `letter-spacing:-.02em` | `.ans .big` |

### 2.6 Spacing, radii, elevation

* Spacing scale `--v6-s1..s6` = 4, 8, 12, 16, 20, 24 px. Map gutter = **14 px** from every viewport edge; panels sit **11 px under the 44 px bar** (top 69 px); the left column is **400 px** wide (`.v6-panel{left:14px;top:69px;width:400px}`).
* Radii: card/surface 14, control 10, inner pill button 8, cell 6, pills 999. Legacy: `.btn` 9, `.seg` 9 (inner 7), `.casep` 12, `.go` 12, drop tile 12, modal `.startcard` 14 (from `.glass`).
* Shadows: v6 one level `0 6px 20px rgba(20,30,50,.08)`; legacy `--shadow` two-layer; pins `0 4px 14px rgba(0,0,0,.08)` → hover `0 8px 20px rgba(0,0,0,.12)`; driving pills `0 2px 12px rgba(0,0,0,.12)`; picture-in-picture `0 6px 24px rgba(0,0,0,.18),0 0 0 1px rgba(0,0,0,.06)`; menu `0 8px 24px rgba(20,30,50,.14)`.
* Hairlines: v6 `#E3E6EB` (outer), `#EEF0F3` (inner dividers); legacy `rgba(0,0,0,.08)`.

### 2.7 Motion

| Token / rule | Value | Source |
|---|---|---|
| `--ease` (enter/settle) | `cubic-bezier(.23,1,.32,1)` | `:root` @178 |
| `--ease-io` | `cubic-bezier(.77,0,.175,1)` | `:root` |
| v6 control colour change | `background-color .12s ease-out, box-shadow .12s, color .12s`; **pressed: `transition:none`** (instant) | `@11934540` |
| Press feedback (legacy) | `transform: scale(.97)` (`.tb`, `.btn`), `.98` (`.go`, cards), `.96` (seg), `.95` (cells) | `.tb:active` etc. |
| Panel in/out | `opacity .35s var(--ease), transform .45s var(--ease)`, from `translateX(16px)` / `translateY(16px)`; `visibility 0s .45s` on exit | `.scen`, `.startc`, `.dpanel` |
| Driver bar | `opacity .4s, transform .5s`, from `translate(-50%,16px)` | `.dbar` |
| Popover | `opacity .2s, transform .25s` from `translateY(-6px) scale(.98)`, `transform-origin: top right` | `.ckp2` |
| Toast | `opacity .25s, transform .3s` from `translate(-50%,6px)`; plain toast auto-hides after **2200 ms** | `.toast`, `function toast` @11827536 |
| Radial menu | items stagger with CSS var `--d`: `opacity .18s var(--ease) var(--d), transform .24s var(--ease) var(--d)` from `scale(.6)` | `#radial .ri` |
| Nudge | `@keyframes nudge` 0→6 px blue ring (`rgba(0,122,255,.28)`) ×2 at 1.3 s | `.btn.nudge` |
| Spinner | `rot .8s linear infinite` (legacy), `v6spin .9s linear infinite` | `.spin`, `.v6-spin` |
| JS tweens | `easeOut = 1-(1-f)^3`, `easeIO` cubic, `smooth = f²(3-2f)`; one rAF loop, renders only when `kick()`ed | `@2045551`, `function tween` @2048587 |
| Camera zoom easing | each frame `dist *= exp(log(target/dist)·0.25)` (25 % of the remaining log-distance per frame), anchored on the point under the cursor | loop `@2049958` |
| Reduced motion | `@media (prefers-reduced-motion:reduce){*{animation:none!important;transition:none!important}}` and JS `REDUCE` short-circuits every tween | `@60293`, `tween()` |

### 2.8 Z-order (CSS `z-index`)

| z | Elements |
|---|---|
| 0 | `#stage` (fixed, inset 0): `#gl` WebGL canvas → `#ov` 2D overlay canvas → `#ck` cockpit canvas → `#pins`, `#hot` (DOM pins) |
| 4 | legend, scale bar, snapshot button, v6 bottom-right surface `#v6Br` |
| 5 | toolbar `.bar` (v6 `#bar` stays 5), scenario/start cards, `.dpanel` |
| 6 | hint, picture-in-picture `.pip`, `#railCab` (Cab), `#hoSec`, v6 busy note |
| 7 | driver bar, why-banner, SOP card, checks, `#railSw` (Dig/Rings) |
| 8 | `.about`, `.dback/.dctl/.dplay/.dhint` (driving chrome), `#hrLayers` (Show), `#ovHero` (big Add) |
| 9 | `.casep` (settings menu), `.ebtns` (wizard/road panel), `.dend` (driving result pill), FPS |
| 18–20 | `#railTip` hover card (18), `.tgtpop` stepper (19), `#radial` menu (20), `.toast` (20) |
| 25 | `.start` modal "Load a pit shell" (with `backdrop-filter: blur(10px)` over `rgba(238,240,243,.92)`) |
| 30 | `.loadc` loading card, `.garage` vehicle picker (full screen) |
| 60 | `.ovmenu` (+ Add menu) |

Rule of thumb they follow: map (0) < passive readouts (4) < bars (5) < floating context (6–9) < transient tips/menus (18–20) < modal/full-screen (25–30).

---

## 3. Layout — the "four corners" map chrome (v6)

v6 chrome header comment (`@11948248`): *"every piece of map chrome as one family … White 44 px surfaces (radius 14) in the map corners holding 36 px controls (radius 10), one type and icon weight, one state set."*

```
┌──────────────────────────────────────────────────────────────────────────────┐
│ ┌─ #bar 400×44 ──────────────────────┐            ┌─ #hrLayers ────────────┐ │  top: 14
│ │ Haul Road Lab        [▤ Report] [⚙] │            │ Show [↔ Width][◺ Grade][⫡ Intersections] │
│ └────────────────────────────────────┘            └────────────────────────┘ │
│ ┌─ #ovHero (400 wide, gap 11) ───────┐   (intersection view: #railSw "Dig | Rings")
│ │ [+] Intersection                    │  64 px big-add cards                 │
│ │     Click the middle of a crossing  │                                       │
│ ├────────────────────────────────────┤                                       │
│ │ [+] Road                            │      3D survey (#gl) + 2D marks (#ov) │
│ │     Click where it starts and ends  │      + DOM pins (#pins)               │
│ └────────────────────────────────────┘                                       │
│  panels: left 14, top 69, width 400, max-height calc(100vh − 83px)           │
│                          ┌ toast (bottom-centre, 44 tall) ┐   ┌ #v6Br ──────┐│
│ ┌ #railCab "⊙ Cab" ┐     └────────────────────────────────┘   │200 m ▕───▏|📷││ bottom: 14
└──────────────────────────────────────────────────────────────────────────────┘
```

* Corner surfaces (`.v6-sf.tl/.tr/.bl/.br`): `left/right/top/bottom: 14px`, height 44, `padding: 0 3px`, `gap: 2px`, inner controls 36 px → the 4 px inset is visually even. Divider inside a surface: `.v6-sep{width:1px;height:20px;margin:0 5px;background:var(--v6-hair)}`.
* `#bar` is fixed 400 px wide (same as the column under it) → the column reads as one stack.
* While a side panel is open the 3D picture is **lens-shifted** so the subject stays centred in the free space: `want = … $('scen').open ? Math.min(.45, 414 / r.width) : … (st.nedit || st.redit) ? -Math.min(.4, 350 / r.width) : 0` eased 18 %/frame and applied to the projection matrix (`@11220752`). Steal this.
* Narrow screens: `@media (max-width:900px){html.v6 #hrLayers{top:auto;bottom:72px}}`; the legacy scenario card becomes a bottom sheet under 760 px.
* Collision avoidance for canvas labels: `railRects()` collects the screen rects of every chrome surface (+8 px) and the overlay label placer avoids them (wrapped in v6 chrome, `@11948248` section "wraps").

---

## 4. Components (anatomy, sizes, states)

All values verbatim from the CSS; "→" means hover, "↓" pressed.

### 4.1 Surface + control (v6 `.v6-sf`, `.v6-c`)

```css
.v6-sf{position:absolute;display:flex;align-items:center;gap:2px;height:44px;padding:0 3px;background:var(--v6-surface);border:1px solid var(--v6-hair);border-radius:var(--v6-r-card);box-shadow:var(--v6-shadow);white-space:nowrap;}
.v6-c{display:inline-flex;align-items:center;justify-content:center;gap:8px;height:36px;padding:0 12px 0 10px;border:0;border-radius:var(--v6-r-ctl);background:transparent;color:var(--v6-ink);font:600 14px/20px var(--v6-font);}
.v6-c.i{width:36px;padding:0}               /* icon-only */
.v6-c svg{width:20px;height:20px;color:var(--v6-ink-2);}
.v6-c.acc,.v6-c.plus{color:var(--v6-blue-ink);}   /* accent text, blue icon */
```

| State | Background | Text | Icon |
|---|---|---|---|
| rest | transparent | `#1F2329` | `#4A5059` |
| hover (`:hover`/`.is-hover`) | `#F1F3F6` | — | `#1F2329` |
| pressed | `#E6E9EE`, transition none | — | `#1F2329` |
| on (toggle) | `#EEF4FD` | `#0A5FC4` | `#0A6FE6` |
| on + hover / pressed | `#DCE9FB` / `#CCDDF7` | | |
| focus-visible | `outline:2px solid #0A6FE6; outline-offset:-2px` (inset); on filled/on states add `box-shadow: inset 0 0 0 4px #fff` | | |
| disabled | transparent | `#646A73` | `#646A73` |
| busy (Report building) | spinner icon `i-spin` rotating .9 s, text "Building" | | blue |
| done | tick icon, text "Saved" in `#0A5FC4` for **2 s** then back to "Report" | | blue |

### 4.2 Toolbar bar (`#bar`)

* Pit: title "Haul Road Lab" (16/22 600, padding `0 10px 0 13px`) · flexible gap · `[i-report] Report` (`.v6-c`) · `[i-gear]` (icon-only). Settings button shows the **on** state while its menu is open (`#bSet[aria-expanded="true"]`).
* Intersection: `[i-left]` back · intersection name (16/22 600, ellipsis) · speed pill (`.spd.big`: 30 px pill, 18/30 700, band colours) · gap · `[i-edit]` · `[i-info]` · divider · `[i-plus] Add` (accent) → a menu (`#ovAddMenu`) with "Intersection" / "Road" rows (`i-ix`, `i-road`).
* Legacy bar (pre-v6, still in DOM): 30 px `.tb` buttons radius 9, `gap:6px`, `.tb.on{background:var(--blue-t);color:var(--blue)}`, 16 px icons, `.sep` 1×18 px.

### 4.3 Big "add" card (`.v6-bigadd`)

`width:400px;height:64px;display:grid;grid-template-columns:40px 1fr;column-gap:14px;padding:0 16px;` white card (radius 14, hairline, shadow). Tile: `40×40, radius 10, background:#0A6FE6, white 20 px plus`. Title 16/22 600, how-to line 14/20 400 ink-2. Hover → card `#F1F3F6`, tile `#0A5FC4`; pressed → card `#E6E9EE`, tile `#0A4FA6`. Shot: `02_hover_road_bigadd.png`.

### 4.4 Layer toggles "Show" (`#hrLayers`)

A top-right surface: muted label "Show" (`padding:0 6px 0 11px; font-weight:500; color:ink-2`) then three `.v6-c` toggles `[i-width] Width`, `[i-grade] Grade`, `[i-ix] Intersections`; `aria-pressed` drives `.on`. Persisted in `localStorage['haul-road-layers-v1']` (`@11664990`). Shots `02b_hover_layer_grade.png`, `02d_layer_width_off.png`, `07b/07c`.

### 4.5 Segmented controls (three generations)

| Variant | Track | Item | Selected |
|---|---|---|---|
| v6 `.v6-seg` | `padding:3px; gap:2px; background:#F1F3F6; radius 10` | flex 1, h 32, radius 8, 14 px 600 ink-2 | white, ink, `box-shadow:0 1px 2px rgba(20,30,50,.12), 0 0 0 1px var(--v6-hair)` (a raised white thumb) |
| legacy `.pick` | `padding:3px; border:1px solid hair; radius 11; bg rgba(0,0,0,.035)` | min-h 40, radius 8 | white + `0 1px 3px rgba(0,0,0,.14)` |
| legacy `.seg` | h 36, `rgba(255,255,255,.7)` | radius 7 | `background:rgba(0,122,255,.12);color:var(--blue)` (tinted, not raised) |

Use the v6 "raised white thumb" for mode switches (Width | Grade). Shot `03c_road_measured_width.png`.

### 4.6 Buttons

```css
.v6-btn{height:36px;padding:0 14px;border-radius:10px;border:1px solid var(--v6-hair);background:#fff;color:var(--v6-ink);font:600 14px/20px var(--v6-font);}
.v6-btn.pri{background:var(--v6-blue);border-color:var(--v6-blue);color:#fff;}        /* hover #0A5FC4, pressed #0A4FA6 */
.v6-btn.ghost{border-color:transparent;background:transparent;color:var(--v6-blue-ink);}
.v6-btn.sm{height:30px;padding:0 10px;font-size:13px;}
.v6-ibtn{width:32px;height:32px;border-radius:8px;color:var(--v6-ink-2)} .v6-ibtn svg{width:18px;height:18px}
```

Legacy: `.btn` 32 px radius 9 translucent white; `.go` primary 46 px radius 12 with blue glow `0 2px 8px rgba(0,122,255,.3)`; `.sec` white 46 px. Destructive actions are text links in rust (`.lnk.del{color:#9A3B32}`) that need **two clicks** ("Click again to delete", 3.5 s arm window).

### 4.7 Badges, pills, verdict marks

* `.v6-badge` 22 px pill 12/16 600: `.fail` `#FBEFED`/`#9A3B32` ("1 to fix"), `.ok` `#EDF6F0`/`#2E6B45` ("Meets"), `.na` `#F1F2F4`/`#4A5059` ("Needs review").
* `.spd` speed pill (legacy, kept in v6 bar): `border-radius:999px;padding:1px 9px;font-weight:600;font-size:12.5px` with `.low/.mid/.ok` tint+ink pairs; `.spd.big` 20 px/700.
* Status icons `st-fail` (rust disc + white ×), `st-ok` (green disc + white tick), `st-na` (grey ring + dash), 18 px, at the end of every row.

### 4.8 Card / panel anatomy (v6 `.v6-card`)

```
┌ .v6-card-head  h52, padding 0 12 0 16, border-bottom #EEF0F3 ┐
│  Title 16/22 600  [badge]                       [×]          │
├ .v6-sec  (padding-top 12; between sections: 1px #EEF0F3 + 8px)│
│  SECTION HEADER 12/16 650 caps .06em            ≥ 110 m       │
│ ┌ .v6-row  grid 24px | 1fr | auto | 20px, h36, padding 0 16 ┐ │
│ │ [icon 20]  Label 14/20  limit(ink-3)   value 14/20 600  [st]│ │
│ └ .on → background #EEF4FD + inset 3px left bar #0A6FE6     ┘ │
│  .v6-mtx  matrix of .v6-cell (h28, radius 6, 14/600)           │
│  .v6-detail  margin 4 16 8, padding 12, bg #F6F7F9, radius 12  │
└───────────────────────────────────────────────────────────────┘
```

Value units are typeset with a fixed min-width so columns align: `.v6-row .v6-val .v6-u{display:inline-block;min-width:14px;margin-left:3px;text-align:left}` (`.deg` 16 px). Number formatting `V6.num(v, unit, limit)`: `%` to 0.1; metres to 0.1, or **0.01 when within 0.1 m of the limit**; ≥ 100 → integer. Expand rows (`.v6-row.det`) rotate a chevron 180° over .16 s. Shots `13_ix_view.png` (SOP card), `03c` (road card).

### 4.9 Pins on the map (DOM, `#pins .pin`)

```css
.pin .pi{display:flex;align-items:center;gap:6px;padding:3px 9px 3px 5px;border-radius:999px;background:var(--glass-strong);border:1px solid var(--hair);box-shadow:0 4px 14px rgba(0,0,0,.08);font-size:12.5px;font-weight:600;color:var(--ink2);}
.pin:hover .pi{transform:translateY(-2px) scale(1.04);box-shadow:0 8px 20px rgba(0,0,0,.12)}
.pin .dot{width:9px;height:9px;border-radius:50%;background:#C7C7CC;box-shadow:0 0 0 3px rgba(199,199,204,.25)}
.pin .dot.low{background:#B5564C;box-shadow:0 0 0 3px rgba(181,86,76,.18)} .pin .dot.mid{background:#C47A3E;…} .pin .dot.ok{background:#5A8F6E;…}
```

Variants: `.star` (selected: `outline:3px solid rgba(0,122,255,.65)`), `.num` (name only on hover), `.cmp` (compact dot; expands on hover), `.todo` (open ring `11px, 2px #6B7079`), `.tk` (15 px disc with a ✓, `.part` = outlined). **Look-B** variant (default): no pill, bold 13 px `#141a24` text, dot size grows with severity (ok 7 px, mid 10 px, low 12 px) — severity is redundantly encoded in size (`@6528`). Pins hide in driving mode (`body.drv #pins .pin{opacity:0}`) and dim to .3 while editing. Hot spots `.hot` (54 px invisible targets; hover shows a 1.5 px blue ring and a label chip). Shot `18_pit_with_intersection_pin.png`.

### 4.10 Legend, scale bar, camera button

* Legend `.legend` (legacy, bottom-right above scale): dots 9 px + 12.5 px labels, `gap:12px`, fades in with `body.pit`. Hidden in ov2/v6 pit (`html.ov2 body.pit #legend{display:none!important}`) — v6 has **no persistent legend** on the pit map.
* Scale bar (`placeScale` @11358557): measured at the screen centre from a projected 10 m vector; picks the first of `[5,10,20,25,50,100,200,250,500,1000]` m that is ≥ 60 px; label "200 m" / "1 km". v6 draws it as an open-top bracket `height:8px;border:1.7px solid var(--v6-ink-2);border-top:0`, text 14/20 600 tabular, **north arrow hidden** (`#sclN{display:none}`).
* Snapshot: `[i-camera]` icon-only control after a divider in the same bottom-right surface; saves a PNG with a footer line "Haul Road Lab - the pit, YYYY-MM-DD" (`snapshot = function` @11967074).

### 4.11 Settings menu (`.casep`, opened from the gear)

`position:fixed;left:14px;top:69px;min-width:210px;padding:6px;background:#fff;border-radius:12px` (+ `.glass` hairline/shadow). Rows are 8×10 px padded buttons, radius 8, hover `--blue-t` tint with blue text. Content: Vehicles (with two pictograms), Load a survey or a DXF, Save audit, Save intersections, counts, version line ("SISD Lab v6.1 mockup"), and a "Mouse and keys" disclosure (2-column grid of keys). Closes on any outside pointerdown. Shots `08_settings_panel.png`, `08b_settings_hover_row.png`. Note: this menu was **not** restyled by v6 (radius 12, 13 px text) — visible inconsistency.

### 4.12 Modal "Load a pit shell" (`.start`)

Full-screen scrim `rgba(238,240,243,.92)` + `backdrop-filter: blur(10px)`, fade-in .3 s. Card `width:min(720px,92vw);padding:26px 28px`; H2 20 px 600; lead 13.5 muted. Two **dashed drop tiles** in a 2-column grid (`gap:12px`):

```css
.drop{border:1.5px dashed rgba(0,0,0,.15);border-radius:12px;padding:16px;cursor:pointer;display:flex;gap:12px;align-items:center;transition:border-color .2s,background .2s}
.drop:hover,.drop.over{border-color:var(--blue);background:var(--blue-t)}
.drop.ready{border-style:solid;border-color:rgba(90,143,110,.6);background:var(--green-t)}   /* file chosen: solid sage */
.drop .ic{width:34px;height:34px;color:var(--blue)}   /* 40-grid line icons, stroke 2.2 */
```

Tile text: **Pit shell** / "Vulcan .00t" → after choosing "demo_pit_surface.00t - 11 MB"; **Intersections** (if you have them) / "DXF or saved intersections (.json)". Progress: 6 px bar (`.pbar`) + step text; error box in rust tint; footer `[Back] … [Open]` (primary, disabled until a shell is chosen). Shots `00_start_modal.png`, `00b_start_modal_hover_drop.png`, `00c_start_modal_shell_ready.png`.

### 4.13 Progress, busy, toast

* Loading card `.loadc` (centre, 360 wide): title 15 px, 8 px bar (`.lbar i` blue, width transition .25 s), status line.
* Busy note `#busy` (v6: top-centre 44 px surface, 14 px spinner `border:2px solid rgba(10,132,255,.25);border-top-color:var(--blue)`) – "Checking 3 of 12".
* Toast (v6, `@11956554`): bottom-centre white 44 px surface, 14/20 500, optional action after a divider as an accent `.v6-c` ("Open it", "Undo" with `i-undo`); moves up to `bottom:124px` in driving mode. Action toasts persist until used; plain toasts 2.2 s.

### 4.14 Wizard panel (intersection: "The middle → The roads → Check")

Legacy `.ebtns.wiz` (318 px, not v6-styled): step dots `.wzs .wz i` 20 px circles (`now` blue/white, `done` green-tint with ✓), hairline connectors; road chips `.wzc` 26 px pills ("A 222 m ✓", ok = green tint); a tab strip `.wzt` (Sight distance | Road (SOP) 2 ✗); result line `.wzres` with the speed in a band-coloured pill (20 px/750, `html.ux`). Shots `12_*.png`.

### 4.15 Road panel (v6 road module, `#ebtns.v6r`) — steal this flow

1. "New road · Click where the road starts · [Cancel]" → 2. live length figure ("826 m", grey "–" until a route exists) + "Click the end" / "Add a point in between" → 3. result: title + badge ("1 to fix" / "Meets" / "Needs review"), big length + "from → to" ends, Width | Grade segmented control, issue rows ("Narrow at 670–870 m ≥ 27.3 m · 19.3 m ⊗"), "Not measured 20 m in 1 place", Details disclosure (lanes, vehicle, SOP basis with **assumed** values in bold), footer `[Discard] … [Confirm]`. Drill-down: `< Issues | Narrow · 700 m` crumb, big figure "19.3 m needs 27.3 m", "Set by hand" badge, reset-to-survey icon button, true-scale section (§11.1). Shots `03*`, `04*`, `05*`.

### 4.16 Driving-mode chrome (body.drv)

* Back: `.dback` 40 px white circle top-left (`rgba(255,255,255,.92)`, shadow `0 2px 10px rgba(0,0,0,.14)`, hover scale 1.05).
* Control pills `.dctl button`: h 42, radius 21, `rgba(255,255,255,.94)`, 13.5 px 600, 14 px icons; on = `#e3eefc`/`#0A63D6`; hover scale 1.04. Buttons: ▶ Play from the start · ◷ Slow motion · ◺ Sight fan · ⇄ Sit in the truck from A.
* Hint pill `.dhint` (radius 20, 13 px) above the controls: "Move it with ← → · Play from the start: it comes at 60 km/h · Move the mouse to look around".
* Result pill `.dend` top-centre (15 px 650, `.ok` sage ink / `.low` rust ink): "Seen from 134 m before the crossing - allows 60 km/h".
* Off-screen target indicator: "Truck this way ▶" chip at the screen edge; target brackets drawn round the other vehicle's projected box.
* Binoculars: frosted white eyepieces `rgb(236,239,243)` with two circle cut-outs (R = min(.3W,.47H), offset .56R) + caption pill "×4 · 145 m away".
* Shots `15c`, `16*`, `17*`.

### 4.17 Vehicle picker ("garage")

Full-screen stage `radial-gradient(120% 90% at 50% 38%,#FFFFFF 0%,#EEF1F5 55%,#E2E7EE 100%)` (`@44290`) with a slowly turning WebGL model (drag to turn, `G.yaw += dx*.01`) on a soft ground ellipse; eye point marked with a blue dot + "Eye 1.50 m" label. Top-centre slot switcher (Light vehicle | Big vehicle, selected slot white with blue ring `0 0 0 3px var(--blue-t)`), left list (76×46 px thumbnails, groups "Haul trucks", "Light vehicles", "More machines (25)" disclosure), right info card (class, name 22 px, unit-id chips, stat bars 6 px with `linear-gradient(90deg,#7DB7FF,var(--blue))`, "estimated" flags in clay, primary "Use as the light vehicle"). Shots `09_garage_*.png`, `31_garage_contact_sheet.png`.

---

## 5. Interaction & cursor rules

| Context | Input | Result | Source |
|---|---|---|---|
| Map (pit/intersection) | left-drag | orbit: `yaw -= dx*.005`, `pitch = clamp(pitch + dy*.004, .06, 1.45)` | `@11473766` |
| | right-drag, Shift+drag, middle-drag | pan; uses a **screen→ground Jacobian** sampled at the press point (`panJac`, 20 px probes) so the ground under the cursor tracks the cursor exactly; fallback `dist*.0014` per px | `@11493957`, `@11473451` |
| | wheel | zoom ×`exp(deltaY*.0012)` toward the ground point under the cursor; eased 25 %/frame; limits **150–9000 m** (pit) / **12–600 m** (intersection) | `@11478653` |
| | camera never under ground | in `orbitPose` (@11219324), pitch is raised +.02 rad (≤1.45) until the eye is ≥ 3 m above the survey | `orbitPose` |
| Driver's seat | mouse position (no button) | head look: `yaw = −sign(nx)·(1.6·abs(nx) + 1.54·abs(nx)⁵)` (≈180° at the screen edge), `pitch = −ny·.38` | `@11468514` |
| | drag | `look.yaw −= dx*.004` (±π), `look.pitch += dy*.003` (±.45) | |
| | wheel | zoom 1–8× (`zoomT *= exp(−deltaY*.0018)`) | `@11478765` |
| Keys | Esc | cancel / back to pit / leave cab; Enter next step; Backspace remove last point; Ctrl+Z undo; B binoculars; L sight lines; Q quality (Smooth/Sharp); F fps; ←/→ drive the other vehicle; ↑ look ahead | keydown @11479228 |
| Road edge (section or map) | drag; arrow keys ±0.1 m (Shift 1 m), applied after a short pause | | road module |

Cursors: map `grab`/`grabbing`; drawing `crosshair` (`body.draw #gl`); handles `grab`; section edges `ew-resize`; clickable marks `pointer`; dragging the target vehicle uses a **custom SVG hand cursor** (white 4.2 px outline under a 1.7 px `#2b2e35` stroke, hotspot 16 16) (`const CUR` @11463946); cursor hidden (`none`) while dragging a vehicle.

Picking: `pickGround` ray-marches the camera ray in 2 m steps against the 1 m pit grid, then 20 bisection steps (`@11494883`). Road ends snap to "running surface": nearest cell within 6 m whose local gradient ≤ 0.2 (`snapPit` @12029712).

---

## 6. Icon system

### 6.1 Inventory (76 symbols, all extracted to `assets/hrl-icons.svg` + `.json`)

**v6 sprite** (`SPRITE` @11938051, inserted once as `<svg id="v6Sprite" width="0" height="0">`, used as `<svg class="v6-ico"><use href="#v6-ID"/></svg>` via `V6.icon(id, cls)`). In our sprite the `v6-` prefix is dropped.

| Group | Symbols |
|---|---|
| SOP / sight checks | `i-eye` (sight), `i-give` (give way ▽), `i-angle` (crossing angle), `i-near` (# next crossing), `i-level` (level 25 m), `i-bund` (centre bund), `i-hump` (bund on the road), `i-rings` (sight rings), `i-dig` (cut to clear sight), `i-cab` (steering wheel = driver's seat) |
| Domain objects | `i-road` (two converging edges + dashed centre), `i-ix` (T/crossing plan), `i-width` (↔), `i-grade` (◺), `i-pin` |
| Actions | `i-plus`, `i-x`, `i-tick`, `i-undo`, `i-reset`, `i-edit`, `i-report`, `i-gear`, `i-camera`, `i-info`, `i-drag` (6-dot grip) |
| Navigation | `i-left`, `i-right`, `i-up`, `i-down` (chevrons) |
| Busy | `i-spin` (22 %-opacity ring + 90° arc; rotate .9 s) |
| Status (filled, 18-grid) | `st-fail` (`#B5564C` disc, white ×), `st-ok` (`#3E8A5A` disc, white ✓), `st-na` (`#8E949C` ring + dash) |

**Legacy sets** (still rendered in places): 25 rail icons on a 16 grid (`RPATH` @11737948: eye, eyeoff, dig, rings, give, pairs, sop, cab, width, flat, hump, median, bund, reverse, curve, xfall, lane1, angle, near, level, plus), 15 toolbar/driver icons from the body markup (16 grid, 1.2–1.7 stroke: bPit, bAdd, bRoad, bSet, bLines, bDraw, bSnap, sclN north arrow, dBino, dSnd, dReplay, dBack, dPlay, dSlow, dFan, dOther, gClose) and the 40-grid drop-tile icons (pit shell mountain, intersection crosshair; stroke 2.2), plus two filled vehicle pictograms (`ICON.car` 26×13, `ICON.truck` 30×15, wheels with a 1 px white separation stroke; `@2047512`). Visual sheet: `shots/30_icon_sheet_all.png`.

### 6.2 Style rules (derived from the sprite, verified on every symbol)

1. **Grid** 20×20 (`viewBox="0 0 20 20"`), live area ≈ 1.8–18.2 (≥ 1.8 px padding). Status glyphs 18×18.
2. **Stroke** 1.7 px at 20 px display (= 8.5 % of the box), `stroke="currentColor"`, `fill="none"`, `stroke-linecap="round"`, `stroke-linejoin="round"`. Single weight across the set; the only exception is `i-drag` dots at 2.6 (round caps on zero-length segments make dots).
3. **Geometry**: circles r 7.2 for "enclosed" glyphs (`i-cab`, `i-rings`, `i-info`, `i-spin`), arrows/chevrons with 4.5 px arms, plan-view drawings for domain objects (road from above, crossing from above, gear drawn as an exact 8-tooth polygon by arcs).
4. **Colour usage**: icons inherit text colour. Rest `ink-2 #4A5059`, hover/pressed `ink #1F2329`, toggled/accent `#0A6FE6`, disabled `ink-3 #646A73`. Row icons 20 px `ink-2` (selected row: blue). Status glyphs carry their own fills (never tinted).
5. **Sizes**: 20 px in 36 px controls; 18 px in 32 px icon buttons and back links; 16 px legacy; 13–14 px inside small badges/back links (`.v6r-hand svg{13px}`).
6. Icon + label gap 8 px in controls; 6 px in buttons; 12 px column gap in rows (24 px icon column).

### 6.3 What our set needs on top (hAIul SIM gap list)

HRL has no icons for: dig face / dump face, solid volumes, truck cycle, shovel/excavator, loader-truck match, shift clock/timeline, slider play/pause/scrub, crew/person, roster, scenario A/B compare, depletion, cross-section cut line, profile, route auto-follow (AI), fuel, speed limit sign, haul-cycle stopwatch, layers/eye-off variants, fullscreen, north arrow (v6 dropped it). Draw them on the same 20-grid/1.7-stroke rules so they sit with the borrowed glyphs.

---

## 7. 3D rendering

### 7.1 Pipeline overview

* One **WebGL2** context on `#gl` (`antialias:true, preserveDrawingBuffer:false, powerPreference:'high-performance'`). No engine/library: hand-written matrix code (`M4`), meshes `{pos,nrm,col,idx}` uploaded as VAOs, uniforms cached per program (`su()` replays them when the program switches).
* One fragment shader source compiled **four times** with `#define VMAP | V5 | V6 | DEPTH` (`const PM = mk('VMAP'), P5 = mk('V5'), P6 = mk('V6'), PD = mk('DEPTH')`), branched by `uniform int mode`:
  * `mode 4` map terrain (texture-draped), `mode 0` multi-light flat, `mode 1` objects (vehicles; first-person adds Fresnel glass/paint), `mode 2` see-through marks (alpha blend, no depth write), `mode 3` silhouette tint (x-ray, `depthFunc(GREATER)`), `mode 5` first-person ground, `mode 6` cab interior.
* Extra full-screen passes: **post** (ink edges, distance soften, heat shimmer, Panini warp, glass dust), **sky** (SFS), **horizon bake** (BFS → sky-view factor + soft sun shadow texture), optional FXAA (three.js FXAA port) and an experimental depth AO ("RACE"/`render=game` flags, off by default).
* 2D layers on top: `#ov` (all map marks: roads, intersection marks, labels, handles), `#ck` (cockpit fallback, binoculars, dust, brackets), DOM pins. Re-projected every frame from `S.lastMV`.
* **Render on demand**: a single rAF loop runs only while tweens, drags, zoom easing or the driver's view are live (`kick()`); idle = no frames. First-person adapts resolution: supersample up to ×1.75 (`ss: 1.75`), dropping through `[1, .8, .64, .52, .44, .38]` when GPU time > 15 ms (`@11242162`).
* Quality: auto **Smooth** (integrated GPUs/SwiftShader: one shadow tap, one ground texture tap) vs **Sharp**; "ultra" (9-tap PCF, 4096 shadow maps) on discrete NVIDIA/Radeon; Q toggles (`const QUAL` @11225868, `SMN` @11226956).

### 7.2 Terrain mesh

* Survey grid at **1 m** for the whole pit (`PIT.dx = 1`, 2401×1701 here), 0.25 m crops round intersections (`cropGrid`, radius ~190 m).
* `terrainMesh(G, stride, centre, radius, vex, nk)` (`@11178813`): node stride 3 m (near) and 8 m (`S.pitMeshLo` when camera distance > 1800 m); intersections stride 4 at 0.25 m (= 1 m). Each quad is **split along its flatter diagonal** so crests follow ridges (no saw-tooth): `if (|z_a − z_d| <= |z_b − z_c|) idx.push(a,b,d, a,d,c) else …`.
* Normals from heights `nk` nodes either side, **vertically exaggerated** for shading only (`RM.VEX = 2.5`; intersections 1.6). Positions stay true.
* Holes: the pit mesh is discarded inside a circle (`uniform vec3 hole`) where a finer patch (intersection, drawing area) is drawn; polygon offset `(2, 8)` on the coarse mesh avoids z-fighting at the seam.
* "Physical model" base (`pitBase` @11176856, look B): light-grey `[.86,.87,.89]` side walls dropped to `zmin − 18 m` round the survey boundary, and a soft table shadow = the footprint drawn **4 times** at offsets `k ∈ {.55, .8, 1.05, 1.3}` × the sun's ground offset, each `alpha .05` (`@11224008`). Gives the "model on a table" look in `01_pit_home.png`.

### 7.3 Map shading (mode 4) — baked hillshade texture + shader contours

The look of the map is **baked on the CPU once per grid** into an RGBA texture at grid resolution (`bakeShade` @11185778; pit call `S.pitTex = bakeShade(PIT, 2, 10)` @11844502 → minor 2 m, major 10 m; intersections `bakeShadeAsync(grid, 1, 5, 1.6, 2)` → 1 m / 5 m, VEX 1.6). Per texel:

```js
// sun (soft cast shadow from the true surface) + sky dome x share of sky in view + a little bounce, as in the cab view
const sv = B ? B.px[k*4]/255 : 1, ss = B ? B.px[k*4+1]/255 : 1;          // GPU horizon bake: sky-view, sun visibility
const sunT = .52 * Math.max(0, dot(n, MAPSUN)) * ss,
      sh = sunT + .40 * sv * (.55 + .45 * n[2]) + .08 * sv * Math.max(0, n[0]*bk[0] + n[1]*bk[1]) + .04,
      wS = Math.min(1, sunT / Math.max(.05, sh));
const t = clamp01((v - lo) / (hi - lo)), hyp = .84 + .14 * t;           // hypsometric: 3rd–97th percentile → 0.84..0.98
const ao = Math.max(.92, Math.min(1.03, 1 + .02 * (v - mean)));          // local mean over ~12 m (summed-area table): hollows darker
let g = Math.min(1, sh) * hyp * ao;
// contours from a ~2 m smoothed surface; coverage = 1 − (distance to contour in px)/0.8
const cMaj = cov(major) * (.4 + .6 * flat), cMin = cov(minor) * clamp(1.6 - slope, 0, 1) * flat * .7;   // minor fade on steep faces
if (!FINEC) g *= (1 - .11 * cMin) * (1 - .26 * cMaj);                    // (FINEC=on by default: contours moved to the shader)
const tw = LOOKB ? [.90 + .15*wS, .945 + .035*wS, 1.05 - .15*wS] : [1.0, .985, .955];   // sunlit faces warm, shaded cool
img = g * 255 * tw;
```

`MAPSUN` = azimuth 315° (NW), elevation 35° (`@2054752`). Shadows/sky-view come from the **horizon bake** shader (BFS @2097325): for each grid texel, 16 azimuths × 22 geometric radii (×1.32) give the maximum horizon slope `m`, sky-view `vis += 1/(1+m²)`; the sun term marches 32 steps (×1.2) toward the sun ignoring the first 1.5 m (survey roughness) and returns `smoothstep(-.07,.07, atan(sunTan) − atan(m))` — a soft-edged cast shadow.

The shader then drapes it and draws **contours per pixel**, so lines stay ~1 px wide at any zoom (mode 4, `@2078216`):

```glsl
if (mode == 4) {
  vec4 t = texture(tex, (vw.xy - texRect.xy) / texRect.zw); if (t.a < .5) discard; col = grade(t.rgb, vec3(0.));
  if (cIv.x > 0.) { float nz = max(.2, normalize(vn).z), sl = sqrt(max(0., 1. - nz * nz)) / nz;   // contours from the height, about 1 px wide at any distance, fading where they crowd
    float f1 = vw.z / cIv.x, w1 = max(fwidth(f1), 1e-5), d1 = abs(fract(f1 - .5) - .5) / w1, l1 = (1. - smoothstep(.35, 1.05, d1)) * (1. - smoothstep(.10, .40, w1)) * clamp(1.6 - sl, 0., 1.);
    float f2 = vw.z / cIv.y, w2 = max(fwidth(f2), 1e-5), d2 = abs(fract(f2 - .5) - .5) / w2, l2 = (1. - smoothstep(.45, 1.25, d2)) * (1. - smoothstep(.12, .45, w2));
    col *= (1. - .16 * l1) * (1. - .34 * l2); }
  if (shadowOn == 1) col *= (.60 + .40 * shadowAt(vw)) * mix(.55, 1., contactAt(vw.xy));   // vehicle shadows + contact shade on the map
}
// … then, for every map fragment:
float f = lookB == 1 && mode == 4 ? .80 * smoothstep(0., 1., clamp((vz - fog) / fogFar, 0., 1.)) : clamp((vz - fog) / fogFar, 0., .45);
o = vec4(mix(col, sky, f), 1.);
```

How it works: `fract(z/interval)` distance divided by its screen derivative (`fwidth`) is the distance to the nearest contour **in pixels**; `smoothstep(.35,1.05,d)` is a ~1 px anti-aliased line; `smoothstep(.10,.40,w)` fades contours where they would crowd (> ~3 lines per 10 px); minor lines also fade on faces steeper than ~58° (`1.6 − tanθ`). Minor darkens 16 %, major 34 %.

Map fog: `GL.begin(MV, camD*.62, camD*1.7, { sky: [.905,.925,.952] })` (`@11222961`) — fog starts at 62 % of the camera distance and is at 80 % by 1.7× — the far edge of the pit melts into a light blue-grey that matches the page.

`grade()` (look B): gentle S-curve `mix(c, c²(3−2c), .22)` then a saturation boost proportional to the albedo's chroma (keeps yellow paint from going olive); on the map the albedo argument is `vec3(0.)`, so only the S-curve applies.

Batter/bench striping is **not a separate effect**: at 2 m minor / 10 m major intervals benches and batters read through the stacked contours plus the VEX 2.5 hillshade (see the dump batters in `01_pit_home.png`).

### 7.4 First-person ground (mode 5) — the "photo ground" look

Quoted core (`@2068345`), simplified only by omitting debug branches:

```glsl
float dist = distance(vw, eyeW), slope = 1. - N.z;
// procedural height detail -> bump normal (surface-gradient method, Mikkelsen 2010), one sample per pixel
float hc = 1.2 * oct(p + 41., 45., 2.7), kf = lite == 1 ? smoothstep(40., 60., dist) : smoothstep(160., 200., dist),
      h = kf >= 1. ? hc : mix(hgt(p, road), hc, kf);            // hgt: 0.21/0.45 m grain (less on roads), 1.8 & 4.5 m lumps, 45 m swell
if (steep > 0. && dist < 200.) { /* same noise projected on the two upright planes for faces */ }
{ vec3 dpx = dFdx(vw), dpy = dFdy(vw), r1 = cross(dpy, N), r2 = cross(N, dpx); float det = dot(dpx, r1), hb = h * .40;
  vec3 sg = sign(det) * (dFdx(hb) * r1 + dFdy(hb) * r2); if (abs(det) > 1e-12) N = normalize(abs(det) * N - sg); }
// photo ground: 4 CC0 layers (road, flat ground, bund/batter rubble, rock faces > ~50 deg), hex-tiled (Heitz & Neyret 2018)
float pn = snoise(p / 7.), sn = slope + .05 * pn, wS = smoothstep(.34, .50, sn), wB = (1. - wS) * smoothstep(.05, .15, sn),
      wR = (1. - wS - wB) * road, wF = max(1. - wS - wB - wR, 0.);
// …two strongest layers, height-blended at the seam; faces use tri-planar on the two vertical planes
// tyre tracks: utes 0.8 m and truck duals 2.6 m either side of the lane centre, worn by noise, gone by ~150 m
float t1 = (rlat - .8) / .28, t2 = (rlat - 2.6) / .55; tk = road * wear * (.55 * exp(-t1*t1) + exp(-t2*t2)) * (1. - smoothstep(.15, .6, w));
vec3 alb = vec3(.62, .61, .59) * (1. + .05 * macro) * (1. + .28 * road - .07 * tk) * (1. - .06 * steep);   // clay-led mid grey
vec3 sunC = vec3(1.05, .97, .88), skyC2 = vec3(.64, .72, .86), bnC = vec3(.66, .58, .48);                // look B: warm sun, cool sky, warm bounce
vec3 lit = sunC * 1.05 * max(dot(N, sun), 0.) * sh * mix(1., gao, .5)
         + skyC2 * .46 * sv * gao * mix(.40 + .60 * N.z, .85, .7 * smoothstep(150., 900., dist))
         + bnC * .17 * sv * gao * max(dot(N, back), 0.);
col = grade(neutral(alb * lit * 1.18), alb);                       // Khronos PBR Neutral tone map, then the S-curve
float ct = mix(1.25, .55, smoothstep(25., 180., dist));             // near solid, far soft (contrast about mid grey)
col = vec3(.60) + (col - vec3(.60)) * ct;
col = max(col, vec3(.16 + .30 * smoothstep(25., 120., dist) + .18 * smoothstep(250., 1200., dist)));   // far always lighter
col = mix(col, vec3(.80, .84, .89), .20 * smoothstep(40., 260., dist) + .55 * smoothstep(260., 1100., dist));
vec3 fc = mix(vec3(.87, .90, .945), vec3(.97, .95, .91), pow(max(dot(rd, sun), 0.), 6.));          // haze warmer toward the sun
o = vec4(ex(mix(col, fc, min(1. - exp(-dist * 2.55e-4), .55))), 1.);                                  // 12 % at 500 m, 40 % at 2 km
```

Inputs: `bakeAt()` sky-view & sun texture (same horizon bake at 512² round the eye + a fine patch), `shadowAt()` = min of PCF lookups in **three cascaded ortho shadow maps** (A terrain 420 m half-size, B vehicles 170 m, C near 30 m incl. the cab; K the cab's own map), `contactAt()` = signed-distance boxes under up to 4 vehicles darkening ground ≤ 70 %. Photo textures: ambientCG CC0 `Ground091, Ground112, Ground110, Rocks011` embedded as JPEG (`const GROUND` @216727), tile sizes `gTile = (2.4, 2.0, 1.8, 3.5)` m, strength `gK = (.5, 1., .8)`, fade `gD = (30, .85, 35, 65)` m (`su('gTile'…)` @2086949). The photo layer fades out by ~65 m; beyond it the ground is the procedural material.

`SUN` for first person: azimuth 315°, elevation **28°** (`@2054478`) so bund faces and lee sides read; `HAZE = [.89,.91,.94]` (`@11225673`).

### 7.5 Sky, post-processing, "driving mode" atmosphere

* CSS sky behind the cockpit canvas: `body.drv #stage{background:linear-gradient(180deg,#9FBFDD 0%,#C4D8EA 32%,#DCE6EF 47%,#E3E9EF 52%,#E7EAED 100%)}` (`@1287`).
* GL sky (SFS @2096276): `hz = mix((.87,.90,.945), (.97,.95,.91), cosSun⁶)`; `col = mix(hz, (.50,.66,.84), 1 − exp(−el·3.2))`; sun glow `.35·cosSun²⁴`; sun disc `smoothstep(.99985,.99993,cosSun)`.
* Post (PFS @2087349): (1) **ink edges only at occlusion** — second difference of linear depth along 4 directions, `jump > 1.5 m`, line ≈3 px at 10 m → 1 px from 90 m, colour `(.30,.32,.35)`, none on the cab (< 4 m); (2) **distance softening** (3×3 blur × `smoothstep(350,1600,d)`, "far = soft"); (3) heat shimmer on far ground; (4) **Panini projection** resample for wide FOV (`pan` uniform; threshold `WIDE_TH = tan 50°`); (5) faint glass dust noise on non-cab pixels.
* Exposure adaptation: looking back into the cab raises exposure up to 1.3× (`expo`), Reinhard-style highlight roll-off `c·e/(1+(e−1)c)`.

### 7.6 Vehicles in the 3D view

Vehicles are separate meshes (body + wheels, wheels spin), lit by mode 1 with baked per-vertex AO (`length(vn) < .97` encodes AO in the normal length), Fresnel environment reflection on glass (`step(.055, b − r)` detects glass colours) and paint highlights. On the map they cast real shadows into a 2048² map round the vehicles and add a contact shade. Shots `13_ix_view.png` (ute with shadow), `17*` (truck).

### 7.7 Roads on the map — 2D overlay, not 3D geometry

Everything road-related is drawn on the `#ov` canvas each frame by projecting world points lifted **+0.5 m** above the survey (`r3World` @11715881). Paint order and colours (`r3Paint` @11717586, road module `drawPreview` @12072641):

| Mark | Style |
|---|---|
| Width band (per 10 m section quad) | ok `rgba(90,143,110,.34)`, narrow `rgba(181,86,76,.5)`, not read `rgba(110,110,115,.32)`; × .42 alpha when not selected/hovered |
| Band edges (selected) | `rgba(62,110,80,.85)` 1.3 px, round joins |
| Grade lanes (per lane, 100 m rolling grade) | ok `rgba(90,143,110,.95)`, > 10 % `#B5564C`, not read `rgba(110,110,115,.7)`; 4 px in the editor, 2.5 px on the pit |
| Centre line | `rgba(43,46,53,.4)` 1.2 px dashed `[4,4]` |
| Selected section / grade place | `#0A6FE6` 2.5 px across the road; editor adds a white 5 px underlay + blue 2.2 px |
| Live preview while digitising | band fill `rgba(10,111,230,.16)`, edges `rgba(10,111,230,.8)` 1.2 px, centre **white-cored blue**: 5 px `#0A6FE6` under 2.2 px `#fff` |
| End / via handles | white 6.5 px dot, 2.5 px blue ring; hover fill `#DCE9FB` r 7.5; dragging blue fill + white ring + 12 px halo `rgba(10,111,230,.2)` |
| "Set by hand" stretch | bracket offset 2.2 m outside the edge: white 4.5 px under blue 2 px |
| Saved road (legacy pit view) | 3 px line (hover 4.5), green `#3E8A5A` / red `rgba(181,86,76,.9)` / grey `rgba(43,46,53,.55)` + label "Road 1 ✓" 13 px 700 |

The road edges for the preview are estimated by marching out from the centre line until a height step > 0.3 m (median of 5), min 2.5 m (`band()` @12028524). There are **no chainage ticks or labels** on roads; what looks like ticks across the ramp in `05d_grade_on_ramp.png` are the 2 m contours crossing a 9 % grade.

### 7.8 Colour ramps

HRL uses **binary verdict colours** (pass/fail/not-read) for width and grade — no continuous grade ramp (e.g. 0–4–8–10–12 %) and no width-margin ramp. Speed uses three bands (< 20, 20–50, ≥ 60 km/h).

### 7.9 Camera

* Orbit camera `S.cam = { t:[x,y,z], dist, yaw, pitch, fov:.78 }` (vertical FOV 0.78 rad ≈ 44.7°). Home: target = pit centre, `dist = max(nx,ny)·dx·.75·max(1, 1.9/aspect)`, `yaw −2.2`, `pitch .95` (`@11359381`).
* Near/far: near `max(.5, dist/400)` (map), `.12` (cab); far 12000 (map) / 6000 (cab).
* Fly-to tweens use `easeIO` with an arc lift when flying into the cab (`lift = min(30, .12·horizontal distance)`).
* No orbit inertia (drags stop dead); only the zoom is eased. Intersection mode clamps pan to 160 m (420 m with the SOP view) round the crossing.

### 7.10 Known rendering artefacts (seen in our captures)

* **Contour speckle on near-flat ground** that sits on a contour level: the dump top (RL 352.0 = a major contour) and the pit floor bands (RL 264/266) render as salt-and-pepper noise (`01_pit_home.png`, `18_pit_with_intersection_pin.png`). Cause: `d = |fract(z/iv − .5) − .5| / fwidth` with tiny `fwidth` on flat ground — any survey noise flips pixels on/off the line. Fix in ours: fade contour opacity with `smoothstep(0.01, 0.04, slope)` and/or use a minimum `fwidth` floor.
* Road bands are filled as separate translucent quads per section (`c.fill()` per quad), so shared edges are blended twice — a seam risk at every 10 m section; draw one polygon per band (or a mesh) instead.
* Huge vertical extent in the Level 25 m cross-section beside a pit wall (`14b_level25_drilldown.png`) — the section's height budget is not clamped downward.

---

## 8. Driver's POV / cockpit

### 8.1 Eye point (from FLEET)

Vehicle frame (`vehicleGeom` header @1528279+): origin = **front centre on the ground**, x forward, y to the driver's left, z up. Eye = `(x = −eyeBack, y = −eyeRight, z = eyeH)`; `eyeRight < 0` means a left-hand cab (all haul trucks), `+0.4` = right-hand-drive LV. All eye values are flagged `estimated` in the data.

| Machine | L × W × H (m) | eyeH | eyeBack | eyeRight | visH ("seen from") | Tyre |
|---|---|---|---|---|---|---|
| CAT_789C (Cat 789C) | 12.177 × 7.674 × 6.15 | 4.52 | 3.29 | −2.79 | 3.08 | 37.00-R57 (E4) |
| CAT_789XD (Cat 789D) | 12.697 × 7.645 × 6.496 | 4.80 | 3.43 | −2.77 | 3.25 | 37.00-R57 |
| KOM_HD1500-7 | 11.37 × 6.89 × 5.85 | 4.435 | 3.07 | −2.39 | 2.92 | 33.00… |
| KOM_HD785-7 (water cart) | 10.29 × 6.885 × 5.05 | 3.85 | 2.78 | −2.39 | 2.52 | |
| CAT_773E (water cart) | 9.338 × 5.076 × 4.393 | 3.19 | 2.52 | −1.49 | 2.20 | |
| CAT_D11T (dozer) | 10.525 × 3.782 × 4.698 | 3.794 | 5.26 | 0 | 2.35 | tool 6.335 |
| CAT_18M (grader) | 10.593 × 3.411 × 3.746 | 3.146 | 6.57 | 0 | 1.87 | tool 5.5 |
| KOM_WA900-8R (loader) | 15.355 × 4.585 × 5.6 | 5.00 | 6.91 | 0 | 2.80 | tool 4.935 |
| HILUX (ute) | 5.32 × 1.855 × 1.865 | 1.50 | 2.39 | +0.40 | 1.25 (flag tip 3.5 m assumed) | 265/65R17-style |

Full table for all 32 machines: `fixtures/hrl-fleet.json`. FLEET meta: *"Eye heights are estimated unless an OEM drawing gives them; "seen from" heights are assumptions… Excavators excluded."* — **there is no excavator** in HRL.

### 8.2 The cab: real 3D geometry (`cab3d`, `<script type="text/plain" id="cabSrc">` @12078517)

* Two cabs only: `'lv'` = Toyota HiLux double cab (RHD) and `'hv'` = Komatsu HD1500 cab on the left front deck. Every other machine borrows one of these (`isLV(v) ? 'lv' : 'hv'`) — a 789D driver sees an HD1500 cab placed at the 789D eye.
* Built procedurally in **eye coordinates** (metres from the eye; x right, y forward, z up): crowned bonnet surface, dash loft with vents/dials, A/B pillars (trim section `LVA = [.052, .055]`, `HVA = [.055, .05]` m — "kept as thin as Ben asked"), mirrors with heads, steering wheel with spokes, door cards, visors, seals, chequer-plate deck tiles and round-tube handrails on the truck deck, plus a **seated miner figure** (orange shirt `#ff7a26`, reflective tape `#f4f6f8`, hard hat `#f3f4f5`).
* Palette: LV interior light greys (`roof #dcdcd8, pillar #d0d0cc, dashTop #a5a8aa, dark #45484d, glass tint #e4eaef, hazard #b0625c`); HV adds Komatsu yellow "toned down" `#d9ab2a` and shell `#a4a7a9`.
* Lighting: drawn in the scene with `mode 6` — same sun, its own shadow map K (cab self-shadow with normal offset), sky through the openings, baked per-vertex "share of windows seen" AO (`var CAB_LIGHT` data @1638002, or a voxel AO fallback at 4 cm), micro-noise on panels, Fresnel on painted parts; rendered "about one stop under the outside, never below ~20 %". **Glass is not modelled — windows are openings** (a faint dust layer is added in post).
* **Blind-spot model**: every opaque triangle is rasterised once into an angle grid as seen from the eye — `GW = 1440, GH = 720` (0.25° cells, azimuth −π..π, elevation −π/2..π/2). `blocked(x,y,z)` answers whether a sight line leaves through glass; the app uses it to say "behind the cab frame" vs "hidden by the ground" and to compute the visible share of the other vehicle.
* Reach (shadow-map radius) 2.8 m (LV) / 7 m (HV).

Fallback when cab3d is unavailable: the **2D painted cockpit** (`drawCockpit(ctx, W, H, kind, o)` @1588454). Geometry is defined in **angle space** — `x = W/2 + (X − yaw)·f`, `y = H/2 − (Y − pitch)·f`, `f = (H/2)/tan(fovY/2)` — so the overlay stays registered with the 3D camera; window polygons are bounded by pillar lines and analytic curves (e.g. LV `cowl(X) = −0.262 − 0.035X²`, `header(X) = 0.405 − 0.06X²`; HV deck edge `−atan(EH / rdist(X, DF, DR, DL))` with eye 1.5 m above a deck 3.6 m ahead). Static layers are cached to an oversized offscreen canvas (`MARGIN_X 1.25 rad`, `MARGIN_Y .55 rad`); the steering wheel has 1.07× parallax and idle steering; digital speed readout `rgba(236,241,246,.95)`.

### 8.3 Camera in the seat

| Item | Value | Source |
|---|---|---|
| FOV | fixed **100° horizontal**: `fpFov = min(1.75, 2·atan(tan50° / max(.6, aspect)))` (1.181 rad vertical at 16:9 — measured) | `@11430685` |
| Wide-angle | Panini resample in post when FOV is wide (`S.warp = [strength, WIDE_TH, aspect]`), off as you zoom in / use binoculars | drvFrame |
| Head | mouse position → yaw up to ±180° (edge), pitch ±.38; drag adds; eased `k = min(1, dt·9)` | `@11468514` |
| Auto look | in the first 1.5 s of a run the head turns toward the other vehicle (clamped ±1.45 rad) | drvFrame |
| Grade | `pitch = −.04 + look.pitch − bodyPitch·.9` (body pitch from a spring: ω = 2π·.85 Hz heavy / 1.5 Hz LV, ζ .3/.38, gain .007/.011 rad per m/s², clamp −.018..+.022) | `dynStep` |
| Shake | `(sin(9.3t)·.006 + sin(4.1t)·.004)·min(1, v/6 m/s)` + idle `sin(31t)·.0012 + sin(47t)·.0008` m | `@11421344` |
| Suspension | each axle on the mean ground under its tyres (3×3 points); body takes grade & cross-fall over ~2× its length | comment above `dynStep` |
| Zoom | wheel 1–8×; **binoculars** (B) ×4 lock onto the other vehicle (eased `1 − exp(−dt·5)`) | `@11422306` |
| Entry | fly from the map camera along an arc (`lift = min(30, .12·d)`), cab hidden until 90 % | drvFrame |
| Intro | chase cam (L + 14 m behind, 7 m up, fov .9) on the approaching vehicle, 1.1 s cross-fade into the seat with a 16 m arc | drvFrame |
| Speed | the other vehicle "comes at 60 km/h" along its lane; ← → drive it by hand | `.dhint` |
| Feedback | beacon flash where it is lost behind a crest, brackets round the target, off-screen "Truck this way ▶" chip, end pill "Seen from 134 m … allows 60 km/h", optional sight fan (green seen / red hidden on the ground), engine sound, dust | |

Not present: the observer never drives a whole haul route; there is no route-following POV with a speedometer/profile strip, no dash HUD for grade/speed limit, no rear-view mirror image (mirror rendering exists only in the 2D fallback API).

---

## 9. Vehicle models (parametric low-poly, `vehicleGeom` @1585684)

`vehicleGeom(v) → {pos,nrm,col,idx}` from the FLEET record; `vehicleParts(v)` returns body + wheels separately (wheel centres, radii) for spinning; `vehicleKeyPoints(v)` returns named visibility points (`cab_roof_*`, `canopy_front_*`, `corner_*`, `flag_tip`). Main dimensions (L, W, H, tool width, eye point) are exact; inner proportions are illustrative and **ASSUMED** values are labelled in comments. Palette (`COL` @1528279): `cat [.80,.62,.12]`, `kom [.82,.66,.16]`, `dark [.20,.21,.23]`, `tyre [.10,.10,.11]`, `glass [.20,.27,.34]`, `white [.95,.95,.94]`, `tank [.93,.93,.91]`, `amber [.98,.55,.10]`; detailed set `COL5` (rubber .075, tread .11, rim .68, chrome .80, lamp .97, red [.80,.07,.05] …). Paint = make (Cat / Komatsu yellow, else white). Two fidelity tiers: **v5 detailed** (`truck`, `ute`) and **v4 boxy** (everything else) — see `31_garage_contact_sheet.png`.

### 9.1 Rigid haul truck (`_truck5` @1538884) — parameter recipe for Three.js

Let `L, W, H` = length, width, height; `hw = W/2`; tyre from the code (`37.00-R57` → section 37 in, rim 57 in).

| Part | Rule |
|---|---|
| Tyre OD | `D = (rim + 2·1.13·sec)·0.0254` (37.00R57 → 3.57 m), capped at `.62H`; width `tw = sec·0.0254`; rim radius `rb = min(rim·.0254/2, .62(r − lugH))`; `lugH = .045r` |
| Axles | front `xf = −.235L`, rear `xr = xf − .47L`; fronts single at `y = ±(.84hw − tw/2)`; rears **dual** at `.86hw − tw/2` and `− 1.5tw − gap` (`gap = .13tw`) |
| Tread | 22 staggered, angled lugs per row × 2 rows (chevron ±.30 rad), every 2nd lug 1.35× wide; valve marker shows rotation |
| Wheel | 40-segment revolve: sidewall profile, recessed rim (dish .20 front / .06 rear), 18 nuts, 6 holes, planetary hub |
| Deck | `deck = max(eyeH − 1.2, D + .18)`, thickness .14, spans `xBF..xDF` at ±.47W |
| Cab | left side, `yCo = min(eyeRight' + .8, hw − .3)`, 2.0 m wide, from `cabR = eyeX − 1.2` to `cabF = min(eyeX + .9, −.045L − 1)`; roof `min(deck + 2.05, H − .38)`, raked windscreen (.20 m), framed side glass, mullions, black mirrors on arms |
| Front | grille box `−.075L` with bars every ~0.2 m, bumper, amber + white lamps, ladder at `y = −.255W`, diagonal stairway to the deck, handrails (posts every ≤ 1.3 m, top + mid rail, r .035) |
| Engine bay | hood hexa on the right of the cab with louvres, air-cleaner drums, twin exhaust stacks |
| Body | lofted dump body: keel floor rising at the tail (`tailLen = .22·bodyLen`), side walls `zTop` easing to the canopy (`smoothstep`), ribs every ~1.05 m, top rail, canopy over the cab to full height `H` with amber marker lamps |
| Frame | rails `±.10–.16W`, rear lamps red/amber, rear axle housing, octagonal lofted fuel/hydraulic tanks between axles, suspension struts (chrome) |

### 9.2 Ute (`_ute5` @1554014)

HiLux double-cab: all-terrain tyres (6-spoke alloy; LC79 steel 6-hole), sill line with wheel-arch cut-outs, sloped windscreen with tumblehome, doors/handles/mirrors/steps/flares, grille, lamps, skid plate, **bull bar**, roof **light bar + amber beacon**, tub (HiLux) or tray (LC79), and a **buggy-whip flag** rear right whose tip height = `v.flagH` else **3.5 m (ASSUMED)** — the ute "counts as seen when the tip of its flag shows" (`FLAGV`).

### 9.3 v4 shapes (proportions as fractions of L, W, H) — `_vehicleBuild5` @1568840

* **Water cart** (`watercart`, @1576892): truck chassis (wheel `d = min(.55H, .3L)`, front `−.2L`, rear duals `−.72L`), tank = prism across `±.40W`, centre `.78H`, radius `.2H`, from `−1.0L` to `−.33L`, top walkway + rail, rear spray bar `−1.02L…−.99L` at `.50–.55H`.
* **Service truck** (`service`): white box body `−1.0L…−.33L`, grey side lockers, crane base.
* **Wheel loader / wheel dozer** (@1577933): 4 wheels `d = .52H` at `−.30L` and `−.70L`, front frame, engine housing, counterweight, cab `−.58L…−.40L` full height with glass box; bucket prism width = `toolWidth` (`.42–.44H` high) + lift arms; wheel dozer: straight blade prism.
* **Dozer** (@1579870): tracks as side prisms `−.86L…−.24L` with raised sprocket (`.34H` at `−.74L`), 9 grousers, body `.27–.55H`, cab `−.72L…−.50L`, blade at the front `toolWidth` wide, `.44H` high, push arms, ripper beam + shank at the rear.
* **Grader** (@1581463): front wheels `−.06L`, tandem rears `−.62L`, `−.82L`, `d = .38H`, arched front frame, push plate, moldboard at `−.49…−.40L` width `toolWidth`, circle, cab `−.72…−.52L`, engine at the rear.
* **Light truck / crane / wagon**: simple boxes, white body, amber light bar; crane boom amber prism.

### 9.4 What hAIul SIM needs beyond this

Excavator (none in HRL — must be built: tracks, house, boom/stick/bucket with joints for the dig animation, counterweight), loaded/empty truck body (payload heap mesh with tray-angle), body-raise animation for dumping, articulated-truck option, dozer/grader at the same v5 detail tier, LOD (HRL ships one LOD — fine for a few vehicles, not for 40 trucks), instancing for fleets, and per-unit colour/number decals.

---

## 10. Road follower — "click two ends, the app finds the road" (`SISDRoute` @11906565)

Pure, deterministic, worker-safe (a Worker is built from `F.toString()` of these functions with the same 2 m height nodes, so main thread and worker agree). Header: *"Finds the cheapest path over the survey between clicked points. A haul road is smooth and gently graded; bunds, windrows and walls are steep and rough, so the path keeps to the road surface and, through a pull towards the middle (away from steep ground), runs down the road rather than along one edge."*

**Settings (verbatim)** — `cell: 2` m grid; `margin: 120` m corridor (at least) and `marginK: .45` × the clicked span; `steep: .28` (rise/run) = bund/windrow/wall; `slopeK: 30`; `roughK: 25` per metre roughness; `centreK: 6`, `centreD: 4`; `blocked: 400`; `simplify: 1.5` m; `step: 10` m output spacing; `maxCostPerM: 6`; recentre: `xsHalf: 40`, `xsStep: .5`, `xsTol: .4`, `xsResume: 5`, `ridgeH: 1.8`, `ridgeW: 8`, `ridgeDip: .8`, `xsGentle: .15`, `xsFall: .05`, `xsPasses: 2`, `xsMaxShift: 8`, `xsEnd: 15` (`@11907450`).

Algorithm:

1. **Corridor** (`corridor`): sample the survey `H(x,y)` (bilinear) onto a 2 m grid over the bounding box of all clicked points padded by `max(120, .45·span)`.
2. **Cost field** (`costField` @11910579): slope `g = |∇z|` by central differences; `steep = g > .28`; chamfer distance transform (two passes, 1 and √2 weights) giving `D` = metres to the nearest steep cell; local roughness `rough = |z − mean3×3|`. Cost per cell:
   `cost = 1 + slopeK·(g/0.1)²/10 + roughK·rough + centreK/(1 + D/centreD)`; steep cells cost `blocked = 400`; off-survey = ∞.
   (So 10 % grade adds 3, 20 % adds 12; the centring term adds up to 6 at a bund toe, 3 at 4 m, 1.2 at 16 m.)
3. **Snap** each clicked point to the nearest non-blocked cell within 6 m.
4. **A\*** (`astar` @11912714) on the 8-neighbour grid; edge cost `w·cell·(cost_a + cost_b)/2` (w = 1 or √2); Euclidean heuristic in metres; binary heap. Multiple via points are chained segment by segment.
5. **Validity**: `costPerM = total/length ≤ 6` **and** steep run ≤ 6 m, else `ok:false, why:'the way between the points leaves the road surface'` → the UI asks for "a point in between" and greys the preview.
6. **Smooth**: Ramer–Douglas–Peucker at 1.5 m, then resample every 10 m; the two ends are put back exactly where clicked.
7. **Recentre** (`centre` @11918436, 2 passes): at each inner point take a cross-section ±40 m every 0.5 m square to the line; road level = median of heights within 8 m; walk out each side over "gentle" ground (`|Δz| ≤ 2·step·0.15`) and stop at the first steep feature that is not a low (< 1.8 m), narrow (< 8 m) ridge followed by ≥ 5 m of gentle surface at the same level (± 0.4 m + 5 % camber) and without a dip deeper than 0.8 m (`sideEdge` @11916608). Candidate inner edges (centre bunds/windrows) are collected; per section choose the edge pair whose width is closest to the median outer width over ±70 m (prefer outer pairs). Shift = `(R − L)/2` if ≤ 8 m; median-of-5 filter; gaps interpolated; no shift within 15 m of the ends, full shift from 30 m.
8. Result `{ ok, pts (every 10 m), length, costPerM, steepRun, why }`; then the road engine measures widths every 10 m from the true edges.

UX around it (road module): the live preview runs in the worker on mouse-move ("newest request only"), throttled by measured runtime (`gap = clamp(2·ms, 40, 220)` ms on the main-thread fallback); the cursor dot snaps to running surface; the preview band edges come from a 0.3 m step march. Minimum road 50 m ("Click an end at least 50 m along the road").

**For hAIul "auto-route a haul string between dig and dump"**: reuse the algorithm as is, plus (a) a hard max-grade constraint (e.g. cost ∞ or 400 where the *along-path* grade > 10 %; HRL penalises slope magnitude, not along-track grade, so it will happily cross a 9 % ramp diagonally), (b) a turning-radius / curvature penalty (HRL has none; corners come out as 2 m-grid diagonals smoothed only by RDP), (c) prefer existing roads (lower cost on previously digitised strings), (d) output a spline (Catmull-Rom/clothoid) and chainage, (e) return the cost breakdown so the AI can explain the choice.

---

## 11. Section and profile views

All sections are **true scale** (same metres-per-pixel on both axes) and live in the 400 px left column.

### 11.1 Road cross-section (road module `secSvg` @12054554) — `04c_road_section_truescale.png`

* SVG `398 × 118`, `viewBox 0 0 398 118`, `role="img"`, `aria-label="Road cross-section at 700 m, true scale"`.
* Horizontal window: `lo = max(−40, −offL − 6)`, `hi = min(40, offR + 6)` m; `k = 398/(hi − lo)` px/m on both axes; road level (median of the surface between the edges) at `y = 86`.
* Layers (back → front): **need band** (width required, from the left edge or beside a centre bund on the narrower side; fill `#F8E4E1` fail / `#E2F0E7` ok / `#EEF0F3` n/a, 7 m tall) → **shortfall** block `--v6-red` @ 50 % → dimension line (end ticks ±4 px, 1.5 px, verdict ink) → **truck rear view** drawn to the selected vehicle width (`truck()` @12058147: 4 tyres `#626871` r .42, chassis `#7C828B`, tray trapezoid `#9BA1A9` from ±3.4 m at 3.1 m up to ±hw at 5.5 m, top rail; height scales with width/7.8 — "6 m for a Cat 789, assumed") → ground fill `#E4E7EB` + ground line `#3A3F47` 1.5 px → centre bund polygon `#C4CAD2` with toe dots → dashed "old edge" ghost when an edge was moved → **edge handles**: blue 2 px vertical line from the knob (y 16) down to a 2.2 px dot on the ground, knob r 6.5 white with 2.5 px blue stroke (hover fill `#EEF4FD`; dragging r 7.5 blue fill, white stroke, 12 px halo at 16 %) → labels "Left"/"Right" 600 12 px ink-2 at the bottom.
* Interaction: the handles are `role="slider"` with `aria-valuenow`; drag on the SVG or on the map (same `V.drag`); arrows ±0.1 m / Shift ±1 m; the SVG is rewritten in place during the drag so pointer capture survives.
* Figure row above it: "19.3 m needs 27.3 m" (22 px 700 verdict colour + 14 px ink-2), "Set by hand" badge, reset icon button.

### 11.2 Grade place chart (`r3Chart` @11707183, canvas) — `05d_grade_on_ramp.png`

Lane long-section ±70 m round the place, true scale, height 90–190 px: lane surface `#3A3A3C` 2 px, the 100 m window shaded (`rgba(90,143,110,.10)` ok / `rgba(181,86,76,.09)` fail), the fitted 100 m grade as a 3 px verdict-colour line, the 10 % limit as a dashed `#8E8E93` 1.2 px line `[4,3]` through the same point, caption "9.0 % over 100 m" (12.5 px 700 verdict ink), chainage labels "237 m … 377 m along the lane" (11 px 600 `#5E5E63`).

### 11.3 "Level 25 m" detail (v6 SOP module, `levelView` @12004864) — `14b_level25_drilldown.png`, `14c_*`

* Header: back chevron, "Level 25 m ≤ 2 %", close ×. A **road segmented control** with road letter discs and each road's value ("A 9.5 % · B 0.1 % · C 0.6 %"; unread roads hatched).
* Verdict sentence (16/22 600): "Falls away from the crossing" / "Rises away…" / "Level" + status glyph.
* **Silhouette** (`silSvg` @11997315): 366 px = 25 m on **both** axes; ground polygon `#E4E7EB` + 1.4 px `#3A3F47` line; the selected LV drawn side-on at the crossing end with both wheels resting on the profile (iterated pitch angle); unmeasured tail shown as a hatched bar with a tooltip.
* **Grade strip**: 5 cells (5 m pieces) in a 5-column grid, 40 px tall, radius 6, 15 px 650 values ("8.7 %"), fail cells `#FBEFED`, n/a hatched, selected cell `inset 0 0 0 2px #0A6FE6`; axis labels 0 5 10 15 20 25 m (12 px ink-3; first left-aligned, last right-aligned). Keyboard: tablist semantics, roving tabindex.
* **Across the road** (`crossSvg` @12000432): section at the selected piece, the "Checked lane" band (2–13 m from the road middle, or 1 m inside the edge) as a pale blue rect with label, edges as short ticks, the ute **end-on** to its width/height resting on the cross-fall.
* A map handle on the road lets you scrub the section position; the map shows each road's 25 m zone as a translucent polygon with its value as map text.

### 11.4 SOP checklist (v6 card, `13_ix_view.png`)

Sections SIGHT (≥ 110 m), CROSSING (angle 90 ± 5°, next crossing ≥ 70 m), ROAD SURFACE as a **matrix**: rows = checks (Level 25 m ≤ 2 %, Centre bund ≤ 1.2 m, Bund on the road), columns = road letters A/B/C, cells = values with verdict colours; trailing status glyph per row. Each row drills down into its own view (same panel, back chevron). "Sit in the cab" appears inline on a selected sight row.

### 11.5 Report charts (PowerPoint, see §12)

Width along the road (one bar per 10 m section; narrower side when there is a centre bund), the section across at true scale, the lane long-section at the steep place with the 100 m fit and the 10 % line, grade along the whole road per lane, and plans drawn from the survey (north up, light shading) with each 10 m piece coloured — all rendered to canvas at slide size × 200 PPI with text ≥ 12 pt.

---

## 12. Report / PowerPoint builder (`deckMake` @12671185, PptxGenJS 4.0.1 offline @12162667; slide code from `// 1 cover` @12672843)

Gate: requires a saved audit ("Save an audit from the case menu before making its report." @11862310) and confirmed roads/intersections. Report button states: Report → Building (spinner) → Saved (tick, 2 s). Layout `W16` = 13.333 × 7.5 in, background `#EEF0F3`, white cards, Segoe UI, nothing under 12 pt, all words as real PowerPoint text (labels placed to avoid overlap; "a crowded picture must never silently lose a value"). Saved locally only.

| # | Slide | Content |
|---|---|---|
| 1 | Cover | white; cover photo fill-cropped on the right (W − 4.8 in), logo |
| 2 | Results | title like "2 stretches too narrow, none too steep · 1 of 3 intersections fail a Road SOP row"; subtitle states the basis (template `Roads checked against ${req} m for 2 lanes (${veh}, assumed) and 10 % grade · intersections: sight distance and the six Road SOP rows`) |
| 3 | Fix list (paged, nothing dropped) | grouped, largest first: intersection rows, narrow, steep, not measured; ids W-01 / G-01 / N-01 as Road Audit did |
| 4–5 | Width map, Grade map | network plan 12.4 × 5.45 in, each 10 m piece coloured; legend key |
| 6 | Not measured | template `${km} km not measured: these are not passed` + "Open the road, drag the edges where they are, confirm again." |
| 7… | One page per problem stretch (15 largest) | title template `${id}  ${road}: ${minWidth} m wide, needs ${required} m (${short} m short)` (e.g. "W-01  Road 1: 19.3 m wide, needs 27.3 m (8.0 m short)"), chainage range; plan crop + true-scale section + width chart / lane long-section |
| n | Intersections scorecard (paged) | "Intersections: 1 of 3 confirmed fail a Road SOP row", lowest sight speed |
| n+1… | One page per failing / unchecked intersection | the app's own result view (rendered off-screen) + the six SOP rows + Level 25 m charts ("Along the level zone", "Across the road at 17.5 m") |
| last | What was checked, and the record | basis, assumptions, audit record (hash-addressed local store) |

Our capture of this flow: `19a_audit_saved_menu.png`; the deck itself did not render under SwiftShader ("The report view did not render") so the slide list above is from source. **Emulate for hAIul scenario reports**: results-first title sentences, fix list that never truncates, one page per problem with a true-scale figure, basis/assumptions slide.

---

## 13. What to beat, and what to steal

### 13.1 What to beat (concrete weaknesses / missed opportunities)

1. **No dark / night theme at all** (no `prefers-color-scheme`, no night shift lighting). Mines run 24 h; we ship light + dark + "night shift" (low-blue, dimmed) themes and a night sky/headlights in POV.
2. **Two design systems visible at once**: v6 cards (Segoe, 14 px, radius 14, green `#3E8A5A`) next to un-migrated legacy panels (settings menu radius 12/13 px, wizard `.ebtns.wiz`, scenario cards, rail tips, two greens `#3E8A5A` vs `#5A8F6E`, blue `#0A84FF` vs `#0A6FE6` vs `#0A63D6`). We start from one token set.
3. **Binary verdict colouring only** for grade/width — no continuous, legible ramps (grade 0–12 %, width margin, speed). We add perceptual ramps with a legend and on-hover values.
4. **No legend on the v6 pit map** and **no north arrow** (v6 hides `#sclN`). We keep a compact legend for active layers and a north/compass control that resets heading.
5. **No chainage**: roads have no chainage ticks, labels or km posts on the map. We draw chainage ticks every 50/100 m with labels, start/end flags and direction arrows.
6. **Contour speckle on flat ground** sitting on a contour level (dump top, pit floor) and contours drawn on the coarse 2 m minor interval only. We fade contours by slope, add index-contour labels (RL) and user-set intervals.
7. **Map marks are 2D canvas drawn per frame**: no depth occlusion (roads show through hills/walls), no proper line joins at high zoom, per-quad alpha seams, text without halo. We render roads as 3D ribbons draped (or decal-projected) on the terrain with depth test + screen-space line widths (Line2/fat lines) and SDF labels with halos.
8. **Only two cab interiors** (HiLux, HD1500); every truck/dozer/loader borrows one. We parameterise the cab from FLEET (cab side, eye, A-pillar positions) and add 789-class, excavator and dozer cabs.
9. **Uneven vehicle fidelity**: v5 truck/ute are excellent, the v4 dozer/grader/loader/crane/wagons are boxes. Unify on one tier, add LOD + instancing for fleets.
10. **No excavator** (explicitly excluded) and no dig/dump animation, loaded body, body raise, queuing. Core for hAIul.
11. **POV is a static "wait at the crossing" scene**: no drive-the-route camera, no speedometer/grade HUD, no mirrors. We add route-following POV with speed from the haul simulation, a profile strip, cab HUD and mirror views.
12. **Camera has no inertia, no keyboard orbit/pan, no saved views/bookmarks, no "fit to selection"**; pan clamped hard in intersections. We add damped orbit (OrbitControls-style with damping), WASD/arrow pan, view presets and fit.
13. **Zero time dimension**: no shift slider, no depletion, no animation timeline. Ours has a shift timeline with scrubbing, play, speed and keyframes.
14. **No scenario compare**: single case only. We add A/B split view and diff colouring.
15. **Rendering cost**: first-person relies on supersampling + 4 shadow maps + 9-tap PCF + post; on integrated GPUs it falls back to "Smooth" with visibly less detail and in SwiftShader it is unusable (minutes per frame). We budget with WebGL2/WebGPU-friendly techniques (CSM via three's `CSM`, TAA/SMAA, LOD terrain tiles) and a clear quality picker.
16. **Report needs a separate "Save audit" step** and failed to render headless; PowerPoint only. We generate the scenario report directly (PPTX + PDF + shareable HTML) from the current state.
17. **Settings is a dumping-ground menu** (vehicles, load, save audit, save intersections, keys) with no grouping. We split into File, Fleet, Display and Help.
18. **Wizard copy is long** and multi-sentence inside small panels; step indicator style differs from v6; row labels truncate with an ellipsis ("Centre bund ≤ 1.2…" in `14_sop_row_hover.png`). We keep HRL's plain-English tone but with single-line instructions and progressive disclosure.
19. **Panels cover the map**: 400 px column + lens shift helps, but no collapse-to-rail, no resizable panels, no bottom-sheet on mobile in v6. We add collapsible panels and responsive layouts.
20. **Accessibility gaps**: map content is canvas-only (no list alternative for roads), colour carries meaning on the map (width/grade bands) without pattern/shape backup except "not measured" hatch. We add pattern fills/dashes for fail states and a data table view of every mark.
21. **Survey only greyscale**: no imagery/orthophoto drape, no dig/dump solids shading, no material colour (coal vs overburden vs spoil). We add solids with material colours, transparency and cut/fill heat-maps.

### 13.2 Steal these (best patterns to copy)

1. **"Four corners" chrome family**: 44 px white surfaces, 36 px controls, radius 14/10, one shadow, one icon weight, 14 px map gutter, 400 px left column, panels 11 px under the bar.
2. **The state table** for controls (rest/hover/pressed/on/on-hover/focus/disabled) with **instant pressed state** and 120 ms ease-out elsewhere; inset 2 px focus ring + 4 px white inner ring on filled buttons.
3. **Icon rules**: 20-grid, 1.7 stroke, round caps/joins, `currentColor`, filled status discs separate from outline glyphs.
4. **Big "add" cards** (blue tile + title + one-line how-to) as the empty-state call to action.
5. **"Show" layer toggles** in one surface with a muted label, persisted per user.
6. **Lens shift** of the 3D projection when a side panel opens (keeps the subject centred without moving the camera).
7. **Zoom to cursor with eased log-distance** and **pan by ground Jacobian** (the ground under the cursor sticks to it).
8. **Camera never goes under the terrain** (raise pitch until ≥ 3 m clearance).
9. **Click-two-ends road follower** with live worker preview, "add a point in between" fallback, and recentring between true road edges — reuse for auto-routing.
10. **Snapping the cursor dot to running surface** (gentle ground within 6 m).
11. **True-scale cross-sections with the actual vehicle drawn to scale** and drag-to-edit edges mirrored on the map; values as sliders with keyboard steps.
12. **Number formatting** (`tabular-nums`, fixed unit width, extra decimal near a limit, limits shown beside labels, "assumed"/"estimated" flags in the UI).
13. **Verdict sentence first** ("Seen from 134 m before the crossing – allows 60 km/h"; "Falls away from the crossing") then the evidence.
14. **Baked map hillshade** = sun with soft cast shadows + sky-view factor + hypsometric tint + local-mean AO + warm/cool split, and **per-pixel anti-aliased contours** that keep ~1 px width and fade where they crowd.
15. **"Model on a table"** presentation: light side walls and a soft multi-offset table shadow; fog to the page colour at the far edge.
16. **First-person atmosphere**: low NW sun (28°), Khronos Neutral tone map + gentle S-curve, distance-graded contrast/lift, physically-motivated haze (σ ≈ 2.55e-4 /m) warming toward the sun, occlusion-only ink lines, Panini for wide FOV, exposure adaptation.
17. **Hex-tiled CC0 photo ground** with slope-driven layer choice, height-blended seams, tri-planar faces and tyre-track wear — the best-looking ground of any mine tool.
18. **Real 3D cab with blind-spot angle grid** (0.25°) used both for rendering and for analysis ("behind the cab frame" vs "hidden by the ground").
19. **Parametric vehicles from spec sheets** (tyre code → tyre geometry; eye point → cab placement) with named key points for visibility tests and separate wheel meshes.
20. **Driving feedback details**: auto head-turn to the target, brackets round small far targets, off-screen direction chip, beacon flash where it disappears, binoculars with distance caption, slow motion, sight fan.
21. **Plain-English microcopy** and destructive actions as two-click text links.
22. **Report structure**: results sentence titles, never-truncated fix list, one page per problem with a true-scale figure, assumptions slide.
23. **Render on demand** (no frames when idle) and adaptive supersampling in heavy views.

---

## 14. Implementation notes for hAIul SIM (Vite + TS + React + Three.js)

### 14.1 Tokens as code (start here; light values = HRL v6 verbatim, dark values = ours)

```ts
// src/ui/tokens.ts
export const tokens = {
  font: `"Segoe UI Variable Text","Segoe UI",system-ui,-apple-system,sans-serif`,
  radius: { card: 14, ctl: 10, btnInner: 8, cell: 6, pill: 999 },
  space: [0, 4, 8, 12, 16, 20, 24],
  size: { surfaceH: 44, controlH: 36, iconCtl: 20, iconBtn: 18, gutter: 14, column: 400, panelTop: 69 },
  motion: { fast: '120ms', panelIn: '350ms', panelMove: '450ms', ease: 'cubic-bezier(.23,1,.32,1)', easeIO: 'cubic-bezier(.77,0,.175,1)' },
  light: {
    bgApp: '#EEF0F3', surface: '#FFFFFF', surface2: '#F6F7F9', hair: '#E3E6EB', hair2: '#EEF0F3',
    ink: '#1F2329', ink2: '#4A5059', ink3: '#646A73',
    blue: '#0A6FE6', blueInk: '#0A5FC4', blue50: '#EEF4FD', blue100: '#DCE9FB', bluePress: '#0A4FA6',
    hover: '#F1F3F6', press: '#E6E9EE', ov1: 'rgba(18,38,70,.05)', ov2: 'rgba(18,38,70,.10)',
    ok: '#5A8F6E', okInk: '#3E6E50', okBg: 'rgba(90,143,110,.14)',      // scheme A sage (use ONE green; HRL's v6 #3E8A5A is the inconsistency)
    mid: '#C47A3E', midInk: '#9A5A26', midBg: 'rgba(196,122,62,.14)',   // clay
    bad: '#B5564C', badInk: '#9A3B32', badBg: 'rgba(181,86,76,.13)',    // rust
    na: '#8E949C', naBg: '#F1F2F4',
    ground: '#E4E7EB', groundLine: '#3A3F47',
    shadow: '0 6px 20px rgba(20,30,50,.08)',
  },
  dark: { /* hAIul addition — HRL has none */ bgApp: '#111418', surface: '#1A1E24', surface2: '#20252C', hair: '#2C323A', hair2: '#232830',
    ink: '#E8EBEF', ink2: '#B4BAC3', ink3: '#8A919B', blue: '#4C9BFF', blueInk: '#7DB6FF', blue50: '#16263D', blue100: '#1D3352',
    hover: '#232830', press: '#2A3038', ok: '#6FA884', okInk: '#8CC3A0', mid: '#D69157', midInk: '#E7AA77', bad: '#D06A5F', badInk: '#E58C82',
    na: '#7B828C', ground: '#2A2F36', groundLine: '#C9CFD7', shadow: '0 6px 20px rgba(0,0,0,.45)' },
} as const;
```

Expose as CSS custom properties (`--hs-*`) on `:root[data-theme]`; components read only tokens. Keep `font-variant-numeric: tabular-nums` on every numeric element.

### 14.2 Components → React

* `<MapSurface corner="tl|tr|bl|br">` (44 px), `<Control icon label on busy done />` (36 px, the §4.1 state table), `<IconButton/>`, `<BigAdd icon title how/>`, `<Seg>` (raised white thumb), `<Card head badge onClose>` with `<Section title limit>`, `<Row icon label limit value unit status selected/>`, `<Matrix/>` + `<Cell/>`, `<Badge kind/>`, `<SpeedPill band/>`, `<Toast action/>`, `<StepDots/>`, `<DropTile state="idle|over|ready"/>`, `<ScaleBar/>` (nice steps `[5,10,20,25,50,100,200,250,500,1000]`, ≥ 60 px).
* Icons: import `assets/hrl-icons.svg` as a sprite (`<use href="#i-road"/>`) or generate `<Icon name>` components from `hrl-icons.json`. Keep the 20-grid/1.7 stroke rules for new glyphs.

### 14.3 Terrain in Three.js

* Geometry: tiled `BufferGeometry` from the 1 m grid, split along the flatter diagonal (custom index builder), LOD tiles (strides 1/2/4/8) instead of HRL's two whole-pit meshes. Normals with optional shading exaggeration (VEX) computed in a worker.
* Map material: `ShaderMaterial` (or `MeshBasicMaterial.onBeforeCompile`) with a baked hillshade `DataTexture` (port `bakeShade` to a worker; port the BFS horizon bake to a `WebGLRenderTarget` full-screen pass) and the §7.3 contour GLSL using `vWorldPosition.z` and `fwidth` (requires `extensions.derivatives` in WebGL1; native in WebGL2). Add the slope fade (`smoothstep(0.01,0.04,slope)`) to kill flat-ground speckle; add RL labels as SDF text along major contours.
* Fog to the page colour (`scene.fog = new Fog(bg, dist*.62, dist*1.7)` with the look-B curve, or a custom fog chunk).
* POV material: port mode 5 as a custom material (or `MeshStandardMaterial` with a `normalMap`-free surface-gradient bump in `onBeforeCompile`), `THREE.CSM` for cascaded shadows (3 cascades ≈ 30/170/420 m), `ACESFilmic`/AgX or a custom Khronos Neutral tone map, height fog per §7.4, `Sky` or the SFS gradient shader on a sky sphere.

### 14.4 Map marks

Render haul strings as **draped ribbons** (terrain-conforming triangle strips +0.3–0.5 m, depth-tested, polygonOffset) with `Line2`/`LineMaterial` for edges and centre lines (screen-space width), chainage ticks + labels (`troika-three-text` with halo), and DOM/CSS2D pins only for interactive markers. Keep HRL's colours (§7.7) but add continuous ramps (§13.1-3).

### 14.5 POV

`PerspectiveCamera` with HRL's fixed-horizontal-FOV rule (`vFov = 2·atan(tan(50°)/aspect)`), parent it to the vehicle at `(−eyeBack, −eyeRight, eyeH)`, head yaw/pitch from pointer, body pitch spring (§8.3), Panini optional (post pass) and binocular zoom. Cab interiors as GLTF or parametric meshes with a precomputed angle-grid blind-spot mask (1440×720) for analysis.

### 14.6 Follower

Port `SISDRoute` verbatim to TS in a Web Worker (it is pure); add the along-track grade constraint, curvature penalty and spline output (§10).

---

## 15. Screenshot index (`/tmp/claude-0/-home-user-Haul-IQ---Intelligent-Haulage/6a799533-cbdc-5f2c-b7d8-1a1fb31b2822/scratchpad/hrl_study/shots/`)

| File | Shows |
|---|---|
| `00_start_modal.png` | "Load a pit shell" modal over the blurred empty app: two dashed drop tiles, disabled Open |
| `00b_start_modal_hover_drop.png` | Drop tile hover (blue dashed border, blue tint) |
| `00c_start_modal_shell_ready.png` | Shell chosen: tile turns solid sage with file name + size; Open enabled |
| `00d_loading_progress.png` | First frame after Open — pit loaded (fast on this fixture) with v6 chrome |
| `01_pit_home.png` | Pit home view: bar + two big-add cards, Show toggles, scale/camera surface; hillshade, contours, pit walls, dump batters, model-on-a-table base and shadow |
| `02_hover_road_bigadd.png` | Big-add card hover state (crop) |
| `02b_hover_layer_grade.png` | Layer toggle hover (crop) |
| `02c_hover_gear.png` | Gear icon-button hover (crop) |
| `02d_layer_width_off.png` | "Width" toggled off (crop) |
| `03_road_start_prompt.png` | Road mode: "Click where the road starts", crosshair over the ramp |
| `03b_road_live_preview.png` | Live follower preview: blue band, white-cored blue centre line, start/end dots, length "826 m", lens-shifted view |
| `03c_road_measured_width.png` | Measured road: "1 to fix" badge, Width/Grade segmented control, issue row, green/red width band on the map |
| `04_road_grade_tab.png` | Grade tab of the road card |
| `04b_road_details_open.png` | Details disclosure (lanes, vehicle, SOP basis, assumed values) |
| `04c_road_section_truescale.png` | Drill-down "Narrow · 700 m": true-scale section with truck, need band, shortfall, edge handles; map zoomed to the section with edge handles |
| `05_map_edge_handle_hover.png` | Map section line with its two edge handles (white knob, blue ring) over the red narrow band (crop) |
| `05b_section_handle_hover.png` | Section knob hover (crop) |
| `05c_grade_place_chart.png` | Grade place 710 m: lane lines, blue place mark, ±70 m long-section with 100 m fit |
| `05d_grade_on_ramp.png` | Grade place on the 9 % ramp ("9.0 % over 100 m"); contours crossing the ramp; pit walls with photo-ground side walls |
| `06_road_confirmed_toast.png` | After Confirm (toast had already faded) — confirmed road on the map |
| `06b_pit_with_road.png` | Pit view with the saved road |
| `07_pit_road_layers_all.png` | Road with Width + Grade layers on |
| `07b_layers_grade_only.png` | Grade layer only |
| `07c_layers_width_only.png` | Width layer only |
| `07d_road_hover.png` | Road hover on the pit (pointer cursor, stronger band) |
| `08_settings_panel.png` | Settings menu (legacy-styled `.casep`) |
| `08b_settings_hover_row.png` | Settings row hover (blue tint) |
| `09_garage_vehicle_picker.png` | Vehicle picker: radial-gradient stage, turning HiLux with eye marker, list, info card with stat bars |
| `09_garage_<ID>.png` (15 files) | Each vehicle model: CAT_789C, CAT_789XD, KOM_HD1500-7, KOM_HD785-7 (water cart), CAT_775F (service), KOM_WA900-8R_HL (loader), CAT_D11T (dozer), KOM_WD900-3 (wheel dozer), CAT_18M (grader), ISUZU, 25T_Crane, HILUX, Landcruiser (LC79), LANDCRUISER_78_SERIES, PRADO |
| `12_ix_step1_prompt.png` | Intersection wizard step 1 "Click the middle of the crossing" |
| `12b_ix_middle_set.png` | Middle placed (blue point), 0.25 m detail patch, "Next" |
| `12c_ix_roads_clicked.png` | Step 2: three roads clicked, chips "A 222 m ✓", 110/185 m speed rings with labels |
| `12d_ix_check_result.png` | Step 3: "Sight distance allows 60 km/h", Road SOP 2 fail, Confirm |
| `12e_ix_wizard_sop_tab.png` | Road (SOP) tab with leader-note labels on the map ("C meets the through road at 83°") |
| `12f_ix_confirmed_toast.png` | Confirmed — action toast "Open it" |
| `13_ix_view.png` | v6 intersection view: bar (back, name, 60 km/h pill, edit, info, + Add), Road SOP card with SIGHT/CROSSING/ROAD SURFACE matrix, Dig/Rings, Cab button, map marks (dashed outlines, red dig wedge, angle arc, road letter discs, ute with shadow) |
| `14_sop_row_hover.png` | SOP row hover (crop) |
| `14b_level25_drilldown.png` | Level 25 m drill-down: road segmented control, silhouette with ute, 5-piece grade strip, cross-section with checked lane band; map zones with % labels and the section handle |
| `14c_level25_strip_piece4.png` | Strip piece 4 selected (crop) |
| `14d_angle_drilldown.png` | (named by step) actually the first SIGHT row selected: inline "Sit in the cab", sight line drawn on the map |
| `15c_cab_lv_cockpit_done.png` | Driver's seat in the HiLux (cab3d), sky, photo ground, delineators, "Truck this way" chip, driving pills + hint |
| `16_cab_lv_look_right.png` | Looking right toward the truck past the B-pillar |
| `16b_cab_lv_sight_fan.png` | Sight fan on (green seen area on the ground), Sight fan pill "on" |
| `16c_cab_binoculars.png` | Binoculars ×4 with frosted eyepieces and "145 m away" caption |
| `16d_cab_lv_playing_0..3.png` | During "Play from the start" (run completes fast under SwiftShader) |
| `16e_cab_lv_run_end.png` | Run end: result pill "Seen from 134 m before the crossing - allows 60 km/h" |
| `17_cab_hv_hd1500_ahead.png` | Komatsu HD1500 cab: deck rails, yellow canopy, pillars, beacon flash on the ute, delineators |
| `17b_cab_hv_look_left.png` | HD1500 looking left into the cab wall/side window |
| `17c_cab_hv_look_right.png` | HD1500 looking right across the deck |
| `18_pit_with_intersection_pin.png` | Pit with the confirmed intersection (look-B tick pin, green zone) |
| `18b_pin_hover.png` | Pin hover: the look-B tick expands into a pill "✓ S49_B6 60 km/h" (crop) |
| `18c_pit_road_and_intersection.png` | Pit with road + intersection |
| `19_report_building.png`, `19b_report_saved.png` | Report control busy state (spinner + "Building") and back at rest/hover after the attempt (the deck failed under SwiftShader — see §12) |
| `19a_audit_saved_menu.png` | Settings menu after "Save audit" ("Saved 04/11/2026, 7:38 am", Recent audits) |
| `30_icon_sheet_all.png` | All 76 extracted icons rendered from `assets/hrl-icons.svg` |
| `31_garage_contact_sheet.png` | Contact sheet of all 15 vehicle models (shows the v5 vs v4 fidelity gap) |

Earlier capture from the brief: `scratchpad/shots/hrl_pit_2.png` (same as `01`).

