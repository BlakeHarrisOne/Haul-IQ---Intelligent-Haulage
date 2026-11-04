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
| | camera never under ground | in `orbitPose`, pitch is raised +.02 rad (≤1.45) until the eye is ≥ 3 m above the survey | `orbitPose` |
| Driver's seat | mouse position (no button) | head look: `yaw = −sign(nx)·(1.6|nx| + 1.54|nx|⁵)` (≈180° at the screen edge), `pitch = −ny·.38` | `@11468514` |
| | drag | `look.yaw −= dx*.004` (±π), `look.pitch += dy*.003` (±.45) | |
| | wheel | zoom 1–8× (`zoomT *= exp(−deltaY*.0018)`) | `@11478765` |
| Keys | Esc | cancel / back to pit / leave cab; Enter next step; Backspace remove last point; Ctrl+Z undo; B binoculars; L sight lines; Q quality (Smooth/Sharp); F fps; ←/→ drive the other vehicle; ↑ look ahead | keydown @11473766+ |
| Road edge (section or map) | drag; arrow keys ±0.1 m (Shift 1 m), applied after a short pause | | road module |

Cursors: map `grab`/`grabbing`; drawing `crosshair` (`body.draw #gl`); handles `grab`; section edges `ew-resize`; clickable marks `pointer`; dragging the target vehicle uses a **custom SVG hand cursor** (white 4.2 px outline under a 1.7 px `#2b2e35` stroke, hotspot 16 16) (`const CUR` @11463946); cursor hidden (`none`) while dragging a vehicle.

Picking: `pickGround` ray-marches the camera ray in 2 m steps against the 1 m pit grid, then 20 bisection steps (`@11494883`). Road ends snap to "running surface": nearest cell within 6 m whose local gradient ≤ 0.2 (`snapPit` @12029712).

<!-- CONTINUE -->
