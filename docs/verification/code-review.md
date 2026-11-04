# hAIul SIM: independent correctness review (engine, geom/io, state)

Scope: `src/engine/**`, `src/geom/**`, `src/io/**`, `src/state/**`, checked against `src/core/types.ts` and `docs/ARCHITECTURE.md`.
I did not change any code under `src/`. Every defect below has a failing vitest test under `tests/review/`. Run them with
`npx vitest run tests/review`: **17 tests, all 17 currently fail**, and each failure is the defect it names. The existing suite
(194 tests) still passes. The defects are ranked by how directly they would show a planner a wrong number or lose data.

| # | Severity | Defect | Test(s) |
|---|---|---|---|
| 1 | High | The priority planner freezes site-task counts, so its crew plan does not fit the shift once applied | R-PRIO-1, R-PRIO-2 |
| 2 | High | Closed solid with mixed winding gets a confident, wrong volume | R-GEOM-1, R-GEOM-1b |
| 3 | Medium-High | Shift sim: a truck on its rolling fuel stop holds the loader, so simulated production falls below the calculation | R-SIM-1..3 |
| 4 | Medium | Kinematic: a stop sign on a repeated point is lost on the loaded leg but still counted as modelled | R-KIN-1 |
| 5 | Medium | Overlapping shift events are subtracted twice, so productive minutes are wrong and run backwards | R-SHIFT-1, R-SHIFT-2 |
| 6 | Medium | A crew-rule expression that divides by zero turns the crew total into NaN | R-EXPR-3 |
| 7 | Low-Medium | Expression tokenizer: `1e-3` is read as `1 − 3`, and malformed numbers are accepted | R-EXPR-1, R-EXPR-2 |
| 8 | Low-Medium | DXF export: two strings can get the same layer name, giving a duplicate LAYER record | R-IO-1 |
| 9 | Low-Medium | `store.commit`: the no-op guard can never fire, so no-op edits clear redo | R-STATE-1 |
| 10 | Low | `reversePoints` keeps `stopOneWay`, so the other traffic stream stops | R-GEOM-2 |
| 11 | Low | DXF export writes a non-finite coordinate as `0.0` | R-IO-2 |

---

## 1. Priority planner freezes site-task counts (High)

**Where:** `src/engine/priority/plan.ts:94`, `:139`, `:171`, `:217`

**Defect:** The planner works out a prioritised task's "full" count once, at the first truck allocation (`taskFull`). It then
sheds, back-fills, deletes overrides and reports from that frozen number. The default `R7_BULK_PUSH` count depends on
`totals.trucks` (`7 − enabling − max(0, trucks − 12)`), so the frozen number goes stale as soon as the planner removes trucks.

**Failure scenario:** 15 trucks requested (EX09 6, EX04 5, LDR coal 4 at P5); manning needs 36; push task is P4.
- *Crew 35.* LDR is parked, which leaves 11 trucks, so R7 is really **6** people. `crewUsed` = 32 includes those 6. But
  `tasks.R7.allocated` = **3**, and `bcmDayAchieved` leaves out 3 × 5,760 = **17,280 bcm/day** of push production.
- *Crew 30.* The task is shed from the frozen 3 (`3 − 1 = 2`, when the live count is 6). Back-fill then brings it back to 3, and
  line 171 deletes the override because 3 ≥ the frozen full of 3. The planner reports push "not reduced (3/3)" and
  `crewUsed` 29 ≤ 30. After *Apply priority allocation*, the Manning tab shows **32 required vs 30 available**.

**Tests:** `priority.review.test.ts` › R-PRIO-1, R-PRIO-2

**Fix:**
- Re-evaluate task counts from the live evaluation in every shed or fill step. A task's natural count is `ev.ruleCounts` at the
  current allocation with no override. Express a shed task as an override below that live value.
- Report `requested` from `reqEval.ruleCounts` and `allocated` from the final `ev.ruleCounts`.
- Only drop an override when it equals the natural count at the *final* allocation.

## 2. Closed solid with mixed winding gets a wrong volume (High)

**Where:** `src/geom/mesh.ts:149-153` (`meshStats`); `src/geom/depletion.ts:91-96` (`prepareSolid`)

**Defect:** `closed` only checks that every edge has two triangles. The volume is then the absolute value of the
signed-volume sum, even when `meshTopology` has found `inconsistentEdges > 0`. Inward triangles subtract instead of add. The
importer (`geomBridge` → `meshStats`) never reorients the mesh or warns.

**Failure scenario:** A 10 m cube (1,000 m³) with its two top triangles wound inward is reported as `closed: true` with
`volume` **666.7 m³**. `prepareSolid` gives the same 666.7 m³, so dig `digFraction`, dump capacity and depletion-plane
positions are all wrong, with no warning.

**Tests:** `geom.review.test.ts` › R-GEOM-1, R-GEOM-1b

**Fix:** Orient the shells consistently before the volume sums: flip triangles by a BFS over manifold edges, then make each
shell's signed volume positive. If that is not possible, return `volume: undefined` and raise an import warning whenever
`inconsistentEdges > 0`. Use the same reoriented triangle list in `prepareSolid`.

## 3. Shift sim: a truck on its rolling fuel stop holds the loader (Medium-High)

**Where:** `src/engine/shift/sim.ts:112-113` and `:139-140`

**Defect:** `svc[k]` includes truck k's own staggered pause windows, so `advance(bestStart, spotS/loadS, svc[k])` stretches
that truck's spot or load across its whole 15-minute fuel window. The loader stays blocked even though other trucks are
queued. The module header says a loader-limited circuit "digs exactly rate × PT per shift".

**Failure scenario:** Default shift profile, which has fuel at f = 0.25. EX09 (1,800 bcm/PT h, 20 h) needs about 6 trucks.
| Trucks | Simulated (bcm/shift) | Calculation |
|---|---|---|
| 6 | 17,368 | 18,000 |
| 8 | 17,576 | 18,000 |
| 10 | 17,257 (−4.1 %) | 18,000 |

At 10 trucks the loader is held for 2 × 15 min. Production is not monotone in trucks. With the fuel event removed, every
count from 6 trucks up gives 17,992. The depletion slider, `bcmShift` and the "Simulated production" step all show the
low numbers.

**Tests:** `engine.review.test.ts` › R-SIM-1, R-SIM-2, R-SIM-3

**Fix:**
- When picking the next truck, skip a truck whose own (non-loader) pause intersects `[start, start + spot + load]`, and
  serve the next queued truck instead.
- Alternatively, move a rolling pause that would start under the loader to the truck's next travel phase.
- Only loader-down windows should stretch spot or load.

## 4. Kinematic: a stop sign on a repeated point is lost on the loaded leg (Medium)

**Where:** `src/engine/haul/circuit.ts:386`, `:393`; `src/engine/haul/route.ts:80-83`, `:119`

**Defect:** `stopAtEnd: stopL.has(sg.i + 1)` assumes the segment that ends at point k has index k−1. When segment k−1→k has
zero length, it is skipped, so no loaded segment carries the stop at point k. `stopsModelled = stopsPerCycle(route)` still
counts that stop, so the stop penalty is reduced as well.

**Failure scenario:** A 800 m flat haul with a stop at 400 m, where the stop point is digitised twice (a double-click).
- Loaded travel: **88.2 s**, against 119.4 s for the same string without the duplicate.
- The cycle is about 37 s short, and the penalty does not make up the difference.
- The empty leg still stops.

**Test:** `engine.review.test.ts` › R-KIN-1

**Fix:** In `buildRoute`, record each kept segment's end point index after skipping, and attach stops by that index (or by
chainage). Compute `stopsModelled` from the stops `kinematicLeg` actually applies (`nodeStop`), not from `route.stops`.

## 5. Overlapping shift events are subtracted twice (Medium)

**Where:** `src/engine/shift/profile.ts:10-24` (`productiveMinutes`, `productiveMinutesAt`)

**Defect:** Lost time is summed event by event, with no union. The simulation itself merges windows (`mergeWindows`), so the
productive fraction, the standby length and `timeAtProductive` (a bisection that assumes monotone input) disagree with the
simulation.

**Failure scenario:** Crib 12:00–12:30 plus a blast clearance 12:00–12:45, both f = 1.
- `productiveMinutes` = **645** min instead of 675.
- `productiveMinutesAt(380)` = 340 < `productiveMinutesAt(360)` = 360, so the depletion slider's `productiveFraction` runs
  backwards during the overlap.

**Tests:** `engine.review.test.ts` › R-SHIFT-1, R-SHIFT-2

**Fix:** Integrate over the elementary intervals of the merged event boundaries, using the combined stop fraction in each
interval: `max(f)`, or `1 − Π(1 − f)`.

## 6. Crew-rule expression divides by zero, total becomes NaN (Medium)

**Where:** `src/engine/manning/evaluate.ts:154-157`

**Defect:** `safeEval` returns whatever the expression evaluates to, including `NaN` and `Infinity`. That value goes straight into
`required[role]`, `total` and `surplus`, with no warning.

**Failure scenario:** The rule `ceil(totals.trucks / totals.activeLoaders / 4)` on a shift with every loader parked computes
0/0, so `total` and `surplus` are both **NaN**. The Manning and Priority tabs then show NaN.

**Test:** `manning.review.test.ts` › R-EXPR-3

**Fix:** If `!Number.isFinite(per)`, push a warning and use 0 (or `rule.count`).

## 7. Expression tokenizer misreads numbers (Low-Medium)

**Where:** `src/engine/manning/expr.ts:17-20`

**Defect:** The number scanner accepts the characters `[0-9.eE]` but not the exponent sign, and `parseFloat` silently drops
whatever it cannot read.

**Failure scenario:**
- `1e-3` → **−2**, because it is read as `1 − 3`.
- `1.2.3` → 1.2, with no error.
- `.` → NaN.

**Tests:** `manning.review.test.ts` › R-EXPR-1, R-EXPR-2

**Fix:** Match `/(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?/y` at position i. Throw if the next character is a digit, `.` or a letter.

## 8. DXF export: duplicate layer names (Low-Medium)

**Where:** `src/io/strings.ts:231-236` (`toDxf3dPolyline`)

**Defect:** Names are de-duplicated per base name, but the generated `BASE_k` is never checked against the layer names of
other strings.

**Failure scenario:** Strings "Haul", "Haul" and "Haul 2" produce the layers `HAUL`, `HAUL_2` and `HAUL_2`.
- The LAYER table lists `HAUL_2` twice. AutoCAD and Deswik reject or merge duplicate table records.
- Two different strings end up on one layer, so they cannot be told apart in Vulcan or Deswik.

**Test:** `io.review.test.ts` › R-IO-1

**Fix:** Keep a `Set` of names already emitted. Increment `k` (and truncate the base to fit 31 characters) until the name
is unused.

## 9. `store.commit`: the no-op guard can never fire (Low-Medium)

**Where:** `src/state/store.ts:147-148`

**Defect:** `touch()` always returns a new object, so `next === prev` is never true. Every commit pushes an undo entry, clears
`future` and sets `dirty`, even when `fn` returned its input unchanged.

**Failure scenario:** Undo an edit, then trigger any handler that returns `s` unchanged. The redo history is lost, an empty
undo step is added, and the document is marked dirty.

**Test:** `state.review.test.ts` › R-STATE-1

**Fix:** `const raw = fn(prev); if (raw === prev) return; const next = touch(raw);`

## 10. `reversePoints` keeps `stopOneWay` (Low)

**Where:** `src/geom/strings.ts:153-166`

**Defect:** `stopOneWay` means "loaded" or "empty" relative to the dig→dump direction. Reversing the string (and swapping
dig and dump) keeps the stop point but not the traffic stream it applies to.

**Failure scenario:** A stop at point b that applies to loaded trucks going a→c. After *Reverse string*, a→c is the empty leg,
but the stop is still marked `'loaded'`, so trucks going c→a stop instead.

**Test:** `geom.review.test.ts` › R-GEOM-2

**Fix:** Swap `'loaded'` ↔ `'empty'` in `reversePoints`.

## 11. DXF export writes a non-finite coordinate as `0.0` (Low)

**Where:** `src/io/strings.ts:259` (`fmt`)

**Defect:** `NaN` and `Infinity` are written as `0.0`.

**Failure scenario:** A point with a NaN RL is exported at RL 0.0. A NaN E/N puts a vertex at the grid origin, which is the
workbook's "phantom segment" bug, now handed on to Deswik or Vulcan.

**Test:** `io.review.test.ts` › R-IO-2

**Fix:** Throw a user-facing error, or skip the vertex and return a warning.

---

### Checked and found sound (no defect reproduced)

**vulZ / FastLZ decoder.** I ran 9,000 random byte mutations across the flat, tree and run layouts, plus 3,000 raw `.00t`
mutations. Every one either parsed or threw the user-facing error, with no hangs, no out-of-range indices accepted and no
DataView `RangeError`. The pointer tree is bounded by a seen-set, a depth limit of 64 and a page-count bound.

**Depletion.** I tested a concave U-shaped solid at MGA coordinates over 6 azimuths × 7 fractions, plus bench-down/bottom-up
and an icosphere:
- the bisection hit the requested fraction within 1e-4 every time;
- `clipMesh` front and back volumes matched `volumeBehindPlane` and stayed closed;
- the cap area was correct.

**Other modules checked:**
- `heightAt` at the bbox edges and corners.
- Spreadsheet table lookup, Excel ROUND and the FastLZ level-2 distance encoding.
- The M/M/1//N formulas.
- The memoisation in `derived.ts`. It is keyed on scenario identity and every engine cache is keyed on immutable objects; I
  found no in-place mutations at the call sites.

**Noted, not counted as defects:**
- `gridHeightAt` within one cell of a surface edge renormalises onto the nearer node. For a 7 m grid on a 10 % slope that is
  up to about 0.6 m. This behaviour is documented.
- A segment speed override above the circuit's global limit is ignored. This is documented as a "global cap", but the
  haulage point table displays the override.
