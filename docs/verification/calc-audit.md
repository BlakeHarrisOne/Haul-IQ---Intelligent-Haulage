# hAIul SIM: independent calculation audit

Scope: the numbers produced by `src/engine/**` and `src/data/**`. Ground truth is the workbook `calc.xlsm`, spec 01, and the methods and sanity table in spec 04. I did not change anything under `src/`.

**Tree audited:** HEAD `ecea9b6`, plus the uncommitted engine edits other agents were making while the audit ran (`haul/circuit.ts`, `haul/route.ts`, `shift/sim.ts`, `shift/profile.ts`, `manning/evaluate.ts`, `manning/expr.ts`). The final run was against that working tree.

**How to rerun:**
- `npx vitest run tests/audit` gives 86 tests: 80 pass and 6 fail. Each failure reproduces one defect below.
- To regenerate the workbook-derived fixtures:
  - `python3 -I tests/audit/tools/xlmodel.py <calc.xlsm> tests/audit/workbook-derived.json`
  - `python3 -I tests/audit/tools/xlcrew.py <calc.xlsm> tests/audit/workbook-crew.json`
- Each script first checks its own model against the workbook's cached cells: 116 Travel Time rows plus C4…C28 for xlmodel, and 14 crew-block days for xlcrew. All match exactly (0 mismatches). Only then does it write expectations.

## Summary

| # | Item | Method (independent of the engine's own fixtures) | Checks | Result |
|---|---|---|---|---|
| 1 | Spreadsheet parity | Python model of every Travel Time / ActiveRoute formula, with tables, EX blocks and strings read straight from the sheets. 27 cases: ActiveRoute; 10 Raw Data strings (#1, 2, 7, 8, 14, 17, 18, 20, 21, 22) with varied B3/C3/C6/C11/C20/I34; 6 truck types; 5 EX blocks; exact ±0.155/±0.165 and other half-step ties; a 1 500-segment near-tie fuzz; single segment; duplicate points; vertical step. All 23 strings for C4/C5. | ≈33 000 values: per-row A/B/ROUND/C/D/K/L/M; C4–C28; buttons 1–9 (C20/C17/C24/C26/C28/capped) | **PASS**. Max relative difference ≤ 1e-12. The negative control is caught. |
| 2 | CalcStep integrity | Demo circuits in 5 modes, each with its alternative string and with n = 1/3/8. Every value is checked against both its result field and an independent recomputation. Each `substituted` expression is parsed and evaluated (×, −, MIN/ROUNDUP). The `fleet.assigned` note numbers, the travel speed-band counts, and the manning/priority/shift steps are also checked. | 1 638 circuit steps; 53 other steps | **FAIL (1, low)**: D3 |
| 3a | Physics, steady | 8 trucks. F·v ≤ 0.9·P_net at every envelope and gear point (max 0.851). Speed is monotone in grade 0…25 %, and descents are monotone too. Empty speed ≥ loaded. Descents: retarder force ≥ required and power ≤ P_ret. Resistance checked by hand. Spec 04 §G.3 table (72 speeds, max rimpull, rim kW) | ≈7 200 grade points | **PASS**. Every §G.3 speed is within ±0.15 km/h, for example 789C loaded at 10 % gives 12.01 vs 12.0. |
| 3b | Physics, kinematic | Long constant climbs; an independent fine-step (0.25 m) forward–backward reference; a force/power check on every accelerating interval; NaN/negative checks; a stop-sign check. | 40 climbs, 48 demo legs, 12 912 intervals, 184 string×truck runs | **FAIL (high)**: D1 |
| 4 | Fleet / queuing | Options monotone in n (production, lost PT, queue, status, wait, busy) for 3 queue models × 2 speed models. MF and C17/C24/C26 identities. M/M/1//N checked against explicit factorial sums. Spec 04 §C.4 table (det / binomial / M/M/1 t/h and wait) | 360 options, 35 table values | **PASS** (one note: I5) |
| 5 | Shift simulation | Demo, sampled every 1 s and every 2 min. One truck at the loader at a time; production ≤ calculation + 1 load; loads × load vs `shiftStateAt`; Σ per-truck loads; trucks stationary during full-stop events; position continuity; digFraction monotone and ≤ 1. | ≈518 000 truck-samples | **FAIL (low, animation only)**: D4. Everything else passes. |
| 6 | Manning | 14 workbook scenarios (2 blocks × 7 days, rows 47/52/57/65–116) re-derived from the cells. Block-2 typed values are applied as overrides. 8 synthetic day plans use the workbook formulas: 13, 14, 18, 19 and 20 trucks (push 5/4/0/0/−2), LDR2 only, no trucks, enabling 2. Demo manning = 36. | 23 scenarios × 12 rule groups | **PASS** |
| 7 | Priority planner | Crew swept 40→0 at 12 trucks. Requests above the trucks available, at 12 and 15 trucks. Coal at P5 below push P4. For each plan, the crew the rules need for the reported plan is recomputed with `evaluateCrew`. Priority order is tested by checking whether shedding everything below P could have fitted one more productive truck. Alternatives are checked against `computeCircuit`. | 78 plans | **FAIL (high)**: D2. Limits, priority order and alternatives pass. |

## Confirmed defects

### D1 (High): the kinematic integrator holds a speed above the balance speed on sustained climbs

**Where:** `src/engine/haul/kinematic.ts:142-152`.

**Cause:** The RK2 predictor `w0 + k1·h` drops below a force discontinuity:
- for the 1st→2nd gear governor drop, the predictor lands in 1st gear, where force is high;
- for the 930E, `wp < 0` lands at v = 0, where F = F_max.

The corrector then averages a large positive and a large negative acceleration. This produces a fixed point well above the true balance speed. The clamp to `bal` only fires when a step crosses `bal` from below (line 150) or lands at or below `bal` from above (line 151). A truck already above `bal` that "accelerates" is therefore never clamped.

```ts
const hs = straightString('h', [{ len: 200, grade: 0 }, { len: 1500, grade: 0.12 }, { len: 200, grade: 0 }], 20);
const c = circuitFor('c', 'EX09', 'KOM_930E_5', 'OB', 'h', 5, { speedModel: 'rimpull', motion: 'kinematic', rrPct: 2 });
computeCircuit(scenarioWith([hs], [c]), c);
// climb plateau 12.70 km/h with F_rim(12.7) = 440 kN < F_res = 715 kN; steady (correct) 7.81 km/h → +63 %
```

Plateau overshoot on 1 500 m climbs (kinematic vs steady):

| Truck | Grade | Kinematic → steady | Overshoot |
|---|---|---|---|
| 930E-5 | 12 % | 12.70 → 7.81 | +62.6 % |
| 777G | 10 % | 11.89 → 10.91 | +9.0 % |
| 789C | 8 % | 12.76 → 12.01 | +6.3 % |
| 789D | 8.96 % | 13.35 → 12.61 | +5.8 % |
| HD1500 | 8 % | 11.51 → 11.01 | +4.5 % |
| HD785 | 10 % | 12.72 → 12.21 | +4.1 % |
| 793F | 8 % | 13.30 → 12.91 | +3.0 % |
| HD1500 | 8.96 % | 11.24 → 11.00 | +2.2 % |
| 789D | 6 % | 17.43 → 17.11 | +1.9 % |
| HD1500 | 6 % | 14.94 → 14.71 | +1.6 % |

10 of the 40 truck × grade cases are affected: every mechanical case where steady is governed in a gear (`governor_g*`), plus the 930E at 12 %. The other rimpull-limited cases match.

**Effect on the demo:** EX09 (789D) loaded travel is 283.9 s against 287.4 s from the reference (−1.2 %). The 789D on the EX04 route is −1.8 %. 136 of the 12 912 intervals accelerate although F_rim < F_res. Kinematic is the default rimpull motion.

**Fix:** For a propel segment with `v0 ≥ bal − ε`, cap `v1 ≤ max(bal, coast-down speed)`. When `sign(k1) ≠ sign(k2)`, use `k1` (Euler), or sub-step.

**Tests:** `physics.test.ts` › "long constant climb…", "…independent fine-step reference", "every accelerating kinematic interval…".

### D2 (High): the priority planner freezes site-task counts, so its plan needs more crew than it reports

This is the same defect as code-review #1, reached independently here.

**Where:** `src/engine/priority/plan.ts:94` (`taskFull` frozen at the first allocation), `:135`, `:152`, `:171` (the override is deleted when it is ≥ the frozen full count), and `:217`.

**Repro:**

```ts
// demo with EX09 6, EX04 5, LDR1 4 trucks and LDR1 priority 5 (below bulk push P4)
const pr = computePriority(s, computeAllCircuits(s), { crewAvailable: 30, trucksAvailable: 15 });
// pr.crewUsed = 29, LDR1 parked, tasks R7 = 3/3 "not reduced"
evaluateCrew({ circuits: crewCircuits(s, id => alloc.get(id)), rules: s.crew.rules, … }).total // = 32 > 30
```

R7 is computed at 15 trucks as 7 − 1 − 3 = 3. Once LDR1 is parked, 11 trucks remain and R7 is really 6. The planner's own crew total (29, using the stale override) disagrees with the plan it reports (32). For crew 29–35 the planner reports R7 at 3/3 while the plan gives 6. At crew 29–31 the applied plan needs 32, more than the crew available.

**Test:** `priority.test.ts` › "coal circuit below the push task…".

### D3 (Low): `shift.bcm` substituted expression has the wrong precedence

**Where:** `src/engine/shift/sim.ts:198`.

The step reads `"58 + 0.99 × 100"` (which evaluates to 157), but the value is (58 + 0.99) × 100 = 5 899. It needs parentheses whenever a load is in progress at the end of the shift.

**Test:** `calcsteps.test.ts` › "manning, priority and shift steps".

### D4 (Low, animation): queue positions teleport

**Where:** `src/engine/shift/sim.ts:350-351` (`truckStatesAt`).

Queued trucks jump `QUEUE_GAP_M` = 15 m in a single instant when the truck ahead leaves the queue (71 jumps). A truck served from slot 1 starts its spot run at slot 0, jumping about 15.8 m (3 jumps). Those 3 come from the in-progress change where a fuel-stopped truck sits out its stop in the queue. There are 74 jumps above speed × 1 s + 0.5 m over the demo shift. Production numbers are not affected.

**Fix:** Ease the queue chainage between slots at creep speed, and start the spot run from the truck's current slot.

**Test:** `shift.test.ts` › "positions are continuous in time…".

### D5 (Low): the rimpull envelope deviates from the per-gear curves

There is no failing test for this one; the numbers come from the audit probe.

**Where:** `src/data/trucks.ts:112` → `src/engine/util/curve.ts:93-100`. `envelopeOf` samples breakpoints and midpoints, and the result is then interpolated in power space.

The envelope overstates the best-gear rimpull by up to +12 % in a band of about 0.2 km/h just above each upshift (789C +12.0 % at 40.43 km/h, 793F +12.3 %). It understates by about 2 % in the 1st-gear converter region (≈1.5 km/h). The steady solver uses the gear curves, so it is unaffected. The kinematic forward pass and the Truck Curves chart use the envelope.

## Not defects (deviations and notes)

- **I1 – blank row:** A blank or origin row inside a string is refused with an error (`route.ts` guard). Excel instead adds a phantom segment: the workbook model gives C4 846 667.6 s and C5 846 666.7 s for a blank row 11. This is deliberate and safer than spec Q14 "emulate".
- **I1 – other workbook-only behaviour the engine does not emulate:**
  - A to-point whose easting is exactly 0 in a local grid: Excel blanks that segment.
  - Strings longer than 3 326 points: Excel truncates them.
- **I2:** The demo LDR1 uses 18 PT h (Targets "Hours"). ActiveRoute uses I34 = 20 for every EX, so parity needs `truckPtHrsPerDay = 20` (the parity test sets it from I34).
- **I3:** `trucksRecommended = ceil(N − 1e-9)` differs from ROUNDUP only for N within 1e-9 above an integer.
- **I4:** Spec 04 §G.3 uses θ = atan(G), while the engine's grade is sin θ (ΔZ/slope). After converting, all 72 speeds agree within ±0.15 km/h and max rimpull within 1 kN. The electric "rim kW" is +0.5 % (1 443 vs 1 436 kW), within the doc's own ≤ 1 % note.
- **I5:** The match factor uses service time. Trucking status uses the planned rate. With the planned rate below service capacity (EX09: 1 800 vs 2 674 bcm/h), status reaches "balanced" at n = 6 with MF 0.70. Meanwhile the `fleet.matchFactor` note says "MF < 1 under-trucked (loader hangs)". This is worth reconciling in the UI text.
- **I6:** Kinematic is faster than steady in 51 of 184 string × truck runs. Part of that is legitimate momentum carried through short rises (the 930E entering a 200 m rise at 50 km/h). Part is D1. "Kinematic ≥ steady" is therefore not a valid invariant. The per-interval force check is, and it is the one that fails.

Shift simulation versus the calculation on the demo: EX09 −0.5 %, EX04 +0.2 %, LDR1 +0.8 % per shift. On this tree, one truck at the loader at a time and production ≤ calculation + 1 load both hold.
