# 04 — Market scan and calculation methods

Status: draft, research output (2026-11-04). Scope: the hAIul SIM haulage simulation and planning engine for Queensland open-cut coal (truck fleet CAT 789C, CAT 789D ("789XD" on site), Komatsu HD1500-7, Komatsu HD785-7; loading tools Komatsu PC4000, Liebherr R996B, Hitachi EX2600, Hitachi EX5600, Komatsu WA900).

Companion fixture: [`fixtures/oem-curves.json`](fixtures/oem-curves.json) (machine library, section G).

## How to read the evidence tags

Every number below carries one of these tags. A number is only as good as its tag.

| Tag | Meaning |
|---|---|
| **[OEM]** | Read from a manufacturer or manufacturer-dealer spec sheet or page. In this session the PDFs themselves could not be downloaded (the network policy blocked `www.cat.com`, `lectura-specs.*` and other hosts; see "Research limits" at the end), so these values came from search-engine extracts of those documents. Check them against the PDF page before you rely on them. |
| **[3P]** | Third party: spec aggregator, hire company, used-equipment listing or trade press. |
| **[LIT]** | Peer-reviewed or academic literature, or a standard. |
| **[EST]** | Our estimate. The method is always stated, so it can be reproduced and replaced. |
| **[OBS]** | Our own observation, for example from decoding the sample `.00t` files. |

Sources are numbered `[S#]` and listed in section H.

---

## A. Competitive feature map

### A.1 Planning and simulation tools

| | **RPMGlobal HAULSIM** | **RPMGlobal TALPAC / TALPAC-3D** | **Micromine Spry (haulage)** / **Alastri Haul Infinity** | **Deswik.LHS** (Landform & Haulage) |
|---|---|---|---|---|
| Core idea | 3D road network discrete-event simulation (DES) of a whole mine | Single loader–truck circuit productivity and cost, stochastic | Spry: schedule-driven haulage over generated haul profiles. Haul Infinity: haul simulator | Landform (dump) scheduling coupled to truck haulage inside Deswik CAD and Sched |
| Key features | 3D network; queues and congestion at sources and sinks; breakdowns; Fleet Planner (auto truck count per configuration, 300+ outputs) [S1][S4][S6]; Cornering Speed (radius estimated from the network, speed caps on bends, since v2.5) [S4]; accel/decel *within* a segment (v3.0; earlier versions used an average speed per segment) [S5]; battery-electric, trolley, hydrogen and hybrid trucks; conveyors [S1][S3] | Stochastic variables for truck and loader parameters, DES [S9]; per-segment reports plus an intra-segment report linking speed, rimpull curve and fuel [S9]; sensitivity runs (ramp length, truck numbers); fleet optimisation; bunching [S9][S36] | Spry: haul profiles built from Points and Vectors; speed restrictions on corners (by direction change) and on ramps (by grade, each direction); truck database of 100+ truck/engine combinations; RR, effective grade, rimpull, retard, TKPH, traction [S10][S12]. Haul Infinity: zone speed limits (active work area, access road, main road; where limits conflict the lowest wins); optional second rimpull curve for trolley assist; acceleration from rimpull and axle weights, capped by traction and retarder settings [S11] | Truck-limited mining and dump schedules; mixed fleets; dynamic haul paths, stop signs, speed limits, rolling resistance, congestion, release dates; conveyors; dragline and dozer dumps; trolley assist [S14] |
| Typical inputs | Road strings or network, segment RR, speed limits, truck/loader specs, shift roster, breakdown statistics, GPS for speed calibration [S2][S3] | Haul segments (length, grade, RR, speed limits), truck and loader specs, material, bucket fill, distributions, roster | Schedule steps (sources to destinations), haul profiles, truck curves, RR, limits | Deswik schedule, dump designs, haul network, fleet |
| Outputs / KPIs | Production per shift, cycle-time breakdown, queue time, truck count, cost, fuel, utilisation per machine [S2][S6] | t/h per operating hour, shift and year; cycle breakdown; truck and loader efficiency; cost/t; fuel [S9] | Cycle times per step; truck count = loader rate / truck rate (or truck hours / loader hours) [S10] | Truck hours, fleet requirement per period, fed back into Deswik.Sched [S14] |
| UI conventions | 3D scene with an animated fleet, network editor, dashboards | Form- and table-driven (Windows desktop), segment grid, report pages | Spry: Gantt/schedule plus profile tables. Haul Infinity: 3D | CAD plus Gantt in the Deswik suite |
| Typically opaque | Exact speed-solving and accel model, OEM curve provenance (the curve library is vendor-maintained), DES randomness and seeds, how "cornering speed" maps radius to speed | Distribution choices, bunching/efficiency math, curve library provenance | Truck curve library provenance, how corner speed restrictions are derived | Speed and rimpull mechanics are thinly documented publicly [S14] |

Notes:

- A third-party comparison describes Spry haulage as route-based rather than full DES [S13]. That claim comes from a competitor, so it is not verified.
- Generic vendor documentation of the same physics (useful for parity checks):
  - Precision Mining: rimpull curves give speed, gear and force from weight and effective grade; retard curves give sustained downhill speed; speed limits are set by segment code or by criteria [S15].
  - Datamine StudioOP: a linear model or a rimpull/retardation model; loaded and empty grids of effective gradient vs speed vs rimpull; an acceleration distance that limits exit speed when it exceeds the segment length [S16].
  - RPM KPROSIM: segments must be homogeneous; default RR 2.0 % main road, 2.5 % bench/ramp/dump, 3.0 % at the loader [S7].
  - RPM XPAC: retarder speed is where retarder force equals the downhill force [S8].

### A.2 Real-time fleet management (dispatch) systems

| | **Modular Mining DISPATCH** (Komatsu) | **Cat MineStar Fleet** | **Wenco (Wencomine FMS)** |
|---|---|---|---|
| Core features | Real-time assignment of trucks to loaders and dumps using linear programming, best-path and dynamic programming; minimise queuing and idle time; shift changes, refuelling, downtime events; in-cab guidance; 175+ OEM interfaces [S17]. Modules: Speed Management, Prestart, Fuel, Blending, KPI dashboards, Crew Line-Up; DISPATCH Simulate (shift scenario modelling), Look Ahead [S17] | Assignment engine working toward shift goals; monitors fuel, TKPH and other KPIs; real-time cycle time and payload; production recording (grade, location, delays, operator proficiency); what-if on assignments [S18] | Open architecture (open database, published APIs) for mixed OEM fleets; dashboards; Open Autonomy API; contributor to ISO 23725:2024 (autonomy–FMS interoperability) [S19] |
| Inputs | GPS, payload, machine states, operator log-ins, plan targets | Same, plus Cat machine telemetry | Same |
| Outputs / KPIs | Production, queue/hang time, utilisation, cycle components, delays by code | Cycle time, payload, blends, cost drivers (fuel, tyres, idle) [S18] | Production and progress KPIs |
| UI | Live pit map and controller console | Live map and office console | Live map and dashboards |
| Opaque | Optimiser formulation and weights; claimed gains (5–34 %, mean 11 %) are vendor figures [S17] | Assignment logic; claimed 10–15 % gain is a vendor figure [S18] | Not much is algorithmic; openness is self-reported [S19] |

Dispatch systems matter to us as **data sources**: actual cycle segments, GPS speed-on-grade, delay codes, payloads, and the time model as recorded. They are also the benchmark planners compare a plan against.

Cat FPC (Fleet Production and Cost) is a legacy Caterpillar estimator. It offers "minimum / average / maximum / no bunching" options and a theoretical fleet match figure [S20]. The bunching math is not publicly documented.

### A.3 Features hAIul SIM must have (parity)

1. A haul network built from 3D strings: segments carry length, grade, RR, speed limits, one-way/two-way, intersections and stop/give-way nodes.
2. A machine library with rimpull and retarder curves (per gear, or an electric envelope), masses, body volumes and loaded/empty speed caps. Users can edit it, and every value is versioned with its source.
3. Physics-based speed and time per segment: rimpull-limited, retarder-limited and limit-capped, with acceleration and deceleration across segment boundaries.
4. Truck–loader matching: passes, loading time, spot/exchange time, match factor, a queuing/bunching model, truck count optimisation, and cost/t.
5. A time model (calendar → available → utilised → productive) with configurable delay codes, giving PT hours and annualised rates.
6. Shift roster, crib, shift change, fuelling and blast windows.
7. Scenario comparison (A/B), sensitivity runs (RR, grade, payload, truck count), and export to CSV/XLSX.
8. Fuel estimate, TKPH, and trolley/battery options (phase 2).
9. Calibration to site GPS: fit per-segment efficiency or RR so that modelled speed matches measured speed-on-grade.

### A.4 Where we beat them

| Differentiator | What it means in the product |
|---|---|
| **Transparent calculations** | Every segment result shows the binding constraint (rimpull in gear *g*, retarder, segment limit, curve limit, stop, accel/decel ramp, traction), the force balance (`F_rim`, `F_grade`, `F_RR`), the gear and the equations with numbers substituted. The queueing model and its assumptions appear beside the truck-count curve. No hidden "operator efficiency" multipliers: any factor applied is a named, visible line item. |
| **OEM curve provenance** | Each curve point carries `sources[]` and `estimated` flags (see the fixture). Planners can see whether a speed came from a digitised OEM chart or from a power model. |
| **Digitise haul strings directly on Vulcan `.00t` surfaces** | Planners click on the pit triangulation (section F); grade and elevation are sampled from the surface, not typed in. |
| **POV / drive-along view** | Camera rides the truck along the solved speed profile. It is the most intuitive check that a profile is plausible (for example, braking for a bend before it, not at it). |
| **Depletion slider** | Animated shift and period depletion of blocks or solids driven by the shift production profile (section D), not a flat average rate. |
| **Crew and manning rules** | Operator availability constrains which machines can run. Support rules (coal dozer, dump dozer, graders and water carts per km) are enforced and, where possible, linked back to physics (no grader → RR rises; no water cart → speed limit drops). Section E. |
| **Over/under-trucking made explicit** | A truck-count curve with loader hang time and truck queue time, three bracketing queue models (deterministic / finite-source / DES), and cost/t. Section C. |
| **Spreadsheet parity mode** | The legacy grade → max-speed lookup can be run side by side so users see why physics and lookup differ. |

---

## B. Haulage physics: implementable algorithms

Units: mass `m` in t, `g = 9.81 m/s²`, so `m·g` is in kN. Speed `v` in km/h in data, m/s inside equations (`v_ms = v_kmh / 3.6`). Grade `G` and rolling resistance `RR` are in %. Power `P` in kW, which equals kN × m/s.

### B.1 Resistances and effective grade

```
θ        = atan(G / 100)                      # G signed: + uphill in direction of travel
F_grade  = m · g · sin θ                       # kN (sign follows G)
F_RR     = m · g · cos θ · RR / 100            # kN, always opposes motion
F_aero   = ½ · ρ_air · C_d · A · v_ms² / 1000  # kN, optional (default OFF for parity)
F_res    = F_grade + F_RR + F_aero

Effective grade (legacy/chart form):  G_eff = G + RR      (uphill)
                                      G_eff = G + RR  with G < 0 downhill  → negative = net retarding
RR in kg/t: 10 kg/t ≡ 1 %                                                   [S30]
```

- Use `sin(atan())` rather than the small-angle `G/100`. At 10 % the difference is 0.5 %, which is enough to show up in a calibration.
- **Effective-grade sign convention.** Spry, MineSched and Cat charts all state it as "uphill: grade + RR; downhill: grade − RR" [S12][S30][S23]. Internally we use one signed equation, so there is no special case.
- **Aerodynamic drag** (optional, [EST]). With frontal area about 45–55 m² and `C_d` about 0.9, drag at 55 km/h is about 6 kN. That is roughly 20 % of the empty-truck RR force on a 2 % road. It is off by default because the tools we are compared with ignore it. Expose it as a calibration switch.

### B.2 Rimpull-limited speed (mechanical drive, per gear)

Data: for each gear `g`, a list of points `[v, F]`. Interpolate in **power space** (`P = F·v` is linear in `v` between points, then `F = P/v`). This follows the hyperbolic shape of the curves much better than linear interpolation in `F`.

```
F_rim(v) = max over gears g of F_g(v)        # transmission picks the best gear
F_avail(v) = min(F_rim(v) · k_derate, F_traction)

F_traction = μ · m · g · cos θ · w_drive     # w_drive = drive-axle share (loaded 0.67, empty 0.50 for 789D [OEM])
```

**Steady (balancing) speed** on a grade is `v* = sup { v : F_avail(v) ≥ F_res(v) }`. The engine's governor cuts force to zero just above each gear's maximum speed, so this is always bounded. The per-gear curves fall with speed and step down at each upshift, so the envelope never rises and the supremum is unique. Solve it by bisection on the envelope, or by scanning the gears from the top down:

```
for g in gears (top → 1):
    if F_g(v_lo_g) < F_res(v_lo_g): continue        # gear can't hold even at its low end
    solve F_g(v) = F_res(v) on [v_lo_g, v_max_g] by bisection (monotone in gear)
    return (v, g)
return (stall / insufficient rimpull)
```

The result record must store `gear`, `v*`, `F_rim(v*)`, `F_res(v*)`, and `binding = "rimpull_g" | "governor_g" | "traction"`.

**Power sanity rule** (enforced by a unit test on the library): `F·v ≤ η·P_net` everywhere. Here η is drivetrain efficiency: 0.80–0.88 for mechanical lock-up [EST], lower in torque-converter drive.

### B.3 Electric drive (AC wheel motors: 830E-5, 930E-5)

There are no gears. The curve is a force-limited segment at low speed followed by a constant-power hyperbola:

```
F_rim(v) = min( F_max , η_e · P_gross · k_derate / v_ms )      for v ≤ v_top
η_e ≈ 0.75–0.80 (rim power / gross engine power, after fan/alternator/aux parasitics and
      alternator–inverter–motor–final-drive losses)                                   [EST]
F_max ≈ traction/current limit (fixture uses 0.25·GVW·g)                              [EST]
```

- **Trolley assist** is a second envelope with `P_trolley` replacing the diesel term on wired segments. Haul Infinity and Deswik both model trolley [S11][S14].
- **Battery trucks** are phase 2: they need an energy state of charge as well.

### B.4 Retarder-limited downhill speed

On a net-downhill segment (`F_res < 0`), the braking force needed is `F_req = −F_res`. The truck can sustain speed `v` only if `F_ret(v) ≥ F_req`. Continuous retarding is limited by **brake-cooling (or grid) power** `P_ret`:

```
F_ret(v) = min( F_ret_cap , P_ret / v_ms )             # per gear band for mechanical trucks

Descent rule (selectable, default by OEM):
  "continuous":   v_desc = min( P_ret / F_req , v_top , limits )
                  → Komatsu ARSC (operator sets a slope speed) and electric dynamic retarding
  "discrete_gear":v_desc = max{ v_max_g : F_req · v_max_g / 3.6 ≤ P_ret }
                  → Cat ARC holds engine speed in the highest gear the brakes can sustain,
                    so descent speeds come in 5–6 discrete steps (one per gear)        [S10][S23]
```

- Cat retarding charts are per gear and **per grade length** (450 m, 600 m, 1,500 m, continuous). They assume 32 °C ambient and sea level [S23]. Short descents can run faster because of brake heat capacity.
- Phase 2 option: a brake-thermal energy budget `E_brake(s)` with a cooling rate, allowing the per-length charts to be reproduced.
- Komatsu reports continuous-descent absorbing capacity in kW: HD785-7 1,092 kW, HD465-7 785 kW, HD325-7 662 kW, HD1500-8 1,750 kW [OEM]. Cat publishes charts only.
- The fixture's estimated retarder powers come from the Komatsu power ratio (section G).

### B.5 Speed limits

The **speed-limit profile** `v_lim(s)` along the route, at each distance `s`, is the minimum of all applicable limits. Store which limit was active.

```
v_lim(s) = min( v_global[loaded|empty],
                v_segment(s)[loaded|empty, direction],
                v_zone(s)                    # e.g. active work area / access / main road (Haul Infinity style) [S11]
                v_curve(s),
                v_ramp(s)[grade band, direction],
                v_top_truck,
                v_desc(s) on downhill (B.4) )
point constraints: v = 0 at stop signs, v ≤ v_giveway at give-way, v ≤ v_spot at loader/dump approach
```

**Curve limit.** Lateral acceleration or the road-design friction relation:

```
v_curve = sqrt( a_lat · R )                       # a_lat default 1.0–1.5 m/s²  [EST]
   or   = sqrt( g · R · (e + f) )                 # e = superelevation (≤ 0.05 recommended), f = side friction [S26][S27]
Imperial form in the haul-road literature: e + f = v²/(15 R) (mph, ft); metric: e + f = v²/(127 R) (km/h, m) [S27]
```

**Radius from a digitised string.** Resample the centreline every Δ = 5 m. For each triple (P₋ₖ, P, P₊ₖ) with chord about 20–30 m, use the circumradius `R = |a|·|b|·|c| / (4·Area)`. Smooth with a 3-point median. Mark curves where R < R_threshold (for example 200 m).

- HAULSIM's "Cornering Speed" works the same way: it estimates radius from the 3D network and applies speed caps [S4].
- Thompson notes that curves should be designed for the fastest truck, usually the one descending [S26].

### B.6 Acceleration and deceleration

**Preferred method: forward–backward pass on distance (time-stepped equivalent)**

Resample the route at `ds` (2–5 m).

```
# 1. limit profile
v_lim[i] from B.5 (point stops → v_lim = 0 at that node)

# 2. forward pass (traction-limited acceleration)
v_f[0] = v_entry
for i in 0..n-1:
    a = (F_avail(v_f[i]) − F_res_i(v_f[i])) / (m · (1 + k_rot))       # k_rot ≈ 0.05–0.10 rotating inertia [EST]
    if a < 0 and descending: a = −min(|a|, (F_ret(v_f[i]) − F_req_i)/(m·(1+k_rot)))  # cannot brake harder than retarder+service
    v_f[i+1] = min( sqrt(max(0, v_f[i]² + 2·a·ds)), v_lim[i+1] )

# 3. backward pass (deceleration-limited)
v_b[n] = v_exit_target
for i in n-1..0:
    d = a_dec(v, G_i)          # planning deceleration, e.g. 0.5–0.8 m/s² loaded, ≤ 1.0 m/s² empty [EST]
    v_b[i] = min( v_lim[i], sqrt(v_b[i+1]² + 2·d·ds) )

# 4. profile and time
v[i] = min(v_f[i], v_b[i]);  dt_i = 2·ds / (v[i] + v[i+1])   (guard v=0 at stops: add dwell)
binding[i] = argmin of {rimpull/gear, retarder, limit source, accel ramp, decel ramp}
```

- The same loop with `dt` stepping is the time-stepped form. Distance stepping is preferred because the route geometry, and therefore the limits, are defined by distance.
- Store per sample: `s, z, G, RR, v, gear, F_rim, F_res, binding, fuel_rate`. This record is what drives POV playback.
- HAULSIM moved to within-segment acceleration in v3.0 [S5]. Datamine limits a segment's exit speed when the acceleration distance exceeds the segment length [S16].

**Legacy method: Caterpillar speed factors.** The Cat Performance Handbook converts maximum (balancing) speed to average speed with a **speed factor** that depends on segment length and whether the unit starts or stops in the segment, or enters already moving.

```
v_avg = SF(L, state) · v_max
t = L / v_avg                       # or Cat's form: t[min] = L[m] / (16.67 · v[km/h])   [S23]
```

- The TRB "Multiloader-Truck Fleet Selection" paper describes these factors as converting maximum haul and return speeds to averages [S28].
- We could not access the PHB tables in this session, so **no SF values are reproduced here**. A parity mode should let users paste the SF table from the PHB edition they hold.
- Use this mode only for spreadsheet comparison. The forward–backward pass supersedes it.

### B.7 Altitude and temperature derates

```
k_derate = k_alt(altitude) · k_temp(ambient)        applied to engine power (rimpull) only
```

- Cat ratings: the 793F needs no derate up to 3,200 m; the 797F LAA none up to 2,134 m [3P][S34].
- Cat charts are drawn for about 32 °C ambient at sea level [S23].
- Bowen Basin pits sit well below 1,000 m, so `k_alt = 1.0` there.
- Hot-weather derate is engine-specific. Keep a user table `k_temp(T)` defaulting to 1.0 up to the rated ambient. [EST]

### B.8 Payload and GVW effects

```
m_loaded = m_empty + payload_actual            # payload_actual ~ distribution, not a constant
payload target = GMW − empty operating weight  (Cat definition)                       [S33]
Cat 10/10/20 policy: mean ≤ target; ≤10 % of loads > 110 %; no load > 120 %            [S33]
```

- Model payload as a truncated normal with mean `μ_p` (often 95–102 % of target) and CV of 5–8 % [EST]. Speed and fuel then become distributions. Overload penalties (slower on ramps, higher TKPH) become visible instead of averaged away.
- Body volume limit: `payload ≤ ρ_loose · V_heaped`. This binds for coal (loose density about 0.85–0.95 t/m³ [EST]). The coal case is why coal bodies exist.

### B.9 Fuel burn (optional)

```
P_engine(t) = max(0, F_trac·v_ms) / η  + P_aux             # P_aux ≈ 4–8 % of rated [EST]
fuel_L_per_h = sfc[kg/kWh] · P_engine / ρ_fuel[kg/L]       # sfc 0.21–0.24 typical at load; ρ ≈ 0.85  [LIT][S32]
idle / retarding: fuel_idle (truck-specific, ~10–25 L/h for 180–230 t class) [EST]
quick estimate: FC [L/h] ≈ 0.3 · P_rated[kW] · LF   (LF = load factor 0.18–0.75)   [LIT][S32]
```

Sanity band: a forum citation of the Cat PHB gives the 789C at about 71–106 L/h (low load), 106–141 L/h (medium) and 141–177 L/h (high) [3P][S32]. Not verified against the PHB.

### B.10 Typical values (defaults; each is editable and visible)

**Rolling resistance (%)**

| Surface | RR % | Source |
|---|---|---|
| Hard, smooth, well-maintained (concrete/cold asphalt-like), radial tyres | 1.2 (bias 1.5) | [S21] |
| "Base" value commonly used for estimating | 2.0 | [S21] |
| Hard, well-maintained permanent haul road, minimum to assume | 1.5 | [S22] |
| Main haul road (RPM default) | 2.0 | [S7] |
| Bench floor / pit ramp / dump (RPM default) | 2.5 | [S7] |
| Around the loader (RPM default) | 3.0 | [S7] |
| Firm, smooth, rolling roadway | 3.0 | [S24] (citing PHB) |
| Rutted dirt, about 25 mm tyre penetration | 4.0 | [S21] |
| Deeper rutted dirt | 5.0 | [S21] |
| Rutted, unstabilised soft dirt | 8.0 | [S21] |

**Rule of thumb [EST, unverified]:** about +0.6 % RR per cm of tyre penetration (often quoted from the Cat PHB, but not confirmed in this session).

**Traction coefficient μ (rubber tyres)**, from a Cat-style table [3P][S31]:

| Surface | μ |
|---|---|
| Dry rough concrete | 0.80–1.00 |
| Dry clay loam | 0.50–0.70 (≈0.55) |
| Wet clay loam | 0.40–0.50 (≈0.45) |
| Loose dry sand | 0.20–0.30 |

Coal stockpile, rutted and wet-weather values belong in a site table [EST].

**Grades.** Pit ramps are typically 8–10 % in Australian coal. Design manuals treat about 10 % as the sustained maximum, and superelevation is kept ≤ 5 % (5–10 % with caution) [S26]. In-pit and dump roads run 0–3 %.

**Efficiencies [EST]:**
- Mechanical drivetrain, lock-up: 0.80–0.88 rim/net (fixture uses 0.85).
- Electric: 0.75–0.80 rim/gross (fixture uses 0.77).
- Rotating-mass factor: 0.05–0.10.

Operator, job and "50-minute hour" factors are **not** applied implicitly. If used, they appear as named line items in the time model (C.8).

### B.11 Transparency record per segment (UI contract)

```
segment_id, direction, loaded/empty, L, ΔZ, G_mean, RR,
v_entry, v_exit, v_max_reached, t, a_mean,
binding_constraint_share = {rimpull_g3: 61%, governor_g6: 0%, retarder: 0%, curve: 12%, decel_to_stop: 9%, limit_segment: 18%},
gear_time_share, fuel_L, energy_kWh, TKPH_contrib,
equations (rendered with substituted numbers for the dominant constraint)
```

---

## C. Truck–loader matching and queuing

### C.1 Loading time

```
passes   n = ceil( payload_target / (V_bucket · FF · ρ_loose) )     # with tolerance, e.g. ceil(x − 0.15)
volume check: payload_actual / ρ_loose ≤ V_heaped
t_load   = t_first_pass_dump + (n − 1) · t_cycle_loader             # ≈ n · t_cycle for modelling
t_spot   = truck exchange / spotting time (single- vs double-side loading)
t_L      = t_spot + t_load        (service time at the loader)
t_A      = haul + dump (manoeuvre + tip) + return + queue-free waits at dump   (time away from loader)
c        = t_L + t_A               (queue-free cycle time)
```

- Typical exchange (spot) time is 25–60 s. Double-side loading shrinks it [3P]. Examples: about 25 s exchange in one earthmoving article; productivity +10 % when spotting drops from 60 to 45 s [S-loader refs].
- Large hydraulic excavator cycles are about 28–35 s [3P][EST].
- In the fixture `typical_passes` table, passes default to fill factor 0.90 and ρ_loose 1.80 t/m³ for blasted overburden [EST].

### C.2 Match factor (MF) and variants

```
Homogeneous (Morgan & Peterson 1968):   MF = (N_T · t_L) / (N_L · c)                [S35]
   MF < 1 under-trucked (loader waits: "hang time"); MF > 1 over-trucked (trucks queue)

Rate form (works for mixed trucks on one loader group):
   MF = Σ_i ( n_i · t_L,i / c_i ) / N_L          # i = truck class; t_L,i class-specific loading time

Heterogeneous loaders and trucks (Burt & Caccetta): defined via lowest common multiple of
   loading times; see [S35]. We implement the rate form and display Burt–Caccetta for reference.
```

### C.3 Production models to show side by side (bracketing)

Let λ = 1/t_A (rate at which a truck returns, per truck away), μ = 1/t_L, ρ = λ/μ = t_L/t_A, one loader, N trucks.

1. **Deterministic, no bunching (optimistic bound).**
   ```
   X_det = min( N / c , 1 / t_L )        loads per unit time
   ```

2. **Finite-source queue M/M/1//N ("machine repairman", high-variability bound).**
   ```
   P0  = [ Σ_{n=0..N}  N! / (N−n)! · ρ^n ]^(-1)
   U   = 1 − P0                       loader busy fraction (hang time fraction = P0)
   X   = U / t_L                      loads per unit time
   L   = N − X · t_A                  mean trucks at loader (queue + in service)
   Lq  = L − U                        mean trucks queuing
   Wq  = Lq / X                       mean queue wait per load
   c_actual = N / X                   mean cycle including queue
   ```
   Exponential times mean CV = 1, which overstates the variability of real loading (CV about 0.1–0.3) and travel (CV about 0.1–0.2). Treat this as a **pessimistic** bound. The literature uses this model widely for truck–shovel systems [S36][S38][S39], and an approximate shovel-idle-probability expression validated against simulation exists [S37].

3. **Binomial / independent-position approximation (crude).**
   ```
   p = t_L / c ;   U = 1 − (1 − p)^N ;   X = U / t_L
   ```
   This assumes truck positions are independent, which ignores the self-spacing a queue creates. It is lower than M/M/1//N, so it is only a lower bound. We include it because legacy spreadsheets use it.

4. **Small seeded DES (default for the curve).** Gamma or lognormal times with user CVs, for example `CV_L = 0.15` and `CV_A = 0.10`. Run 20 shift-days with a fixed seed and show the seed. It converges in milliseconds for a single circuit. Multi-loader networks use the full DES.

TALPAC accounts for short- and long-term bunching and mismatch. In one comparison, FPC and TALPAC both called for an extra truck when the average queue was about 1.4 trucks per loader [S36].

### C.4 Worked example (illustrative, [EST] inputs)

Inputs: one loader, `t_L = 2.75 min` (spot plus five passes), `t_A = 22.0 min`, payload 181 t. Values were generated by the same formulas (scratch script, seed 1).

| N trucks | MF | Deterministic t/h | Binomial t/h | M/M/1//N t/h | DES (CV 0.15/0.10) t/h | Loader busy (DES) | Queue wait per load, DES (min) | Queue wait, M/M/1//N (min) | t/h per truck (DES) |
|---|---|---|---|---|---|---|---|---|---|
| 6 | 0.67 | 2,633 | 2,001 | 2,410 | 2,548 | 0.65 | 0.84 | 2.29 | 425 |
| 7 | 0.78 | 3,072 | 2,218 | 2,732 | 2,942 | 0.74 | 1.05 | 3.07 | 420 |
| 8 | 0.89 | 3,510 | 2,410 | 3,019 | 3,320 | 0.84 | 1.46 | 4.03 | 415 |
| 9 | 1.00 | 3,949 | 2,581 | 3,265 | 3,650 | 0.92 | 2.00 | 5.18 | 406 |
| 10 | 1.11 | 3,949 | 2,733 | 3,469 | 3,884 | 0.98 | 3.25 | 6.56 | 388 |
| 11 | 1.22 | 3,949 | 2,868 | 3,628 | 3,946 | 1.00 | 5.49 | 8.18 | 359 |
| 12 | 1.33 | 3,949 | 2,988 | 3,746 | 3,949 | 1.00 | 8.29 | 10.04 | 329 |

What the table shows:

- **Bunching costs about 8 % at MF = 1** even with modest variability: 3,650 vs 3,949 t/h.
- **Per-truck productivity falls steadily** as trucks are added.
- **The loader saturates at MF ≈ 1.2.**

### C.5 Over- vs under-trucking trade-off

```
Cost/h(N) = N · C_truck_h + N_L · C_loader_h (+ operators)
Unit cost(N) = Cost/h(N) / X(N)          → choose N* = argmin, or maximise margin = price·X − Cost/h
Marginal tonnes of truck N:  ΔX(N) = X(N) − X(N−1)
```

- **Under-trucked:** the loader hangs (P0 large). This is the expensive failure when the loader and its crew dominate cost, or when the loader is on the critical path (coal to the CHPP).
- **Over-trucked:** trucks queue. Truck hours are wasted, but the loader target is protected.
- **Showing the optimum.** Plot X(N), U(N), Wq(N) and cost/t(N) together, with the DES result and the two bounds. Using the example above with illustrative costs (C_truck = $450/h, C_loader = $1,500/h [EST]), cost/t is lowest at N = 9 (MF ≈ 1.0). As the loader/truck cost ratio rises, N* moves toward over-trucking.

### C.6 Time model and "PT" hours (Australian coal convention)

```
Calendar time CT (24 h/day; 8,760 h/yr)
 − Maintenance downtime (scheduled + unscheduled/breakdown)           → Available time AT
      Mechanical availability A = AT / CT
 − Standby (no operator, no work/plan, weather, industrial, external)  → Utilised / Operating time OT
      Utilisation of availability U = OT / AT
 − Operating delays (shift change, prestart, crib if machine idles, fuel/lube,
   relocation, blast clearance, waiting on dozer/clean-up, bench prep, wet-weather slow) → Productive time PT
      ("direct operating hours": measurable throughput is happening)
 Rate = production / PT  (bcm/PT-h for overburden; t/PT-h for coal)
```

The structure follows the GMG Time Classification Framework and similar time usage models (TUMs) [S40][S42][S43][S44]. Two points for the configuration:

- **Conventions differ.** Some TUMs reject "delay" and the scheduled/unscheduled split [S41]. We make the category mapping configurable per site and always display it.
- **Hang time.** Truck-wait time at a loader is booked either as an operating delay or inside PT, depending on the site. We report it **separately** as "under-trucking loss" so it is never hidden.

**Typical target and example chain [EST].** Prime loaders in QLD coal are commonly planned at about **18–20 PT h/day**. No public benchmark confirmed that range in this session [S41]. It is reproduced by:

| Item | h/day |
|---|---|
| CT | 24.0 |
| × A 0.90 | 21.6 AT |
| − standby 0.6 | 21.0 OT |
| − shift change 2 × 0.5 | −1.0 |
| − crib (partial hot-seat) 2 × 0.25 | −0.5 |
| − prestart 2 × 0.17 | −0.33 |
| − fuel/lube 0.3 | −0.3 |
| − blast 0.3 | −0.3 |
| − misc 0.4 | −0.4 |
| **PT** | **≈ 18.2** |

Roster note: 2 × 12 h shifts capture all calendar hours; 2 × 11 h with a 30-minute overlap captures only 21.5 h [S41]. Bowen Basin truck-and-shovel rosters are commonly 7/7 on 12–12.5 h shifts [3P][S52].

---

## D. Shift production profile (drives the depletion slider)

The flat "rate × hours" picture hides the start-of-shift ramp and the dips. Model a per-minute **availability vector** for each machine and solve production minute by minute.

### D.1 Default 12 h day-shift profile [EST, all configurable]

| Clock (from shift start) | Event | Effect |
|---|---|---|
| 0:00–0:20 | Shift change, prestart checks, travel to machine (or hot-seat) | Loaders and trucks unavailable unless hot-seat; with hot-seat, availability about 0.6 |
| 0:20–0:45 | Ramp-up: trucks reach loaders, first loads | Production ramps linearly 0.3 → 1.0. Dumps see first loads only after the first loaded haul time (pipeline fill) |
| 0:45–5:30 | Steady state | X(N_eff) from section C |
| 5:30–6:00 (or staggered) | Crib | Without relief: loader stops and trucks queue. With crib relief: loader runs, `N_eff` drops by relief shortfall |
| Rolling, mid-shift | Fuelling: each truck about 15–20 min including detour, once per shift | `N_eff` reduced by a staggered 1–2 trucks |
| As scheduled (e.g. 12:30–13:15) | Blast clearance | Affected pits: loaders stop, trucks reassigned or parked |
| 11:15–12:00 | End of shift: park-up or hot-seat handover | Linear decline 1.0 → 0.4 (hot-seat) or → 0 (park-up) |

Evidence for the dip sizes [3P]:

- About 30 min of productive time lost per shift change (Krause 2008, cited in [S47]).
- Up to 1 h for poorly run changeovers [S45], and production during changeover at about 25–30 % of a normal hour [S46].
- Hot-seat changeovers keep machines running [S45].
- Starting the incoming shift about 15 min early, and sending trucks to the dump rather than queueing empty at shovels, shortens the ramp [S45].

### D.2 Algorithm

```
for each minute t in shift:
    N_eff(t) = trucks assigned − trucks at fuel(t) − trucks without operator(t) − trucks parked(t)
    loader_on(t) ∈ {0,1} (crib w/o relief, blast window, prestart)
    rate(t) = loader_on(t) · X_model(N_eff(t)) · ramp(t)
    Q_dig(t) = Σ rate          # tonnes loaded (digger accounting)
    Q_dump(t) = Q_dig(t − t_haul_loaded)   # dump/stockpile accounting (pipeline delay)
Depletion slider: position → t → Q_dig(t) → remove volume Q/ρ_bank from block sequence
```

`X_model` is the precomputed C.3 curve. For interactive speed, use a lookup of the DES curve rather than a rerun. The slider should expose both accounting bases, dig (in situ) and dump (receipt), because the reconciliation teams use both.

---

## E. Manning and crew allocation

### E.1 Typical operator roles (QLD open-cut coal, truck–shovel)

| Role | Notes |
|---|---|
| Haul truck operator | One per manned truck |
| Excavator / shovel operator | One per loader. A WA900 front-end loader needs its own operator |
| Dozer operators | **Dump dozer** (tip-head and windrow maintenance), **pit or bench dozer** (clean-up at the face, floor prep), **coal dozer** (coal-seam clean-up, push-up and windrowing for the coal loader), **push dozer** (dozer push or cast-blast reclaim) |
| Grader operator | Haul road maintenance |
| Water cart operator | Dust suppression; road moisture also affects RR |
| Service / fuel truck operator | Fuel and lube |
| Production supervisor (shift supervisor) | |
| **Open Cut Examiner (OCE)** | Statutory. At least one OCE must be present and contactable whenever mining activities are carried out in or around the surface excavation (CMSHR 2017 s.104, per an unofficial compilation; verify against the official text) [S49][S50] |
| Dispatch / pit controller | Where an FMS is used |

### E.2 Support-equipment rules (defaults to configure, [EST] unless noted)

| Rule | Default | Basis |
|---|---|---|
| Each active coal loading circuit | 1 coal dozer | Site practice [EST] |
| Each active dump (or tip-head pair) | 1 dump dozer | Site practice [EST] |
| Graders | 1 per 8–18 km of active haul road per 16 h day | Mine-reported range [S51]; theoretical grader rate about 0.75 km/h of maintained road |
| Water carts | 1 per about 6 km of road per operating hour of watering, scaled by weather (evaporation) and dust TARPs | Water car about 6.25 km/h maintained in [S51]; size the cart to the haul-truck class [S53] |
| Excavator support | 1 bench/clean-up dozer per 1–2 diggers [EST] | |
| Statutory roles | OCE ≥ 1 present while mining in the excavation | [S49] |

**Physics links (where we beat others):**

- Grader coverage below requirement → RR of the uncovered km rises by ΔRR per shift (default +0.5 %/shift, cap +2 %) [EST].
- Water-cart shortfall → dust TARP speed limit or stop on affected segments [EST].
- No dump dozer → dump closed after `t_grace`.
- No coal dozer → coal loader rate × `k` (default 0.7) [EST].

### E.3 Allocation when crew is short (priority algorithm)

```
inputs: operators with competencies (VOC/tickets), machines available, rules E.2,
        production value per tonne/bcm by circuit (coal > OB critical path > OB other)
1. Assign statutory and supervision roles (OCE, supervisor). If unmet → no mining in that area.
2. Coal circuit first (CHPP feed / contract coal): coal loader + its coal dozer + trucks to its
   optimal N* (C.5).
3. For every dump that will receive loads: assign dump dozer.
4. Greedy by marginal value per operator:
      candidates = {add truck k to loader j (value ΔX_j(N_j+1)),
                    start loader j with its minimum viable trucks (value X_j(N_min)/(1+N_min+support)),
                    grader/water cart (value = avoided RR/speed penalty converted to tonnes)}
      pick max value per operator; respect competencies (bipartite matching / min-cost flow)
   Rule: never start a loader that cannot be trucked to MF ≥ MF_min (default 0.7).
5. Output: manned machine list, parked machines with reason ("no operator", "rule: no dump dozer"),
   and the production delta vs. full crew. Show every rule that fired.
```

Fleet and task priority must be a user-ordered list (e.g. `Coal > Prestrip EX5600 > OB PC4000 > Rehab`). The algorithm explains each decision in plain text.

---

## F. Vulcan `.00t` triangulation format

**Source:** `brentbuffham/vulcan-00t-tri`, commit `065927f` (2026-07-14). The authoritative file is `00T_FORMAT.md`; reference code is `js/vulcan00TParser.js` and `js/vulcan00TWriter.js` [S54].

**Licence:** the README says the parser code is **MIT**, the format is proprietary to Maptek, and the project is not affiliated with Maptek. There is **no LICENSE file** in the repository root, only the README statement. If we copy code, record the MIT attribution.

**README is partly outdated.** Its "delta/tag coordinate grammar" and "EdgeBreaker" sections describe the *compressed* stream and are superseded by `00T_FORMAT.md`.

### F.1 Top level and endianness

A file starting with the 8-byte magic `EA FB A7 8A 76 75 6C 5A` ("…vulZ") is a **compressed paged container**. Otherwise the file is the flat raw image.

**Endianness quirk:** container header fields are **little-endian**; geometry inside the decompressed image is **big-endian**.

### F.2 `vulZ` container

| Offset | Type (LE) | Field |
|---|---|---|
| 0x00 | 8 B | magic |
| 0x14 | u32 | `page_size` (validated 1,024 … 4,194,304). All 19 fixtures use **40,960 (0xA000)** [OBS]. The README's "2,048-byte pages" comes from the superseded analysis of the compressed stream |
| 0x20 | u64 | `total_expanded_len` (raw image length) |
| 0x2C | u32 | `aux_offset` (auxiliary pointer tree; layer PNG previews and names in design databases; usually empty) |
| 0x34 | u32 | `aux_len` |
| 0x3C | — | start of the data pointer-tree walk |

**Records** are 8-byte `(first, second)` LE u32 pairs:

- **Pointer block:** `second == 0`. Up to 256 `(target, 0)` entries, terminated by `target == 0` or `second != 0`.
- **Page header:** `second != 0`, read as `(stored_len, advance)`. Constraints: `advance ≥ stored_len`, `advance ≤ stored_len + 0x4000`, and `stored_len ≤ 4 MiB`.
- **Trailer:** after the stored stream. Its first LE word is the logical page number, unless it is `FA FB FC FD` (end marker), which means 0.

**Pages:** each page is one **FastLZ** block (level 1 or 2, given by the top 3 bits of the first control byte). Match copies must be byte by byte because source and destination can overlap.

**Walk:** walk the aux tree first, then the data tree (depth-first stack). Page runs are followed by `advance`. A run-scanned page never overwrites a tree-named slot. Slot numbering follows **tree-naming order**: there is a stale-page bug in the older Rust port, fixed in `ROSETTA/tri00t_v2.rs`. The decode is complete only if all `ceil(total_len / page_size)` slots are filled.

### F.3 Raw image (after decompression; all geometry BE)

```
0x00  120-byte header  (ASCII "Created External", "Variant…" strings observed at 0x00/0x18/0x32 [OBS])
0x48  u32 BE  vertex_count
0x60  u32 BE  face_count
0x78  vertices: vertex_count × 24 B = 3 × f64 BE (X, Y, Z absolute model coords)
      faces:    face_count × 24 B   = 3 × u32 BE indices (1-based canonical; detect 0-based) + 12 B payload
      trailing attributes
```

**The extra 12 bytes per triangle.** Upstream calls them an "opaque payload (attributes/colour; preserved, not interpreted)". We decoded all 19 sample files with an independent decoder [OBS], and the 12 bytes are **all zero in every face**: 20,000 faces in the 18-page BigGrid and every solid and surface fixture. Their meaning is unknown. Preserve them on round-trip and do not depend on them.

**Closure vertex.** Some meshes store a trailing duplicate of the first vertex, so `vertex_count` exceeds the distinct points. Keep it for indexing.

### F.4 Trailing attribute block [OBS, decoded by us; not in upstream spec]

The block is `u32 LE = 1`, `u32 LE block_len`, then a root object of type 5. Each record inside is:

```
u32 LE key_len+4 | key ASCII | u8 type | u32 LE value_len+5 | value
type 0 = empty/null, 1 = f64 **LE**, 2 = string, 3 = i32 LE, 5 = nested object
```

Observed keys:

- `NAME` (Vulcan path), `IRGB` (i32 = 65280 = 0x00FF00, green in the samples; channel order not confirmed), `ICOLOUR` (colour index), `USE_ICOLOUR`, `USE_RGB`
- `SHADED`, `WIREFRAME`, `SMOOTH` (f64 60.0), `TRANSLUCENT` (f64 50.0), `CONTOUR`
- `scheme{colour_by}`, `UserAttributes`, `datafiles_directory`, and others

An optional PNG thumbnail (`89 50 4E 47 … IEND`) can follow. Colour should therefore be read as: `USE_RGB ? IRGB : palette[ICOLOUR]` [EST].

### F.5 Solids vs surfaces

There is **no explicit flag**. Topology decides:

- **Solid:** a closed 2-manifold, where every undirected edge is shared by exactly 2 faces (0 boundary edges).
- **Surface:** an open triangulation with boundary edges.

Verified on the fixtures [OBS]:

- 0 boundary edges: `cube*`, `tri-crack-solid`, `L-SHAPE`, `SPHERE`.
- Boundary edges present: `BigGrid` 400, `Hexhole` 12, `fan` 4, and others.

A tempting header byte (0x27 = 0x00 for most solids, 0x3C for surfaces) is contradicted by `SPHERE` (closed, 0x3C), so it is not a solid flag.

For hAIul SIM:

- **Pit surfaces** (open) feed string digitising: drape and grade sampling via barycentric interpolation on a 2D spatial index.
- **Solids** feed volumes for depletion, via the divergence theorem: `V = Σ (v0 · (v1 × v2)) / 6`, valid only when closed and consistently wound.

### F.6 Our reader (reference)

We already have a working raw + vulZ reader:

- Raw image: 120-byte header; vertex count BE u32 at 0x48; triangle count BE u32 at 0x60; vertices 3 × BE f64 from 0x78; then triangles of 24 B (3 × BE u32, 1-based, + 12 B).
- This matches the upstream spec and our independent decode of all fixtures (pages fully covered, 0 missing).

---

## G. Machine library (`fixtures/oem-curves.json`) and sanity checks

### G.1 What could and could not be sourced

**No rimpull or retarder chart was digitised.** Both are published only as charts, and the chart PDFs could not be opened in this session. Every curve in the fixture is therefore a **model output** (`estimated: true`), built from power, published gear maximum speeds, stall rimpull where published, and retarder power where published.

Data quality per truck:

| Truck | Engine kW | Gear speeds | Masses | Stall rimpull | Retarder power | Overall |
|---|---|---|---|---|---|---|
| CAT 789C | [OEM] 1,417 gross / 1,320 net | [OEM] 12.0/16.3/22.0/29.8/40.4/54.4 | GMW [OEM] 317.5 t; empty [3P] 135.7 t (Cat chassis + body implies about 126–129 t) | **[OEM] 785 kN** | [EST] 1.40 × gross | Good speeds; curves estimated |
| CAT 789D ("789XD") | [OEM] 1,566 / 1,468 (3516C) | [OEM] 12.6/17.1/23.1/31.2/42.3/57.2 | [OEM] GMW 324.3 t, chassis 99.13 t + body 23.97–30.13 t | [EST] scaled from 789C | [EST] | Good speeds; curves estimated |
| KOM HD1500-7 | [OEM] 1,109 / 1,048 | [OEM] 11.0/14.7/19.7/24.5/32.7/44.2/58.4 (assembled from two brochure extracts) | GVW [OEM] 249.5 t; empty [3P] 105.3 t | [EST] | [EST] 1,650 kW (HD1500-8 ratio) | Good speeds; curves estimated |
| KOM HD785-7 | [OEM] 895 / 879 | **[EST]** F1–F6 (HD1500-7 ratios × 65 km/h top [OEM]) | GVW [OEM] 166 t; empty [3P] 72 t | [EST] | **[OEM] 1,092 kW** | Gear speeds must be read from the Komatsu chart |
| CAT 793F | [OEM] 1,976 / 1,848 | [OEM] 12.9/17.4/23.8/32.1/43.6/60.0 | GMW [OEM] 386.0 t; empty [3P] 159.8 t | [EST] from 793C 1,005 kN [OEM] | [EST] | Good speeds; curves estimated |
| CAT 777G | [OEM] 765 gross; net 683–711 [3P], 700 used | [OEM] 10.9/14.8/20.1/27.2/36.9/49.4/67.1 | GMW [OEM] 164.65 t; empty [3P] 64.4 t | [EST] | [EST] | Good speeds; curves estimated |
| KOM 830E-5 | [OEM] 1,865 gross | n/a (AC electric) | [3P] consistent set 164.2 + 221.4 = 385.6 t; Komatsu pages show higher ratings (408.9–411.1 t, 227–230 t) | [EST] | [3P] 3,207 kW (4,300 HP) | Curves estimated; mass rating must be confirmed |
| KOM 930E-5 | [OEM] 2,014 gross | n/a | [OEM] GVW 521.6 t, empty 231.3 t, payload 290 t | [EST] | **[OEM] 4,027 kW** | Curves estimated |

### G.2 Estimation method (reproducible; constants in `model_constants`)

**Mechanical (per gear `g`, published `v_max,g`, net power `P_net`):**

```
n/n_rated = v / v_max,g
p(x) = x · (1 + TR·(1−x)/(1−x_pk))  for x ≥ x_pk ;  x · (1+TR) below (flat torque)   TR = 0.15, x_pk = 0.74
F_g(v) = η · P_net · p(v/v_max,g) / v_ms             η = 0.85
1st gear converter region: 0 … 0.70·v_max,1, concave blend from stall rimpull to the lock-up point
governor cut-off: F → 0 at 1.005·v_max,g
stall rimpull where unpublished = 789C (785 kN) × (P_gross / 1,417) × (12.0 / v_max,1)   (793F: 793C 1,005 kN × P ratio)
```

`x_pk = 0.74` matches the consecutive gear-speed ratio of about 1.35, so each upshift lands at about peak-torque speed.

**Retarder (mechanical):**

```
F = min(0.30·GVW·g, P_ret / v) across each gear band
P_ret = OEM value where published, else 1.40 × P_gross
```

The 1.40 factor brackets Komatsu's published ratios: HD785-7 1.22, HD465-7 about 1.4 (assuming about 551 kW gross [EST]), HD1500-8 1.49.

**Descent rule:** Cat → `discrete_gear`, Komatsu → `continuous` (B.4).

**Electric:**

```
F = min(0.25·GVW·g, 0.77·P_gross / v)
retard F = min(F_max, P_ret / v)
```

**Replacement procedure:** digitise the OEM charts (rimpull–speed–gradeability and retarding at the continuous grade length) into `[v, F]` points. Mark `estimated: false` and keep the URL and page in `sources`. Re-run the sanity table as a regression test, and fit `η` against site GPS speed-on-grade.

### G.3 Sanity table (computed from the fixture)

Settings: loaded = GVW/GMW rating; empty = empty mass; "up X %" = effective grade (grade + RR); empty-level case uses 2 % RR; no traction limit; sea level. Speeds in km/h.

| Truck | Rim kW (model) | max(F·v) / gross | Max rimpull kN | Loaded up 6 % | **8 %** | **10 %** | 12 % | Empty level (2 % RR) | Empty up 10 % | Retard kW | Loaded down −8 % | Loaded down −10 % (rule) | −10 % continuous |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| CAT 789C | 1,122 | 0.792 | 785 | 21.3 | 16.2 | **12.0** | 9.8 | **54.4** | 29.8 | 1,984 | 22.0 | 22.0 (gear 3) | 23.0 |
| CAT 789D | 1,248 | 0.797 | 826 | 23.1 | 17.1 | **12.6** | 11.1 | 57.2 | 31.2 | 2,192 | 23.1 | 23.1 (gear 3) | 24.9 |
| KOM HD1500-7 | 891 | 0.804 | 670 | 19.7 | 14.7 | **11.7** | 10.9 | 58.4 | 29.9 | 1,650 | 30.4 | 24.4 | 24.4 |
| KOM HD785-7 | 747 | 0.835 | 488 | 27.3 | 19.7 | **16.4** | 12.2 | 65.0 | 36.4 | 1,092 | 30.3 | 24.3 | 24.3 |
| CAT 793F | 1,571 | 0.795 | 1,103 | 23.8 | 17.4 | **12.9** | 12.2 | 60.0 | 32.1 | 2,766 | 32.1 | 23.8 (gear 3) | 26.4 |
| CAT 777G | 595 | 0.778 | 467 | 20.1 | 14.8 | **11.9** | 10.9 | 67.1 | 31.5 | 1,071 | 27.2 | 20.1 (gear 3) | 24.0 |
| KOM 830E-5 | 1,436 | 0.775 | 946 | 22.8 | 17.1 | **13.7** | 11.4 | 64.5 | 32.2 | 3,207 | 38.3 | 30.7 | 30.7 |
| KOM 930E-5 | 1,551 | 0.776 | 1,279 | 18.2 | 13.6 | **10.9** | 9.1 | 64.5 | 24.7 | 4,027 | 35.5 | 28.5 | 28.5 |

Power check: `max(F·v)` never exceeds η × P_net (mechanical) or 0.77 × P_gross (electric), apart from ≤ 1 % rounding at the electric corner point. That is about 0.78–0.84 of gross power, as expected.

**Comparison with published figures**

| Check | Published / expected | Model | Verdict |
|---|---|---|---|
| 789C loaded at 10 % effective | 11–13 km/h (brief) | 12.0 (top of 1st, governed) | ✔ |
| 789C empty, level | ≈ 54 km/h (brief); 6th gear 54.4 [OEM] | 54.4 | ✔ |
| 793-class loaded at 10 % grade | 12.9 km/h (Cat press release, *new* 793, same 12.9 km/h 1st-gear top) [S-793PR] | 793F 12.9 | ✔ (governed in 1st) |
| HD1500-7 vs competitors at 12 % effective, max GVW | "10 % speed advantage" (Komatsu, 2008) [S-1500Q] | HD1500-7 10.9 vs 789C 9.8 (+11 %) | ✔ consistent |
| 830E-5 hold max GVW on 15 % | Rated to hold [OEM brochure, S-830BR] | Retard/propulsion cap 946 kN ≥ 567 kN needed | ✔ |
| Generic chart example: loaded about 10 km/h at 12 %, empty about 54 km/h at 2 % | Fast2Mine worked example [S29] | 789C 9.8 / 54.4 | ✔ |
| Loaded speed at 8 % for any truck | **No published value found** | 14.7–19.7 | Calibrate on site GPS |
| Loaded descent speeds | No OEM numbers found; charts only | 20–31 km/h | Calibrate / digitise charts; site ramp limits (often 25–40 km/h) will bind first |

Two effects worth noting:

- **Gear steps matter.** At 10 % the 789C, 789D and 793F all sit on the **1st-gear governor**: rimpull is spare, but 2nd gear cannot hold the grade. So their speed equals the 1st-gear maximum, and small changes in RR or payload can drop the truck into a lugging 1st gear. This is the "cliff" a grade → speed lookup cannot show.
- **The HD785-7 at 16.4 km/h rides on an estimated 2nd-gear top.** Treat it as the least reliable number in the table.

### G.4 Loaders (fixture `loaders[]`)

| Loader | Operating weight | Bucket options | Typical cycle | OEM truck match |
|---|---|---|---|---|
| Komatsu PC4000-11 | 393–409 t [OEM] | 22 m³ shovel and backhoe [OEM] | 30 s [EST] | |
| Liebherr R 996 B | 672 t BH / 676 t FS [OEM] | BH 32–36 m³, FS ~34 m³; 2 × 1,120 kW engines (2,240 kW) [OEM/3P] | 32 s [EST] | |
| Hitachi EX2600-7 | 259–263 t [OEM] | LS 15.0–16.5 m³, BH 18.0–19.5 m³ [OEM] | 28 s [EST] | 150–180 t trucks [OEM] |
| Hitachi EX5600-7 | 544–555 t [OEM] | LS 29–31 m³, BH 36–38.5 m³ [OEM] | 32 s [EST] | 180–290 t trucks [OEM] |
| Komatsu WA900-8 | 116.4 t [OEM] | 11.5 / 13.0 / 14.5 m³ [OEM] | 42 s V-cycle [EST] | 70–150 short-ton trucks [OEM] |

**Cycle evidence [3P]:** about 30 s per cycle for a 26 m³ example (Quarry); about 35 s for large shovels (patents).

**Passes at fill factor 0.90 and ρ_loose 1.80 t/m³ [EST].** Each cell is passes [exact], with "over" = fewer than 3.5 passes, "under" = more than 7, and "V!" = the heaped body (default body) is volume-limited at this density:

| Loader (bucket) | 789C | 789D | HD1500-7 | HD785-7 | 793F | 777G | 830E-5 | 930E-5 |
|---|---|---|---|---|---|---|---|---|
| PC4000-11 (22 m³) | 5 [4.97] | 5 [5.08] | 4 [4.04] V! | 3 (over) | 7 [6.37] | 3 (over) | 7 [6.21] | 8 (under) |
| R 996 B (FS 34 m³) | 4 [3.21] (over) | 4 [3.29] (over) | 3 (over) V! | 2 (over) | 4 [4.12] | 2 (over) | 4 [4.02] | 6 [5.27] |
| EX2600-7 (LS 16.5 m³) | 7 [6.62] | 7 [6.77] | 6 [5.39] V! | 4 [3.40] (over) | 9 (under) | 4 (over) | 9 (under) | 11 (under) |
| EX5600-7 (LS 31 m³) | 4 [3.52] | 4 [3.60] | 3 (over) V! | 2 (over) | 5 [4.52] | 2 (over) | 5 [4.41] | 6 [5.77] |
| WA900-8 (14.5 m³) | 8 (under) | 8 (under) | 6 [6.13] V! | 4 [3.87] | 10 (under) | 4 [3.81] | 10 (under) | 13 (under) |

Reading the flags:

- **Partial final pass.** A fractional pass (for example 3.21 → 4) means a partial last bucket. The UI should offer "load to payload" vs "full buckets" (overload risk under 10/10/20).
- **V! (HD1500-7).** The 78 m³ body holds only about 140 t at 1.8 t/m³. Coal (about 0.9 t/m³) is volume-limited for every body.

---

## H. Sources

Competitors and dispatch:

- [S1] RPMGlobal HAULSIM product page — https://www.rpmglobal.com/softwares/haulsim/
- [S2] HAULSIM brochure (2019) — https://www.mining-technology.com/wp-content/uploads/sites/19/2019/06/rpm00928-haulsim-brochure-v02-flat.v2.pdf
- [S3] HAULSIM brochure (2021) — https://rpmglobal.com/wp-content/uploads/2021/12/haulsim_brochure.pdf ; HAULSIM resource page — https://rpmglobal.com/resource/haulsim-3d-mine-haulage-simulation-software/
- [S4] HAULSIM 2.5 (Fleet Planner, Cornering Speed) — https://www.canadianminingjournal.com/news/software-rpms-haulsim-2-5-features-fleet-planner-cornering-speed-optimization/ ; https://im-mining.com/2017/06/27/launch-haulsim-2-5-next-level-haul-cycle-software/
- [S5] HAULSIM 3.0 (accel/decel within segments) — https://www.globalminingreview.com/product-news/02102018/rpmglobal-releases-new-haulsim-model
- [S6] RPM Fleet Planner help — https://help.rpmglobal.com/simulation/fpsim/latest/en/Content/Haul%20Network%20Simulation/Fleet%20Planner.htm
- [S7] RPM KPROSIM haul route help — https://help.rpmglobal.com/simulation/kprosim/latest/en/Content/Haul%20Route%20Analysis/HaulRoute.htm
- [S8] RPM XPAC travel time object — https://help.rpmglobal.com/xpac/latest/en/HTML/properties_the_travel_time_object.htm
- [S9] TALPAC-3D — https://rpmglobal.com/product/talpac-3d/ ; brochure https://rpmglobal.com/wp-content/uploads/2021/12/TALPAC-3D_brochure.pdf
- [S10] Micromine Spry haulage help — https://webhelp.micromine.com/spry/latest/English/Content/sphaulage/IDH_HAULAGE.htm ; Rimpull — https://webhelp.micromine.com/spry/latest/English/Content/sphaulage/IDH_RIMPULL.htm ; Results — https://webhelp.micromine.com/spry/25.5/English/Content/sphaulage/IDH_HAULAGE_RESULTS.htm
- [S11] Micromine Alastri Haul Infinity training booklet — https://webhelp.micromine.com/pdfs-alastri/Haul%20Infinity%20Training%20Booklet_v02.pdf
- [S12] Spry scheduling and haulage tutorial — https://www.slideshare.net/slideshow/spry-scheduling-and-haulage-model-tutorial/43416162
- [S13] IMCM planning software comparison (competitor-authored) — https://imcm.au/insights/mine-planning-software-comparison/
- [S14] Deswik.LHS — https://www.deswik.com/product-detail/landformhaulage/ ; https://www.mining.com/web/deswik-launch-new-haulage-functionality-underground-mining/
- [S15] Precision Mining, Haulage theory and setup — https://support.precisionmining.com/documentation/haulage-part-1-haulage-theory-setup/
- [S16] Datamine StudioOP haul truck performance — https://docs.dataminesoftware.com/StudioOP/Latest/ISTS/ists_HaulTruck_Performance.htm
- [S17] Modular DISPATCH — https://www.komatsu.com/en-us/technology/smart-mining/loading-and-haulage/dispatch ; https://www.miningsoftwarereviews.com/software/dispatch-fleet-management-system ; https://www.mining.com/web/modulars-dispatch-fleet-management-system-displace-competitive-fms-two-brazilian-mining-operations/
- [S18] Cat MineStar Fleet — https://www.westernstatescat.com/wp-content/uploads/2019/10/MineStar-System-Fleet.pdf ; https://www.foleyeq.com/equipment/cat-equipment-technology/fleet/fleet/cat-minestar-fleet-for-surface/
- [S19] Wenco — https://www.wencomine.com/vision/open-autonomy-vision ; https://im-mining.com/2024/04/25/wenco-on-open-autonomy-fleet-management-and-right-sized-trucks/ ; https://im-mining.com/2019/09/04/wencos-system-6-1-takes-open-fleet-management-systems-64-bit-territory/
- [S20] Cat FPC introduction (third-party copy) — https://www.scribd.com/document/522395747/Introduction-to-FPC

Physics and road:

- [S21] Cat, Rolling resistance factors — https://www.cat.com/en_US/articles/ci-articles/rolling-resistance-factors.html
- [S22] Caterpillar Haul Road Design and Management (Holman) — https://www.numeralkod.com/cross/tires.pdf ; https://res.cloudinary.com/dun3slcfg/image/upload/v1691507787/Caterpillar-Haul-Road-Design-and-Management.pdf
- [S23] Cat Performance Handbook Ed. 50 (not accessed) — https://wheelercat.com/wp-content/uploads/2025/03/Cat-Performance-Handbook-Edition-50-June-2022.pdf ; Ed. 41 trucks section — https://www.holtcat.com/Documents/PDFs/2012PerformanceHandbook/Construction%20&%20Mining%20Trucks%20-%20Sec%209.pdf ; chart conditions and retarding-chart method as quoted from Cat 789/789D spec sheets — https://www.empire-cat.com/sites/default/files/products/documents/CM20240821-01baf-b730a.pdf ; https://s7d2.scene7.com/is/content/Caterpillar/CM20221017-305df-8c2e9
- [S24] USQ thesis citing PHB RR table — https://sear.unisq.edu.au/29266/1/Kubler_K_Baker.pdf
- [S25] Perdomo, Detailed Haul Unit Performance Model (VT) — https://vtechworks.lib.vt.edu/server/api/core/bitstreams/f3d6a038-3fa9-482f-89b6-0671f9081241/content
- [S26] Guidelines for Mine Haul Road Design (Thompson) — https://www.researchgate.net/publication/277759950_Guidelines_for_Mine_Haul_Road_Design ; GSFM — https://haul-road-design.com/wp-content/uploads/2015/07/Thompson-R.-J.-2011.-GSFM-%E2%80%93-An-Integrated-Approach-to-Mine-Haul-Road-Design.pdf
- [S27] Design of Surface Mine Haul Road (e + f = v²/15R) — http://www.ijste.org/articles/IJSTEV2I11114.pdf
- [S28] TRB 1988, Multiloader-Truck Fleet Selection (speed factors) — https://onlinepubs.trb.org/Onlinepubs/trr/1988/1186/1186-005.pdf
- [S29] Fast2Mine, using the rimpull graph — https://fast2mine.com/en/rimpull-graph/
- [S30] Dassault GEOVIA, rimpull and retard tables — https://blog.3ds.com/brands/geovia/how-to-use-rimpull-tables-in-minesched/ ; https://blog.3ds.com/brands/geovia/how-to-use-retard-tables-to-calculate-truck-velocities/
- [S31] Traction factor table (third-party copy) — https://www.scribd.com/document/751403087/Chapter-6
- [S32] Fuel: FC = 0.3·P·LF and SFC form — https://rggf.untz.ba/wp-content/glasnik/2024-12/ERAD_9a.pdf ; 789C PHB fuel bands (forum) — https://www.eng-tips.com/threads/cat-785c-789c-amp-793c-fuel-consumption-rates.248451
- [S33] Cat 10/10/20 payload policy — https://www.cat.com/en_US/by-industry/mining/surface-mining/surface-equipment/loading-and-hauling.html ; AusIMM APCOM 2011 — https://ausimm.com/publications/conference-proceedings/35th-apcom-symposium-2011/selection-criteria-for-open-pit-production-equipment---payload-distributions-and-the-101020-policy
- [S34] Altitude: 793F no derate to 3,200 m — https://www.codeready.org/mining-dump-trucks/cat-mining-trucks/cat-793f-tier-4-haul-truck

Queuing and time model:

- [S35] Burt & Caccetta, Match factor for heterogeneous fleets — https://www.researchgate.net/publication/238400832_Match_factor_for_heterogeneous_truck_and_loader_fleets ; https://www.mssanz.org.au/modsim05/papers/burt.pdf ; https://www.sciencedirect.com/science/article/abs/pii/S0377221717301789
- [S36] Applications of Queuing Theory for Open-Pit Truck/Shovel Haulage Systems (VT thesis) — https://vtechworks.lib.vt.edu/server/api/core/bitstreams/67d24cff-9d41-40f0-9dad-b488050fedd9/content
- [S37] Linear truck allocation model with shovel idle probabilities (EJOR) — https://www.sciencedirect.com/science/article/abs/pii/S0377221713005043
- [S38] Optimisation of shovel-truck system (SAIMM) — https://scielo.org.za/pdf/jsaimm/v109n7/06.pdf
- [S39] Queuing case study (Zimbabwe) — https://www.academia.edu/66001820/MODELLING_AND_ANALYSIS_OF_OPEN_PIT_TRUCK_SHOVEL_SYSTEM_USING_QUEUING_THEORY_CASE_STUDY_OF_CAM_AND_MOTOR_MINE_MASHONALAND_WEST_ZIMBABWE
- [S40] GMG Time Classification Framework — https://gmggroup.org/wp-content/uploads/2024/07/20200713_Time_Classification_Framework-GMG-DAU-v01-r01-1.pdf
- [S41] AusIMM, Challenging the Norms: TUM — https://www.ausimm.com/globalassets/bulletin/challenging-the-norms---time-usage-model-for-mobile-underground-mining-equipment.pdf
- [S42] MiningFMS time usage models — https://miningfms.com/knowledge-base/time-models/time-usage-in-mining/
- [S43] Connected Mine TUM — https://connectedmine.com.au/content-hub/the-time-usage-model-a-pillar-in-mining-analytics
- [S44] Calendar time structure (open pit) — https://crimsonpublishers.com/amms/fulltext/AMMS.000537.php

Shift and manning:

- [S45] Outliers, improving shift change — https://outliersminingsolutions.com/case-study/improving-shift-change-at-open-pit-mines/
- [S46] World Coal, a shift in mine productivity — https://www.worldcoal.com/mining/06102017/a-shift-in-mine-productivity/
- [S47] Shift change in stochastic dispatching (cites Krause 2008) — https://www.sciencedirect.com/science/article/pii/S1474667016312812
- [S48] Cat customer material on changeover loss — https://s7d2.scene7.com/is/content/Caterpillar/CM20220204-f38f3-46112
- [S49] Coal Mining Safety and Health Regulation 2017 (Qld) — https://www.legislation.qld.gov.au/view/whole/html/inforce/current/sl-2017-0165 ; s.104 wording seen via unofficial compilation — https://www.scribd.com/document/602110374/OCEs-and-the-Law-221022
- [S50] Qld mining legislation and statutory officials — https://www.business.qld.gov.au/industries/mining-energy-water/resources/safety-health/mining/legislation-standards
- [S51] SAIMM, haul road maintenance (grader and water car productivity) — https://www.saimm.co.za/Journal/v103n05p303.pdf
- [S52] Bowen Basin roster examples — https://www.workpac.com/job-listing/shovel-operators/ ; https://iminco.net/open-cut-mine-excavator-operators-coal-mining-bowen-basin/
- [S53] Haul road maintenance (water tanker sizing) — https://www.agg-net.com/resources/articles/loading-hauling/haul-road-maintenance

Format:

- [S54] brentbuffham/vulcan-00t-tri (commit 065927f) — https://github.com/brentbuffham/vulcan-00t-tri (00T_FORMAT.md, js/vulcan00TParser.js, js/vulcan00TWriter.js, README "Licence")

Machine data:

- 789C: http://directminingservices.com/wp-content/uploads/Equipment/Caterpillar/789c.pdf ; https://www.kellytractor.com/eng/images/pdf/earthmoving/offhighway_trucks/789c.pdf ; https://www.constructionequipmentguide.com/charts/off-highway-trucks/caterpillar/789c/30617659 ; https://heavy-spec.com/rock-truck/1273-caterpillar-789c.html
- 789D: https://s7d2.scene7.com/is/content/Caterpillar/CM20221017-305df-8c2e9 ; https://www.petersoncat.com/products/new/mining-trucks/789d ; https://ccmodels.com/wp-content/uploads/2015/08/789D_Spec_Sheet.pdf ; https://www.teknoxgroup.com/attachment/3103/789D.pdf ; https://www.cat.com/en_AU/products/new/equipment/off-highway-trucks/mining-trucks/18107706.html ; https://im-mining.com/?p=4785
- HD1500-7: https://www.komatsuindia.in/templates/mdestemplate/pdf/HD1500-7.pdf ; https://www.komatsu.pe/images/pdf-mineria/camiones/HD1500-7.pdf ; https://www.motorbazee.com/komatsu/hd15007/base-overview ; https://www.ritchiespecs.com/model/komatsu-hd1500-7-rock-truck ; [S-1500Q] https://www.quarrymagazine.com/2008/01/03/fast-and-productive-haul-trucks/ ; HD1500-8 retarder: https://www.cimertex.it/wp-content/uploads/2024/07/HD1500-8_EENSS20333_2008.pdf
- HD785-7: https://cdn.machine.market/specifications/komatsu-off-highway-dump-trucks-spec-283b2a.pdf ; https://issuu.com/komatsuindia/docs/rigid_dump_trucks_-_hd785-7 ; https://www.komatsu-africa.com/en/dump-trucks/rigid-dump-trucks/hd785-7 ; https://www.komatsu.com/en-nz/products/equipment/dump-trucks/mechanical-rigid-trucks/hd785-7 ; https://www.komatsu.com.au/getattachment/865ec7a2-70e5-4f2e-af2d-4e5d45e42b72/HD785-7
- 793F: https://www.petersoncat.com/products/new/mining-trucks/793f ; https://toromontcat.com/mining/equipment/details/406-equipment/470-off-highway-trucks/715-mining-trucks/18092621 ; https://www.kellytractor.com/eng/images/pdf/earthmoving/offhighway_trucks/793F.pdf ; https://www.codeready.org/mining-dump-trucks/cat-mining-trucks/cat-793f-haul-truck/ ; 793C stall rimpull: https://s7d2.scene7.com/is/content/Caterpillar/C195474 ; [S-793PR] https://www.cat.com/en_US/news/machine-press-releases/new-cat-793-features-best-in-class-payload--increased-fuel-efficiency-and-faster-cycle-times.html
- 777G: https://www.zeppelin.cz/fileadmin/helios_files/JPG/ToM/OHT/777G/777G-RDR_AEXQ2671-00_Tech_Specs_2020.pdf ; https://h-cpc.cat.com/cmms/v2?f=product&it=product&cid=406&lid=en&sc=US&gid=307&pid=18265926&nc=1 ; https://www.petersoncat.com/products/new/highway-trucks/777g-tier-4 ; https://semhire.com.au/specification/cat-777g-off-highway-truck-specifications/
- 830E-5: https://www.komatsu.eu/en/dump-trucks/electric-dump-trucks/830e-5 ; https://www.komatsu.com.au/equipment/dump-trucks/electric-mining-trucks/830e-5 ; https://www.komatsu.com/en-us/products/equipment/trucks/electric-drive-mining-trucks/830e-5 ; https://semhire.com.au/specification/komatsu-830e-5-ultra-dump-truck-specifications/ ; https://www.kirby-smith.com/dump-trucks/details/komatsu-830e5 ; [S-830BR] https://www.komatsu.com/content/dam/komatsu/sales-and-marketing-documents/brochures/trucks/830e-5-aess924-01.pdf
- 930E-5: https://www.komatsu.com/content/dam/komatsu/sales-and-marketing-documents/brochures/trucks/930e/930e-5-aess921-01-ev1.pdf ; https://www.komatsu.com/en-us/products/equipment/trucks/electric-drive-mining-trucks/930e-5 ; https://www.komatsu.com.au/equipment/dump-trucks/electric-mining-trucks/930e-5
- Loaders: https://www.komatsu.com/en-us/products/equipment/excavators/surface-mining-excavators/pc4000-11 ; https://www.komatsu.eu/en/excavators/mining-excavators/pc4000-11 ; https://manualmachine.com/liebherr/r996b/1585186-user-manual/ ; https://www.scribd.com/document/279781046/Liebherr-R-996-B-OEM-Specs ; https://www.hitachicm.com/global/en/solutions/mining-business/products/large-excavators/product.ex2600-7/ ; https://www.hitachicm.com/global/en/solutions/mining-business/products/large-excavators/product.ex5600-7/ ; https://www.komatsu.com/en-us/products/equipment/wheel-loaders/surface-mining-wheel-loaders/wa900-8 ; https://www.komatsu.eu/en/news/komatsu-europe-launches-wa900-8-wheel-loader
- [S-loader refs] cycle and exchange evidence: https://www.quarrymagazine.com/professional-selection-and-operation-of-hydraulic-excavators ; https://www.forconstructionpros.com/equipment/earthmoving/article/10303462/optimize-earthmover-operations ; https://www.researchgate.net/publication/342264746_Evaluation_of_Effect_of_the_Excavator_Cycle_Duration_on_its_Productivity

Not reviewed but possibly useful: `fsantibanezleal/CAOS_MINEHAUL`, an Apache-2.0 deterministic DES of mine haulage on road networks — https://github.com/fsantibanezleal/CAOS_MINEHAUL

## Research limits (read before trusting numbers)

- **Fetching was blocked.** Page and PDF fetching was blocked for most hosts in this session (`www.cat.com`, `www.lectura-specs.*` and others). Only search-engine extracts and GitHub were reachable. As a result:
  - no OEM chart was viewed or digitised;
  - Cat Performance Handbook tables (speed factors, RR-by-penetration, traction) could not be read directly.
- **To digitise the charts, allow these hosts:** `s7d2.scene7.com` (Cat spec PDFs), `www.komatsu.com`, `www.komatsu.com.au`, `www.cat.com`, `wheelercat.com` (PHB). With them, the rimpull–speed–gradeability and retarding charts can be digitised to replace the `[EST]` curves in the fixture.
- **Site rules are estimates.** Every support-equipment and shift-profile default is `[EST]` and must be confirmed with the site's own standards, TARPs and FMS delay records.
