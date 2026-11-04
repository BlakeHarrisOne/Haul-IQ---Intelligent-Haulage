# 01 — Spreadsheet calculations (calc.xlsm) — reverse-engineering spec

Status: verified against cached values · Source: `calc.xlsm` ("Haulage Calculator Spreadsheet (Short Term Planning)", author Blake Harris) · Extracted 2026-11-04

This document specifies exactly what the user's Excel haulage calculator computes, so hAIul SIM can reproduce it in a **Spreadsheet-compatible mode** and then improve on it. Every formula below was read from the workbook XML/openpyxl and every number was checked against Excel's cached values (see §15).

Machine-readable companions (all in `docs/spec/fixtures/`):

| File | Contents |
|---|---|
| `spreadsheet-active-route.json` | Current Data Dump string (117 points, `[easting, northing, rl]`), every ActiveRoute input, 116 per-segment Travel Time rows, cached outputs C4…C28, derived macro-button table |
| `spreadsheet-tables.json` | Speed tables, EX assumptions, truck loads, densities, Transcale data, swell, fleet notes, dropdown lists |
| `spreadsheet-targets-crew.json` | Weekly plan per circuit, daily totals, both crew blocks cell-by-cell, static crew allocation, **proposed crew rule-set JSON + 14 test scenarios**, equipment register |
| `raw-data-strings.json` | All 23 haul strings in Raw Data as named options, plus derived spreadsheet-mode travel times |
| `verify_spreadsheet.py` | Independent re-implementation + checker (`python3 -I verify_spreadsheet.py [--workbook calc.xlsm]`) |

---

## 1. Workbook inventory and data flow

| # | Sheet | Visible | XML | VBA codename | Formulas | Role |
|---|---|---|---|---|---|---|
| 1 | How To Guide | yes | sheet1 | Sheet6 | 0 | 9-step user workflow (text only) |
| 2 | Data Dump | yes | sheet2 | Sheet1 | 0 | **Input**: the haul string being analysed (A2:C…), pasted by the user |
| 3 | Raw Data | yes | sheet3 | Sheet2 | 0 | Rolling history of Deswik/Vulcan string exports (23 named options) |
| 4 | Travel Time | yes | sheet4 | Sheet3 | 26 627 | Per-segment distance/grade/speed/time, loaded and return legs |
| 5 | ActiveRoute | yes (active tab) | sheet5 | Sheet5 | 68 | **Main calculator**: cycle time, productivity, trucks required, buttons 1–9 |
| 6 | TABLE | **hidden** | sheet6 | Sheet4 | 12 | Static "compare haulage scenarios" table of pasted values |
| 7 | Targets & Haulage Priorities | yes | sheet7 | – | 398 | Weekly "Perfect Day" targets per circuit + crew/manning blocks |
| 8 | Equipment | yes | sheet8 | – | 0 | Fleet register by month 2025-01…2030 |

Formula counts are from `calcChain.xml`, grouped by sheetId: 5→26 627, 270→398, 23→68, 7→12.

Every cross-sheet reference was searched for. Only two links exist: Travel Time reads Data Dump (29 934 references), and ActiveRoute reads Travel Time (`C4`, `C5`). **Targets, Equipment, Raw Data and TABLE have no formula links to any other sheet.**

```
 Deswik/Vulcan string export (X,Y,Z)
        │  paste (manual)
        ▼
 ┌────────────┐  copy block (manual)   ┌─────────────┐
 │  Raw Data  │ ─────────────────────▶ │  Data Dump  │  A=Easting B=Northing C=RL (headers mislabelled)
 └────────────┘                        └──────┬──────┘
                                              │ formulas (rows 3..3328)
                                              ▼
                                       ┌─────────────┐  P3:Q35 loaded speed table
                                       │ Travel Time │  S3:T35 unloaded speed table
                                       └──────┬──────┘
                                    F15 (Σ loaded s) │ H15 (Σ return s)
                                              ▼
 EX dropdown B3, truck C3, eff C6,     ┌─────────────┐   VBA Macro_1..9 (buttons "1".."9" on row 28)
 stops C11, I34 PT/day, C20 ─────────▶ │ ActiveRoute │ ◀─ GoalSeek C24:=n by changing C20, cap at C19
                                       └──────┬──────┘
                                              │ copy/paste values (manual, optional)
                                              ▼
                                       ┌─────────────┐
                                       │ TABLE (hid.)│  static scenario comparison
                                       └─────────────┘
 Trucks per circuit chosen by planner (manual, informed by ActiveRoute C24)
        ▼
 ┌──────────────────────────────┐   rows 5-58 weekly plan; rows 65-88 crew (linked);
 │ Targets & Haulage Priorities │   rows 93-116 crew (manual what-if); AF:AG static crew list
 └──────────────────────────────┘
 ┌───────────┐
 │ Equipment │  standalone register (not referenced)
 └───────────┘
```

Workbook-level items:
- `calcPr calcId=191029`. Calculation mode is automatic (no `calcMode` attribute).
- Defined names: hidden XLM names `_xleta.IF` and `_xleta.MATCH` (both `#NAME?`, harmless artefacts) and `Equipment!$B$2:$AS$81` as the print area.
- The ActiveRoute `<sheetProtection selectLockedCells="1"/>` element has no `sheet="1"`, so protection is **not** active.

## 2. How To Guide (workflow, verbatim summary)

1. Draw the haul string in Deswik/Vulcan from the **dig centroid to the dump centroid**, snapping to the as-constructed surface at intervals. Do not cross bunds. Digitise dig → dump so the direction is visually correct.
2. Export the string properties with Northing, Easting and Elevation.
3. Paste into **Raw Data**, which is the rolling history (use text-to-columns if needed).
4. Copy the N/E/Elevation part into **Data Dump** at A2.
5. Choose the EX (**ActiveRoute B3**) and truck type (**C3**).
6. Estimate the Haul Efficiency Factor (**C6**), typically 0.83 or 0.85.
7. Update the number of stop signs (**C11**) for the full cycle, including the return.
8. Enter PT/day assuming a "perfect day" dry target, e.g. 20 h. Loaders may use 18 h because of standby with the coal dozer or EX03.
9. "Select # TRUCKS boxes in Row 28 until there are 0 hrs lost/shift (C28)". These are the **buttons 1–9** (§6.4).

Other considerations (C15/C16):
- Use the Targets sheet to balance trucks across circuits, at most "12 trucks @85% Avail or 13 trucks @92%".
- If all trucks are used, you may under-truck a circuit and schedule the PT lost to hang time. This should trigger a search for shorter hauls.

## 3. Data Dump

- Contents are A1:C118: one header row and **117 points** in rows 2–118. Nothing else is in A1:Q287, which is only the formatting extent.
- **Header labels are swapped.** A1 says `NORTHING` and B1 says `EASTING`, but:
  - column A holds ~236 000 (MGA **easting**) and column B holds ~7 051 000 (MGA **northing**);
  - the ActiveRoute chart plots A on an axis titled "Easting (m)" and B on an axis titled "Northing (m)";
  - Raw Data puts X in E and Y in F, and those are pasted unchanged into A/B.

  Correct semantics: **A = Easting (X), B = Northing (Y), C = Elevation/RL (Z)**. The swap does not affect any calculation, because 3D distance is symmetric in the horizontal axes.
- The current points are byte-identical to Raw Data rows 1030–1146, the string titled **"EX09 - B7-9 to RL282"**.
- Capacity: Travel Time formulas run to row 3328, so Data Dump rows 2–3327 (**3 326 points** maximum) are used. The chart only plots rows 2–3000.

## 4. Raw Data

Each option is laid out as:
- a **title row**: col A is the title, col I/J the truck note, col M/P flags;
- a **header row**: `No.`, `T`, `ype`, `Colour`, `X`, `Y`, `Z`, `W Name`. This is a Vulcan export split badly by text-to-columns;
- the **point rows**.

Only E/F/G (X = easting, Y = northing, Z = RL) carry meaning:
- col B holds the point number mis-parsed as an Excel time;
- col C is the Vulcan point type (0 = first point, 1 = the rest);
- col D is `...` and col H is 0.

Blocks from row 835 onwards have only E/F/G.

There are 23 strings, parsed in `raw-data-strings.json`:

| # | Row | Title | Pts | Truck note |
|---|---|---|---|---|
| 1 | 1 | EX07 - S51 Haul West from Mid Point (Option 1 - FRONT DUMP TIER) | 17 | 5 trucks |
| 2 | 21 | EX07 - S51 Haul West from Mid Point (Option 2 - FL LEVEL) | 29 | 5 trucks |
| 3 | 53 | EX07 - S51 Haul West from Mid Point (Option 3 - FL LEVEL - LONG HAUL OPTION) | 33 | 6 trucks |
| 4 | 89 | EX07 - S51 Haul East from Mid Point (Option 1 - SHORT HAUL) | 25 | 5 trucks |
| 5 | 117 | EX07 - S51 Haul East from Mid Point (Option 2 - LONG HAUL) | 43 | 6 trucks |
| 6 | 163 | EX07 - S51 Haul West from Mid Point (Option 3 - FL LEVEL - LONG HAUL OPTION) *(duplicate title of #3, different points)* | 40 | 7 trucks |
| 7 | 205 | EX07 - Eastern Corner Ramp to RL336 (adjacent to B107-B105) | 20 | 4.6 → 5, "Trucks req at 20hrs PT" |
| 8 | 227 | EX04 - B10-B07 OB to RL325 DUMP | 15 | 2.4 → 3 |
| 9 | 244 | EX04 - B07-B10 OB to RL325 DUMP (hauling west to western rl325 dump) | 29 | 4.7 → 5 |
| 10 | 275 | EX07 - B11-B12 OB to RL336 DUMP (adjacent to B107-B105) | 16 | 4.7 → 5 |
| 11 | 293 | EX04 - B10-B07 OB to RL336 DUMP - hauling East - NOTE: requires S53 blast (replacing DZR dirt for EX) | 29 | 4.7 |
| 12 | 324 | EX04 - B10-B07 OB to RL325 DUMP *(dup title of #8)* — CENTROID ADJUSTED | 16 | 2.6 → 3 |
| 13 | 342 | EX04 - B07-B10 OB to RL325 DUMP (hauling west…) *(dup of #9)* — CENTROID ADJUSTED | 30 | 4.7 |
| 14 | 374 | EX09 - B1-2 OB to Western RL340 DUMP — CENTROID ADJUSTED | 45 | 5.7 |
| 15 | 421 | EX09 - B13-11 OB to Eastern RL340 DUMP (topo) — CENTROID ADJUSTED | 50 | 5.7 |
| 16 | 473 | EX09 - B13-11 OB to Eastern RL325 DUMP (finish) — CENTROID ADJUSTED | 50 | 5 @ 19.27 h PT |
| 17 | 525 | LDR - B6-7 MA Coal to ROM — CENTROID ADJUSTED | 94 | 4 @ 18.04 h PT |
| 18 | 621 | LDR - B104 MA Coal to ROM — CENTROID ADJUSTED | 45 | 3.2 |
| 19 | 669 | EX09 - B08-10 OB to T-Bridge RL295 — CENTROID ADJUSTED | 35 | 5.4 |
| 20 | 707 | EX09 - B08-10 OB to T-Bridge RL340 — CENTROID ADJUSTED | 56 | 7 @ 19.82 h PT |
| 21 | 766 | LDR - B011 to ROM — CENTROID ADJUSTED | 66 | 3 @ 16.82 h PT |
| 22 | 835 | EX09 - B7-9 to RL325 — centroid-to-centroid | 190 | 5 "at 0.92hrs PT hang/shift (32kbcm)" |
| 23 | 1028 | **EX09 - B7-9 to RL282** — centroid-to-centroid (**= current Data Dump**) | 117 | 3 "at 0.92hrs PT hang/shift (32kbcm)" |

The truck notes are the planner's own annotations and are **not** formulas. With the current inputs, 3 trucks on string 23 give 1.27 h lost per shift, not 0.92 (see the derived macro table, §6.4). The note was evidently produced with different inputs.

## 5. Travel Time

### 5.1 Column formulas

The formula patterns were checked programmatically: every row 4–3328 is identical apart from relative offsets. Row *r* uses Data Dump rows *r-1* (the "to" point) and *r-2* (the "from" point). Segment *i* (Data Dump points *i-1* → *i*) is in row *i+3*.

| Col | Header | Formula (row r) | Notes |
|---|---|---|---|
| A | Distance (m) | `=IF('Data Dump'!A{r-1}=0,"",SQRT((A{r-1}-A{r-2})^2+(B{r-1}-B{r-2})^2+(C{r-1}-C{r-2})^2))` (Data Dump refs) | 3D slope distance. Blank only if the **to-point's easting** is 0/blank |
| B | Grade (%) | `=IFERROR(('Data Dump'!C{r-1}-'Data Dump'!C{r-2})/'Travel Time'!A{r},"")` | dZ / **slope** distance (= sin θ, not tan θ). Stored as a fraction |
| C | Speed (km/h) | `=IFERROR(VLOOKUP(ROUND(B{r},2),$P$3:$Q$35,2,FALSE),"")` | loaded speed |
| D | Time (s) | `=IFERROR(((A{r}/1000)/C{r})*60*60,"")` | loaded time |
| J | Distance (m) | `=A{r}` | return leg uses the same segments |
| K | Grade (%) | `=IFERROR(-B{r},"")` | grade negated for the return |
| L | Speed (km/h) | `=IFERROR(VLOOKUP(ROUND(K{r},2),$S$3:$T$35,2,FALSE),"")` | unloaded speed |
| M | Time (s) | `=IFERROR(((J{r}/1000)/L{r})*60*60,"")` | unloaded time |

Totals:
- `F15 =SUM(D:D)` is the loaded/"Dump" seconds, and `F16 =F15/60` the minutes.
- `H15 =SUM(M:M)` is the return seconds, and `H16 =H15/60` the minutes.
- G1 'Dig', F13 'Dump', H13 'Return' and G35 'Dump' are labels only.

**Row 3 (`#REF!`).** `A3 =IF('Data Dump'!A2=0,"",SQRT(('Data Dump'!A2-'Data Dump'!#REF!)^2+…))` refers to a deleted row, so A3 = `#REF!` and J3 = `#REF!`. B3, C3, D3, K3, L3 and M3 are wrapped in IFERROR and evaluate to `""`. Row 3 contributes nothing and **is benign**: the first real segment is row 4 (Data Dump rows 2→3).

### 5.2 Algorithm (spreadsheet-compatible)

```
for i in 1..N-1:                                  # points p[0..N-1] in Data Dump order (dig → dump)
    if p[i].E == 0: skip (row is "")              # only the to-point easting is tested
    d    = sqrt(ΔE² + ΔN² + ΔZ²)                  # 3D
    g    = ΔZ / d            (d == 0 → "" → segment skipped, contributes 0)
    vL   = LOADED[ excelRound(g, 2) ]    or ""    # exact-match lookup
    vU   = UNLOADED[ excelRound(-g, 2) ] or ""
    tL   = (d/1000)/vL*3600 if vL else ""         # "" ⇒ excluded from SUM
    tU   = (d/1000)/vU*3600 if vU else ""
loaded_s = Σ tL ;  return_s = Σ tU
```

- **`excelRound(x, 2)`**: Excel ROUND rounds half **away from zero**, applied to the value's 15-significant-digit decimal form. So 0.015 → 0.02 and −0.165 → −0.17. Python's `round()` uses banker's rounding on the binary value and is **wrong** here. The verifier uses `Decimal(format(x,'.15g')).quantize(Decimal('0.01'), ROUND_HALF_UP)`. −0.004 → −0.0, which matches the 0 row.
- **Out-of-range grades.** If |ROUND(g,2)| > 0.16, i.e. |g| ≥ 0.165, the VLOOKUP gives `#N/A`, IFERROR turns that into `""`, and the time is `""`. **The segment's time is silently dropped (counted as 0 s), while its distance still appears in column A.** This happens on the current route in rows 36 (g = −0.166), 39 (+0.178), 40 (−0.312) and 46 (−0.229). Those are 4 of 116 segments, 4.75 m of 1 115.55 m. Timed at the steepest-row speeds (12 / 14 km/h) they would add 1.43 s loaded and 1.22 s return.
- **Blank rows.**
  - Rows after the last point give `""` and contribute nothing.
  - A blank row *inside* the list is **not** skipped. The segment ending at the blank row is `""`. The next segment is measured from (0,0,0) to the next point: about 7.05 million metres at about +0.00004 grade, i.e. 30 km/h and roughly 846 000 s. That is a catastrophic error.
  - Text in Data Dump makes A `#VALUE!`, which B/C/D swallow.
- **Efficiency factor.** It is **not** applied here; it is applied in ActiveRoute C7 to the sum of both legs.
- The speed lookup **ignores the truck type**. There is a single table (below).

### 5.3 Grade → max speed tables (the only ones in the workbook)

`'Travel Time'!P3:Q35` (loaded) and `S3:T35` (unloaded):
- T12:T26 are formulas `=Q12`…`=Q26` (linked to the loaded column);
- T3:T11 and T27:T35 are the constant 14;
- grade is a fraction, positive = uphill in the direction of travel.

**There are no per-truck tables.** `'Travel Time'!AG2` = "CAT789C" and `AM2` = "KOM1500HD" are bare labels with nothing beneath them, and columns AG:AM are otherwise empty.

| Grade | Loaded km/h | Unloaded km/h | | Grade | Loaded km/h | Unloaded km/h |
|---|---|---|---|---|---|---|
| −0.16 | 12 | 14 | | +0.01 | 30 | 30 |
| −0.15 | 12 | 14 | | +0.02 | 30 | 30 |
| −0.14 | 12 | 14 | | +0.03 | 30 | 30 |
| −0.13 | 12 | 14 | | +0.04 | 30 | 30 |
| −0.12 | 12 | 14 | | +0.05 | 30 | 30 |
| −0.11 | 12 | 14 | | +0.06 | 20 | 20 |
| −0.10 | 12 | 14 | | +0.07 | 20 | 20 |
| −0.09 | 12 | 14 | | +0.08 | 12 | 14 |
| −0.08 | 12 | 14 | | +0.09 | 12 | 14 |
| −0.07 | 20 | 20 | | +0.10 | 12 | 14 |
| −0.06 | 20 | 20 | | +0.11 | 12 | 14 |
| −0.05 | 30 | 30 | | +0.12 | 12 | 14 |
| −0.04 | 30 | 30 | | +0.13 | 12 | 14 |
| −0.03 | 30 | 30 | | +0.14 | 12 | 14 |
| −0.02 | 30 | 30 | | +0.15 | 12 | 14 |
| −0.01 | 30 | 30 | | +0.16 | 12 | 14 |
| 0.00 | 30 | 30 | | | | |

The two tables are symmetric in grade sign and differ only at |grade| ≥ 8 % (12 vs 14 km/h). Two embedded pictures sit beside the tables:
- `image19`/`image20`: CAT 789 and Komatsu rimpull/gradeability charts;
- `image21`: "Comparison of Loaded, Unloaded, and OEM Rimpull Max Speeds". This shows an **older** version of the table (loaded 20 km/h at +3…+4 %), not the current values.

### 5.4 Current route results (cached)

- 116 segments; 112 timed.
- Speeds: 76 segments at 30 km/h, 15 at 20, 21 at 12 (loaded) or 14 (unloaded).
- Loaded **F15 = 171.56703384077264 s** (2.859 min).
- Return **H15 = 163.93864122564963 s** (2.732 min).

## 6. ActiveRoute

### 6.1 Inputs

| Cell | Label | Current | Validation / note |
|---|---|---|---|
| B3 | EX | `EX09` | list `=$U$5:$U$9` → EX04, EX07, EX06, LDR, EX09 |
| C3 | Truck type | `CAT789D (OB)` | list `=$M$5:$M$10` → CAT789C (OB), KOM1500HD (OB), CAT789C (COAL), KOM1500HD (COAL), CAT789D (OB), CAT789D (COAL) |
| C6 | Haul Eff Factor | 0.85 | D6 unit label says "secs" (wrong). B6 comment gives 90–95 % / 80–90 % / 70–80 % guidance |
| C11 | Stop Signs (incl. return haul) | 2 | |
| C20 | Desired Daily Vol (bcm) | 36000 | **constant overwritten by the macros** (B20 comment: "Macro automatically updates cell when you select #trucks (row 28)") |
| I34 | Ideal Avg Hours (PT/day) | 20 | feeds C19 and C22 |
| H4:J32 | EX assumption blocks | §7.1 | edited in place |
| N12:N18 | Truck load BCM | §7.2 | typed constants |

### 6.2 Formulas (all cells, verbatim)

| Cell | Label | Formula | Cached value |
|---|---|---|---|
| C4 | Travel Time (Dump) s | `='Travel Time'!F15` | 171.56703384077264 |
| C5 | Travel Time (Return) s | `='Travel Time'!H15` | 163.93864122564963 |
| C7 | Haul Time s | `=SUM(C4,C5)/C6` | 394.7125589016733 |
| C8 | Dump Time s | `{=INDEX($I$4:$I$32,MATCH($B$3,$H$4:$H$32,0) + 1)}` (array) | 60 |
| C9 | Spot Time s | `{=INDEX($I$4:$I$32,MATCH($B$3,$H$4:$H$32,0) + 2)}` | 30 |
| C10 | Loading Time s | `{=INDEX($I$4:$I$32,MATCH($B$3,$H$4:$H$32,0) + 3)}` | 110 |
| C12 | Stop Sign + Start/Stop Accel s | `=60*C11` | 120 |
| C14 | Total Time (s) | `=SUM(C7:C10,C12)` | 714.7125589016732 |
| C15 | Total Time (min) | `=C14/60` | 11.911875981694553 |
| C16 | Truck Productivity (bcm/pt) | `=(60/C15)*C21` | 523.8469582448014 |
| C17 | Truck Hours Required | `=C20/C16` | 68.7223614328532 |
| C19 | Ideal Daily Volume | `{=INDEX($I$4:$I$32,MATCH($B$3,$H$4:$H$32,0) + 4)* $I$34}` | 36000 |
| C20 | Desired Daily Vol | *(constant / macro-written)* | 36000 |
| C21 | Truck Load bcm | `=IF(C3="CAT789C (OB)",N12,IF(C3="KOM1500HD (OB)",N13,IF(C3="CAT789C (COAL)",N16,IF(C3="KOM1500HD (COAL)",N17,IF(C3="CAT789D (OB)",N14,IF(C3="CAT789D (COAL)",N18,""))))))` | 104 |
| C22 | Truck Production Time hrs | `=I34` | 20 |
| C24 | Trucks Needed | `=C17/C22` | 3.4361180716426603 |
| C26 | Excavator PT @ Planned Rate hrs | `=C20/(IF(B$3=H4,I8,IF(B$3=H10,I14,IF(B$3=H16,I20,IF(B$3=H22,I26,IF(B$3=H28,I32,""))))))` | 20 |
| C28 | Lost PT/shift (D28) | `=(C22/2)-(C26/2)` | 0 |

The same calculation in closed form:

```
haul_s      = (loaded_s + return_s) / eff                       # efficiency only on travel
cycle_s     = haul_s + dump_s + spot_s + load_s + 60 × stops
cycle_min   = cycle_s / 60
prod        = (60 / cycle_min) × payload_bcm                    # bcm per truck per PT hour
ideal_vol   = planned_rate(EX) × I34                            # C19
truck_hours = desired_vol / prod                                # C17
trucks      = truck_hours / I34                                 # C24 (fractional, no availability)
ex_pt       = desired_vol / planned_rate(EX)                    # C26
lost_pt_per_shift = (I34 − ex_pt) / 2                           # C28, assumes 2 shifts/day
```

EX lookups:
- **INDEX/MATCH** (C8–C10, C19): `MATCH(B3, H4:H32, 0)` returns 1, 7, 13, 19 or 25 for EX04, EX07, EX06, LDR or EX09. The offsets +1…+4 then pick dump, spot, loading and planned rate. This relies on the rigid 6-row block layout.
- **IF chain** (C26): the same planned rate is fetched by hard-coded cell pairs (H4→I8, H10→I14, H16→I20, H22→I26, H28→I32).
- With EX09 selected, MATCH = 25, so C8 = I29, C9 = I30, C10 = I31 and C19 = I32 × I34.

Truck load lookup: C21 is a hard-coded IF chain over the six dropdown strings. Unknown text gives `""`, and C16 then becomes `#VALUE!`.

### 6.3 Conditional formats and validation

- `C26:C27` cellIs **> $C$22** → bold red text on a light-red fill (FF9999). This flags excavator PT required above the available truck PT.
- `C28` cellIs **> 17.76** → the same style. It can never fire while C22 ≤ 35.5, because C28 ≤ C22/2. In practice this is dead.
- Data validation: B3 and C3 lists only (§6.1).

### 6.4 The "# TRUCKS" controls on row 28 are **buttons**, not checkboxes

- `xl/ctrlProps/ctrlProp1..9.xml` are all `objectType="Button"`. None has a linked cell.
- The nine Form Buttons sit across A28:C29 and are captioned "1"…"9":
  - shapes "Button 6, 7, 8, 10, 11, 12, 13, 14, 15";
  - each has `macro="[0]!Macro_n"`, n = caption.
- No cell holds a "# TRUCKS" label.

Each macro (VBA `Module1`, §11) does this:

```vba
Range("C24").GoalSeek Goal:=n, ChangingCell:=Range("C20")
If Range("C20").Value > Range("C19").Value Then Range("C20").Value = Range("C19").Value
```

C24 is linear in C20, so the closed form is **`C20 := MIN(n × C22 × C16, C19)`**. GoalSeek converges to this within Excel's tolerance (about 0.001 on C24).

Pressing a button **overwrites the input C20**. That changes C17, C24, C26 and C28; C16 and the travel times are unchanged. If the goal is capped at C19, C24 shows a fractional value below *n* and C28 = 0.

Derived button table for the current inputs (not cached; in the fixture as `macro_truck_buttons.table`):

| Button | Uncapped goal C20 | Capped? | C20 | C24 | C26 h | C28 h lost/shift |
|---|---|---|---|---|---|---|
| 1 | 10 476.94 | no | 10 476.94 | 1.000 | 5.82 | 7.09 |
| 2 | 20 953.88 | no | 20 953.88 | 2.000 | 11.64 | 4.18 |
| 3 | 31 430.82 | no | 31 430.82 | 3.000 | 17.46 | 1.27 |
| 4–9 | ≥ 41 907.76 | yes | 36 000 | 3.436 | 20.00 | 0.00 |

The cached state (C20 = 36000 = C19) is consistent with any button from 4 to 9 having been pressed, or with manual entry.

### 6.5 Chart

`xl/charts/chart1.xml` is a scatter chart:
- title "Haul Route - Visual Check";
- one series, "Haul Route";
- X = `'Data Dump'!$A$2:$A$3000` with axis title "Easting (m)";
- Y = `'Data Dump'!$B$2:$B$3000` with axis title "Northing (m)".

It is anchored over E2:F26 (column E is about 100 characters wide). It is a plan-view sanity check of the string and plots no results.

### 6.6 Other ActiveRoute content

- Reference images, all static:
  - CAT 789D HP body spec sheet;
  - "789 Wide HP 154 m³ – Custom" (128 m³, 185.5 t @ 1.45 t/m³);
  - a payload→BCM conversion note (ρB = ρL × (1+swell));
  - Transcale 2025 density table;
  - a dispatch-system truck capacity table (MACHINE_ID / COAL_CAPACITY / OB_CAPACITY …);
  - a "minimum target density" footnote.
- Cycle-element definitions, W23:X25:
  - **Dump** — starts when the truck stops in position and raises the bed; ends when the truck moves forward.
  - **Spot** — starts when the truck manoeuvres into position (U-turn); ends when it stops under the excavator.
  - **Loading** — from the first bucket to the last load plus the operator signal (horn).
- Efficiency guidance, W27:X29: highly efficient 90–95 %; moderate 80–90 %; challenging 70–80 %.

## 7. Lookup / assumption tables (verbatim)

### 7.1 Excavator assumptions — `ActiveRoute!H2:J34` ("planned rates from 2025 Budget SPRY")

| EX (H) | Model (I) | Dump s | Spot s | Loading s | Planned rate bcm/PT | Rows |
|---|---|---|---|---|---|---|
| EX04 | KOM PC4000 (400-ton class) | 60 | 30 | 116 | 1300 | H4:J8 |
| EX07 | LIEB R996B (600-ton class) | 60 | 30 | 110 | 1800 | H10:J14 |
| EX06 | HIT EX2600 (250-ton class) | 60 | 30 | 155 | 900 | H16:J20 |
| LDR | KOM WA900 (100-ton class) | 60 | 30 | 245 | 650 | H22:J26 |
| EX09 | HIT EX5600 (550-ton class) | 60 | 30 | 110 | 1800 | H28:J32 |

- Ideal Avg Hours `I34 = 20` PT/day.
- `K7 = 155` sits unlabelled beside the EX04 loading time and is unreferenced.
- I20 comment: "check against bucket capacity 60 rule of thumb".

### 7.2 Trucks

Truck fleets, `M4:O10`:

| Truck type | #Trucks | Class |
|---|---|---|
| CAT789C (OB) | (3) | 180t |
| KOM1500HD (OB) | (3) | 140t |
| CAT789C (COAL) | (3) | 180t |
| KOM1500HD (COAL) | (3) | 140t |
| CAT789D (OB) | (8) | 190t |
| CAT789D (COAL) | (8) | 190t |

Comments on the fleet table: M5 "CAT-789C Dual Slope"; O5/O7 "177 metric tonnes (195 short ton US)"; O6/O8 "144 metric tonnes (160 short ton US)".

Truck load (bcm per load), `M12:O18`, as mapped by C21:

| C3 value | Cell | BCM |
|---|---|---|
| CAT789C (OB) | N12 | 104 |
| KOM1500HD (OB) | N13 | 89 |
| CAT789D (OB) | N14 | 104 |
| CAT789C (COAL) | N16 | 100 |
| KOM1500HD (COAL) | N17 | 100 |
| CAT789D (COAL) | N18 | 100 |

Other truck and material data:
- Material density `M22:O23`: OB 1.53 t/cbm and COAL 1.05 t/cbm (unreferenced).
- Bucket capacity `Q4:R8` ("TBC"; R5 comment "cbm before swell"): EX04 22 cbm, EX07 34 cbm, EX06 15 cbm, LDR401/402 18 cbm.
- Transcale (2024) vs Spec Sheet (nominal), `Q10:R16`. Comments: R12 "Heaped bcm - CAT spec sheet", R13 "Heaped bcm - KOM spec sheet".
  - row 12: 104 / 105
  - row 13: 89 / 78
  - row 15: 98 / –
  - row 16: 100 / –

### 7.3 Swell and Transcale

- Swell `AD4 = 1.2`, labelled "Swelled to get bank density" (t/m³). BCM density = LCM density × 1.2. BCM per load = truck tonnage / BCM density.
- **Transcale Study (2024)**, `W6:AE15`. Formulas: `AD = Y*$AD$4`, `AE = AC/AD`.

| Truck | Seam | t/LCM | Avg vol cbm | Avg t | Truck t | BCM density | BCM/load |
|---|---|---|---|---|---|---|---|
| Komatsu HD1500 | Rejects | 1.35 | 72.6 | 98.5 | 144 | 1.62 | 88.889 |
| Komatsu HD1500 | Overburden | 1.44 | 91.02 | 131.5 | 144 | 1.728 | 83.333 |
| Cat 789C | Overburden | 1.46 | 104.85 | 153.2 | 177 | 1.752 | 101.027 |
| Cat 789C | Interburden | 1.62 | 102.16 | 165.3 | 177 | 1.944 | 91.049 |
| Komatsu HD1500 | Interburden | 1.63 | 86.28 | 140.89 | 144 | 1.956 | 73.620 |
| Komatsu HD1500 | Coal - MA2B | 0.98 | 99.27 | 97.5 | 144 | 1.176 | 122.449 |
| Komatsu HD1500 | Coal - MA3 | 1.04 | 97.6 | 100 | 144 | 1.248 | 115.385 |
| Cat 789C | Coal - MA3 | 1.06 | 97.8 | 104.36 | 177 | 1.272 | 139.151 |

The AD15 formula `=Y15*$AD$4` evaluates to 0 (Y15 is blank).

Summary rows `X17:AE20` (informational; inconsistent ranges, see Q15):

| Row | X | AB | Avg density formula → value | Avg bcm formula → value | ROUNDUP | Truck t | BCM dens. | BCM/load |
|---|---|---|---|---|---|---|---|---|
| 17 | OB | KOM1500 Waste | `AVERAGE(Y8:Y11)` → 1.5375 | `(Z8+Z11)/2` → 88.65 | 89 | 140 | 1.845 | 75.881 |
| 18 | CL | CAT789 Waste | `AVERAGE(Y12:Y14)` → 1.02667 | `(Z9+Z10)/2` → 103.505 | 104 | 180 | 1.232 | 146.104 |
| 19 | OB | KOM1500 Coal | `AVERAGE(Y10:Y13)` → 1.3175 | `=Z12` → 99.27 | 100 | 140 | 1.581 | 88.552 |
| 20 | CL | CAT789 Coal | `AVERAGE(Y14:Y16)` → 1.06 | `=Z14` → 97.8 | 98 | 180 | 1.272 | 141.509 |

**Transcale Study (2025)**, CAT789D custom tray, `AG4:AK14`:
- truck tonnage AI13 "Transcale Actual" = 181.9 t; AI14 "Nominal Design" = 185.5 t;
- formulas `AJ = AI*$AD$4` and `AK = $AI$13/AJ`.

| Material | Samples | t/LCM | BCM density | BCM/load |
|---|---|---|---|---|
| Parting | 36 | 1.63 | 1.956 | 92.996 |
| Overburden | 35 | 1.44 | 1.728 | 105.266 |
| MA1 Coal | 5 | 0.98 | 1.176 | 154.677 |
| MA2 Coal | 20 | 0.90 | 1.08 | 168.426 |

Scratch cells: `AG22 =0.98*66.5` (65.17), `AH22 = 89`, `AI22 =AH22/AG22` (1.36566), `AG23 =89/1.4` (63.571).

### 7.4 Daily volume guide and fleet availability

- **Daily Vol Guide** `BR3:BT10` (bcm/day, "assumed from 2025 Budget"):
  - EX04 18 942 — comment "Full production day Budget"
  - EX07 27 892 — comment "Full production day Budget"
  - EX06 `=BS5` (18 942) — comment "Not loading in Budget so assumption made."
  - LDR 9 943 — comment "Max 24hrs in Budget"
  - Footnote BR10: "* check whether I pulled this above from Schedule export which assumes wet-weather and avail/util applied". Unreferenced.
- **Fleet notes** `H36:I42`:
  - "8 x CAT789's - Owned"
  - "3 x CAT789's - Hired"
  - "3 x KOM1500HD's - Hired"
  - "14 x Trucks Total"
  - `H41 =14*0.92` → 12.88, "~13 @92% Availability"
  - `H42 =14*0.85` → 11.9, "~12 @85% Availability"
- **Stop penalty**: 60 s per stop, hard-coded in C12. B12 comment: "Test from moment truck reduces speed, stops, and accelerates back up to full speed."

## 8. TABLE (hidden)

This is "EXAMPLE TO COMPARE HAULAGE SCENARIOS". It has three blocks:
- C:F "Using CAT789C"
- G:J "Using CAT789D (new)"
- K:N "Using KOM1500HD"

Each block has Dump 1…4. All values are **pasted constants**. The P:Q instructions are:
1. Copy ActiveRoute C4 to C15 and paste into row 6.
2. Enter the EX rate in row 19.
3. Copy C24 into row 21.

The only formulas are `C22:N22 =ROUNDUP(C21,0)`, "Tot. Trucks Needed (round-up)", giving 6, 4, 2, 2 | 6, 4, 2, 2 | 10, 7, 4, 3.

The pasted values are stale and internally inconsistent:
- Haul time equals the plain sum of the two legs, with no division by the efficiency factor.
- Total time = haul + 200 s.
- The stop row shows 70 s for 2 stops.
- The loading row shows 155 s.
- "Trucks Needed" cannot be reproduced from the displayed inputs.

Treat this sheet as a UI idea (side-by-side scenario comparison), not as calc logic.

## 9. Targets & Haulage Priorities

### 9.1 Week header

- `C1` = plan week start (2026-05-05). AJ3 says "Update B1 for plan week", but the date is in C1.
- `E3 =C1`, `F3 =E$3+1` … `K3`, giving 7 days.
- `E4 =TEXT(E3,"ddd")` and so on.
- Column L is "Week Total (bcm or t)".

### 9.2 Circuit blocks (one value per day in E:K)

| Block (C) | Rows | Inputs (typed) | Formula rows |
|---|---|---|---|
| EX09 | 5–11 | Priority 1, # Trucks 5, Hours 20, Rate 1800, Dig/Dump blank | `E9 =E7*E8` "Target Waste" (36 000/day); `L9 =SUM(E9:K9)` (252 000) |
| EX04 | 12–18 | Priority 2, # Trucks 4, Hours 20, Rate 1300 | `E16 =E14*E15` (26 000); `L16` 182 000 |
| EX06 | 19–25 | Priority/Trucks/Hours blank, Rate 0 | `E23 =E21*E22` (0); `L23` 0 |
| LDR 1/2 | 27–34 | Priority 3, # Trucks 3, Hours 18, Rate 650 | `E31 =E29*E30` in the **"Target Waste"** row (11 700); `L31` 81 900; "Target Coal" row 32 is blank and `L32 =SUM(E32:K32)` = 0 |
| LDR 2/2 | 35–42 | Priority 0, # Trucks 0, Hours/Rate blank | `E40 =E37*E38` in the **"Target Coal"** row (0); "Target Waste" row 39 is blank; `L40` 0 |
| DZR | 44–48 | Priority 4, Hours 18, Rate 320 | `E47 =IF(E57>12, 7-(E57-12)-E52, 7-E52)` "# Dozers" (6); `E48 =E45*E46*E47` (34 560); `L48` 241 920 |
| DZR - Enabling Tasks | 50–53 | E51 "DR Prep", `E52` # Dozers = 1 | – |

Daily and weekly totals:

| Row | Label | Formula (E; same for F:K and L) | Value/day | Week |
|---|---|---|---|---|
| 55 | Daily Waste (bcm) | `=E9+E16+E23++E31+E48+E39` | 108 260 | 757 820 |
| 56 | Daily Coal "(kt)" | `=E31+E40` | 11 700 | 81 900 |
| 57 | Daily Trucks (max 12) # Operating | `=E6+E13+E20+E28+E36` | 12 | – |
| 58 | Total Units (bcm + t) | `=E56+E55`; `L58 =SUM(E58:K58)` | 119 960 | 839 720 |

Benchmarks:
- `O57 =14*0.92` → 12.88, "92% Avail". S57: "13 possible with good availability (achieving 92-95% on new CAT789's)".
- `O58 =(2156874+350000)/30` → 83 562.47, "Scheduled Total Units/ Day for April 2026".

C59 "Services/ Relocation" is an empty block.

**What is not automated:**
- The Priority rows are not used by any formula.
- Dig/Dump rows are blank free-text fields.
- There is **no truck-balancing formula**. Balancing is manual, guided by the E57 sum and its conditional format.

Notes in AJ4–AJ6:
- "Balance trucking to ensure 12 operating at all times based on priorities"
- "Highlight yellow if undertrucked (to prompt discussion on haulage strategies)". This is manual; no rule implements it.
- "Remove dozers from push for Enabling tasks to reflect lower volumes". This is implemented by `-E52` in E47.

Conditional formatting:
- `E57:K57`: **> 12** gives a red fill (FF0000); **≤ 12** gives bold text on a green fill (00B050).
- There are no other CF rules and no data validations on this sheet.

### 9.3 Static crew allocation — `AF3:AG19`

"Crew Allocations / #People" are typed constants:

| Role | People |
|---|---|
| Trucks | 12 |
| Push Dozers | 7 |
| Excavators | 3 |
| Loaders | 2 |
| Dump Dozers | 2 |
| Wheel Dozers | 1 |
| Coal Dozer | 2 |
| Water Cart | 2 |
| Grader | 2 |
| Loaders *(again)* | 2 |
| Supervisor | 2 |
| OCE | 1 |

- `AG18 =SUM(AG4:AG16)` = **38**, "Total Crew # Req.".
- `AG19 = 30` has no label, and is presumably the crew available.
- This block is **not linked** to the crew blocks below. "Loaders" is counted twice.

Crew cap notes:
- C90 "Crew Cap (No OT)", D90 "29?? (incl/excl supervisors/oce) ??"
- C91 "32 crew cap minus 4 for AL/PL?Training = 28 operating (or is it 28 including the supervisors and OCE's??)"
- Neither is enforced by a formula.

### 9.4 Crew blocks — the manning rules

There are two blocks with identical structure. Each day has two columns, "Trucks" and "Equip Op": D/E, F/G, H/I, J/K, L/M, N/O and P/Q. TOTAL = `SUM` over **both** columns, e.g. `D88 =SUM(D68:E87)`.

**Block 1, rows 65–88, "CREW"** is linked to the plan. Formulas below are for day 1; the other days shift by two columns.

| Row | Line | Trucks col | Equip Op col | Day-1 value |
|---|---|---|---|---|
| 68 | EX09 | `D68 =$E$6` | `E68 =IF(D68>0,1,0)` | 5 / 1 |
| 69 | EX09 DZR (floor + dump) | – | `E69 =IF(D68>0,2,0)` | 2 |
| 70 | EX04 | `=$E$13` | `=IF(D70>0,1,0)` | 4 / 1 |
| 71 | EX04 DZR (floor + dump) | – | `=IF(D70>0,2,0)` | 2 |
| 72 | EX06 | `=$E$20` | `=IF(D72>0,1,0)` | 0 / 0 |
| 73 | EX06 DZR (floor + dump) | – | `=IF(D72>0,2,0)` | 0 |
| 75 | LDR 1 | `=$E$28` | `=IF(D75>0,1,0)` | 3 / 1 |
| 76 | DZR (coal) | – | `=IF(D75>0,1,0)` | 1 |
| 77 | LDR 2 | `=$E$36` | `=IF(D77>0,1,0)` | 0 / 0 |
| 78 | DZR (coal) | – | `=IF(D77>0,1,0)` | 0 |
| 79 | EX03/EX08 (support) | – | `=IF(D75>0,1,0)` *(LDR 1 only)* | 1 |
| 81 | DZR Bulk Push | – | `=$E$47` | 6 |
| 82 | EX06 DZR Assist | – | `=IF(E81>0,1,0)` | 1 |
| 83 | DZR Enabling Tasks | – | `=$E$52` | 1 |
| 85 | Water Truck | – | 2 (typed) | 2 |
| 86 | Grader | – | 2 (typed) | 2 |
| 87 | Supervisors/OCE | – | 3 (typed) | 3 |
| 88 | TOTAL | `=SUM(D68:E87)` | | **36** (12 truck operators + 24 equipment operators), every day |

Dates are `D65 =$C$1`, `F65 =D$65+1`, … and day names are `=TEXT(…,"ddd")`.

**Block 2, rows 93–116,** is a manual what-if with the same formulas, except:
- `D96:P96` EX09 trucks are typed **4** (not linked);
- `E109:Q109` DZR Bulk Push is typed **4** (not `=$E$47`);
- Water Truck **1**, Grader **1** and Supervisors/OCE **0** are typed.

TOTAL `D116 =SUM(D96:E115)` = **28** every day: 11 truck operators + 17 equipment operators. This matches the "28 operating" crew cap note.

Block 2 dates use `F93 =D$65+1`, i.e. they reference block 1.

### 9.5 Manning rules as explicit IF-THEN statements

Per day, with circuits {EX09, EX04, EX06} of kind *excavator* and {LDR 1, LDR 2} of kind *loader*:

1. **R1 Truck operators.** For every circuit, + `trucks` truck operators.
2. **R2 EX operator.** IF an excavator circuit has trucks > 0 THEN +1 excavator operator.
3. **R3 EX support dozers.** IF an excavator circuit has trucks > 0 THEN +2 dozer operators (1 floor + 1 dump).
4. **R4 Loader operator.** IF a coal loader circuit has trucks > 0 THEN +1 loader operator.
5. **R5 Coal dozer.** IF a coal loader circuit has trucks > 0 THEN +1 coal dozer operator.
6. **R6 Supporting EX for coal.** IF **LDR 1** has trucks > 0 THEN +1 support excavator operator (EX03/EX08). *LDR 2 alone does not trigger this.*
7. **R7 Bulk push dozers.** `push = 7 − enabling_dozers − max(0, total_trucks − 12)`. This implies a substitution rule: every truck above 12 takes one push-dozer operator, i.e. dozer operators are re-deployed to drive trucks. There is no clamp at 0.
8. **R8 Push assist.** IF push > 0 THEN +1 "EX06 DZR Assist" operator.
9. **R9 Enabling.** + `enabling_dozers` dozer operators (input E52, "Remove dozers from push for Enabling tasks").
10. **R10 Fixed.** +2 water cart, +2 grader, +3 supervisors/OCE.
11. **Total crew** = Σ of all the above.

Constraints:
- **C1 (error):** total trucks ≤ 12 (CF red).
- **C2 (info):** under-trucked if fewer than 12. The yellow highlight is manual.
- **C3 (warning):** total crew ≤ 28 operating (note only).

Production rules:
- **P1:** target = hours × rate.
- **P2:** DZR target = hours × rate × push dozers.
- **P3 / P4:** waste and coal sums as in §9.2, including the LDR 1 double count.

### 9.6 Proposed JSON rule-set schema

The full instance is in `spreadsheet-targets-crew.json` → `rule_set`. Abridged:

```json
{
  "schema": "haulsim.crew-rules/1",
  "params": {
    "max_trucks_operating": {"value": 12},
    "push_dozer_fleet": {"value": 7},
    "water_cart": {"value": 2},
    "grader": {"value": 2},
    "supervisor_oce": {"value": 3},
    "crew_cap_operating": {"value": 28}
  },
  "circuit_kinds": {"excavator": "...", "loader": "..."},
  "roles": {"truck_operator": "...", "excavator_operator": "...", "dozer_floor_dump": "...", "loader_operator": "...",
            "dozer_coal": "...", "support_excavator_operator": "...", "dozer_bulk_push": "...", "dozer_push_assist": "...",
            "dozer_enabling": "...", "water_cart": "...", "grader": "...", "supervisor_oce": "..."},
  "derived_totals": {"total_trucks": {"expr": "sum(circuit.trucks for all circuits)"}},
  "rules": [
    {"id": "R1_TRUCK_OPERATORS", "scope": "circuit", "where": "true", "when": "true", "add": {"truck_operator": "circuit.trucks"}},
    {"id": "R2_EX_OPERATOR", "scope": "circuit", "where": "circuit.kind == 'excavator'", "when": "circuit.trucks > 0", "add": {"excavator_operator": 1}},
    {"id": "R3_EX_DOZERS", "scope": "circuit", "where": "circuit.kind == 'excavator'", "when": "circuit.trucks > 0", "add": {"dozer_floor_dump": 2}},
    {"id": "R4_LOADER_OPERATOR", "scope": "circuit", "where": "circuit.kind == 'loader'", "when": "circuit.trucks > 0", "add": {"loader_operator": 1}},
    {"id": "R5_COAL_DOZER", "scope": "circuit", "where": "circuit.kind == 'loader'", "when": "circuit.trucks > 0", "add": {"dozer_coal": 1}},
    {"id": "R6_SUPPORT_EX", "scope": "circuit", "where": "circuit.id == 'LDR 1'", "when": "circuit.trucks > 0", "add": {"support_excavator_operator": 1}},
    {"id": "R7_BULK_PUSH", "scope": "global",
     "set": {"dozer_bulk_push": "params.push_dozer_fleet - inputs.enabling_dozers - max(0, totals.total_trucks - params.max_trucks_operating)"}},
    {"id": "R8_PUSH_ASSIST", "scope": "global", "when": "roles.dozer_bulk_push > 0", "add": {"dozer_push_assist": 1}},
    {"id": "R9_ENABLING_DOZERS", "scope": "global", "add": {"dozer_enabling": "inputs.enabling_dozers"}},
    {"id": "R10_FIXED_ROLES", "scope": "global", "add": {"water_cart": "params.water_cart", "grader": "params.grader", "supervisor_oce": "params.supervisor_oce"}}
  ],
  "outputs": {"total_crew": {"expr": "sum(all roles)"}},
  "constraints": [
    {"id": "C1_MAX_TRUCKS", "expr": "totals.total_trucks <= params.max_trucks_operating", "severity": "error"},
    {"id": "C2_UNDERTRUCKED", "expr": "totals.total_trucks >= params.max_trucks_operating", "severity": "info"},
    {"id": "C3_CREW_CAP", "expr": "outputs.total_crew <= params.crew_cap_operating", "severity": "warning"}
  ],
  "test_scenarios": [ {"id": "linked_plan_day1", "inputs": {"circuits": [...], "enabling_dozers": 1}, "overrides": {}, "expected": {"total_crew": 36, "...": "..."}},
                      {"id": "manual_scenario_day1", "overrides": {"circuit_trucks": {"EX09": 4}, "roles": {"dozer_bulk_push": 4, "water_cart": 1, "grader": 1, "supervisor_oce": 0}}, "expected": {"total_crew": 28}} ]
}
```

Semantics:
- Rules run in array order.
- `scope: circuit` iterates over the circuits and filters with `where`; `scope: global` runs once.
- `when` gates the effects.
- `add` accumulates; `set` assigns.
- A scenario's `overrides.roles[X]` replaces whatever a rule would put in role X *at the moment that rule runs*. Later rules, e.g. R8 reading `roles.dozer_bulk_push`, see the override. This reproduces block 2 exactly.
- Expressions use a tiny language: numbers, quoted strings, `+ - * /`, comparisons, parentheses, `max`, `min`, and dotted identifiers. Each rule carries `source` (the cell formula) and `compat_note` fields.

Each crew-block line carries `maps_to: [role, circuit]`. The verifier checks every cell, all 7 days of both blocks, against the engine.

Suggested generalisations for "enhanced" mode, all **off** in compatibility mode:
- R6 for any loader circuit, capped at one support EX per plan;
- clamp R7 at ≥ 0;
- de-duplicate the EX06 operator when EX06 runs a truck circuit and also does push assist;
- take 12, 7 and 28 from the Equipment register and availability rather than constants.

## 10. Equipment

This is a static fleet register, `A2:AS83` (print area B2:AS81). It has **no formulas and nothing references it**.

| Column(s) | Content |
|---|---|
| A | Eqp Description |
| B | Eqp Code Input, e.g. EX003, DT126, DZ215, LD409, WT610, ST006 |
| C | Proposed Fleet ID, e.g. Exc3, Trk5, Doz6, Fel2 |
| D | Current SAP CC |
| E | Current SAP Dsc |
| F | Tech Services Comments |
| G | Commercial Comments |
| H | Mtce Comments |
| I:K | "Options": I = Own/Buy, J = Hire / Buy, K = Hire |
| M:AJ | Monthly presence 2025-01…2026-12: 1 = in fleet, 0 = out, fractions = part-month |
| AK:AN | Years 2027…2030 (fractions = part-year) |
| AO | Note |
| AP | CURRENT SMU |
| AQ | SMU AT 2029 |
| AR | SMU AT LIFE |
| AS76 | "Before major overhaul" |

- There are 66 non-empty rows. Two of them (rows 9 and 55) hold only a description. The rows are grouped as excavators, trucks (KOM HD1500, CAT 789, placeholder 793/789 purchases), dozers (D475, D11T, D375, D10), wheel dozer, graders, loaders, water carts and service trucks.
- Comment W3 (William Long): "Contract due in Nov".
- All rows are in `spreadsheet-targets-crew.json` → `equipment_register`.
- Copy-paste inconsistencies exist, e.g. A15 "CDM DT197 CAT 789 Hire" with code DT126, and A28 "CAT 793" with E28 "CAT 789".

## 11. VBA

`olevba` (oletools 0.60.2) extracted `xl/vbaProject.bin` successfully. Streams: `Module1`, `ThisWorkbook`, `Sheet1..Sheet6`. Only `Module1` has code:

| Procedure | Body |
|---|---|
| `Macro_1` … `Macro_9` | `Range("C24").GoalSeek Goal:=n, ChangingCell:=Range("C20")`, then `If Range("C20").Value > Range("C19").Value Then Range("C20").Value = Range("C19").Value` (n = 1…9). `Macro_1` also carries a macro-recorder attribute `VB_ProcData.VB_Invoke_Func = " \n14"` (no shortcut key) |

- `ThisWorkbook` and all sheet modules are empty: no events and no auto-run code.
- `Range` is unqualified, so the macros act on the **active sheet**. They only work when run from the ActiveRoute buttons.
- The PROJECT stream has the standard CMG/DPB/GC entries. The source was fully readable, so nothing blocked extraction.

## 12. Cell comments

ActiveRoute (`comments1.xml`, author Blake Harris):

| Cell | Comment |
|---|---|
| M5 | CAT-789C Dual Slope |
| O5 | 177metric tonnes (195 short ton US) |
| R5 | cbm before swell |
| BS5 | Full production day Budget |
| B6 | Highly efficient operations: 90-95% · Moderate efficiency: 80-90% · Challenging conditions: 70-80% (e.g., poor roads, weather, frequent delays) |
| O6 | 144 metric tonnes (160 short ton US) |
| Z6 | Check if this is lcm |
| BS6 | Full production day Budget |
| O7 | 177metric tonnes (195 short ton US) |
| BS7 | Not loading in Budget so assumption made. |
| O8 | 144 metric tonnes (160 short ton US) |
| BS8 | Max 24hrs in Budget |
| B12 | Test from moment truck reduces speed, stops, and accelerates back up to full speed. |
| R12 | Heaped bcm - CAT spec sheet |
| R13 | Heaped bcm - KOM spec sheet |
| Z16 | lcm? |
| AD17 | Very typical bank OB density |
| B20 | Macro automatically updates cell when you select #trucks (row 28) |
| I20 | check against bucket capacity 60 rule of thumb |

Equipment (`comments2.xml`, author William Long): W3 "Contract due in Nov".

## 13. Quirks, bugs and limitations

Columns: S = severity, H = high, M = medium, L = low. "Compat" is how the Spreadsheet-compatible mode should behave.

| # | S | Quirk | Compat |
|---|---|---|---|
| Q1 | L | Data Dump headers swapped: A is labelled NORTHING but holds Easting; B the reverse | Engine uses semantic E/N/Z; no numeric effect |
| Q2 | L | `Travel Time!A3` (and J3) = `#REF!` from a deleted row; harmless because of IFERROR | Ignore; start at the first pair |
| Q3 | **H** | Segments with \|ROUND(grade,2)\| > 0.16 are **dropped from travel time** (0 s) instead of slowed. The current route loses 4 segments / 4.75 m. Steep ramps or vertical duplicates can drop real distance. For example, string 22 starts with a 3.4 m vertical step; 14 of its 189 segments, 38.2 m in total, are excluded | Replicate (`outOfRange: "drop"`); enhanced: clamp to the end row or use physics |
| Q4 | **H** | **One speed table for all trucks.** Truck type changes only the payload. Speeds are a step function of grade, at most 30 km/h. There is no rimpull/retarder curve, rolling resistance, payload, acceleration/braking, speed limit, curve or intersection modelling. The table is symmetric in grade sign, so loaded downhill = loaded uphill | Replicate table lookup; enhanced: rimpull/retarder per truck model |
| Q5 | M | Loaded and unloaded speeds differ only at \|grade\| ≥ 8 % (12 vs 14 km/h) | – |
| Q6 | M | ROUND(grade,2) quantises grade to whole percent with half-away-from-zero ties; Python's `round` differs | Implement `excelRound` |
| Q7 | M | Grade = dZ / **3D slope distance** (sin θ), not dZ / horizontal distance (tan θ); negligible below 10 % | Replicate |
| Q8 | M | Haul efficiency divides **travel time only** (C7); fixed times and the stop penalty are not adjusted | Replicate; enhanced: separate efficiency/utilisation terms |
| Q9 | M | Stop-sign penalty is hard-coded at 60 s/stop (C12). The hidden TABLE uses 35 s/stop | Parameterise, default 60 |
| Q10 | **H** | Trucks needed = truck-hours / I34. There is no mechanical availability, utilisation, queueing/bunching or match factor, the result is fractional, and the same I34 is used for trucks and EX. Availability appears only as text (14 × 0.92 / 0.85) | Replicate; enhanced: availability, utilisation, queue simulation |
| Q11 | M | `C28 = (C22 − C26)/2` hard-codes 2 shifts/day. It means excavator hang hours per shift when volume is limited by the trucks. It goes negative if C20 > C19 by manual entry. The CF threshold 17.76 can never fire | Replicate; expose shiftsPerDay |
| Q12 | M | Buttons 1–9 run GoalSeek, **mutating the input C20**. The result depends on state, there is no record of which button was pressed, and once capped C24 shows fractional trucks below *n* | Pure function `volumeForTrucks(n) = min(n·PT·prod, ideal)` |
| Q13 | M | EX parameters are fetched two different ways: INDEX/MATCH with fixed offsets (C8–C10, C19) and a hard-coded IF chain (C26). The truck load is an IF chain over literal strings (C21). Adding equipment means editing formulas | Data-driven lookups |
| Q14 | **H** | A blank row inside Data Dump creates a phantom segment from (0,0,0) of about 7 Mm. Only the easting is tested for blank. The maximum is 3 326 points, and the chart shows only rows 2–3000 | Compat: emulate; normal mode: reject/split |
| Q15 | L | Transcale summary X17:AE20 uses inconsistent AVERAGE ranges and labels (row 18 is "CL" vs "CAT789 Waste"; Y20 averages a text cell). It is unused: N12:N18 are typed. CAT789C coal load is 100 bcm vs the Transcale round-up of 98 | Load table as data |
| Q16 | L | Dump/spot times are 60/30 s for every EX. Loading time is not derived from bucket size, passes or payload | Parameterise |
| Q17 | L | TABLE (hidden) holds stale pasted values that disagree with current logic (no efficiency division, 200 s fixed, irreproducible trucks) | Don't port as logic |
| Q18 | **H** | Targets: **LDR 1 production is counted in both Daily Waste (E55) and Daily Coal (E56)**, inflating Total Units by 11 700/day (81 900/week). The LDR 1 formula sits in the "Target Waste" row but LDR 2's is in "Target Coal". E39 (blank) is referenced. Daily Coal is labelled "(kt)" but holds tonnes. E55 contains a `++` typo (harmless) | Compat flag `ldr1DoubleCount: true` |
| Q19 | M | Priority, Dig and Dump rows feed nothing. There is no automated truck balancing, only the E57 sum and CF. "Highlight yellow if under-trucked" is manual | Implement balancing in-app |
| Q20 | M | E47 hard-codes 7 push dozers and 12 trucks; there is no clamp at 0. The implicit rule is "each truck above 12 takes a push-dozer operator" | Rule R7 with params |
| Q21 | M | Crew: support EX is tied to LDR 1 only. "EX06 DZR Assist" depends on bulk push, not on EX06. The EX06 operator could be double counted | Rules R6/R8 with compat notes |
| Q22 | M | Static crew list AF:AG: "Loaders" appears twice, total 38 vs unlabelled 30, and it is not linked. The crew cap (28/29/32) exists only as notes | Params + constraint C3 |
| Q23 | L | Crew block 2 overrides formulas with typed numbers; its dates reference block 1 | Model as scenario overrides |
| Q24 | L | AJ3 "Update B1 for plan week", but the date is in C1 | – |
| Q25 | L | Equipment register is unlinked and has copy-paste errors in descriptions | Import as master data |
| Q26 | L | Raw Data: "No." mis-parsed as time, duplicate titles, truck notes not reproducible with the current inputs | Parse E/F/G only |
| Q27 | L | `SUM(D:D)` and `SUM(M:M)` sum whole columns, so a stray number typed anywhere in D or M changes the travel time | – |
| Q28 | L | C21 returns "" for an unknown truck, then `#VALUE!`. The D6 unit says "secs" for a dimensionless factor | – |
| Q29 | L | Embedded comparison image (image21) shows an outdated speed table | – |

## 14. Mapping to hAIul SIM

### 14.1 Engine functions (pure, unit-testable)

| Function | Spreadsheet source | Signature (TS-style) |
|---|---|---|
| `parseVulcanExport(text)` | Raw Data blocks | `→ HaulString { name, unit, notes, points: {e,n,z}[] }` |
| `segmentize(points, opts)` | Travel Time A, B, J, K | `→ Segment[] { dist3d, dz, grade }`. `opts.compat` keeps the blank-row/zero-easting semantics |
| `excelRound(x, digits)` | `ROUND` | half away from zero on the 15-significant-digit value |
| `lookupSpeed(table, grade, {rounding:'excel2dp', outOfRange:'drop'})` | Travel Time C, L | `→ km/h \| null` |
| `travelTime(segments, table, direction)` | D, M, F15, H15 | `→ { seconds, perSegment[], excluded[] }`. Direction `'return'` negates grade |
| `cycleTime({loadedS, returnS, haulEff, dumpS, spotS, loadS, stops, stopPenaltyS=60})` | C7, C12, C14, C15 | `→ { haulS, totalS, totalMin }` |
| `truckProductivity({cycleMin, payloadBcm})` | C16 | `→ bcm/truck/PT-h` |
| `idealDailyVolume({plannedRate, ptHours})` | C19 | |
| `trucksRequired({dailyVol, productivity, ptHours})` | C17, C24 | `→ { truckHours, trucks }` |
| `excavatorPT({dailyVol, plannedRate})` | C26 | |
| `lostPtPerShift({ptHours, exPt, shiftsPerDay=2})` | C28 | |
| `volumeForTrucks({n, ptHours, productivity, idealVol})` | Macro_1..9 | `min(n·ptHours·productivity, idealVol)` |
| `weeklyTargets(plan)` | Targets rows 5–58 | per-circuit `hours × rate`, DZR push, waste/coal/units, `ldr1DoubleCount` flag |
| `crewRequirement(dayPlan, ruleSet, overrides)` | Targets rows 65–116 | `→ { roles, byCircuit, total, constraintViolations }` |

### 14.2 Inputs → model

| Spreadsheet | hAIul SIM model field |
|---|---|
| Data Dump A/B/C | `route.points[].{e,n,z}` |
| B3 | `route.loadingUnit` → `equipment.loaders[id]` (dump/spot/load s, plannedRate) |
| C3 | `route.truckType` → `trucks[id].payloadBcm[material]` (and, in enhanced mode, rimpull curves) |
| C6 | `route.haulEfficiency` |
| C11 | `route.stopSigns` (+ `params.stopPenaltyS`) |
| I34 / C22 | `shift.ptHoursPerDay` (separate truck and EX PT in enhanced mode) |
| C20 | `route.desiredDailyVolume` (or derived from `nTrucks` via `volumeForTrucks`) |
| P3:Q35 / S3:T35 | `speedTables.spreadsheetDefault.{loaded,unloaded}` |
| Targets E5:K52 | `weekPlan.days[].circuits[]` {priority, trucks, hours, rate}, `dozerPush` {hours, rate}, `enablingDozers` |
| Crew rules | `crewRuleSet` (JSON §9.6) |
| Equipment | `fleetRegister.units[]` with `availabilityByPeriod` |

### 14.3 Outputs to show (compat parity)

The engine should show these outputs to match the spreadsheet:
- loaded and return travel s/min;
- haul, cycle s/min;
- productivity;
- ideal and desired volume;
- truck hours;
- trucks needed (fractional and rounded up);
- EX PT;
- lost PT per shift;
- a per-*n* trucks table (buttons);
- daily/weekly targets;
- trucks operating vs max 12 (red/green);
- crew by role/day and total vs cap.

Enhanced mode adds, at minimum:
- per-segment speed source;
- excluded segments;
- an availability-adjusted fleet.

### 14.4 Mode switch

`calcMode: "spreadsheet" | "enhanced"`. Spreadsheet mode must reproduce every number in the fixtures:
- Excel rounding;
- drop out-of-range grades;
- efficiency on travel only;
- 60 s stops;
- the LDR 1 double count;
- rules R6/R7/R8 as is.

## 15. Verification

`docs/spec/fixtures/verify_spreadsheet.py` is an independent Python re-implementation; it does not share code with the extractor. It recomputes:
- the Travel Time segments from the raw Data Dump points and the speed tables;
- the full ActiveRoute chain;
- the macro closed form;
- the Targets plan formulas;
- the crew numbers, via a generic evaluator for the JSON rule-set.

Results are compared with the cached values at relative tolerance 1e-6. With `--workbook`, it also:
- checks that every fixture value equals the workbook's cached cell exactly;
- recomputes the chain straight from the workbook's own Data Dump.

Run on 2026-11-04 (`python3 -I verify_spreadsheet.py --workbook calc.xlsm`):

| Section | What | Pass | Fail |
|---|---|---|---|
| A.segments | 116 rows × (A,B,C,D,J,K,L,M, ROUND) + exclusion list | 1 162 | 0 |
| A.totals | F15, F16, H15, H16 | 4 | 0 |
| A.outputs | C4, C5, C7, C8, C9, C10, C12, C14, C15, C16, C17, C19, C20, C21, C22, C24, C26, C28 | 18 | 0 |
| A.macro (derived) | Macro_1..9 closed form vs fixture table | 36 | 0 |
| B.plan | targets, E47, E48, E55–E58, week totals | 86 | 0 |
| B.crew | rule engine vs every crew cell, both blocks, 7 days | 350 | 0 |
| C.raw | 23 strings, current string == Data Dump, derived travel times | 73 | 0 |
| D.workbook | fixture values == workbook cached values (exact) | 1 193 | 0 |
| D.recompute | chain recomputed from the workbook's own Data Dump vs cached cells | 950 | 0 |
| **Total** | | **3 872** | **0** |

Maximum relative error on toleranced checks is **5.0 × 10⁻¹⁶**: the last-bit difference in the 112-term SUM, e.g. C4 171.56703384077267 vs the cached 171.56703384077264. Without `--workbook` (fixtures only, no openpyxl needed) the run gives 1 729 pass / 0 fail.

As a negative control, perturbing one speed-table entry and one crew parameter in a copy of the fixtures produced 91 failures, so the checks are discriminating.

How mismatches were resolved during the work:
- The crew-line check first failed on row 79/107 ("EX03/EX08 (support)"). The cause was in the fixture's line map: the rule is per-circuit, keyed to LDR 1, but the line was mapped to a global role. The map was corrected. The spreadsheet logic was not involved.
- Nothing else needed investigation.

Not verifiable from cached values:
- the GoalSeek path itself (only its closed form is checked);
- the per-string travel times of the 22 Raw Data strings that are not loaded in Data Dump. These are derived with the verified algorithm and marked `derived_not_cached`.
