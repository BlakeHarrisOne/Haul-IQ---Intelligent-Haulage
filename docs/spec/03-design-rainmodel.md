# 03 — Design study: the "Rain Model" game HUD, 3D renderer and tools (what hAIul SIM must beat)

Status: analysis + implementable spec for the Vite + TypeScript + React + Three.js build of **hAIul SIM**.
Source studied: `rainmodel.html` ("Rain Model v1.16.8", single file, 25.8 MB; the code is the first 4,331,965 bytes,
the rest is an embedded calibration PDF that was ignored). Every token, constant and shader below is quoted from that
file; each quote carries its **byte offset** (`grep -boa` on the file) as `@b123456`.

> Offset convention. The brief's offsets (e.g. "2596279 the 3D view") are text offsets after CRLF→LF normalisation and
> UTF-8 decoding; the file has CRLF line endings (42,603 lines) and many multi-byte characters (`·`, `—`, `°`, `³`), so
> byte offsets are 0.04–0.8 % higher. Example: the 3D view's header comment is at text offset 2,596,287 and byte offset
> 2,617,397. Use `grep -boa '<literal>' rainmodel.html` to land on any quote.

Screenshots (headless Chromium + SwiftShader, 1600×900, DPR 1) are listed in §13. SwiftShader shows the shading
without hardware MSAA and at low frame rates, so motion screenshots catch single frames.

---

## 0. Executive summary

Rain Model is a WebGL2, no-library, offline single-page app that shows a Vulcan `.00t` pit surface in 3D, runs a
fill-spill-merge water model hour by hour and plays it back. It is good. Its strengths, in order of what matters to us:

1. **A disciplined HUD design system** — one glass material, one cut-corner shape, one accent, fixed-width figures,
   strict z-layers, a 2.5 s auto-fade with an "at rest" ribbon, and a written rulebook in the CSS header (§2).
2. **A terrain renderer that reads like a survey plot** — a 4-light, matplotlib-calibrated hillshade on a 1 m height
   texture, curvature crest/toe accents, worker-baked horizon AO and soft sun shadows, a hypsometric cream tint, a
   strata-banded skirt, 128 m vertex-less tiles with 5 LODs and skirts (§3).
3. **Weather as light, not decoration** — sky gradient, sun glow, cloud masses and drifting cloud shadows, haze and
   exposure/saturation grading all derived from one `state()` function of the hour's rain and cloud cover (§3.7).
4. **Water that is mostly reflection** — Beer–Lambert body, Fresnel-weighted analytic sky, a height-field ray-march
   that mirrors the pit walls, wind ripples with Beckmann glitter, rain rings, a soft waterline (§3.9).
5. **A camera rig with "no-void" limits**, zoom-to-cursor glide, inertia, log-scale fly-to that keeps screen scale while
   the FOV narrows (3D ⇄ 12° "Top"), and a frame-time governor for render scale (§3.12–3.13).
6. **Playback**: 24 h in 5 s, smoothstep interpolation between whole-hour keyframes, a time bar with rain bars, a
   head + "hour flag", a thin at-rest ribbon, Space/←/→/Home/End (§5).
7. **Plan/Design tools**: click-or-drag line drawing, snap rings with labelled targets, undo history (200 steps,
   500 ms burst coalescing), labelled items with greedy label placement, "dig/rise" animation timelines with terrain
   deformation in 3D, a long section with draggable 0.05 m handles, and an A–B section with 1:1/fit toggle (§6–7).

Its weaknesses (our opening, §10): water-specific everything; no contours, grid, scale bar or north-arrow on the 3D
terrain; plan-view colour ramp hard-coded to RL 265–350; no vertex editing of drawn lines; leader lines disabled; the
design rules have drifted (rounded cluster, dark panels forced into the light theme, three generations of bottom bar);
no equipment, no objects, no POV, no shadows from objects, no screen-space AO/SSR/TAA, SwiftShader-level visuals on
noisy surfaces (diamond artefacts), and a 25 MB single file.

---

## 1. Source map (what lives where)

| Module (browser global) | What | `@b` start |
|---|---|---|
| top `<style>` | the HUD design system + rulebook comment | 194 – 81,750 |
| `RMTin` / vulZ reader | `.00t` parser, max-height rasteriser | 172,086 / 179,934 |
| `RMGeo` | MGA→lat/lon (GRS80), marching squares (mask outlines), Douglas–Peucker, compass8 | 187,776 |
| `RMEngine` | water engine (merge tree, hourly fill-spill-merge) | 268,775 |
| `RMPlan` | Plan core: items, lines, drain grade, `cleanLine`, history | 455,591 |
| `CRPlanGL` | WebGL2 hillshade plan renderer (2D map / fallback) | 729,848 |
| `RMAtmos` | weather-of-the-hour + "AAA pass" GLSL (sky, streaks, cloud shadow, haze, water sky) | 767,031 |
| `RMGL3D` | the 3D renderer (raw WebGL2): terrain, walls, water, lines, points, flow, rain, sky | 798,708 |
| `RM` UI core | the game HUD, time bar, playback, auto-fade, toasts, keys | 2,116,314 |
| `RMPreferences` | Settings (theme, motion, tool names, flow unit) | 2,429,065 |
| `RMMotion` | bounded presentation animations (WAAPI) | 2,441,751 |
| `ui_play` | 2D rain streak overlay + small clock while playing | 2,502,846 |
| `RMCard` | hover / pinned cards, placement | 2,510,365 |
| `RMDesignCloseup` | close-up camera choreography for an accepted design | 2,603,274 |
| `RMMeasurement` | survey measurement + strict section sampling | 2,607,245 |
| `RM3D` (ui_3d.js) | the 3D view: camera rig, limits, governor, picking, layers, bake worker, deformation | 2,617,389 |
| perf readout | Ctrl+Shift+F panel, GPU timer queries | 3,249,213 |
| `RMPlanDraw` | Canvas2D items, snap rings, markers, labels, label placement, timelines | 3,270,939 |
| `RMPlanPicture` | A4 PNG plan picture | 3,340,209 |
| Plan mode | toolbar, drawing, snapping, history, keys, view adapter | 3,423,542 |
| `RMPlanLS` | long section strip with draggable invert handles | 3,875,137 |
| map inspection | Measure + A–B section | 4,089,560 |
| screen layout v3/v4 | left rail, top-centre, pills, compass cluster | 4,118,435 |
| fishing mini-game | an easter egg on the 3D canvas | 4,214,313 / 4,329,835 |

---

## 2. HUD design system

### 2.1 The rulebook (verbatim, `@b201`)

```css
/* Rain Model: the Game HUD (docs/UI_Redesign_Confirmation_v1.html, approved 2026-10-14, binding). The pit fills the
   window; the controls are slim glass. Screen layout v2 (...): top left the compass, then Layers ▾ and Plan View in one
   group; top right only ⋯ (Save ▸ with its fly-out, Wash | Arrows, Settings, About & sources); one bar at the bottom
   (the rain chip with its menu opening upward, Play, the hourly rain, the hour flag, "Not calibrated"); the info panel
   (ui_card.js) pinned at the right edge between them.
   They fade after 2.5 s still (ui.js puts .awake / .awake-top / .awake-bottom on #app); the rain line, the compass, a thin
   rain ribbon with the hour and "Not calibrated" stay.
   One material: smoked glass in dark, frosted in light (blur 16 px, saturate 140 / 160 %, a 6 % / 65 % sheen on the top
   38 %, a 1 px edge); denser glass for panels, menus and cards. One shape: a rectangle with its top-left and bottom-right
   corners cut at 45° (6 px controls, 10 px panels and cards, 4 px switches and key caps); the compass is the one circle.
   No drop shadows. One system sans with fixed-width figures (Segoe UI Variable on the site laptops). One accent, safety
   yellow, for what is selected, held or focused; red for spill and errors; orange for pumps; water blue is data.
   "Solid panels" (Settings) or prefers-reduced-transparency: no blur, the glass at .80 / .84 (html.rm-solid). The glass is
   drawn by ::before (and its edge by ::after) so menus can drop out of their group without being clipped.
   Layers, back to front: 0 the 3D pit · 10 in-world labels · 20 HUD groups, compass, time bar · 30 docked panels
   (profile, Settings) · 40 cards and their leader · 50 menus · 60 hints and help · 70 blocking messages. */
```

Reality check against the tokens: the *Bright* theme (the default since 22 Oct 2026, `THEME_V = 2` in
`RMPreferences` `@b2429073`) replaced safety yellow with **one blue accent `#1f6feb`**, and the dark theme's "accent"
is a **neutral steel grey `#b9c2c7`** (not yellow). The light glass is in practice near-opaque white (`.96`), and the
"6 % / 65 % sheen" is `rgba(255,255,255,0)` in Bright (no sheen) — i.e. Bright is flat white panels with hairlines.

### 2.2 Tokens — Bright (light, default) — verbatim `@b2650`

```css
:root{
  /* Bright (Ben, 21-22 Oct 2026; Reviews/Bright_Theme_Options.html): white panels, thin borders, one blue accent, no yellow */
  --paper:#eef1f4; --sheet:#ffffff; --ink:#16202a; --ink2:#4a5866; --ink3:#6b7785;
  --rule:#c8d1db; --rule2:#dfe5ec;
  --water:#1d5fa8; --water2:#7fb2de; --pump:#c25f0c; --accent:#1f6feb; --alarm:#c2392b; --ok:#2f7d4f;
  --mapbg:#eef1f4; --sel:#e8f0fe;
  --w1:#8cc0e8; --w2:#3f7fc0; --w3:#0b2f6b;
  --f:"Segoe UI Variable Text","Segoe UI Variable","Segoe UI",system-ui,-apple-system,BlinkMacSystemFont,"Helvetica Neue",Arial,sans-serif;
  --fd:"Segoe UI Variable Display","Segoe UI Variable","Segoe UI",system-ui,-apple-system,BlinkMacSystemFont,"Helvetica Neue",Arial,sans-serif;
  --f-cond:var(--f); --f-body:var(--f);
  --f-num:"Segoe UI Variable Text","Segoe UI Variable","Segoe UI",system-ui,-apple-system,BlinkMacSystemFont,"Helvetica Neue",Arial,sans-serif;
  --gut:16px;                                     /* the screen edge inset (10 on a phone) */
  --ctl:40px;                                     /* control height (44 on a phone) */
  --top-h:56px;                                   /* the top groups' bottom (ui.js keeps it up to date) */
  --map-bg:#eef1f4; --map-ink:#4a5866; --map-chip:rgba(255,255,255,.92);
  /* the HUD */
  --ch:6px; --cp:10px; --ck:4px;
  --g-bg:rgba(255,255,255,.96); --g-hi:#ffffff; --g-line:#dfe5ec; --g-line2:#c8d1db; --g-sheen:rgba(255,255,255,0);
  --g-blur:16px; --g-sat:160%;
  --t1:#16202a; --t2:#4a5866; --t3:#6b7785; --y:#1f6feb; --y-ink:#1f6feb; --red:#c2392b; --tbw:#4b98d8; --drain:#1e3a5f;
  --halo:0 0 2px rgba(255,255,255,.95),0 0 10px rgba(255,255,255,.8); --hover:rgba(22,32,42,.05); --press:rgba(22,32,42,.09);
  --e-soft:cubic-bezier(.4,0,.2,1); --e-out:var(--e-soft); --e-in:var(--e-soft); --e-cam:cubic-bezier(.65,0,.35,1);
  --motion-hover:240ms; --motion-panel:420ms;
  --hud:var(--g-bg); --hud2:var(--g-hi); --hl:var(--g-line);   /* the old chrome names, for plug-ins */
  color-scheme:light;
}
```

Bright-only extras `@b~61,000`: `:root:not([data-theme="dark"]){--hi-blue:#1f5fd0;--pos-ink:#1d5fa8}` (hover of a blue
primary button; positive figures). Primary buttons in Bright: `background:var(--y); color:#fff`, hover `--hi-blue`.
Selected list rows: `background:var(--sel); box-shadow:inset 3px 0 0 var(--y); color:#1f4fbf`.

**Control height as shipped is not 40 px.** Two later style blocks in the screen-layout module override it
(`@b4207635`, `@b4209593`): "Approved compact controls" `:root{--ctl:32px}` and then "Ben (21 Oct 2026, #18): every
button at about half its area (sides x0.7: 32 -> 24 px, 36-42 -> 26-30 px); 24 px is the smallest, so each stays easy to
hit; text stays readable (13 px)" → `:root{--ctl:24px}`, pills/rail/Layers/Plan-view buttons `height:24px!important;
font-size:13px!important`, icons 12–14 px, the compass cluster 30 px. The DOM inventory of the running app confirms
24 px (`#layersBtn` 113×24, bottom pills ×24; `rain_study/inventory1.json`). The screenshots therefore show a much
smaller HUD than the 40 px rulebook — see §10 #17.

### 2.3 Tokens — dark ("Original dark") — verbatim `@b4082` (and repeated for `:root[data-theme="dark"]`)

```css
@media (prefers-color-scheme: dark){:root:not([data-theme="light"]){
  --paper:#15191b; --sheet:#1c2124; --ink:#e7eaeb; --ink2:#b3bbbf; --ink3:#939da3;
  --rule:#3a4347; --rule2:#2a3134; --water:#6aa6e0; --water2:#2f5f8f; --pump:#ef8a2e; --alarm:#ef6b5c; --ok:#5fbf86;
  --map-bg:#202528; --map-ink:#b3bbbf; --map-chip:rgba(32,37,40,.88);
  --g-bg:rgba(17,21,24,.6); --g-hi:rgba(20,25,28,.8); --g-line:rgba(255,255,255,.14); --g-line2:rgba(255,255,255,.26); --g-sheen:rgba(255,255,255,.06); --g-sat:140%;
  --t1:#eef1f2; --t2:#b3bcc1; --t3:#939da3; --y-ink:#b9c2c7; --red:#ef6b5c; --tbw:#7cbcf0; --drain:#5b7fb0;
  --halo:0 1px 2px rgba(8,11,13,.85),0 0 10px rgba(8,11,13,.55); --hover:rgba(255,255,255,.07); --press:rgba(255,255,255,.12);
  --accent:#b9c2c7; --y:#b9c2c7; --mapbg:#202528; --sel:rgba(255,255,255,.12);
  color-scheme:dark}}
```

The theme is applied by `RMPreferences.apply()` → `root.setAttribute('data-theme', prefs.theme)` plus
`data-motion="reduced|full"` and `data-tool-names` (`@b2429073`). Canvas code re-reads CSS vars on a
`MutationObserver` of `data-theme` (time bar `TBC = null; drawTrack()` `@b~2336000`; 3D `readLook()` `@b~2629400`,
which also derives `look.dark = r+g+b < 1.5` from `--map-bg`).

Other fixed palettes (not CSS vars):
- Plan drawing `RMPlanDraw.C` `@b~3283000`: `paper #f3f2ef, sheet #fbfbfa, ink #1b2124, ink2 #4b5459, earth #73818a,
  pump #d96b14, pumpInk #b34f08 (4.64:1), red #c4352a, water1 #8cc0e8, water2 #3f7fc0, water3 #0b2f6b,
  waterInk #1d5fa8, accent = dark ? #b5c4ce : #1f6feb`; trench/bund shading `trLit #c1c9ce, trMid #65727a,
  trShade #39434a, bLit #cdd5da, bMid #89969e, bShade #505b63, crest #eef2f4, shadow rgba(22,28,32,0.42)`.
- 3D: `ALARM #c4352a, PUMP #d96b14, WATER #1d5fa8, ACCENT = dark ? #b9c2c7 : #1f6feb` (`@b~2626900`).
- Water depth ramp (2D and 3D): `#8cc0e8` (0 m) → `#3f7fc0` (1.5 m) → `#0b2f6b` (≥3 m), alpha .92.
- Cut/fill marks on terrain (3D, review 18 C): **carved = blue `vec3(0.29,0.51,0.75)`, built = sage `vec3(0.53,0.69,0.53)`**
  multiplied by `(0.55 + 0.75*gray)` so the hillshade survives (`FS_TERRAIN`, §3.3).

### 2.4 The glass material (verbatim `@b10783`)

```css
.gl{position:relative;isolation:isolate;--c:var(--ch)}
.gl::before{content:"";position:absolute;inset:0;z-index:-1;pointer-events:none;
  background:linear-gradient(180deg,var(--g-sheen),transparent 38%),var(--g-bg);
  -webkit-backdrop-filter:blur(var(--g-blur)) saturate(var(--g-sat));backdrop-filter:blur(var(--g-blur)) saturate(var(--g-sat));
  clip-path:polygon(var(--c) 0,100% 0,100% calc(100% - var(--c)),calc(100% - var(--c)) 100%,0 100%,0 var(--c))}
.gl::after{content:"";position:absolute;inset:0;z-index:3;pointer-events:none;background:var(--edge,var(--g-line));--w:1px;
  clip-path:polygon(evenodd,var(--c) 0,100% 0,100% calc(100% - var(--c)),calc(100% - var(--c)) 100%,0 100%,0 var(--c),var(--c) 0,
    calc(var(--c) + var(--w) * .41) var(--w),calc(100% - var(--w)) var(--w),calc(100% - var(--w)) calc(100% - var(--c) - var(--w) * .41),
    calc(100% - var(--c) - var(--w) * .41) calc(100% - var(--w)),var(--w) calc(100% - var(--w)),var(--w) calc(var(--c) + var(--w) * .41),calc(var(--c) + var(--w) * .41) var(--w))}
.gl.p{--c:var(--cp)}
.gl.p::before{background:linear-gradient(180deg,var(--g-sheen),transparent 30%),var(--g-hi)}
html.rm-solid .gl::before,html.rm-solid .rm-glass{-webkit-backdrop-filter:none!important;backdrop-filter:none!important;background:var(--g-hi)!important}
@media (prefers-reduced-transparency: reduce){.gl::before,.rm-glass{-webkit-backdrop-filter:none!important;backdrop-filter:none!important;background:var(--g-hi)!important}}
```

How it works (port as a React `<Glass variant="control|panel">` + one CSS module):
- **Fill** on `::before` (z −1, `isolation:isolate` keeps it under the content): sheen gradient over the top 38 %
  (30 % for denser `.p` panels) on top of `--g-bg` (controls) or `--g-hi` (panels/menus/cards), with
  `backdrop-filter: blur(16px) saturate(160% light | 140% dark)`. The same polygon clip cuts the corners.
- **Edge** on `::after` (z 3, above content): a solid fill of `--edge` (default `--g-line`) clipped with an
  **even-odd double polygon** — outer cut rectangle minus an inner one inset by `--w`. The inner diagonal is offset by
  `w × 0.41` (= tan 22.5°) so the 1 px stroke has constant thickness along the 45° cut. A focused card sets
  `--edge:var(--y);--w:2px` to get a 2 px accent outline that follows the cut (`.rmc:focus-visible::after`).
- Because both layers are pseudo-elements, menus can be absolutely positioned *outside* their group without being
  clipped by the group's own `clip-path`.
- **Solid panels**: `html.rm-solid` (Settings, or set automatically by the 3D frame governor when the GPU is slow,
  §3.13) drops the blur and uses `--g-hi`. **At rest** the faded groups drop their blur too (`.rested`, §2.7) — "a
  still pit costs nothing extra".
- **No drop shadows** anywhere on HUD glass (case dialogs are the exception: `box-shadow:0 12px 40px rgba(16,24,40,.16)`
  in Bright).

### 2.5 The shape: 45° cut corners

- Sizes: `--ch:6px` controls, `--cp:10px` panels/cards/menus, `--ck:4px` switches, key caps, small tags.
- Polygon (top-left and bottom-right cut): `polygon(c 0, 100% 0, 100% calc(100% - c), calc(100% - c) 100%, 0 100%, 0 c)`.
- Group ends: the first/last control of a joined group carries its own clip so hover/press backgrounds never show past
  the corner — `.cut-l{clip-path:polygon(var(--ch) 0,100% 0,100% 100%,0 100%,0 var(--ch))}` /
  `.cut-r{clip-path:polygon(0 0,100% 0,100% calc(100% - var(--ch)),calc(100% - var(--ch)) 100%,0 100%)}` (`@b~12700`).
- Inside a group, controls have **no box**; a 1 px hairline separates them:
  `.isl>.ddwrap+.ddwrap::before, .trow>*+*::before{left:0;top:11px;bottom:11px;width:1px;background:var(--g-line)}`.
- Selected state = a **2 px accent underline inset 12 px** from each side:
  `button[aria-pressed="true"]::after{left:12px;right:12px;bottom:0;height:2px;background:var(--y)}`. Rails use a
  2 px **left** bar (`left:0;top:10px;bottom:10px;width:2px`), menus' checked radio uses a 2 px left bar `top/bottom 8px`.
- The compass is the only circle (52 px, `border-radius:50%`, same glass, `box-shadow:inset 0 0 0 1px var(--g-line)`).
- Drift: the newest compass "cluster" (`@b4192531`) is a **rounded pill** (`border-radius:22px`, buttons 50 %), and
  the A–B/inspector panels force a dark fill `rgba(22,27,30,.94)` even in Bright (overridden later in the Bright block).
  hAIul SIM should not inherit this inconsistency (§10).

### 2.6 Typography

| Use | Spec (verbatim values) |
|---|---|
| Base | `body{font-family:var(--f);font-size:14px;line-height:1.5;font-variant-numeric:tabular-nums}` |
| HUD chrome | `.rm-chrome{color:var(--t1);font-family:var(--f);font-variant-numeric:tabular-nums;-webkit-font-smoothing:antialiased}` |
| Control label | 14px / 500; secondary part `.t2{color:var(--t2);font-weight:450}`; the rain chip's figure 15px / 650 |
| Menu item | 14px / 400, `min-height:36px` (44 px on `pointer:coarse`), padding 0 16px, gap 12 |
| Section head in menus | `11.5px; letter-spacing:.06em; text-transform:uppercase; color:var(--t2)` |
| Helper text | `.why{font-size:12.5px;line-height:1.4;color:var(--t2);max-width:320px}`; footers 12px `--t3` |
| Card title | `.rmc-p{font-family:var(--fd);font-size:22px;font-weight:650;letter-spacing:-.01em;line-height:1}` |
| Card rows | 13.5px; values `dd` 14.5px / 500 right-aligned; sub-notes 11.5px `--t3` |
| Sheet / dialog title | 16–17px / 650 (`.rm-start h2{font-size:17px;font-weight:650;letter-spacing:-.01em}`) |
| Empty state | `--fd` 26px / 600, letter-spacing −.01em |
| In-world labels | 12.5px / 500, `text-shadow:var(--halo)` (white halo in light, dark halo in dark), bold part 650 |
| Hour flag | 13px / 500; icon 15 px stroke 1.6 |
| Canvas text | read from `--f` once per theme change; time-bar day labels `600 11px`; A–B chart `14px Segoe UI` |

Figures are always `tabular-nums` (`.num`, every chrome root and the canvas readouts). Words and figures share one
family (a Oct-20 review dropped Plex Mono for numbers: "the monospace digits read as a different hand", `@b~3283900`).

### 2.7 Layers / z-order

| z | Layer (from rulebook + CSS) |
|---|---|
| 0 | 3D canvas (`.map`, `#gl`, `#ov`) |
| 2–5 | entry background, empty state, map overlays (inspect overlay z 5) |
| 10 | in-world labels (`#pins`) |
| 15 | inspect panel (A–B section) |
| 19 | at-rest items (`.rest`: ribbon, rest line, rest flag) |
| 20 | HUD groups (`.top`), compass, time bar (`.scrub`), `.hud` clock |
| 21–23 | bottom pills (21), tool rail (22), top-middle/top-right (23) |
| 30 | docked panels: Settings / About sheets, `.below` (long section) |
| 40 | cards (`.rmc`, `.rm-overlay`) and leader (39) |
| 50 | menus (`.menu`); a group with an open menu lifts itself: `.top:has(.menu:not([hidden])){z-index:50}` |
| 60 | hints, help tooltips (`.calib .tip`, `.v3hint`, floating Start) |
| 70 | blocking messages: `.banner`, `.rm-toast` |
| 80 | the Start sheet (`.rm-start`) |
| 1190–1250 | modal case pages and their shade, preparation progress, site-data dialog |

An open menu also hides what it would cover (`.rm-under-menu{visibility:hidden!important}`, "ui.js coverUnder").

### 2.8 Auto-fade ("the HUD at rest")

Behaviour (`@b2338780`, CSS `@b42843`):

```js
// After 2.5 s with the pointer still and nothing open, the groups settle: they fade over 0.6 s and slide 6 px toward their
// edge (CSS: .fade-t / .fade-b); the rain line, the compass at 60 %, the ribbon with the hour and "Not calibrated" stay
// (.rest-t / .rest-b). Any pointer move, key or touch brings them back in 0.16 s; a move within 96 px of the top or the
// bottom wakes only that edge. They never settle while a menu, card, the Settings or a profile is open, while drawing,
// while the keyboard is on a control, before a survey is in, on a phone (no mouse to wake them) or with "Keep controls
// visible". Reduced motion: shown and hidden at once (CSS). Settled, the glass's blur is off (.rested).
const REST_MS = 2500, EDGE_PX = 96;
```

```css
.fade{transition:opacity .6s var(--e-out),translate .6s var(--e-out)}
.app:not(.awake):not(.awake-top) .fade-t{opacity:0;translate:0 -6px}
.app:not(.awake):not(.awake-bottom) .fade-b{opacity:0;translate:0 8px}
.app.awake .fade,.app.awake-top .fade-t,.app.awake-bottom .fade-b{transition-duration:var(--motion-panel)}
.app.rested:not(.awake):not(.awake-top) .fade-t.gl::before, ... {-webkit-backdrop-filter:none;backdrop-filter:none}
.app:not(.awake):not(.awake-top) .rest-t,.app:not(.awake):not(.awake-bottom) .rest-b{opacity:1;transition:opacity .6s var(--e-out) .1s}
.app:not(.awake):not(.awake-top) .top .v3compass{opacity:.62;-webkit-backdrop-filter:none;backdrop-filter:none}
```

State machine (port as a `useHudRest()` hook writing classes on the app root):
- `wake(edge)`: `edge ∈ {awake, top, bottom}`; restart a 2.5 s timer. `pointermove` (capture, passive) picks the edge by
  `clientY < 96` / `> innerHeight − 96`; `pointerdown | keydown | touchstart | wheel` wake everything.
- `rest()`: if `hudHeld()` re-check in 400 ms; else clear the edge classes and add `.rested` after 640 ms (0 under
  reduced motion).
- `hudHeld()` = keep-visible setting ‖ no survey ‖ phone/coarse pointer ‖ start sheet open/working/playing ‖ any menu,
  sheet, pinned card, inspector, long section open ‖ any `[aria-expanded="true"]` ‖ a non-core pointer mode (drawing) ‖
  `:focus-visible` inside the HUD.
- The wake transition uses `--motion-panel` (420 ms); the comment's "0.16 s" is stale.
- **Later layout (bottom pills, `@b4145200`)**: the full time bar is folded away and "opens when the pointer reaches the
  bottom edge, while playing or while the rain menu is open" (`.app.rm-bar-open #scrub`, 540 ms in / 360 ms out) — in
  the shipped code it opens on a click of the ⌃ toggle or the hour button and on Play (§5.1); hovering does not open it.

### 2.9 Controls

```css
.chip,.sq,.seg.cam button,.rm-chrome .btn{all:unset;box-sizing:border-box;cursor:pointer;position:relative;height:var(--ctl);display:inline-flex;align-items:center;gap:8px;
  padding:0 14px;font-family:var(--f);font-weight:500;font-size:14px;white-space:nowrap;color:var(--t1);max-width:100%;transition:background-color var(--motion-hover) var(--e-soft),box-shadow var(--motion-hover) var(--e-soft)}
.sq{width:var(--ctl);padding:0;justify-content:center}
.chip:hover,.sq:hover,...{background:var(--hover)}
.chip:active,.sq:active,...{background:var(--press);transition-duration:0ms}
.chip[aria-expanded="true"],.sq[aria-expanded="true"]{background:var(--press)}
.chip:focus-visible,...{outline:none;box-shadow:inset 0 0 0 2px var(--y)}
.chip .caret{width:12px;height:12px;fill:none;stroke:var(--t2);stroke-width:1.6}
.chip .ic{width:18px;height:18px;fill:none;stroke:currentColor;stroke-width:1.6;stroke-linecap:square;stroke-linejoin:miter}
```

- **Global button feedback** (`@b~6000`): hover `box-shadow:inset 0 0 0 1px var(--g-line2)`; active
  `box-shadow:inset 0 2px 5px rgba(0,0,0,.3);filter:brightness(.9);transition-duration:0ms` ("restrained inset").
- **Icons**: 24-unit viewBox, stroke 1.6, `square` caps and `miter` joins on HUD chips (round caps on the rail).
- **Segmented controls** (4 flavours, one look): a 1 px inset hairline box, items separated by 1 px rules, selected
  item = `color:var(--t1)` (+ `background:var(--press)` in dense ones) and the 2 px accent underline:
  - `.rain-menu .per` (24 h · 3 days · 7 days): height 32, underline inset 14 px.
  - `.menu .sw2` (Wash | Arrows): height 26, underline inset 6 px.
  - `.rm-start-seg` (Forecast | Type it in): height 34, `font-weight:600` when checked, underline inset 12 px.
  - `.seg.cam` (3D | Top, retired): `padding:0 13px; color:var(--t2)`.
- **Switch** (`.tg`, cut 4 px): 30×16, `box-shadow:inset 0 0 0 1.5px var(--t3)`; thumb 8×8 square sliding
  `left:4px → 18px` over `--motion-hover`; on = `background:var(--y)`, thumb `#14191c` (dark) / `#fff` (Bright).
- **Checkbox** (`.layers-menu .cb`): 16×16, `inset 0 0 0 1.5px var(--g-line2)`; checked = filled (Bright `--y`,
  dark `#e8ecee`) with an L-tick drawn by borders rotated −45°.
- **Number field in a menu**: 76×30, `box-shadow:inset 0 0 0 1px var(--g-line2)`, 600 weight, right-aligned, focus
  `inset 0 0 0 2px var(--y)`, spin buttons removed, placeholder transparent.
- **Primary action** (`.rm-start-go`): 42 px tall, 650/15px, `background:var(--y)`; Bright text `#fff`; disabled `.45`.

### 2.10 Menus and fly-outs

```css
.menu{position:absolute;z-index:50;top:calc(100% + 8px);left:0;min-width:220px;display:flex;flex-direction:column;padding:6px 0;color:var(--t1);font-family:var(--f);font-size:14px;--c:var(--cp)}
.menu:not([hidden]){animation:rm-drop var(--motion-panel) var(--e-soft) backwards}
@keyframes rm-drop{from{opacity:0;translate:0 -4px}to{opacity:1;translate:none}}
.scrub .rain-menu{top:auto;bottom:calc(100% + 8px);left:0}                 /* menus in the bottom bar open upward */
@keyframes rm-rise{from{opacity:0;translate:0 4px}to{opacity:1;translate:none}}
.menu.fly{top:-6px;left:auto;right:calc(100% + 8px);width:230px;min-width:0} /* Save ▸ fly-out to the side */
@keyframes rm-side{from{opacity:0;translate:4px 0}to{opacity:1;translate:none}}
.menu .sepl{height:1px;background:var(--g-line);margin:6px 16px}
#saveBtn[aria-expanded="true"]::before{content:"";position:absolute;left:0;top:6px;bottom:6px;width:3px;background:var(--y)}
```

- Every menu is `.menu.gl.p` (denser glass, 10 px cut), drops 8 px from its own button, enters with a 4 px slide
  toward the user in the direction it opens (down / up / sideways) over 420 ms.
- From v1.6, a global `@supports (transition-behavior: allow-discrete)` block gives every popup a 540 ms
  `cubic-bezier(.22,.7,.2,1)` fade in and a 360 ms fade out using `@starting-style` and `display … allow-discrete`, with
  `[hidden]{opacity:0;pointer-events:none;interactivity:inert}` (`@b~77000`). Port: a `<Presence>` wrapper or
  Framer Motion with the same timings.
- Rows: `role="menuitemradio"` with a right-aligned value (`b{font-weight:500;color:var(--t2)}`), an inline "Type mm…"
  row (label + 76 px field + unit), helper `.why` paragraphs, a source footer with an ⓘ that shows help on hover and
  pins it on click (but never on hover inside the first-run sheet — it scrolled away under the pointer).
- Layers menu (300 px): uppercase head, rows = checkbox + swatch key + label + right note ("4 items"), an inline
  Wash | Arrows `sw2` beside Flow, an ⓘ per row with an inline help block (`background:var(--sel); box-shadow:inset 2px 0 0 var(--y)`).
- One Esc does one thing: section → menus → cards (documented in ui_3d and RMCard).

### 2.11 Chips, banner, toast, hints, sheets

- **Rain chip** (bottom-left): `<b class="mm">120 mm</b><span class="t2">typed in · 24 h</span>▾`; hides its `.t2`
  part under 600 px.
- **Banner** (`.banner.gl.p`, z 70, top centre under the top row, `width:min(680px, 100% − 2·gut)`): a 3 px
  `--red` bar before the text (`.info` → `--t3`), actions as 40 px boxed buttons ("Try again", "Close") —
  screenshot `01_loaded_rain_sheet.png`.
- **Toast** (`.rm-toast.gl.p`, z 70): `api.toast(text, actionLabel?, onAction?, ms = 8000)`; centred above the time bar
  or the long section; one action button (650 weight, boxed hairline); a new toast replaces the old; Esc closes;
  used for "Drain 1 deleted · Undo" (`@b2354840`).
- **Hint** (`.v3hint`): 12.5px on `--g-hi`, padding 6×12, 6 px cut, top centre under the top row, z 60.
- **Busy tag** (`.busy`): 12.5 px / 500 `--t2` text with halo, no box; "Recalculating water… 1.4 s".
- **Tooltip** (`.calib .tip`): glass, 13 px, `max-width:min(300px, …)`, opens upward on hover/focus.
- **Start sheet** (`.rm-start`): centred 360 px glass dialog, title 17/650, a segmented control, the rain menu embedded
  (`position:static`), a 42 px primary button, close ✕ 32 px at top-right (Esc). After Start a **preparation card**
  ("Working out the water", a 4 px progress bar, "4 of 5") over a `rgba(10,13,15,.24)` shade — `02b_preparing.png`.
- **Settings / About sheets**: `.sheet.gl.p` docked right, `width:392px`, `top: row-h + 8`, bottom above the time bar,
  head 52 px (title 16/650 + 44 px close), groups 12px/600 `--t3`, rows separated by `inset 0 1px 0 var(--g-line)`.
- **Info panel** (layout v2): the selected pond's facts pinned at the right edge under ⋯ and above the time bar
  (`P104  SE · RL 303.7`, Water now, Fullest (when), `Enter ›`).

### 2.12 Motion tokens and rules

- Easing: `--e-soft: cubic-bezier(.4,0,.2,1)` for everything UI; `--e-cam: cubic-bezier(.65,0,.35,1)` (camera, CSS
  side); popups v1.6 `cubic-bezier(.22,.7,.2,1)`. Camera flights in JS use the quintic smootherstep
  `easeIO = t³(t(6t−15)+10)` ("zero velocity and acceleration at both ends").
- Durations: hover 240 ms, panel 420 ms, fade-out of the HUD 600 ms, popups 540/360 ms, card trail 240 ms, toast 8 s.
- `RMMotion` (`@b2441759`) — four bounded WAAPI moves, each continuing from the visible frame if interrupted:
  `reveal` (opacity 0→1, translate 0 −4px→0, 540 ms), `replace` (contents changed: opacity .72→1, 2 px, 360 ms),
  `dismiss` (→ opacity 0, −4 px, 360 ms, element inert immediately), `acknowledge` (a quiet .78 opacity pulse, 360/420 ms).
  "Model changes never wait for an animation."
- Reduced motion everywhere: `prefers-reduced-motion` **or** the app's own `data-motion="reduced"` (Settings: System /
  On / Off) kills transitions and animations, the playback water steps hour by hour, no rain particles, flights become
  cuts, the snap ring stops pulsing, timelines get `dur = 0`.

### 2.13 Responsive

`≤ 900 px`: gutter stays 16. `≤ 600 px` (phone): `--gut:10px; --ctl:44px`, compass 44 px, menus
`min(300px, 100vw − 2·gut)`, the Save fly-out becomes inline, the ribbon/rest items hide, the time bar is 52 px, the
Settings sheet spans the width, the pinned card becomes a bottom sheet (swipe down to close), the HUD never auto-fades.

---
## 3. The 3D renderer (RMGL3D + RMAtmos + RM3D)

### 3.1 Architecture and frame graph

- Raw WebGL2, no library, offline. Context: `getContext('webgl2', { antialias: true, alpha: false, depth: true,
  preserveDrawingBuffer: false })`; extensions `EXT_texture_filter_anisotropic` (4×) and `EXT_color_buffer_float`
  (RG16F mipmaps) (`@b~889300`).
- **Display space** (`COMMON` `@b805211`): `disp(p) = vec3(p.x, (p.z − uZ0) * uVex, −p.y)` with local E/N metres
  (survey centre subtracted, so Float32 is exact), y up. **Display vertical exaggeration `vex = 1.5`**
  (`const vex = () => 1.5;` ui_3d `@b~2769700`); the **shading uses 2.5** (`uShadeVex = 2.5`, the matplotlib
  reference) and the sun term 1.5 — exaggerating normals separately from geometry is a deliberate trick: relief reads
  strongly without distorting the pit.
- **Data as textures**: a 1 m height grid `uZ1` (R32F, −1e4 = off-survey), a gradient map `uGrad` (RG16F, mipmapped,
  anisotropic; built on the GPU by `FS_GRAD` with numpy-style central differences, one-sided at holes), an engine grid
  (2 m) for water/flow, a baked light map `uLight` (RG8: AO, sun visibility), `uMark` (cut/fill), `uMask`/veil (focus).
- **Frame graph** (`draw(V)` `@b962845`):
  1. ground → offscreen colour + depth FBO: terrain tiles (two programs: `terrainIn` *without discards* for tiles
     fully on the survey so early-Z works, `terrain` for edge tiles), survey walls (skirt), section earth;
  2. copy colour + depth to the default framebuffer (`FS_COPY` writes `gl_FragDepth`);
  3. `drawG3Post` — streaks of running water, cloud shadows, haze: **one full-screen pass, premultiplied
     (`ONE, ONE_MINUS_SRC_ALPHA`), reconstructing world position from the depth buffer** (no overdraw);
  4. `drawSky` — only where depth = 1;
  5. water — one full-screen pass that ray-casts the water plane per pixel against the scene depth (or instanced quads
     for Plan's "After" water);
  6. plug-in draw hooks (depth-tested);
  7. blended overlays: section water, flow particles, wash crests/arrows, waterfalls, ribbons (drainage, paths, items,
     drains with chevrons, shorelines, survey edge line, catchment halo), points, the drawing preview (no depth test),
     then rain streaks.

### 3.2 Terrain mesh: vertex-less tiles, 5 LODs, skirts

```js
const TILE = 128, STEPS = [1, 2, 4, 8, 16], FLOW_MAX = 20000;            // @b888172
function buildLods() {                                                    // @b937071
  meshes.lod = STEPS.map(s => {
    const q = TILE / s, n = q + 1, idx = [];
    for (let v = 0; v < q; v++) for (let u = 0; u < q; u++) {
      const a = v * n + u, b = a + 1, c = a + n, d = c + 1;
      idx.push(a, b, d, a, d, c);
    }
    const edge = (e, t) => e === 0 ? t : e === 1 ? t * n + (n - 1) : e === 2 ? (n - 1) * n + t : t * n;
    for (let e = 0; e < 4; e++) for (let t = 0; t < q; t++) {             // skirt quads: edge vertex → its copy below
      const a = edge(e, t), b = edge(e, t + 1), sa = n * n + e * n + t, sb = sa + 1;
      idx.push(a, b, sb, a, sb, sa);
    }
    ...                                                                   // Uint16 index buffer only, no vertex buffer
  });
}
```

```glsl
// VS_TERRAIN @b810906 — the vertex id IS the grid node; heights come from the R32F texture
uniform sampler2D uZ1; uniform ivec2 uTile; uniform int uStep; uniform int uPN; uniform float uZLow;
out vec3 vP; out float vRL; out vec2 vXY; out float vOk;
void main() {
  int id = gl_VertexID, n2 = uPN * uPN;
  ivec2 uv; float drop = 0.0;
  if (id < n2) uv = ivec2(id % uPN, id / uPN);
  else {                                   // skirt: the tile's edge vertices again, hung below the surface
    int k = id - n2, e = k / uPN, t = k % uPN;
    uv = e == 0 ? ivec2(t, 0) : (e == 1 ? ivec2(uPN - 1, t) : (e == 2 ? ivec2(t, uPN - 1) : ivec2(0, t)));
    drop = 1.0;
  }
  ivec2 g = uTile + uv * uStep, gc = clamp(g, ivec2(0), uN1 - 1);
  float z = texelFetch(uZ1, gc, 0).r;
  bool ok = z > -9000.0 && g.x < uN1.x && g.y < uN1.y;
  vOk = ok ? 1.0 : 0.0;
  if (!ok) z = uZLow;
  z -= drop * (1.5 * float(uStep) + 1.0);   // skirt depth grows with the LOD step → no cracks between LODs
  vec2 xy = uG0 + vec2(gc) * uDx1;
  vP = disp(vec3(xy, z)); vRL = z; vXY = xy;
  gl_Position = uVP * vec4(vP, 1.0);
}
```

LOD + culling per frame on the CPU (`pickTiles0` `@b~2786900`): each tile's AABB (with zmin − 18 m for skirts) is
tested against the 8 clip-space corners (all-out on one plane ⇒ culled); the vertex spacing is the **largest of
1/2/4/8/16 m whose screen size stays under `LOD_PX = 4` CSS px per edge**: `want = LOD_PX * dist / K` with
`K = (cssH/2)/tan(fov/2)`. The tile list is cached while the view matrix is unchanged ("a still camera picks the same
tiles"). Edge fragments outside the survey are discarded in the FS (`fullQuad()`), so the model edge is exactly the
outline of whole 1 m quads, where the skirt hangs.

### 3.3 Terrain material (lighting model) — `FS_TERRAIN` `@b811901`

```glsl
void main() {
  if (vOk < 0.999) discard;
  if (clipped(vP)) discard;                                  // section clip plane (uClip)
  vec2 f1 = (vXY - uG0) / uDx1, tc = (f1 + 0.5) / vec2(uN1);
  if (!fullQuad(f1)) discard;                               // the edge is the full quads' outline
  vec2 gr = texture(uGrad, tc).rg;                          // per-PIXEL normal from the mipmapped gradient map
  vec3 n = normalize(vec3(-uShadeVex * gr.x, 1.0, uShadeVex * gr.y));
  vec4 dl = vec4(dot(n, uL[0]), dot(n, uL[1]), dot(n, uL[2]), dot(n, uL[3]));
  // the 2D map's 'clip' model (default) or CentreRoad's per-light min-max stretch of the reference picture
  float hs = uShade == 1 ? dot(uLW, clamp((dl - uImin) / (1.0 - uImin), 0.0, 1.0)) : dot(uLW, clamp(dl, 0.0, 1.0));
  float gray = uShadeOn == 1 ? clamp((hs - 0.15) / 0.85, 0.0, 1.0) : 0.86;   // the Ground shading layer off: flat paper
  float t = clamp((vRL - uRL.x) / max(uRL.y - uRL.x, 1.0), 0.0, 1.0);
  vec3 tint = mix(vec3(0.80, 0.76, 0.69), vec3(0.97, 0.945, 0.89), t);       // hypsometric: warm grey-brown low → cream high
  vec3 rgb = (0.78 * gray * vec3(1.0, 0.985, 0.955) + 0.22 * tint) * uBright;
  // crest / toe accent from the 1 m curvature (half a cell either side) where a metre is still a few pixels wide
  float mpp = length(fwidth(vXY));
  if (mpp < 0.6 && uCurv > 0.0 && uShadeOn == 1) {
    vec2 hx = vec2(0.5 / float(uN1.x), 0.0), hy = vec2(0.0, 0.5 / float(uN1.y));
    float lap = (texture(uGrad, tc + hx).r - texture(uGrad, tc - hx).r + texture(uGrad, tc + hy).g - texture(uGrad, tc - hy).g) / uDx1;
    float crest = smoothstep(0.25, 0.9, -lap), toe = smoothstep(0.25, 0.9, lap);
    rgb *= 1.0 + uCurv * (1.0 - smoothstep(0.35, 0.6, mpp)) * (0.10 * crest - 0.16 * toe);
  }
  rgb = g1Ground(rgb, gray, gr, vXY, tc);                   // drone photo, baked AO + sun shadow, real sun
  vec2 te = ((vXY - uG0) / uDx + 0.5) / vec2(uN);
  vec3 mk = texture(uMark, te).rgb * uMarkA;                 // Plan mode: new fill (r), cut (g, b deeper than 2 m)
  if (uMarkFocus == 1) mk *= step(0.999, texture(uMask, te).r);
  // carved ground blue, built ground sage, over the ground's own shading
  rgb = mix(rgb, vec3(0.29, 0.51, 0.75) * (0.55 + 0.75 * gray), min(1.0, max(mk.g, mk.b) * uMarkStrength.y * (uMarkPresentation == 1 ? 3.0 : 1.0)));
  rgb = mix(rgb, vec3(0.53, 0.69, 0.53) * (0.55 + 0.75 * gray), min(1.0, mk.r * uMarkStrength.x * (uMarkPresentation == 1 ? 3.0 : 1.0)));
  rgb = g2Wet(rgb, vXY);                                     // wet ground where sheet flow runs this hour
  ...                                                        // calibration zones overlay
  if (uHasMask == 1) { float vm = mix(texture(uVeilM0, te).r, texture(uVeilM, te).r, uVeilT); rgb = mix(rgb, uVeil.rgb, uVeil.a * (1.0 - vm)); }
  o = vec4(rgb * uGroundMul * uGrade, 1.0);                  // uGrade = weather exposure/white balance (RMAtmos)
}
```

The 4-light table (CentreRoad / matplotlib `LightSource` reference, `@b888057`) and its vectors (`@b960621`):

```js
// CentreRoad planGL.js LIGHTS: map azimuth, weight, per-light stretch minimum (reference picture); altitude 40
const LIGHTS = [[225, 0.45, -0.756357], [135, 0.20, -0.756315], [315, 0.15, -0.754676], [45, 0.20, -0.755009]];
const lightVec = LIGHTS.map(([az]) => {
  const a = az * Math.PI / 180, al = 40 * Math.PI / 180;
  return [Math.sin(a) * Math.cos(al), Math.sin(al), -Math.cos(a) * Math.cos(al)];
});
```

Why it looks like a survey plot rather than a game: four lights from SW (0.45), SE (0.20), NW (0.15), NE (0.20), all
at 40° altitude, so no face is ever black; `gray = (hs − 0.15)/0.85` stretches mid-tones; only **22 %** of the colour is
the height tint; the curvature term brightens crests by up to 10 % and darkens toes by 16 % only when a metre is
> ~1.7 px on screen (it fades between 0.35 and 0.6 m/px so it never aliases). **Cut/fill** recolouring keeps the
hillshade (`× (0.55 + 0.75·gray)`) — the exact trick we need for dig (blue-ish) / dump (sage/clay) solids.

**Slope tinting**: none. RM never colours by slope (the only slope-driven terms are the 2D contour suppression below
3 % and the running-water sheen past ~35°). hAIul SIM needs a **grade-class overlay** for roads and ramps (e.g. ≤ 8 %
sage, 8–10 % clay, > 10 % rust) computed from the same gradient texture (`|∇z|` along the road tangent for strings,
`|∇z|` for free terrain).

`g1Ground` (`G1_GROUND` `@b~809300`) — the photo, baked light and the real sun:

```glsl
vec3 g1Ground(vec3 rgb, float gray, vec2 gr, vec2 xy, vec2 tc) {
  if (uPhotoOn == 1) {
    vec4 ph = photoAt(xy);
    if (ph.a > 0.5) rgb = mix(rgb, ph.rgb * (0.55 + 0.62 * gray), 0.92);   // the photo, the 1 m relief kept on it
  }
  vec2 li = uLightOn == 1 ? texture(uLight, tc, uShadowBias).rg : vec2(1.0);   // (G3: softer under thin cloud)
  float ao = mix(1.0, li.r, mix(0.55, 0.75, uSunAmt));
  rgb *= ao;
  if (uSunAmt > 0.0) {
    vec3 n = normalize(vec3(-1.5 * gr.x, 1.0, 1.5 * gr.y));        // the ground as drawn (vertical exaggeration 1.5)
    float vis = uLightOn == 1 ? texture(uLight, tc, 1.2 + uShadowBias).g : 1.0;   // shadow a little blurred via LOD bias
    float lam = max(dot(n, uSunDir), 0.0) * mix(1.0, vis, uShadowW);
    vec3 lit = rgb * (vec3(0.70, 0.73, 0.80) + uSunCol * lam * 1.25);   // blue sky fill, warm sun
    rgb = mix(rgb, lit, uSunAmt);
  }
  return rgb;
}
```

- `uSunDir` is the **real sun at the time on screen** (`api.sunAt(T)` from the pit's lat/lon) with a warmer, lower
  colour near the horizon: `col = mix([0.66,0.50,0.34], [0.62,0.55,0.42], clamp((el−3)/22,0,1))`; `uSunAmt` eases at
  1/s toward `clamp((el+0.5)/2.5,0,1)` on dry hours and 0 in rain (`g1SunNow` / `g1SunTarget` `@b~2985700`).
- `uShadowW` fades the baked shadows out as the real sun moves away from the baked one (full within 8°, none past
  30°) and a **rebake** is requested when they differ by > 10° and the time bar rests 800 ms.
- `uShadowBias` (texture LOD bias = `3 × cloud cover`) **softens the shadows under thin cloud** — free penumbra.

### 3.4 Baked ambient occlusion and soft sun shadows (worker, `@b~3002000`)

One persistent Web Worker (source = `g1BakeWorker.toString()` in a Blob URL) keeps a copy of the 1 m heights (sent in
2 M-value slices to avoid a 12–37 ms stall) and its AO; a new sun only re-runs the shadow march.

```js
// ambient occlusion: the horizon in 8 directions out to ~40 m, on every s-th node (2 m), then bilinear to every node
const s = dx < 2 ? 2 : 1, ...;
const RAD = [1, 2, 3, 4, 6, 8, 11, 15, 20, 27, 36].map(r => r / dx), ND = 8;
for each node: sum over 8 dirs of  tm/√(1+tm²)  where tm = max over radii of (zs − z0)·vex/(r·dx);   ao = 1 − sum/8
// the sun's soft shadow: march towards the sun to ~400 m; the least clearance angle over the ground sets the light
const ST = [1.5, 2, 3, 4, 5, 6, 7, 8, 10, 12, 14, 17, 20, 24, 28, 33, 40, 48, 56, 66, 80, 95, 112, 135, 160, 190, 225, 270, 320, 380];
mn = min over steps of (h0 + dd·tanEl − zs·vex)/dd  (early out above the highest ground or below −0.04)
vis = smoothstep(−0.035, +0.035, mn)        // → RG8 texture: r = AO, g = sun visibility
```

Port: identical algorithm in a worker producing a `THREE.DataTexture(RG8)`; sample with `textureLod(..., bias)`.
For hAIul SIM add **object shadows** (trucks, shovels) with a real shadow map — RM has none (§10).

### 3.5 Edge skirts / strata on the model's sides

```glsl
// VS_WALL @b816326 — a skirt of uSkirt (9) metres below the local ground along a smoothed outline
float z = aTop > 0.5 ? aZ : aZ - uSkirt;
vP = disp(vec3(xy, z)); vRL = z; vN = vec3(aNrm.x, 0.0, -aNrm.y); vCol = uCol; vKind = 1.0;
// FS_SOLID @b817264 — lit by one fixed light, with 5 m strata lines that fade out before they alias
if (vKind > 0.5 && vKind < 1.5) {
  float l = length(vN) > 0.1 ? 0.70 + 0.30 * abs(dot(normalize(vN), normalize(vec3(-0.45, 0.35, 0.82)))) : 1.0;
  c *= l;
  float f = vRL / 5.0, fwf = max(fwidth(f), 1e-4), d = abs(fract(f + 0.5) - 0.5) / fwf;
  c = mix(c, c * 0.84, (1.0 - smoothstep(0.5, 1.5, d)) * 0.8 * (1.0 - smoothstep(0.12, 0.35, fwf)));   // 5 m lines, gone before they alias
}
```

`EARTH = [0.60, 0.535, 0.455, 1]` (`@b960692`) — a warm brown skirt, seen in every screenshot as the thin brown
slab edge. The section "earth" (A–B cut face) uses the same `FS_SOLID` with flat triangles.
**Beat it**: RM's skirt is a uniform 9 m brown band with 5 m lines; hAIul SIM should cut the block to a datum and show
real strata (coal seams, overburden) from the dig solids, banded by RL (§11).

### 3.6 Contours

The 3D terrain has **no contour lines** (only the 5 m lines on the skirt). Contours exist only in the 2D `CRPlanGL`
(§4). This is a clear gap to beat: port the CRPlanGL contour maths (§4.2) into our terrain fragment shader.

### 3.7 Sky and atmosphere — RMAtmos (`@b767039`)

One pure function maps the hour's weather to uniforms; tiers switch features off for weaker GPUs:

```js
const TIERS = Object.freeze({
  high:   { name: 'high',   mirror: 12, streak: 1, rings: 2, rainK: 0.6,  rainLum: true,  cloudSh: true,  haze: true,  foamRings: true },
  medium: { name: 'medium', mirror: 6,  streak: 1, rings: 1, rainK: 0.45, rainLum: true,  cloudSh: true,  haze: true,  foamRings: true },
  low:    { name: 'low',    mirror: 0,  streak: 0, rings: 1, rainK: 0.25, rainLum: false, cloudSh: false, haze: false, foamRings: false },
});
// low cloud counts in full, mid at 0.75, high at 0.35 (thin cirrus lets the sun through)
function effCover(c) { ... e = 1 - (1 - low) * (1 - 0.75 * mid) * (1 - 0.35 * high) ... }
const SKY = {
  clear: { zen: [0.36, 0.56, 0.80], hor: [0.86, 0.91, 0.95] },
  over:  { zen: [0.63, 0.67, 0.71], hor: [0.82, 0.84, 0.86] },
  storm: { zen: [0.36, 0.40, 0.45], hor: [0.60, 0.63, 0.66] },
  night: { zen: [0.09, 0.12, 0.20], hor: [0.19, 0.23, 0.32] },
};
function skyColours(eff, storm, daylight, dark) {
  let zen = mix3(SKY.clear.zen, SKY.over.zen, eff), hor = mix3(SKY.clear.hor, SKY.over.hor, eff);
  zen = mix3(zen, SKY.storm.zen, storm); hor = mix3(hor, SKY.storm.hor, storm);
  zen = mix3(SKY.night.zen, zen, daylight); hor = mix3(SKY.night.hor, hor, daylight);
  if (dark) { zen = zen.map(v => v * 0.55); hor = hor.map(v => v * 0.6); }   // dark theme: dimmer so the HUD glass reads
  return { zen, hor };
}
function state(inp) {
  const storm = mm > 0 ? clamp(Math.sqrt(mm / 8), 0, 1) : 0;
  const eff = Math.max(cov ?? 0, mm > 0 ? 0.9 + 0.1 * clamp(mm / 5, 0, 1) : 0);
  const sun = clamp(inp.sunAmt || 0, 0, 1) * Math.pow(1 - eff, 1.3);       // 0 under full overcast
  const expo = 1 - 0.08 * storm - 0.03 * eff;                                // about -0.15 EV at the storm
  const sat = 1 - 0.12 * storm - 0.05 * eff;
  const grade = [expo * (1 - 0.03 * storm), expo * (1 - 0.015 * storm), expo];   // cooler in a storm
  const hazeMax = on3d && tier.haze ? 0.25 * Math.pow(clamp((mm - 4) / 12, 0, 1), 0.7) : 0;   // from 4 mm/h, capped 25 %
  const cloudSh = tier.cloudSh && sun > 0.03 && eff > 0.08 && eff < 0.92
      ? 0.7 * Math.sin(Math.PI * eff) * clamp((inp.sunAmt || 0) * 1.5, 0, 1) : 0;   // peaks at half cover
  const t = inp.time || 0, wind = [t * 6.0, t * 2.2];                        // ~6 m/s from the WSW
  return { storm, eff, sun, sky, expo, sat, grade, haze: [0.6 * vd, vd, hazeMax], hazeCol: sky.hor,
           cloud: [cloudSh, eff, wind[0], wind[1]], shadowBias: 3 * eff, ... };
}
```

Sky pass (`G3_SKY_FS` `@b794617`, drawn only where the depth buffer is empty):

```glsl
void main() {
  if (texelFetch(uDepth, ivec2(gl_FragCoord.xy), 0).r < 0.99999) discard;
  vec2 ndc = gl_FragCoord.xy / uView * 2.0 - 1.0;
  vec3 d = normalize(uF + uR * ndc.x * uTan.x + uU * ndc.y * uTan.y);     // view ray from camera basis + tan(fov/2)
  float sky = smoothstep(-0.04, 0.22, d.y), up = clamp(d.y, 0.0, 1.0);
  vec3 col = mix(uSkyH, uSkyZ, pow(up, 0.6));
  if (uCover > 0.05 && d.y > 0.0) {                  // cloud masses on a plane overhead, drifting
    vec2 uv = d.xz / (d.y + 0.12) * 0.22 + vec2(uTime * 0.0021, uTime * 0.0009);
    float n = textureLod(uG3Tex, uv, 1.0).g * 0.62 + textureLod(uG3Tex, uv * 2.7 + 0.21, 1.0).g * 0.38;
    float c = smoothstep(1.0 - uCover - 0.18, 1.0 - uCover + 0.28, n) * smoothstep(0.0, 0.18, d.y);
    vec3 cloud = mix(uSkyH * 1.04, uSkyZ * 0.82, uStorm);            // fair-weather cloud lighter, storm cloud darker
    col = mix(col, cloud, c * mix(0.35, 0.65, uStorm));
  }
  col += uSkyH * 0.10 * exp(-abs(d.y) * 16.0);       // the brighter band low at the horizon
  vec3 c = mix(uBg, col, sky * uSkyK);               // below the horizon: the theme's map background
  float cs = max(dot(d, uSunDir), 0.0);
  float glow = (pow(cs, 900.0) * 0.9 + pow(cs, 40.0) * 0.35 + pow(cs, 4.0) * 0.22) * smoothstep(-0.02, 0.10, d.y);
  c += vec3(1.0, 0.90, 0.72) * glow * uSunAmt * (uDark == 1 ? 0.8 : 1.0);   // 3-lobe sun disc + halo + glow, no flare
  o = vec4(min(c, vec3(1.0)), 1.0);
}
```

Ground post pass (`G3_POST_FS` `@b781032`), the parts we want — cloud shadows and haze composited once per pixel from
the depth buffer (world position reconstructed from linear depth):

```glsl
float zEye = 2.0 * uNF.x * uNF.y / (uNF.y + uNF.x - (dR * 2.0 - 1.0) * (uNF.y - uNF.x));
vec3 dir = uF + uR * ndc.x * uTan.x + uU * ndc.y * uTan.y, P = uEye + dir * zEye;
float hz = uHaze.z > 0.0 ? uHaze.z * smoothstep(uHaze.x, uHaze.y, length(uEye - P)) : 0.0;   // haze 60 %..100 % of view
float keep = 1.0;
if (uCloud.x > 0.0 && uSunAmt > 0.0) {             // a cloud's shadow takes some of the sun off the ground
  vec2 q = (xy - uCloud.zw) / 1100.0;              // 1.1 km noise tile, scrolled by the wind
  float nz = textureLod(uG3Tex, q, 0.0).g;
  keep = 1.0 - 0.42 * uSunAmt * uCloud.x * smoothstep(1.0 - uCloud.y - 0.10, 1.0 - uCloud.y + 0.10, nz);
}
// ground' = ground x keep x (1 - s) x (1 - hz) + streak x s x (1 - hz) + haze x hz     (premultiplied output)
o = vec4(uStreakCol * strength * (1.0 - hz) + uHazeCol * hz, 1.0 - keep * (1.0 - strength) * (1.0 - hz));
```

The same pass draws **flow-mapped streaks** of running water (`g3Streaks`: a tiling streak texture in the flow's own
frame, 2×2 world cells cross-faded so the frame stays local, two phases half a cycle apart with a per-pixel noise phase
— Valve/Portal 2 flow maps; brightness and width from modelled discharge; a sheen down the fall line past 35°; explicit
LODs `g3Lod = log2(|fwidth(xy)| / W0 * 128)` because the branches diverge). The 128² RGBA "G3 texture" is generated
in JS (`texture()`): R = 22 soft streak columns with periodic dashes, G/B = two tileable gradient-noise fBms (clouds,
per-pixel phase) — one tiny texture feeds clouds, cloud shadows, water-sky clouds and streaks.

**hAIul SIM use**: the same `state()` pattern drives **dust** instead of rain (haze from truck count × road dryness,
`grade` warmer/desaturated in dust), the sky from the shift clock (dawn/day/dusk/night), cloud shadows drifting over
the pit, and the flow-map streak technique to animate **traffic flow on haul roads** (direction = road tangent, speed
= truck speed, brightness = trucks/h).

### 3.8 Rain particles (`VS_RAIN`/`FS_RAIN` `@b883442`)

```glsl
// three nested world-anchored boxes ahead of the eye (near B, mid 3B, far 9B); drops wrap inside their box → parallax
int lay = gl_InstanceID / uPer; float id = float(gl_InstanceID);
if (uStill == 1) lay += 1;                                     // reduced motion: no near layer, fine still streaks
float B = uBox * (lay == 0 ? 1.0 : lay == 1 ? 3.0 : 9.0);
vec3 r = vec3(h1(id * 1.37 + 0.1), h1(id * 2.11 + 7.3), h1(id * 3.07 + 19.7));
vec3 c = uEye + uFwd * B * 0.9;
vec3 vel = uVel * B * (0.85 + 0.3 * h1(id + 5.1));
vec3 p = r * 2.0 * B + vel * (uTime + h1(id + 3.3) * 10.0);   // world-anchored lattice, wrapped round c
p = c - B + mod(p - (c - B), 2.0 * B);
float shutter = uStill == 1 ? 0.018 : lay == 0 ? 0.085 : lay == 1 ? 0.05 : 0.03;   // motion-blur length per layer
vec3 q = p - vel * shutter;                                    // streak = segment p→q, extruded in screen space
... float wpx = (uStill == 1 ? 0.8 : lay == 0 ? 2.3 : lay == 1 ? 1.3 : 0.85) * uDpr;   // width in device px
float edge = 1.0 - smoothstep(0.7, 1.0, length((p - c) / B) / 1.5);
float nearFade = smoothstep(uBox * 0.05, uBox * 0.22, dist);
float fog = exp(-dist / (uFog * uBox));
vA = uAlpha * edge * nearFade * fog * thin * (0.6 + 0.4 * h1(id + 11.0)) * clamp(wpx / uDpr, 0.6, 1.0);
// FS: soft ends; rain shows against dark ground/sky, little against bright benches; lit from behind by a real sun
float along = smoothstep(0.0, 0.35, u) * (1.0 - smoothstep(0.75, 1.0, u)) * 0.85 + 0.15;
if (uLum == 1) { vec3 bg = texelFetch(uScene, ivec2(gl_FragCoord.xy), 0).rgb;
                 k = mix(1.15, 0.6, smoothstep(0.12, 0.85, dot(bg, vec3(0.299, 0.587, 0.114)))); }
k *= 1.0 + 2.2 * uBack * pow(max(dot(normalize(vDir), uSunDir), 0.0), 6.0);
o = vec4(mix(uRainCol, vec3(1.0), 0.25), min(1.0, vA * along * (1.0 - s * s) * k));
```

Parameters (`@b~2989000`): `rainCount = round((reduced ? 3000 : 18000) · k)` with `k = clamp(√(mm/16), 0.12, 1)`, then
× tier `rainK`; `rainBox = clamp(cam.r × 0.07, 18, 380)` m; `rainVel = [0.06, −0.55, 0.035]` (× box per s);
`rainFog = 7`; `rainAlpha = (reduced ? .4 : .8)(.55 + .45k)`; colour dark `[.80,.85,.92]` / light `[.93,.95,.985]`.
The 2D/legacy overlay (`ui_play` `@b2502854`) draws slate streaks 16° off vertical in 4 depth buckets
(`target = cap · min(1, (mm/8)^0.6)`, `cap = clamp(w·h/2400, 110, 420)`). **hAIul SIM**: reuse the instanced
world-anchored box approach for **dust motes behind trucks** and **rain on wet shifts** (which matter for haulage
productivity), with the luminance-aware alpha.

### 3.9 Water rendering (summary + the reusable pieces)

`WATER_LIB` `@b822466`, `G3_WATER` `@b788640`. Per pixel (field pass, full screen): find the ground under the pixel
from depth, look up the engine quad's water level (two 16-bit levels per quad packed in a `uint` texture, mixed with
the playback fraction `uT`), and if the ray meets the level plane in front of the ground, shade water:

- **Body**: Beer–Lambert with a soft onset and roll-off on the *optical path through the water* (from the refracted
  scene depth), red absorbed first: `od = uAbs*(path − uP0*(1−e^(−path/uP0))); od = uOdMax*(1−e^(−od/uOdMax));
  T = exp(−od*vec3(1.25,1.0,0.72)); col = ground*T + g3Body(dep)*uGrade*(1−T)`, `g3Body` = light tint → blue-teal
  (0.8 m) → dark teal (3 m). `WATER_ABS = 1.4`/m.
- **Refraction**: screen-space offset by the ripple normal × depth (none at the very edge to avoid dark lines).
- **Reflection**: an analytic sky (`g3SkyIn`, same colours/clouds as the sky pass) weighted by an "artist's Fresnel"
  `g3Refl(c) = clamp(0.03 + 1.05·(1−c)^2.1, 0, .88)` (stronger than Schlick at mid angles), plus **the pit walls
  mirrored by ray-marching the height field** (`g3Mirror`: 12/6 steps ×1.55/2.2 growth + 4 bisection steps; uses the
  on-screen colour when that point is visible, else re-shades the terrain with the 4 lights) — not SSR, so walls
  off-screen still reflect.
- **Ripples**: a tileable slope map read at 6 m, 2.3 m, 0.9 m, each drifting at deep-water speed `c = √(g·λ/2π)`,
  mip-faded with distance; the variance the mips average away feeds a **Beckmann glitter** term far out; sharp
  `pow(nh,1400)` glints near; twinkle by cell hash.
- **Rain rings**: per cell one drop per period (`1/(rain·cs²)`), ring radius `0.08 + age·0.55`, Gaussian profile; two
  layers (1.6 m and 2.7 m cells); only on standing water and near the eye.
- **Waterline**: ~1.1 px bright line from `depth / (|grad| · m-per-px)`, faded on cm-deep sheets; off by default now.
- **Films** (< 4–10 cm pools) render as darker, slightly more saturated *wet ground* instead of water.
- Selection tint (`uSelTint`), focus greying, haze on water ÷ 3.

hAIul SIM need: sumps and pit-floor ponding after rain (affects ramp/floor trafficability) — reuse the Beer–Lambert body
+ analytic-sky Fresnel; skip the per-quad level machinery (one plane per sump is enough).

### 3.10 Draped ribbons with chevrons — the template for haul strings (`VS_LINE`/`FS_LINE` `@b846731`)

Lines are triangle strips whose **width is in CSS px** (× DPR), extruded in screen space, nudged toward the eye so a
coarse far LOD never hides them, with optional dashes and **chevrons that drift along the line at a set speed**:

```glsl
// VS_LINE
A += normalize(uEye - A) * clamp(length(uEye - A) * uLift, 0.0, 40.0);   // a little towards the eye (lift 0.0015..0.004)
B += normalize(uEye - B) * clamp(length(uEye - B) * uLift, 0.0, 40.0);
vec4 ca = uVP * vec4(A, 1.0), cb = uVP * vec4(B, 1.0);
vec2 sa = ca.xy / max(ca.w, 1e-4) * uView * 0.5, sb = cb.xy / max(cb.w, 1e-4) * uView * 0.5;
vec2 d = sb - sa; float l = length(d); d = l > 1e-4 ? d / l : vec2(1.0, 0.0);
vec2 nrm = vec2(-d.y, d.x);
vec4 p = atB ? cb : ca;
p.xy += nrm * sd * (aW * uDpr * 0.5 + 1.0) / (uView * 0.5) * p.w;          // +1 px for the AA ramp
p.z -= uBias * p.w;
// FS_LINE
float across = vSide * vW * 0.5;                                           // device px from the centre line
float hc = vCore > 0.0 ? vCore * 0.5 : vW * 0.5 - 1.0;
float a = clamp(hc + 0.5 - abs(across), 0.0, 1.0) * vCol.a;               // 1 px analytic AA edge
if (vChev < 0.0) { float mpp = max(fwidth(vDist), 1e-4); if (mod(vDist / mpp, 12.0 * uDpr) > 7.0 * uDpr) discard; }   // 7 on / 5 off
if (uChev == 1 && vChev > 0.0) {                                           // chevrons pointing downstream, drifting
  float mpp = max(fwidth(vDist), 1e-4);
  float ph = fract((vDist - tl * uChevSpeed) / uSpacing);                  // uSpacing default 64 m
  float along = (ph - 0.5) * uSpacing / mpp;
  float hw = 3.6 * uDpr, dch = abs(along + 0.95 * abs(across));
  float ch = (1.0 - smoothstep(0.55 * uDpr, 1.35 * uDpr, dch)) * (1.0 - smoothstep(hw - uDpr, hw, abs(across)));
  c = mix(c, mix(c, vec3(1.0), 0.35), ch * vChev); a = max(a, ch * vChev);
}
```

Layout per vertex: 15 floats (`aA` xyz, `aB` xyz, `aSide` (±1, ±3 = at B), `aW`, `aCol` rgba, `aDist` chainage, `aCore`,
`aChev`). Port to Three: a `LineSegments2`-style instanced quad per segment with this exact VS/FS in a `ShaderMaterial`
(`depthTest:true, depthWrite:false, transparent:true`), chainage attribute for chevrons/dashes. For haul roads:
chevrons = travel direction (loaded vs empty in two colours), `uChevSpeed` = truck speed scaled, dashes = planned
segments, `aW` = road width in px at a reference zoom, or switch to metres when zoomed in (draw the road as a real
draped polygon then).

### 3.11 Points, glows and flow arrows

- `VS_PTS`/`FS_PTS` `@b850515`: kinds 0 disc, 1 **soft glow** sized in metres (`clamp(aSize·uFocal/w, 8, 44)` px) with a
  ring spreading every 2.4 s, 2 **square marker with a dark rim** (pumps). Good for loaders/dump points/queue markers.
- `VS_ARROW` `@b880508`: arrows chosen on the CPU ~84 CSS px apart, each **gliding along its own 8-point downhill
  polyline** (RGBA32F texture row), 13–24 px long by flow, fading in/out over a cycle, still under reduced motion;
  white halo + blue core SDF arrow (`seg()` distances, `fwidth` AA). Template for "truck heading" glyphs on the plan.
- Flow particles: transform-feedback advection on the GPU (`VS_FLOWSTEP`), respawned at random screen points, draped,
  hidden under water by depth.

### 3.12 Camera rig (ui_3d `@b~2768000–2815000`)

Constants: `FOV = 40°, TOP_FOV = 12°, EL_MIN = 8°, EL_MAX = 89°, EL_TOP = 90°, LOD_PX = 4`; start pose
`az 20°, el 42°`. Orbit camera `{C (target), r (distance), az, el, fov}`; basis `f = [sin az·cos el, −sin el,
−cos az·cos el], r = [cos az, 0, sin az], u = r × f`; eye `= C − f·r`. Near plane `clamp(0.3·height-above-highest-ground,
0.5, 4000)`, far `= |eye.xz| + 1.6·radius + |eye.y| + 500` (`computeView`).

Controls: drag = **orbit about the point under the pointer** (with inertia); right-drag or Shift-drag = pan; wheel/pinch
= zoom at the pointer; double-click on water/catchment selects (again = enter; empty space or Home = whole pit); a click
only marks the pivot. Turning/zooming never pauses playback (`[data-keeps-play]`).

```js
// zoom glide: each wheel tick queues ln(scale); every frame takes 1 − e^(−dt/τ) of what is left, about the ground
// point that was under the pointer at its tick (exact zoom-to-cursor); every limit applies per step; at a limit the
// rest of the glide is dropped.
const ZOOM_TAU = 0.115;
const k = 1 - Math.exp(-Math.min(dt, 0.1) / ZOOM_TAU), step = last ? Q.L : Q.L * k;
// inertia after a drag (rotation or pan), frame-rate independent
const k = Math.exp(-dt / 0.32), travel = 0.32 * (1 - k);   // stop when |v| < 0.02 rad/s or < 0.4 % of r per s
// fly-to keeps what the screen shows steady: the half-height in view (r·tan(fov/2)) moves on a LOG scale while the
// field of view narrows (3D → Top: perspective flattens to an almost-plan without a jump in scale)
const ha = a.r * Math.tan(a.fov / 2), hb = b.r * Math.tan(b.fov / 2);
cam.fov = a.fov + (b.fov - a.fov) * e;
cam.r = Math.exp(Math.log(ha) + (Math.log(hb) - Math.log(ha)) * e) / Math.tan(cam.fov / 2);
// azimuth takes the short way round; a new destination inherits the visible flight's velocity, decaying as
// tangent = elapsed·e^(−elapsed/0.09)·(1−p)²   → retargeting mid-flight never hard-stops
```

Durations: Top ⇄ 3D 1100 ms; face north 1000 ms; fly to pond 1000 ms; fly to area 1200 ms (margin 1.3, or 1.05 for a
box); `easeIO` quintic. **Top** = straight down, 12° FOV, the pit's long axis across the screen ("square", the same
heading every time), returns to the last 3D az/el.

Limits (`CAM` `@b~2812500`): `{ TERRAIN: 0.7, EYE_M: 3, ZOOM_OUT: 1.25, CENTRAL: 0.15, EDGE: 0.15, RUBBER: 0.12,
SPRING_S: 0.09, BLANK_MS: 300 }` — the eye stays ≥ 3 m above the highest ground in a 4 m footprint (per-8 m-block max
height map, holes filled from neighbours); tilt never below 8° (20° inside a focused segment); the target stays on the
survey; zoomed out the pit's projected centre stays within 15 % of the free area's centre, zoomed in the view may
overhang the pit by 15 %; **rubber-band** while dragging past a limit, spring back on release (τ 0.09 s); zoom-out stops
at the pit fitted × 1.25; **auto-recover**: 300 ms of a blank frame (eye underground, nothing on the centre ray) flies
back to the whole pit. The "free area" (`safeRect`) excludes the HUD groups, time bar, rail and docked card, and the
fitted framing leaves ~6 % margins.

Compass (`@b2635018`): a 24-unit SVG — thin ring r 8.6 at (12,13.5), N tick + "N" text, split needle (north filled,
south outlined) rotating with `az`; **drag its ring to turn the pit about the view centre**; click = face north
(animated, tilt kept); focused ←/→ turn 15°; tooltip "Click: views · double-click: face north · drag: turn · ← → turn 15°".
The newest layout wraps it in a cluster that slides out "Plan view (Q)" and "Presentation" with `kbd` key caps.

Design close-up choreography (`RMDesignCloseup` `@b2603274`): `TIMING = { zoomIn: 1500, formation: 3000, zoomOut:
1500, hold: 1000 }`, a state machine `zoom-in → forming → zoom-out → hold → done | cancelled` that advances only on
*actual* flight landings (never elapsed-time guesses), skipped under reduced motion; `frame(box, {az, el, fov, width,
height, safe, margin = .10, minDistance = 12})` fits a 3D box inside the unobstructed rectangle by **offsetting the
orbit target** rather than moving panels. Perfect template for "fly to shovel → watch the bench deplete → fly back".

### 3.13 Level of detail, culling and performance tricks

- Tiles: 128 m, 5 vertex spacings by screen size (4 px rule), CPU frustum culling, tile list cached for an unchanged VP.
- Two terrain programs so interior tiles have **no `discard`** (keeps early-Z, perf audit A6).
- **Render-scale governor** (`@b~2770900`): levels `[DPR, 1.5, 1]`; while the camera moves, cap at **4.3 M device
  pixels** and step down when the rolling median of 24 frame intervals > 28 ms or draw > 20 ms; back to full DPR
  **1.2 s** after the camera stops (one resize per gesture); at rest only a measured failure (> 40 ms median) lowers it,
  recovery under 22 ms; "clarity outranks 60 fps once the camera is still".
- **Ambient frame rate**: when only ambient motion moves (ripples, crests, chevrons) render at **30 fps (20 on a slow
  GPU)**; on slow GPUs freeze ambient motion after **30 s** without input.
- **Auto "solid panels"** when the governor stepped down (no `backdrop-filter` cost) — checked every 2 s.
- Gradients on the GPU (no CPU pass over 11 M nodes); region updates (`setZ1Region` + `setGradRegion`) for local edits
  and deformation animation; uploads in bands; heights copied to the bake worker in 2 M slices; one persistent bake
  worker; 1 m grid dropped to 2 m when over `MAX_TEXTURE_SIZE`.
- Weather tiers (high/medium/low): a Quality pick `auto|high|medium|low` (localStorage `rm3d.quality`); in auto
  (`g3Tier` `@b~2992300`) the tier drops to **low** when the governor's rest scale is below full, high → medium after
  700 ms of moving frames over 18.5 ms median, medium → high after 6 s under 14 ms; "a still picture never changes
  tier by itself". Reduced motion disables time-varying effects.
- Perf HUD (Ctrl+Shift+F, `@b3249221`): fps + p50/p95/max interval with a 120-frame sparkline (green < 17 ms, amber
  < 33, red), CPU per frame, **GPU per frame via `EXT_disjoint_timer_query_webgl2`** (Shift+click: per-pass breakdown),
  render scale/governor/tier, tiles/tris/draw calls, long tasks, upload MB/s, GPU memory, "Software WebGL: the GPU is
  not being used" warning, Bench and Record-10 s → JSON.
- Context loss handled; textures freed on fallback; 2D CRPlanGL map as a no-WebGL2 fallback.

### 3.14 Porting the renderer to Three.js (r16x, WebGL2)

| RM piece | Three.js approach |
|---|---|
| R32F height texture + vertex-less tiles | `DataTexture(Float32Array, nx, ny, RedFormat, FloatType)`, `NearestFilter`; one `BufferGeometry` per LOD with an `index` and a dummy `position` (or `gl_VertexID` in a `RawShaderMaterial` with `glslVersion: GLSL3`); one `Mesh` per visible tile sharing geometry, `frustumCulled = false`, own culling + LOD pick per frame (port `pickTiles0`), `uTile/uStep/uPN` as per-mesh uniforms (`onBeforeRender`) or an `InstancedMesh` per LOD with an `instanceTile` attribute |
| Gradient map RG16F mipmapped | `WebGLRenderTarget(nx, ny, { type: HalfFloatType, format: RGFormat, generateMipmaps: true, minFilter: LinearMipmapLinearFilter, anisotropy: 4 })` rendered once by a full-screen `FS_GRAD` quad; region updates via scissor |
| `FS_TERRAIN` | `RawShaderMaterial` (we want full control and no Three lighting); or `MeshStandardMaterial.onBeforeCompile` replacing `#include <normal_fragment_maps>` with the gradient-texture normal and `#include <lights_fragment_end>` with the 4-light hillshade, if we want Three's shadow maps for trucks — recommended: custom material + sample Three's `DirectionalLight` shadow map manually via `#include <shadowmap_pars_fragment>` |
| Baked AO/shadow | Worker → `DataTexture(Uint8Array, nx, ny, RGFormat)` with mipmaps; sample with bias |
| Offscreen ground + copy + post passes | `EffectComposer`/`pmndrs/postprocessing`: a `RenderPass` with a `DepthTexture`, then custom `Effect`s: G3 post (cloud shadow + haze + flow streaks, premultiplied), sky (depth = 1), water (full-screen, reads `inputBuffer` + depth) |
| Ribbons / chevrons | Custom instanced segment geometry + the `VS_LINE`/`FS_LINE` code; `depthWrite:false`, `polygonOffset` or the eye-lift trick |
| Rain/dust | `InstancedBufferGeometry` of 6 vertices, `instanceCount = rainCount`, VS_RAIN verbatim |
| Camera | Our own controller class with RM's maths (do **not** use `OrbitControls`: no zoom-to-cursor glide, no limits, no log-scale FOV flights) |
| Governor | `renderer.setPixelRatio(level)` with the same rolling-median logic; `renderer.info.render` for the perf HUD; `EXT_disjoint_timer_query_webgl2` via `renderer.getContext()` |

---
## 4. Plan view: CRPlanGL hillshade, contours, outlines, labels

### 4.1 The hillshade (`CRPlanGL` `@b729856`, shaders `@b743066`)

A WebGL2 2D renderer for height grids (the 2D map and the fallback). View = `{cx, cy, k (CSS px per m), rot (rad,
CCW), w, h, dpr}`; `screen = R(rot)(world − c)·k`, y up in world, down on screen. Large grids are split into tiles of
`MAX_TEXTURE_SIZE`; **box-filtered LOD levels** (2×, 4×, … up to 8 m cells) are built at upload and **a level is chosen
per draw: the finest whose cell is ≥ 0.7 device px** (`LOD_MIN_PX = 0.7`, `LOD_MAX_DX = 8`).

Per fragment: fetch a 4×4 node stencil (16 `texelFetch`), compute numpy-style normals at the 4 cell corners (one-sided
at nodata), bilinearly blend **normals** (not heights) — so shading is smooth inside cells and exact at nodes — then the
same 4-light model as 3D:

```glsl
vec3 nodeN(int c) {                                  // central differences like numpy.gradient, one-sided at nodata
  float zc = Zs[c];
  bool l = Vs[c - 1], r = Vs[c + 1], d = Vs[c - 4], u = Vs[c + 4];
  float gx = (l && r) ? 0.5 * (Zs[c + 1] - Zs[c - 1]) : (r ? Zs[c + 1] - zc : (l ? zc - Zs[c - 1] : 0.0));
  float gy = (d && u) ? 0.5 * (Zs[c + 4] - Zs[c - 4]) : (u ? Zs[c + 4] - zc : (d ? zc - Zs[c - 4] : 0.0));
  return normalize(vec3(-uVex * gx / uDx, -uVex * gy / uDx, 1.0));
}
...
vec4 dl = vec4(dot(n, uL[0]), dot(n, uL[1]), dot(n, uL[2]), dot(n, uL[3]));
float hsClip = dot(uLW, clamp(dl, 0.0, 1.0));
float hsRef = dot(uLW, clamp((dl - uImin) / (1.0 - uImin), 0.0, 1.0));   // matplotlib LightSource per-light min-max stretch
float hs = uShade == 1 ? hsClip : hsRef;
float g = clamp((hs - 0.15) / 0.85, 0.0, 1.0);    // gray, vmin 0.15, vmax 1
vec3 terr = textureLod(uLut, vec2((clamp((z - 265.0) / 85.0, 0.0, 1.0) * 255.0 + 0.5) / 256.0, 0.5 / 3.0), 0.0).rgb;
vec3 rgb = (0.78 * vec3(g) + 0.22 * terr) * uBright;
```

- Lights: `LIGHTS = [{az 225, w .45, imin −0.756357}, {135, .20, −0.756315}, {315, .15, −0.754676}, {45, .20,
  −0.755009}]`, `ALT = 40`, `vex 2.5`; "the reference picture (matplotlib LightSource, azdeg 315/45/225/135 … on
  origin='lower' data, which mirrors N-S: the effective (map) azimuths are 225/135/315/45)". Default `lights:'screen'`:
  the lights **turn with the view rotation** so a rotated map looks like the north-up reference.
- Colour ramp: matplotlib `terrain` (`[[0,[.2,.2,.6]],[.15,[0,.6,1]],[.25,[0,.8,.4]],[.5,[1,1,.6]],[.75,[.5,.36,.33]],[1,[1,1,1]]]`)
  at 22 % — **hard-coded to RL 265–350** (`(z − 265)/85`): a survey outside that band is flat-coloured. Weakness.
- Tints over the shade (under contours), sampled bilinearly from their own grid: `fill` (dump thickness 0–60 m,
  `#5c2410 → #fdd2b0`, fades in from 0.6 m over 2 m), `diverge` (mined-out minus survey, `#2166ac … #b2182b`, ±10 m,
  fade from 0.1 m over 0.5 m), `water` (depth ramp, shoreline antialiased at half wet weight). The fill/diverge tints
  are re-shaded `× (0.50 + 0.72·hsClip)`. **These two ramps are exactly what a depletion map needs** (dug depth /
  dumped thickness).
- Nodata edge antialiased from the bilinear coverage `m` and its screen derivative; premultiplied output.

### 4.2 Contours (`@b~748900`)

```glsl
float pxCss = fw * uDpr;                             // fw = |∇z| in metres of height per device px (dFdx/dFdy of z)
if (uCon.y > 0.0) {                                  // 5 m major contours
  float d5 = abs(z - 5.0 * round(z / 5.0));
  float sp5 = 5.0 / pxCss;                           // CSS px between 5 m contours
  float c5 = clamp(uCon.w * 0.5 + 0.5 - d5 / fw, 0.0, 1.0) * uCon.y * clamp((sp5 - 1.5) / 2.5, 0.0, 1.0);
  rgb = mix(rgb, INK, c5);
}
if (uCon.x > 0.0) {                                  // 1 m minor contours
  float r1 = round(z); float d1 = abs(z - r1);
  float sp1 = 1.0 / pxCss;                           // fade below ~4 px spacing
  float slope = length(n.xy) / max(n.z, 1e-3) / uVex; // true slope: no 1 m contours on near-flat ground
  float fade = clamp((sp1 - 3.0) / 2.0, 0.0, 1.0) * clamp((slope - 0.03) / 0.05, 0.0, 1.0);
  float minor = abs(r1 - 5.0 * round(r1 / 5.0)) > 0.5 ? 1.0 : 0.0;
  float c1 = clamp(uCon.z * 0.5 + 0.5 - d1 / fw, 0.0, 1.0) * uCon.x * fade * minor;
  rgb = mix(rgb, INK, c1);
}
```

`CONTOUR = { minorAlpha: 0.12, minorWidth: 0.5, majorAlpha: 0.40, majorWidth: 0.75 }` (CSS px), `INK = (0.06,0.07,0.08)`.
Analytic, resolution-independent, self-fading when lines would crowd (< 4 px) and suppressed on near-flat ground
(< 3 % slope) so benches and floors stay clean. **Port verbatim into the 3D terrain shader** (use `fwidth(vRL)`),
add index-contour labels on the CPU from a marching-squares pass (RM does not label contours).

### 4.3 Marching squares, Douglas–Peucker (`RMGeo` `@b187784`)

`marchingSquares(mask, nx, ny)` traces **outlines of a cell mask** (not iso-lines): rings along cell corners, collinear
points dropped, outer rings CCW / holes CW, 4-connected foreground. Used for pond, catchment and selection outlines
(drawn as `'shore'`, `'outline'` ribbons). `simplifyDP(pts, tol)` keeps endpoints. For hAIul SIM, use the same for dig
block / dump lift footprints at each shift step and for "mined so far" outlines.

### 4.4 Label placement (`RMPlanDraw.placeLabels` `@b3327838`)

```js
var DIRS = [[0, -1], [0, 1], [1, 0], [-1, 0], [1, -1], [-1, -1], [1, 1], [-1, 1]];   // up, down, right, left, diagonals
var DISTS = [0.5, 1, 1.6, 2.4, 3.4];
// greedy in the order given: each want tries where it is, (clamped into bounds), then 8 directions × 5 distances
// (dx = DIST·(w/2 + 6), dy = DIST·(h + 6)) and takes the first spot inside bounds, ≥ gap (3 px) from every avoid rect
// and placed label, whose own leader segment crosses no placed label; else ok = false (hide or draw anyway).
```

`layoutItemLabels` feeds it every item's footprint rects as `avoid`, and labels hang from an anchor with a **leader**
(`drawLeader`: 1 px `rgba(27,33,36,0.5)` from the rect's nearest point, none within 4 px); `leadersFirst` draws all
leaders before all boxes so no leader strikes through another label. Map style = plain text on a soft paper halo;
picture style = boxed; selected = ink tag with the accent edge. In-world 3D labels (`.pin`) are DOM elements
projected each frame with a 1 px stem (`--stem`, 55 % opacity), flipped below when needed (`.pin.below`), a 40 px
invisible touch target, and a selected state as an accent-filled cut-corner tag.

---

## 5. Time and playback (→ our shift slider)

### 5.1 The time bar UI

Anatomy (original v2 bar, `@b38802` CSS, `@b2225600` JS): one glass bar `48 px` high across the bottom:
`[rain chip ▾] | [▶ 52 px] | [track: day columns + rain bars + head] | ["Not calibrated"]`, and over the head the
**hour flag**. The newest layout folds it into **three pills** (rain · ▶ + hour "Thu 10:00 ⌃" · ⋯ + New case) and
opens a 32 px, ≤ 640 px wide bar (`.app.rm-bar-open #scrub`) when the ⌃ toggle or the hour button is clicked or when
playback starts (`ext.on('play', p => { if (p && p.on) setBar(true); })` `@b4157383`); it closes 2 s after the pointer
leaves it (hover, a drag or keyboard focus inside keep it), on window blur, in compare mode, and on Esc.

```css
.scrub{position:absolute;left:var(--gut);right:var(--gut);bottom:var(--gut);z-index:20;height:48px;display:flex;align-items:stretch}
.play{width:52px;height:100%;display:grid;place-items:center} .play svg{width:14px;height:14px}
.track{position:relative;flex:1 1 auto;min-width:0;margin:0 14px;touch-action:none;cursor:pointer;outline:none}
.track:focus-visible{box-shadow:0 2px 0 -0 var(--y)}
.tag-now{position:absolute;top:2px;bottom:2px;left:0;width:2px;margin-left:-1px;pointer-events:none}
.tag-now i{position:absolute;inset:0;background:var(--y)}
.tag-now i::before{content:"";position:absolute;left:-4px;top:-1px;width:10px;height:5px;background:var(--y);clip-path:polygon(0 0,100% 0,50% 100%)}   /* the notch */
.flag{position:absolute;bottom:calc(100% + 8px);left:0;height:28px;display:flex;align-items:center;gap:7px;padding:0 10px;font-size:13px;font-weight:500}
.ribbon{left:var(--rib-l,calc(var(--gut) + 300px));right:var(--rib-r,calc(var(--gut) + 134px));bottom:calc(var(--gut) + 2px);height:20px}
.ribbon .base{position:absolute;left:0;right:0;bottom:0;height:1px;background:var(--t3);opacity:.5}
.ribbon .head{position:absolute;bottom:-3px;height:18px;width:2px;margin-left:-1px;background:var(--y)}
```

Track drawing (Canvas2D at DPR, colours read once per theme):
- **Day columns**: a hairline (`--g-line`) at each midnight from y 6 to h−6, the day name "Fri 7" in `600 11px` `--t3`
  at the top-left of its column (and at x 6 for the first partial day if there is ≥ 52 px before the first midnight).
- **Rain bars**: bins of 1 h (3 h when > 72 h); bar height ∝ bin / max(bins, 0.5); gap `max(1, min(bw·0.36, 6))`;
  fill `--tbw`; **played bins at alpha .95, future bins at .38** — progress is shown by the data itself, no fill bar.
- **Head**: 2 px accent line with a 10×5 px downward notch; position `(t + 0.5)/H × W` (bin centre), glides with the
  fractional hour while playing.
- **Hour flag** (glass, 28 px): an icon (a **drop** while it rains, a **sun** when this and the previous hour are dry,
  a **moon** at night), the time "Fri 07:00" (bold) and "20 mm so far" (`--t2`); centred over the head and clamped
  inside the track. Text/icon/ARIA are written once per whole hour; positions use cached layout (perf audit A5: no
  forced layout per frame), re-measured only on resize.
- **At rest**: the bar fades, and a 20 px **ribbon** of the same bars (alpha .9/.38) with a 1 px base line, a 2 px head
  and the time above it stays — the user always knows "when" even with the HUD gone.
- ARIA: `role="slider"`, `aria-valuemin 0`, `aria-valuemax H−1`, `aria-valuenow h`, `aria-valuetext "Fri 07:00"`.

### 5.2 Playback and interpolation

```js
// 24 h in 5 s (3 days in 15 s). The board, labels, numbers and time tag change on each whole hour through setHour; in
// between, on WebGL2, the water is drawn part of the way to the next hour and the time tag glides. Any pointer, wheel or
// key input other than Play / Space pauses; the water then rests on the whole hour. Reduced motion: the water steps.
const HOURS_PER_S = 24 / 5;
function playFrame(ts) {
  const dt = Math.min(0.1, Math.max(0, (ts - PL.last) / 1000)); PL.last = ts;   // dt clamped to 100 ms
  PL.T += dt * (PL.rate > 0 ? PL.rate : HOURS_PER_S);       // play.start({hoursPerS}) overrides the rate
  if (PL.T >= H - 1) { PL.T = H - 1; setHour(H - 1); stopPlay(); return; }
  const h = Math.floor(PL.T), t = PL.T - h;
  if (h !== S.hour) setHour(h);                               // discrete state (labels, cards, numbers) on whole hours
  PL.interp = !reduced && (alt || useGL()) && !S.busy;
  if (PL.interp) moveTag(PL.T);                              // the head glides
  ext.emit('frame', { T: PL.T, h, t, dt, mm, reduced, interp: PL.interp });
  PL.raf = requestAnimationFrame(playFrame);
}
// startPlay: from the current hour (or 0 if at the end); Play button ↔ Pause (two bars) icon; 'play' {on} event
// stopPlay: back to the whole hour (water and tag)
```

3D side (`setT` `@b~2728900`): `h = floor(T)`, `t = T − h`, **`waterT = reduced ? 0 : smoothstep(t)`** where
`smooth = t => t*t*(3-2*t)`; every water level is stored as a pair *(level at h, level at h+1)* per tree leaf in an
RG32F texture and the shader does `mix(from, to, uT)` — keyframes are exact on whole hours, eased in between. Sun
position, sun amount (eased 1/s), rain rate and weather uniforms follow the fractional clock.

Input rules: drag on the track = `setPointerCapture` + **at most one `setHour` per display frame** (a rAF batch with a
50 ms timeout fallback); click jumps; ←/→ step one hour; Home/End on the focused track; **Space toggles play** (not on
buttons/links/menu items); Esc closes menus; keys ignored inside inputs or with modifiers. Any `pointerdown`/`wheel`
outside `#play` and `[data-keeps-play]` (the 3D canvas) pauses. Playing never lets the HUD settle.

### 5.3 What this means for hAIul SIM's shift slider

- Keyframes = **shift stages** (e.g. every 30 min or per production interval) holding exact solved states (dig solid
  depleted volume, dump solid filled volume, truck counts, queue lengths); interpolate continuous quantities with
  `smoothstep(t)` between keyframes, update discrete UI (cards, tables, labels) only on whole keyframes — exactly RM's
  split. For geometry, store per-node *(z at k, z at k+1)* in a 2-channel texture and `mix` in the vertex shader
  (RM's `setZ1Region` + `animateDeform` already morph terrain; we morph by the clock instead of by an edit).
- Track: replace rain bars with **production bars** (bcm or t per interval: dig in one colour, dump in another, or
  stacked by fleet), played at full alpha, future at .38; day columns → **shift columns** (Day/Night, crib breaks and
  shift change as hatched bands, blast windows as red marks); the flag shows "D-shift 10:30 · 12,400 bcm so far" with a
  sun/moon icon from the real sun position (RM already derives sun from lat/lon + time).
- Speeds: RM has one rate (24 h/5 s) plus an API rate; we should offer **0.5× / 1× / 4× / 16×** and "real time" for POV
  driving, and **J/K/L** (shuttle) in addition to Space/←/→/Home/End; Shift+←/→ = one keyframe vs one minute.
- Keep: pause on interaction except camera moves, at-rest ribbon, ARIA slider semantics, reduced-motion stepping.

---

## 6. Drawing tools (Plan / Design mode) — template for the haul-string digitiser

### 6.1 Tools, modes and keys (`@b3423550`, keys `@b3849600`)

- Tool rail (left, vertically centred in the latest layout, 132 px wide; rows 42 px — 24 px after the compact pass —,
  icon + name, 2 px left accent bar when pressed, hairlines between rows; as shipped: Drain, Bund | Undo, Redo | Pump,
  screenshot `26_segment_entered.png`): **Drain D, Bund B, Note N** (Select is the neutral mode; Sump and Pump line
  are legacy, still loadable). Tool names show on focus or always (Settings → "Tool names"). The rail only appears inside
  an entered segment (layout v2: Design is per-catchment).
- **Two ways to draw a line**: *press–drag–release* (the raw path straightened by `RMPlan.cleanLine` at **3.2 screen px**
  tolerance, legs ≥ 5 m) or *click points* (double-click or **Enter** finishes, **Backspace** drops the last point,
  Shift+Enter keeps the tool). After an item is made the tool **lets go** back to Select unless Shift was held or the
  tool was locked by a double-click on it ("P5"). **Right-click finishes** a click-points line with ≥ 2 points (else
  cancels it) — a capture-phase `pointerdown` with `button === 2` (`@b~3833100`); the right button no longer turns
  the camera while drawing.
- While Drain or Bund is on (review 15, `@b~4188300`): a **custom crosshair cursor in the tool's colour** (SVG data URL:
  a 4 px dark under-stroke `rgba(10,13,15,.8)` + 2 px coloured stroke, centre dot r 2.4; drain `#8cc6f2`, bund `#f0f3f4`)
  and a **draw-hint bar** centred above the bottom bar (`.rm-drawhint.gl`, 40 px, 14 px `--t2` with 600-weight key
  names): "**Left-click** add a point · **Right-click** finish · **Backspace** undo a point · **Esc** cancel"
  (screenshot `27_drain_snap_ring.png`).
- The live line (screenshot `28_drain_live_line.png`): numbered vertex dots (1, 2 …, white fill, ink ring), committed
  legs solid in the drain blue, the leg to the pointer dashed with a pale halo band, and a readout chip at the pointer
  "**Drain** · 530 m · falls 4.9 m · open ground → P2"; the start snapped to the pond's diamond marker.
- **Esc**: closes the item detail layer → stops a play → cancels the drawing (and the tool) → clears the selection; a
  right-click without drag outside click-drawing cancels the tool. **Delete/Backspace** removes the selected item (with an
  "Undo" toast); **Ctrl/⌘+Z** undo, **Ctrl/⌘+Shift+Z** or **Ctrl+Y** redo; **A** flips Before/After; tool letters are
  ignored while typing; the rail and Before/After use a roving tabindex with arrow keys.
- Touch: bigger thresholds (`MIN_DRAG` 8 px vs 4, `HIT` 20 px vs 10) and a "Done" chip to finish a click-points line.
- Pointer readout "E 237,231 N 7,050,635 · RL 323.85" at the bottom right (11 px, `--t2`, halo, hidden on coarse
  pointers).

### 6.2 Snapping

```js
const SNAP_PX = 25, LINE_TOL_PX = 3.2, LINE_SNAP_PX = 12;   // v1.4 D2: a drain's or bund's ends snap within 12 px only
```

- Targets are semantic: a drain Start snaps to a pond's **low point** ("P3 low point · RL 323.85"); an Outlet to a sump,
  another pond's nearest wet cell or the **map edge** ("Into Sump 1" · "Into P2" · "Off the map"); radius 25 screen px
  (12 px for line ends), converted to metres with the view's px/m at the cursor.
- **Snap ring** (`drawRing` `@b3321704`): an outer 1 px dark ring `rgba(27,33,36,0.7)` at r + 1.5, a **3 px accent ring
  at r = 13 + 2·sin(2πt/900 ms)** (pulsing; still under reduced motion), a 2.5 px ink dot at the centre, and a label
  chip (white with `#dfe5ec` hairline in Bright, ink in dark; 12 px text, 19 px tall) placed up-right at (+16, −33),
  flipped left/below at the canvas edge. Shown *before* commit, on hover.
- The live line (`lineNow`) is computed exactly as the commit will be (same cleaning, snaps and order) and the live
  readout shows length/depth/fall from the real ground under it; a bund being drawn is tested against water paths and
  crossed paths are highlighted with a ring ("Crosses a water path from 12.4 ha") — an **aiming aid**.
- Screenshots `27_drain_snap_ring.png`, `28_drain_live_line.png`.

### 6.3 Commit, history, undo

- On commit: derive (grade, depth, spoil side) → burn into the ground at once → show cut/fill → animate → re-run the
  model (one request in flight, one waiting, latest wins; replies cached by run key, 24 entries, so undo/redo shows
  instantly).
- History: `RMPlan.History(200)`; every listed change is one step; **stepper and key bursts coalesce into one step after
  500 ms idle**; undo/redo flush pending bursts first; a pin drag is one step on release.
- **No vertex editing on the map**: lines cannot be reshaped by dragging their vertices; the only post-edit handles are
  the invert pins in the long section (§7.1). Our digitiser must beat this (§10).

### 6.4 Item drawing, labels, animation timelines (`RMPlanDraw`)

- Items are drawn in Canvas2D on an overlay over the 3D view through a **view adapter** (`toWorld(x,y)` = ray pick,
  `toScreen(E,N,RL?)` drapes, `pxPerM(E,N)`, `onFrame(fn)`, optional fast `xf()`), so the same drawing/snapping code
  serves the 2D map, the 3D view and the A4 plan picture (Ruling R72). Trench shapes are true screen polygons
  (walls, floor/invert, spoil windrow on its side, red "too deep" stretches, shadows thrown away from a NW light
  `LX,LY = (−0.62,−0.78)`).
- Labels: "Drain 1 · 310 m · 125 m too deep · blocked", "Bund 1 · 120 m · 1.0 m high"; lengths round to 5 m, volumes to
  10 m³; placed with `placeLabels` (§4.4) avoiding every item footprint.
- **Timelines** (`timeline()` `@b3284885`): drain **3000 ms** (86 % spent carving from the Outlet up to the Start, the
  rest a width settle), bund **3000 ms** (ridge grows 0.25 → 1 of base with a **3 % overshoot**
  `overshoot(t) = 1 + 1.9u³ + 0.9u²`, `u = t−1`), sump 500 ms open + 1500 ms water, hose 600 ms then looping dashes,
  water 1500 ms, Before/After flip 600 ms; all 0 under reduced motion. **Soil specks** thrown from the digging head
  (seeded, ≤ 80, one every 30 ms of animation time). ±m³ labels float up 12 px with the overshoot and fade in over the
  first quarter. "Hold to remove" = 1200 ms (not shortened by reduced motion: a safety).
- 3D: `animateDeform(cells, from, to, ms)` eases each 1 m node with its own delay (a drain is dug from Outlet to
  Start: `q = clamp((p − delay·0.7)/0.3)`; drains/bunds `smoothstep(q)`, others ease-out cubic), uploading only the
  changed region of heights + gradients each frame, never overshooting the accepted terrain; the close-up camera (§3.12)
  wraps it. **This is the depletion animation we need for dig/dump solids along the shift.**

---

## 7. Long section and A–B section (→ haul profile and cross-section views)

### 7.1 Long section strip (`RMPlanLS` `@b3875145`)

Layout: the HUD's glass profile panel docked above the time bar (`.below`, z 30), **262 px high (150 px under 600 px;
older strip 170/120)**, two cut corners (10 px), system sans. Head: item name, live numbers (length · depth · fall ·
Dig about · too deep), the warning in red, "Water at Fri 07:00", ×, and "Reset invert to auto" (only with pins). A
cross-section inset at the right end (hidden < 600 px): the V-drain at its deepest station or the bund trapezoid with
dimensions.

Plot contents: ground line and the ground under it (see-through on glass), the cut between ground and invert shaded,
red where too deep / too flat / invert above ground, the pond water at each end (Before at the Start, After at the
Outlet), **fall % per leg under the invert**, RL grid lines, chainage axis (ch 0 = Start on the left), "vertical ×N",
a top band "Start · P3 … Outlet · into P2", a square handle per point (filled = pinned; steel-grey = picked/dragged),
the pre-drag invert as a dashed line while dragging, a hover hairline + ink ring + readout chip
"ch 120 m · ground RL 325.10 · invert RL 322.40 · 2.7 m deep".

Scales (`@b~3893800`):

```js
function frame(P, G, o) {                         // RL range: ground ∪ invert ∪ drawn pond water, min span 3 m
  var span = Math.max(top - lo, 3), mid = (top + lo) / 2;
  if (top - lo < 3) { lo = mid - 1.5; top = mid + 1.5; }
  var pad = o.pad || { t: 6, b: 13 }, sz0 = Math.max(1e-6, ph - pad.b - pad.t) / span;   // px paddings (room for labels)
  lo -= pad.b / sz0; top += pad.t / sz0;
  if (o.keep) { lo = Math.min(lo, o.keep.lo); top = Math.max(top, o.keep.hi); }   // the range only ever grows (no jumps)
  return metrics({ lo, hi: top }, P.len, o.w, o.h, m);   // sx = pw/len, sz = ph/(hi−lo), exag = sz/sx
}
function exagLabel(sz, sx) { var e = sz / sx; return 'vertical ×' + (e >= 2.95 ? String(Math.round(e)) : (Math.round(e * 10) / 10).toFixed(1)); }
function chainTicks(len, sx, minPx) { steps = [1,2,5,10,20,25,50,100,200,250,500,1000,2000,5000]; first step with step·sx ≥ 56 px; labels 'ch 0', '100', … }
function rlTicks(lo, hi, sz, minPx) { steps = [0.25,0.5,1,2,5,10,20,50,100]; first with step·sz ≥ 20 px; decimals 2/1/0 }
```

Independent X and Y fits ⇒ the exaggeration is whatever fills the panel, always labelled.

As captured (`47_long_section_drain.png`, a 535 m drain drawn through `RM.plan.addItem` and opened with
`RM.plan.lsOpen(uid)`): head "**Drain 1** 535 m · 1.0 to 8.5 m deep · falls 2.7 m (0.5%) · Dig about 13,300 m³" + red
"410 m of it deeper than 2.0 m", right "Water at Wed 17:00" and ×; band "Start · P2 … Outlet"; RL ticks every 2 m
("RL 266 … RL 258"), chainage every 25 m ("ch 0, 25, 50 …"), "vertical ×7" at the axis end; the cut between ground and
invert grey where OK and **red where deeper than the red depth**, the invert red there too; square handles at the
three points; fall labels "0.5 %" under each leg; the inset "V-drain at ch 535 m, the deepest · 17.1 m wide at the top ·
8.5 m deep (red) · sides 1 : 1". `ls.debug()` reported `exaggeration 7.09, pxPerM 16.46 (vertical), pxPerMH 2.32
(horizontal), range [256.76, 267.58]`. The strip pushes the 3D view up (the map column ends at its top) and the map
shows the item labels with leaders and a floating "−6,609,278 L" change label. Axis labels fall back to a monospace
face (`F_NUM = "IBM Plex Mono",ui-monospace,…` in this module) — the one place the "one family" rule is broken.
Dragging the middle handle down (`48_long_section_drag_handle.png`): the picked square turns accent with a ring, a
hairline marks its chainage, a dark readout chip (monospace, red underline when too deep) reads "ch 222 m · ground RL
263.28 · invert RL 258.35 · 4.9 m deep", the pre-drag invert stays as a dashed line, the head numbers update live
("1.0 to 10.1 m deep · falls 4.2 m (0.8%) · Dig about 19,910 m³"), per-leg falls become 1.2 % / 0.5 %, "Reset invert to
auto" appears, the band shows the water key "▬ Before · Thu 16:00", and the 3D map shows a red-square "Spill here ·
RL 323.9" marker on the bund. The **bund** variant (`49_long_section_bund.png`): "**Bund 1** 320 m · 1.0 m high · crest
0.5 m wide · Fill about 640 m³ · no water against it", ground and crest lines with the fill between, "1.0 m" height
labels, "Lowest crest RL 322.55 ▼", RL ticks every 0.5 m, chainage every 20 m, "vertical ×10", inset trapezoid
"0.5 m crest · 1.0 m high · 3.5 m base". Bug seen: the RL tick labels are clipped at the strip's left edge ("L 325.5").
In the shipped Design card the same profile appears as a mini chart (`30_drain_done.png`); the full strip is reached
through the item card's "Long section" button where the legacy card is used, or `RM.plan.lsOpen(uid)`.

Handles: drag a square up/down; the pin snaps to the **0.05 m RL grid** inside `RMPlan.pinRange` and inside the RL range
frozen at drag start (so the square stays under the pointer); a press moving < 3 px pins nothing; hit radius 20 px
(40 px target); keys on the focused strip: ←/→ pick a point, ↑/↓ ±0.05 m, Shift+↑/↓ ±0.5 m, Delete/Backspace unpin,
Esc cancels a drag; double-click/tap a filled square to unpin; a 170 ms "pop" (off under reduced motion). Contract:
`onLive(pins, derived, uid)` at most once per animation frame while moving (re-graded drain, no history, no model run),
`onCommit(pins, uid)` once per finished change (release; arrow keys after **500 ms idle** — "twenty taps = one
commit"), `onHover(ch, readout, at)` drives a ring on the map at the hovered station. The plot is
`role="application"` with a polite live region ("Point 2 · invert RL 323.75 · pinned").

### 7.2 Measure and A–B section (`@b4089568`)

- Tools: two chips in the top-left tool group (`[data-inspect="measure"]` ruler, `[data-inspect="profile"]` section);
  the pressed tool shows `background:var(--sel); color:var(--y)`.
- Drawing: "Pick two points on the map"; the line stays drawn on an overlay canvas.
- **Measure** readout (one row in the panel head): Distance, Horizontal, ΔRL, Grade % (`measurePair`: straight line,
  not terrain-following).
- **Section** panel (docked above the bottom bar, beside the rail, `width:min(760px, …)`, 10 px cut): head "Cross
  section · A → B · 412.3 m", Redraw, ×; body = **200 px side column** (Deepest, At, Length; Offset field; Reset;
  `1:1` / `Fit depth` toggle) + a 120 px canvas chart.
- Chart (`drawChart` `@b4108344`): left gutter 62 px, right 16, bottom 28; `fitX = (W−78)/len`, `fitY = (H−48)/(high−low)`;
  **1:1 uses `min(fitX, fitY)` for both axes; Fit depth uses each**; three RL grid lines with labels ≥ 16 px apart;
  "0 m" and "412.3 m" under the axis; a legend "Ground" / "Water" and "Vertical ×N" at the top right; wet segments
  filled (light blue), ground 2 px `#6b7785`, water 2 px `#1d5fa8`; a dashed accent cursor at the hovered station;
  readout "120.0 m · Ground 312.40 RL · Water 314.10 RL · Depth 1.70 m"; ←/→/Home/End step stations.
- **Offset bar**: a dashed bar across end B, ±5 m either side of the drawn line (≥ 80 px on screen), dragged to slide
  the whole A–B line in parallel in **0.1 m** steps (hit 10 px), mirrored by a numeric field with toasts on invalid
  input.
- Sampling (`RMMeasurement` `@b2607253`): 0.5 m step, ≤ 50,000 samples (hard cap 200,000); **missing ground is a gap,
  never interpolated** ("a nonzero-weight missing corner invalidates the interpolation. No renormalization"); sections
  stop at the user's endpoints; max depth is at the section's samples only. In 3D the section also **clips the model**
  with a plane (`uClip`) on the eye's far side and draws the cut face (earth) and water (blue) as flat triangles.

hAIul SIM: the haul profile = RM's long section (chainage × RL, grade % per leg, editable vertical pins snapped to
0.05 m or to a grade, ramps flagged red over max grade, speed/rimpull curve as a second band), the cross-section = RM's
A–B tool plus road width/berm/windrow template overlay and the dig/dump solids cut at the current shift time.

---

## 8. Cards: hover vs pinned, leaders, hierarchy (`RMCard` `@b2510373`, CSS `@b2542305`)

- **Hover card**: one at a time, `pointer-events:none`, never covers the cursor, **trails it** (`left/top` transitions
  240 ms; updates throttled to one per frame), shows instantly, leaves **80 ms** after the pointer leaves the object
  (no flicker across one-cell gaps). Content stops at the essentials and ends with "Click to select".
- Placement (`place` `@b2524987`, `GAP = 16, MARGIN = 8, CUR_W = 14, CUR_H = 22`): try **right** of the cursor (16 px
  out, top 16 px below the tip, slid to fit), then **left**, **below the arrow** (`cy + 22 + 6`), **above**; skip
  candidates that hit `avoid` rects (pinned card, top groups + compass, hour flag, Settings); else the first that fits;
  else clamp ("clamped").
- **Pinned card** (320 px vs 268 px hover): focusable, × (40 px), a **2 px accent "held" edge** along the top (from
  the cut to the right edge), docks at the right edge 16 px in, its top 40 px below the click, pushed clear of HUD
  rects (`dock`), on the left when the object is under the right dock; a phone gets a bottom sheet (72 vh, swipe down).
  A **leader** (1.2 px `--g-line2` path + an accent diamond on the object, re-projected every frame) exists in CSS but
  is **disabled** (`display:none!important`) since layout v2 replaced pinned pond cards with the right-edge info panel.
- Hierarchy: header row = big name (22/650, display face) + a quiet locator ("SE · RL 322.6", 13 px `--t2`); then a
  two-column key/value grid (`dt` `--t2`, `dd` 14.5/500 right-aligned, ellipsis, small sub-lines 11.5 px `--t3`); 1 px
  separators/sections (`margin 11px`); a sentence row for status ("→ Down to 0.3 m by Wed 06:00 (about 600 m³ left)"
  with the key value in a status colour); a full-width action row at the bottom (40 px, hairline on top, "Enter ›").
  Live hour updates edit values **in place** without re-placing the card.
- Kinds are registered (`RMCard.register(kind, {render, key, label, attrs, close, bind, update, onPin, onClose})`) —
  a good pattern for trucks, loaders, dump points, road segments.
- Info panel (selection): title "P104  SE · RL 303.7", Water now, Fullest (when), `Enter ›` into a focused segment
  ("Runs for this segment only, so results come back fast."), `Exit ‹`. As captured inside a segment
  (`26_segment_entered.png`): an uppercase 11.5 px head "SEGMENT", "**P2** W · RL 262.5", key/value rows with hairline
  rules ("Water now 15,686,481 L", "Fullest 30,618,424 L · Thu 16:00" — the flow-unit preference turns m³ into L), two
  boxed buttons "Details" | "Exit ‹". It collapses to one line + buttons when an item card opens under it.
- **Item card** (Design, `30_drain_done.png`): docked under the info panel at the right; a 2 px accent top edge (held),
  a bold title "Drain 1" with ×; a "Depth" stepper (− 1.0 m +, boxed 30 px); a **mini long section** (ground solid
  `#6b7785`, design invert dashed accent, RL ticks 267.6 / 263.8 / 260.0, chainage 0 m – 530.3 m, end handles);
  the consequence sentence "No pond loses water by Thu 16:00, if built before the rain"; a red "🗑 Delete" action.
  The item's **map label "Drain 1" hangs from a leader stem** to the line (leaders survive for Plan labels, not for
  pinned cards).
- **Segment focus in 3D** (`26_segment_entered.png`): the camera flies into the catchment; everything outside it is
  veiled toward white (`uVeil`, cross-faded between lit areas over `VEIL_MS`), the selected water body is tinted solid
  accent blue (`uSelTint`), its marker is an accent diamond with a "P2" chip, and the top centre gains
  "Before | After | Compare" and a "Designs (1 of 1 on) ▾" chip after the first item (`29_drain_dig_animation.png`).

---
## 9. Steal these (the best patterns, ranked by value to hAIul SIM)

1. **One `state(clock)` → uniforms function** for all atmosphere (RMAtmos `state()`): sky zenith/horizon, sun amount
   (× (1−cover)^1.3), exposure −0.15 EV and −12 % saturation in bad weather, haze from 4 mm/h capped at 25 % beyond 60 %
   of the view, cloud-shadow strength `0.7·sin(π·cover)`. Drive ours from the **shift clock + weather + dust**.
2. **4-light matplotlib hillshade + 22 % hypsometric tint + curvature crest/toe accent** with **separate shading
   exaggeration (2.5) from display exaggeration (1.5)** — terrain that reads like an engineer's plot at any zoom.
3. **Cut/fill recolour that keeps the hillshade** (`mix(rgb, col·(0.55+0.75·gray), a)`), blue for carved, sage for built;
   and CRPlanGL's `fill`/`diverge` ramps with fade-in thresholds — ready-made depletion visuals.
4. **Worker-baked horizon AO (8 dirs × 11 radii) + soft sun visibility (30-step march, smoothstep ±0.035)**, softened by
   texture-LOD bias under cloud, rebaked when the real sun moves > 10°, cross-faded by angle.
5. **Vertex-less 128 m tiles × 5 LODs + growing skirts**, CPU culling and a cached tile list; two programs so interior
   tiles avoid `discard`.
6. **Analytic contours with self-fading** (major 5 m / minor 1 m, fade < 4 px spacing, suppressed < 3 % slope) — port
   into 3D (RM never did).
7. **Screen-space-width ribbons with drifting chevrons and dashes** draped with an eye-ward lift — our haul strings,
   travel direction and live traffic.
8. **Camera**: orbit about the point under the pointer, zoom-to-cursor glide (τ 0.115 s), inertia (τ 0.32 s), log-scale
   fly-to that preserves on-screen scale while FOV morphs 40° → 12°, velocity-inheriting retargets, rubber-band limits,
   eye ≥ 3 m above ground, tilt ≥ 8°, auto-recover after 300 ms blank, framing inside the HUD-free rectangle.
9. **Close-up choreography** (zoom-in 1.5 s → formation 3 s → zoom-out 1.5 s → hold 1 s) advanced by real landings, with
   per-node delayed easing of the terrain — reuse for "watch this bench get dug this shift".
10. **Playback split**: discrete UI updates on whole keyframes, continuous `smoothstep` in between via (from, to) texture
    pairs; one rAF clock with dt clamp; pause on any non-camera input; a ribbon that survives HUD fade.
11. **Time bar shows progress with the data** (played bars opaque, future at .38) + a head notch + a flag with icon,
    time and running total; ARIA slider; cached layout (no per-frame reflow).
12. **HUD discipline**: one material, one shape family, one accent, `tabular-nums` everywhere, z-layer table, a written
    rulebook in code; auto-fade after 2.5 s with edge-aware wake (96 px), held while anything is open or focused, blur
    switched off at rest; "solid panels" auto-enabled on slow GPUs; reduced-transparency honoured.
13. **Even-odd `::after` edge with `w·0.41` diagonal offset** — crisp 1 px (or 2 px focus) outlines that follow any
    clipped shape.
14. **Semantic snapping** with a pulsing labelled ring shown *before* commit, radius in screen px; live readout computed
    exactly as the commit will be; an aiming aid that highlights what the line would cross.
15. **Undo burst coalescing (500 ms)**, 200-step history, cached recomputes keyed by state so undo/redo is instant,
    "Deleted · Undo" toast.
16. **View adapter** (`toWorld/toScreen/pxPerM/onFrame`) so one drawing tool works in 2D, 3D and print.
17. **Long-section handle grammar**: 0.05 m grid, Shift = 0.5 m, arrow-key bursts commit after 500 ms, range frozen
    during drag, only grows after, dashed "before" line, live region announcements, `onLive`/`onCommit` split.
18. **Strict section sampling** (gaps are gaps, never invented) and the **1:1 vs Fit-depth** toggle with a labelled
    "Vertical ×N".
19. **Greedy label placement** (8 directions × 5 distances, leader-crossing test, `leadersFirst`) and halo text for
    in-world labels.
20. **Render-scale governor** (4.3 M px cap while moving, back to full DPR 1.2 s after rest, 30 fps ambient) + a built-in
    perf HUD with GPU timer queries and a "software WebGL" warning.

## 10. What to beat (concrete weaknesses and missed opportunities)

1. **Water-only semantics** — no objects at all: no trucks, loaders, dozers, lights, signage, berms, windrows, power
   lines. hAIul SIM must render animated equipment (instanced, LOD'd, with shadows) and an **equipment POV driving
   camera** along routes (RM has none).
2. **No dynamic shadows or object lighting** — only baked terrain AO/sun visibility. Use a cascaded directional shadow map
   for equipment and dump/dig solids; keep RM's baked AO for terrain.
3. **No contours, grid, scale bar or coordinates on the 3D terrain**; the compass is the only orientation aid. Add analytic
   contours (§4.2), an optional 50/100 m MGA grid draped in-shader, a dynamic scale bar (HRL has one), and RL labels on
   index contours.
4. **Plan colour ramp hard-coded to RL 265–350** (`(z − 265)/85` in CRPlanGL) — wrong for most pits. Use the survey's
   actual percentiles (RM's 3D tint uses `zmin..zmax`; do that everywhere, robustly at P2/P98).
5. **Noisy surfaces look bad**: high-frequency survey noise becomes a diamond/argyle pattern under the 2.5× shading
   exaggeration and the curvature accent (screenshots `03`–`06`); the white flow "crest" glyphs read as litter. Add a
   display-only low-pass (bilateral on heights, preserving crests/toes) before gradients, and cap shading exaggeration
   by local roughness.
6. **No vertex editing** of drawn lines (redraw only); no insert/delete vertex, no drag handles on the map, no numeric
   entry of a vertex, no grade-constrained drawing. Our haul-string digitiser must have all of these.
7. **Leader lines disabled** in the current layout; pinned cards no longer point at their subject. Bring leaders back
   (with RM's own crossing-avoidance) for multi-select truck/loader cards.
8. **Design drift**: three generations of bottom bar (48 px bar → 32 px folded bar → pills), rounded cluster vs cut-corner
   rule, dark inspector panels forced then patched for Bright, `!important` everywhere, legacy colour constants in
   canvas modules (`#f3f2ef` paper vs `#eef1f4` map). We ship one token source (TS + CSS vars) consumed by DOM, canvas
   and shaders.
9. **Single 25 MB HTML** with the worker as a string and a PDF inside; slow first paint, no caching, no code splitting.
   Vite chunks + workers + lazy Three modules + KTX2/meshopt assets.
10. **One playback speed** (24 h/5 s) and coarse controls; no loop/range, no bookmarks, no keyframe stepping, no
    J/K/L shuttle, no "real time" mode. Add speeds, loop range, markers (shift change, crib, blast).
11. **No scenario compare in 3D beyond Before|After split/swipe** for one design; we need side-by-side or overlay of N
    scenarios with synced cameras and a diff layer.
12. **Charts are hand-drawn per module** (time bar, A–B chart, pump charts with SVG colours patched by CSS selectors on
    attribute values). Use one charting layer themed by tokens.
13. **Accessibility gaps**: canvas content is mostly `aria-hidden`; good ARIA on the slider and long section, but no
    keyboard path to pick an object in 3D other than Tab through ponds. Provide an object list with roving focus.
14. **No TAA/FXAA beyond MSAA**, no SSAO for objects, no bloom on lights at night, no tone mapping (simple `uGrade`
    multiply). Use ACES/AgX tone mapping, SMAA/TAA, and a night mode with equipment lights.
15. **Dark theme accent is grey** (`#b9c2c7`) — selection and focus become hard to see on dark terrain. Keep a saturated
    accent in dark.
16. **Sections clip the whole model by one plane only**; no ribbon section along a polyline (needed for haul profiles
    that follow the road), no section box.
17. **Controls shrunk to 24 px** (`--ctl:24px`, 13 px text, 12–14 px icons) in the final layout pass: at the WCAG 2.2
    AA minimum target size, hard with gloves or on a site tablet, and visually timid against a full-screen 3D pit. HRL's
    44 px chrome is the better baseline; offer a "Compact" density (32 px) as a setting, never below.
18. **The HUD hides too much**: in the shipped layout the time bar is folded behind a 24 px toggle and only opens on
    hover/play, and the top groups fade — the at-rest screenshots show a bare pit with three tiny pills. Keep the
    shift bar's ribbon and KPIs visible at rest.

## 11. Recommended combined visual direction for hAIul SIM (light + dark)

Goal: family resemblance with **Haul Road Lab** (white 44 px chrome, cards radius 14, `#0A84FF`, sage/rust/clay) plus
Rain Model's **discipline** (one material, tabular figures, strict layers, auto-fade, at-rest ribbon) and a renderer
that exceeds both. Verified HRL tokens (`haulroad.html`, head `<style>` `@b~381` and v6 core `@b11937606`):
`--blue:#0A84FF; --blue-t:rgba(10,132,255,.12); --green:#3E6E50; --green-t:rgba(90,143,110,.14); --red:#9A3B32;
--red-t:rgba(181,86,76,.13); --orange:#9A5A26; --orange-t:rgba(196,122,62,.14); --r:14px;
--ease:cubic-bezier(.23,1,.32,1); --shadow:0 10px 30px rgba(0,0,0,.08),0 1px 2px rgba(0,0,0,.04)`; v6:
`--v6-r-card:14px; --v6-r-ctl:10px; --v6-r-cell:6px; --v6-clay:#B8692E; --v6-green:#3E8A5A; --v6-red:#B5564C;
--v6-shadow:0 6px 20px rgba(20,30,50,.08)`.

### 11.1 Shape and material

- **Shape family (rounded, not cut)**: radius 14 cards/panels/menus, 10 controls, 6 cells/tags, 999 pills and the
  compass. Rationale: matches HRL; RM's cut corners are distinctive but RM itself drifted to rounded pills. Keep RM's
  *rule* ("one family, no exceptions") and its even-odd edge trick for focus rings that follow the radius
  (`outline` with `outline-offset` is enough for rounded shapes).
- **Material**: Light = HRL white glass `rgba(255,255,255,.90)` (controls) / `.94` (panels) with `backdrop-filter:
  blur(16px) saturate(160%)` and HRL's soft two-layer shadow (the only shadow in the system). Dark = RM smoked glass
  `rgba(17,21,24,.62)` / `rgba(20,25,28,.82)` with `saturate(140%)`, `inset 0 1px 0 rgba(255,255,255,.06)` sheen, 1 px
  `rgba(255,255,255,.14)` hairline, **no** drop shadow. Solid fallback (`.solid`) auto-enabled by the frame governor.
- **Control height 44 px** (HRL) on desktop, 48 px coarse; gutters 16 / 10 (phone); group separators = 1 px hairlines
  inset 11 px (RM).

### 11.2 Tokens (proposed; one TS source → CSS vars + shader uniforms)

```css
:root{                                   /* hAIul SIM — Light ("Bright + HRL") */
  --bg:#EEF0F3; --surface:#FFFFFF; --surface-2:#F6F7F9; --glass:rgba(255,255,255,.90); --glass-hi:rgba(255,255,255,.94);
  --hair:#E3E6EB; --hair-2:#EEF0F3; --ink:#1F2329; --ink-2:#4A5059; --ink-3:#646A73;
  --accent:#0A84FF; --accent-ink:#0A5FC4; --accent-t:rgba(10,132,255,.12); --sel:#EEF4FD;
  --sage:#3E8A5A; --sage-ink:#2E6B45; --sage-t:#EDF6F0;      /* producing / on plan / OK          */
  --clay:#B8692E; --clay-ink:#8F5422; --clay-t:#F7EDE3;      /* queueing / waiting / caution      */
  --rust:#B5564C; --rust-ink:#9A3B32; --rust-t:#FBEFED;      /* down / over grade / behind plan   */
  --dig:#2F6FB0; --dump:#A0703C; --coal:#22262B; --haul-loaded:#0A84FF; --haul-empty:#8E949C;
  --halo:0 0 2px rgba(255,255,255,.95),0 0 10px rgba(255,255,255,.8);
  --r-card:14px; --r-ctl:10px; --r-cell:6px; --ctl:44px; --gut:16px;
  --shadow:0 10px 30px rgba(0,0,0,.08),0 1px 2px rgba(0,0,0,.04);
  --blur:16px; --sat:160%; --e:cubic-bezier(.23,1,.32,1); --e-soft:cubic-bezier(.4,0,.2,1);
  --t-hover:240ms; --t-panel:420ms; --t-fade:600ms;
  font-variant-numeric:tabular-nums;
}
:root[data-theme="dark"]{               /* hAIul SIM — Dark ("RM smoked glass + saturated accent") */
  --bg:#15191B; --surface:#1C2124; --surface-2:#22282B; --glass:rgba(17,21,24,.62); --glass-hi:rgba(20,25,28,.82);
  --hair:rgba(255,255,255,.14); --hair-2:rgba(255,255,255,.08); --ink:#EEF1F2; --ink-2:#B3BCC1; --ink-3:#939DA3;
  --accent:#409CFF; --accent-ink:#7DB8FF; --accent-t:rgba(64,156,255,.18); --sel:rgba(64,156,255,.16);
  --sage:#5FBF86; --clay:#E0A060; --rust:#EF6B5C;
  --dig:#6AA6E0; --dump:#D2A26A; --haul-loaded:#409CFF; --haul-empty:#7A828B;
  --halo:0 1px 2px rgba(8,11,13,.85),0 0 10px rgba(8,11,13,.55);
  --shadow:none; --sat:140%;
}
```

Status scheme usage (HRL's sage/rust/clay, RM's "one accent for selection"): blue = selected/held/focused only; sage /
clay / rust = equipment and plan states; dig and dump get their own *data* hues (blue-ish carved, warm built — RM's
review-approved pairing `vec3(0.29,0.51,0.75)` / `vec3(0.53,0.69,0.53)` shifted so built ≠ sage status). Every status
colour has an `-ink` variant ≥ 4.5:1 on its surface (RM's R68 rule: orange fails as small text).

### 11.3 Terrain look (both themes)

- Light: RM's 4-light hillshade, `gray` stretch, a **true-percentile hypsometric tint** at 18–22 % (cool grey-green low
  → warm sand high), contours ink `(0.06,0.07,0.08)` at 12 %/40 %, background `--bg` fading into an RMAtmos sky.
- Dark: the same hillshade ×0.72 with a cooler tint, contours `rgba(255,255,255,.18/.45)`, sky ×0.55 (RM's dark rule),
  **saturated accent kept**.
- Dig solids: translucent `--dig` volume, top face hillshaded, shrinking per keyframe; dump solids: `--dump` lifts
  rising; mined-so-far = CRPlanGL `diverge` blue, dumped-so-far = `fill` ramp; both keep the hillshade.
- Haul strings: RM ribbons, 3 px core + 1 px halo, chevrons drifting at scaled truck speed (loaded `--haul-loaded`,
  return `--haul-empty`), grade violations rust, segments under construction dashed.
- Night shifts: sky to RM's night palette, terrain ×0.35, equipment lights with bloom, tone mapping AgX.
- **Vertical exaggeration**: RM displays at 1.5× (and shades at 2.5×). Keep 1.5× for overview/plan, but the **POV
  driving camera must run at 1.0×** (grades and sight lines must be true); animate `vex` 1.5 → 1.0 during the fly-in to
  POV with RM's log-scale flight (§3.12) so the transition is seamless, and keep shading exaggeration separate.

### 11.4 HUD layout for hAIul SIM (desktop)

- Top-left: compass (44 px circle) · View ▾ (layers) · Plan/3D/POV segmented. Top-centre: scenario name + compare
  toggle. Top-right: ⋯ (Save ▸ fly-out, Settings, About), user.
- Left rail (132 px, RM's): Digitise road · Edit points · Section · Measure · Dig/Dump solids · Fleet.
- Bottom: the **shift bar** (RM time bar grammar, 48 px): scenario chip ▾ | ▶ | shift track (production bars, shift
  columns, crib/blast bands, head + flag "D 10:30 · 12,400 bcm so far") | speed ▾ (0.5×/1×/4×/16×) | KPI pill
  (trucks required, TPH). At rest: a 20 px ribbon + time above the head.
- Right: inspector panel (RM info panel) for the selection; hover cards with RM placement; pinned cards **with leaders**.
- Docked above the shift bar: haul profile (RM long section, 262 px) or cross-section (RM A–B, 200 px side + chart).
- Auto-fade 2.5 s, edge-aware wake, held while editing; "Keep controls visible" setting.

### 11.5 Acceptance bar — "exceeds Rain Model" checklist for the builders

| Area | Rain Model (measured in source) | hAIul SIM must ship |
|---|---|---|
| Terrain shading | 4-light hillshade, curvature accent, baked AO + sun visibility | same + analytic contours in 3D + grade-class overlay + display low-pass for noisy surveys + object shadow maps |
| Model edge | 9 m uniform brown skirt, 5 m lines | cut to a datum with strata/seam bands from the solids, RL tick labels on the skirt |
| Atmosphere | weather `state()`, sky, clouds, cloud shadows, haze, rain | same driven by shift clock + dust + rain; night with equipment lights, bloom, AgX tone mapping, SMAA/TAA |
| Objects | none | instanced trucks/loaders/dozers with LOD, shadows, wheel/bed animation, POV camera at vex 1.0 |
| Camera | orbit-at-pointer, zoom glide τ .115 s, inertia τ .32 s, log-scale FOV flights, no-void limits, compass drag | all of RM's + follow-cam, POV drive, keyframed tours, multi-view compare with synced cameras |
| Playback | 24 h/5 s, smoothstep between hours, Space/←/→/Home/End | 0.5×–16× + real-time, loop range, markers (shift change, crib, blast), J/K/L, keyframe stepping, at-rest ribbon with KPIs |
| Digitiser | click/drag lines, `cleanLine` 3.2 px, semantic snap ring 25/12 px, undo 200 + 500 ms coalescing, no vertex editing | all of RM's + vertex drag/insert/delete, numeric vertex entry, grade-constrained drawing, snap to road ends/ramps/contours/dig faces |
| Profiles | long section with 0.05 m pins, A–B section 1:1/fit, offset bar | haul profile along the string (chainage, grade/leg, speed band), section boxes and polyline sections, solids at shift time |
| HUD | glass, one shape, 24 px controls (shipped), folded time bar, leaders disabled | glass + HRL shape, 44 px controls (32 px compact option), visible shift bar + KPIs, pinned cards with leaders |
| Perf | governor (4.3 M px moving, full DPR at rest), 30 fps ambient, perf HUD | same targets: ≥ 50 fps moving at 1080p on an integrated GPU, ≤ 2 s first frame on a 10 M-node survey, perf HUD with GPU timers |

## 12. Three.js / React port map (summary)

| Concern | Implementation |
|---|---|
| Tokens | `tokens.ts` → CSS vars on `:root`, a `useTokens()` hook for canvas, a `Uniforms` object for shaders; re-read on `data-theme` change (RM's MutationObserver pattern) |
| Glass/shape | `<Glass variant>` with `::before` fill + blur, `::after` edge; `.solid` class; `@supports (transition-behavior: allow-discrete)` + `@starting-style` popups or Framer Motion with 540/360 ms |
| HUD rest | `useHudRest({restMs: 2500, edgePx: 96})` setting `awake/awake-top/awake-bottom/rested` on the app root; `held` computed from a Zustand store of open surfaces |
| Terrain | §3.14; `RawShaderMaterial` GLSL3 ports of `VS_TERRAIN`/`FS_TERRAIN` + contour block; worker AO bake; morph by keyframe pairs |
| Atmosphere | `atmos.ts` = RMAtmos `state()` + `skyColours()` + `texture()` verbatim; postprocessing `Effect`s for sky, haze/cloud-shadow, flow streaks |
| Ribbons | `HaulRibbon` (instanced segments, `VS_LINE`/`FS_LINE`), chainage attribute, chevron speed uniform |
| Camera | `RigController` porting `basis/flyTo/stepZoom/stepInertia/limits/frame()`; React state only for mode; the controller owns the per-frame pose |
| Playback | `useShiftClock()` (rAF, dt clamp 0.1 s, speeds, pause-on-input except `[data-keeps-play]`), emits `{T, k, t, eased}`; discrete store updates on whole keyframes |
| Time bar | Canvas2D track (DPR-aware), cached layout, ARIA slider, ribbon at rest |
| Drawing | view-adapter interface; `cleanLine` (Douglas–Peucker at 3.2 px), snap providers (road ends, ramps, dig faces, dump points, contour crossings) with RM's ring; history with 500 ms coalescing |
| Sections | `RMPlanLS`-style `frame/metrics/chainTicks/rlTicks/exagLabel` helpers verbatim; handles with the same key grammar |
| Cards | `place()`/`dock()` verbatim; registry of card kinds; leaders on an SVG overlay re-projected each frame |
| Perf | governor (pixel ratio levels, 4.3 M cap, 1.2 s rest), ambient 30 fps, perf HUD with `EXT_disjoint_timer_query_webgl2` |


## 13. Screenshot index

Folder: `/tmp/claude-0/-home-user-Haul-IQ---Intelligent-Haulage/6a799533-cbdc-5f2c-b7d8-1a1fb31b2822/scratchpad/rain_study/shots/`
(1600×900, DPR 1, headless Chromium + SwiftShader; scripts `study1.js`–`study4.js` in the parent folder; fixture
`demo_pit_surface.00t`, 120 mm typed in over 24 h, ARR pattern). SwiftShader renders slowly, so motion is caught as
single frames and the HUD has often faded to its rest state. Captures that did not show what was intended were deleted.

| File | Shows | Spec § |
|---|---|---|
| `00_entry_empty.png` | empty state: dashed drop zone, drifting contour background, "Drop a survey (.00t) here", Pick a file | 2.11 |
| `01_loaded_rain_sheet.png` | survey in 3D (before any run); red-bar banner "Couldn't get the forecast…" with Try again / Close; the "Rain for this case" sheet | 2.11 |
| `02_rain_sheet_typed.png` | Start sheet: Forecast \| Type it in segmented, Type mm… field, 24 h · 3 days · 7 days with underline, source footer, Start | 2.9, 2.11 |
| `02b_preparing.png` | the preparation card "Working out the water" (4 px bar, "4 of 5") over the shade; storm sky; water forming | 2.11, 3.7 |
| `03_run_done_storm_sky.png` | first result in a rain hour: grey-blue sky background, rain, water, water paths, wash crests; HUD at rest | 3.7–3.9 |
| `04_scrubbed_hour18.png` | a later hour; the three bottom pills (rain · hour ⌃ · Fullest) and ⋯ | 5.1 |
| `04b_pills_bar_folded.png` | shipped layout: time bar folded behind the ⌃ toggle | 2.8, 5.1 |
| `05_playing_rain.png`, `05b_playing_rain.png` | playback frames (water between hours, rain) | 5.2 |
| `06_hud_rested.png` / `06b_hud_awake.png` | auto-fade: top groups gone at rest / back after a pointer move | 2.8 |
| `07_layers_menu.png` | Layers menu: uppercase head, ticks, Drainage + Details + Density slider, Ground parameters, Pump | 2.10 |
| `09_more_menu_save_flyout.png` | ⋯ menu opening upward (New case, Save ›, Pumping plan, Site data, Settings, About & sources · 1 note) and the Save fly-out (DXF, CSV, Report, Plan picture) | 2.10 |
| `10_plan_view_top.png` | Top / Plan view: 12° FOV, square on the pit | 3.12, 4 |
| `11_dark_theme.png`, `12_dark_layers_menu.png`, `12b_dark_focus_ring.png` | dark theme: `#202528` surround, smoked menus, grey accent focus ring | 2.3 |
| `14_closeup_pond.png` | close-up: water body with sky reflection, crest/toe accents, small-pool film rings | 3.3, 3.9 |
| `15_horizon_sky_gradient.png` | near-horizontal view: analytic sky (dark zenith → bright horizon band) | 3.7 |
| `16_timebar_open.png`, `16z_timebar_zoom2x.png` | the opened time bar: day columns "Wed 4 / Thu 5", played vs future rain bars, head with notch, flag "Thu 10:00 · 85 mm so far" | 5.1 |
| `17_timebar_scrub_drag.png` | scrubbing: head and flag following the drag | 5.2 |
| `22_measure.png` | Measure: A/B markers, drawn line, Distance / Horizontal / ΔRL / Grade | 7.2 |
| `23_section_AB.png` / `24_section_fit_depth.png` | A–B Cross section panel: side column (Deepest, At, Length, Offset, Reset, 1:1 / Fit depth), chart at Vertical ×1.0 and ×2.0, readout line | 7.2 |
| `25_more_menu.png`, `25b_case_menu.png` | ⋯ menu; the rain pill's case menu (Change the rain ›, Case details and assumptions ›) | 2.10 |
| `25d_compass_cluster_opening.png` | the compass cluster sliding open (mid-animation) | 3.12 |
| `26_segment_entered.png` | entered segment: catchment lit and the rest veiled, selected water in solid accent, diamond "P2" marker, SEGMENT info panel, tool rail (Drain, Bund, Undo, Redo, Pump) | 6.1, 8 |
| `27_drain_snap_ring.png` | Drain tool: draw-hint bar, pointer E/N/RL readout, start snapped to the pond marker | 6.1, 6.2 |
| `28_drain_live_line.png` | live line: numbered vertices, dashed leg to the pointer with halo, readout "Drain · 530 m · falls 4.9 m · open ground → P2" | 6.2 |
| `29_drain_dig_animation.png` | after commit: Before \| After \| Compare, "Designs (1 of 1 on)", water re-run | 6.3, 6.4 |
| `30_drain_done.png` | item card: held accent edge, Depth stepper, mini long section, consequence sentence, Delete; map label on a leader | 6.4, 8 |
| `31_bund_live_readout.png` | Bund tool: live line snapped to "P85", readout "Bund · 430 m · 1.0 m high" | 6.2 |
| `36_design_top_view.png`, `37_design_top_dark.png`, `38_design_3d_dark.png` | Design in Top (light/dark) and 3D dark: veil darkens outside the catchment in dark | 3.3, 6 |
| `41_low_angle_rain_layers.png` | low-angle 3D with near/mid/far rain streak layers, water paths, ring glyphs | 3.8 |
| `41b_closeup_wall_rain.png` | close-up of a steep wall with rain streaks and a water edge | 3.3, 3.8 |
| `42_section_clip_3d.png` | 3D section: model clipped by a plane, earth-coloured cut face, depth label "2.4 m", survey edge line at the skirt foot | 3.5, 7.2 |
| `43_storm_override_rain_streaks.png` | `RM3D.setWeather({rain:14, overcast:1})`: storm light and rain | 3.7, 3.8 |
| `44_perf_hud.png` | perf readout (Ctrl+Shift+F): fps + sparkline, CPU/GPU, scale/governor/tier, tiles/tris/draws, long tasks, memory, red "Software WebGL" warning, Bench / Record 10 s / Save | 3.13 |
| `45_dark_rain_streaks.png` | dark theme with luminance-aware rain showing against the dark surround | 3.8 |
| `46_design_items_3d.png` | a drain and a bund added through `RM.plan.addItem`; "Recalculating water… 18.1 s" busy tag | 6.3 |
| `47_long_section_drain.png` | full long section strip for the drain (head figures, red too-deep cut, handles, per-leg falls, "vertical ×7", V-drain inset) | 7.1 |
| `48_long_section_drag_handle.png`, `48b_long_section_pinned.png` | dragging an invert handle: accent square, readout chip, dashed pre-drag invert, Reset invert to auto, live figures, Bund card, "Spill here" marker | 7.1 |
| `49_long_section_bund.png` | bund long section: crest vs ground, "Lowest crest RL 322.55", trapezoid inset, "vertical ×10" (RL labels clipped at the left edge) | 7.1 |

Not captured, in the time available: the hover card and the pinned/selected pond info panel on the whole-pit view
(clicks only set the orbit pivot in this build, and the hover card never appeared under SwiftShader), the Settings and
About sheets, the Presentation mode, and a sunny dry hour (the case rained through its last hour). These are specified
from source in §2.11, §8 and §3.3.
