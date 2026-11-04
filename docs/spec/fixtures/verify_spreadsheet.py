#!/usr/bin/env python3
"""Independent re-implementation of the calc.xlsm haulage calculator, checked against
Excel's cached values.

Usage:
    python3 -I verify_spreadsheet.py                       # fixtures only (no dependencies)
    python3 -I verify_spreadsheet.py --workbook calc.xlsm  # + cross-check fixtures against the
                                                           #   workbook and recompute straight
                                                           #   from its Data Dump (needs openpyxl)

What is checked
  A. ActiveRoute chain recomputed from the Data Dump points + lookup tables + inputs in
     spreadsheet-active-route.json / spreadsheet-tables.json, compared with the cached
     per-segment values and the cached outputs C4..C28 (rel tol 1e-6).
  B. Targets & Haulage Priorities plan formulas and the crew rule-set
     (spreadsheet-targets-crew.json -> rule_set) evaluated by a small rule engine,
     compared with every cached crew cell and total.
  C. raw-data-strings.json: the string flagged is_current_data_dump equals the Data Dump
     points, and every derived spreadsheet_mode_travel block is reproducible.
  D. (--workbook) every fixture value equals the workbook's cached cell value, and the
     ActiveRoute chain recomputed directly from the workbook's Data Dump matches.

Exit code 0 when everything passes.
"""
import argparse
import ast
import json
import math
import os
import sys
from decimal import Decimal, ROUND_HALF_UP

HERE = os.path.dirname(os.path.abspath(__file__))
REL_TOL = 1e-6
ABS_TOL = 1e-9


class Tally:
    def __init__(self):
        self.passed = 0
        self.failed = 0
        self.max_rel = 0.0
        self.failures = []
        self.by_section = {}

    def check(self, section, name, got, exp, exact=False):
        sec = self.by_section.setdefault(section, [0, 0])
        ok = True
        if isinstance(exp, (int, float)) and isinstance(got, (int, float)) and not isinstance(exp, bool):
            if exact:
                ok = got == exp
            else:
                ok = math.isclose(got, exp, rel_tol=REL_TOL, abs_tol=ABS_TOL)
                if exp != 0:
                    self.max_rel = max(self.max_rel, abs(got - exp) / abs(exp))
        else:
            ok = got == exp
        if ok:
            self.passed += 1
            sec[0] += 1
        else:
            self.failed += 1
            sec[1] += 1
            self.failures.append(f"[{section}] {name}: got {got!r}, expected {exp!r}")
        return ok


def load(name):
    with open(os.path.join(HERE, name), encoding="utf-8") as fh:
        return json.load(fh)


# ----------------------------------------------------------------------------- Excel semantics
def excel_round(x, digits):
    """Excel ROUND: 15-significant-digit view of the double, then half away from zero."""
    d = Decimal(format(x, ".15g"))
    return float(d.quantize(Decimal(1).scaleb(-digits), rounding=ROUND_HALF_UP))


def speed_lookup(table, grade):
    """VLOOKUP(ROUND(grade,2), table, 2, FALSE) wrapped in IFERROR(...,"") -> None."""
    if grade is None:
        return None
    return table.get(excel_round(grade, 2))


def travel_time_sheet(points, loaded_tbl, unloaded_tbl):
    """Rows 4.. of 'Travel Time'. points = [[easting, northing, rl], ...] in Data Dump order.
    Returns list of per-segment dicts (None == Excel "")."""
    segs = []
    for i in range(1, len(points)):
        prev, cur = points[i - 1], points[i]
        if cur[0] == 0:                       # IF('Data Dump'!A{n}=0,"",...)
            continue
        a = math.sqrt((cur[0] - prev[0]) ** 2 + (cur[1] - prev[1]) ** 2 + (cur[2] - prev[2]) ** 2)
        b = (cur[2] - prev[2]) / a if a != 0 else None          # IFERROR(dZ/A,"")
        c = speed_lookup(loaded_tbl, b)
        d = ((a / 1000) / c) * 60 * 60 if c is not None else None
        k = -b if b is not None else None                        # IFERROR(-B,"")
        l_ = speed_lookup(unloaded_tbl, k)
        m = ((a / 1000) / l_) * 60 * 60 if l_ is not None else None
        segs.append({"row": i + 3, "A": a, "B": b, "C": c, "D": d, "J": a, "K": k, "L": l_, "M": m})
    return segs


def active_route_chain(points, tables, inputs):
    loaded = {r["grade"]: r["max_speed_kmh"] for r in tables["speed_tables"]["loaded"]["rows"]}
    unloaded = {r["grade"]: r["max_speed_kmh"] for r in tables["speed_tables"]["unloaded"]["rows"]}
    segs = travel_time_sheet(points, loaded, unloaded)
    ex = tables["excavator_assumptions"]["excavators"][inputs["B3"]]
    i34 = inputs["I34"]
    out = {}
    out["F15"] = sum(s["D"] for s in segs if s["D"] is not None)      # SUM(D:D)
    out["H15"] = sum(s["M"] for s in segs if s["M"] is not None)      # SUM(M:M)
    out["F16"] = out["F15"] / 60
    out["H16"] = out["H15"] / 60
    out["C4"], out["C5"], out["C6"] = out["F15"], out["H15"], inputs["C6"]
    out["C7"] = (out["C4"] + out["C5"]) / out["C6"]
    out["C8"] = ex["dump_time_s"]
    out["C9"] = ex["spot_time_s"]
    out["C10"] = ex["loading_time_s"]
    out["C12"] = 60 * inputs["C11"]
    out["C14"] = out["C7"] + out["C8"] + out["C9"] + out["C10"] + out["C12"]
    out["C15"] = out["C14"] / 60
    out["C21"] = tables["truck_load_bcm"]["truck_type_to_load"]["map"][inputs["C3"]]["bcm"]
    out["C16"] = (60 / out["C15"]) * out["C21"]
    out["C19"] = ex["planned_rate_bcm_per_pt_hr"] * i34
    out["C20"] = inputs["C20"]
    out["C17"] = out["C20"] / out["C16"]
    out["C22"] = i34
    out["C24"] = out["C17"] / out["C22"]
    out["planned_rate"] = ex["planned_rate_bcm_per_pt_hr"]
    out["C26"] = out["C20"] / out["planned_rate"]
    out["C28"] = (out["C22"] / 2) - (out["C26"] / 2)
    return segs, out


def macro_buttons(out, n):
    """Macro_n: GoalSeek C24 -> n by changing C20, then cap C20 at C19 (closed form)."""
    c20 = min(n * out["C22"] * out["C16"], out["C19"])
    c26 = c20 / out["planned_rate"]
    return {"C20": c20, "C24": (c20 / out["C16"]) / out["C22"], "C26": c26, "C28": out["C22"] / 2 - c26 / 2}


# ----------------------------------------------------------------------------- A. ActiveRoute
def verify_active_route(T, ar, tables):
    inp = ar["inputs"]
    inputs = {"B3": inp["excavator_B3"]["value"], "C3": inp["truck_type_C3"]["value"], "C6": inp["haul_efficiency_C6"]["value"],
              "C11": inp["stop_signs_C11"]["value"], "C20": inp["desired_daily_volume_C20"]["value"], "I34": inp["ideal_avg_hours_I34"]["value"]}
    segs, out = active_route_chain(ar["points"], tables, inputs)
    exp_segs = ar["segments"]
    T.check("A.segments", "segment count", len(segs), len(exp_segs), exact=True)
    for s, e in zip(segs, exp_segs):
        r = e["travel_time_row"]
        T.check("A.segments", f"row {r} index", s["row"], r, exact=True)
        for k, ek in (("A", "distance_m"), ("B", "grade"), ("C", "loaded_speed_kmh"), ("D", "loaded_time_s"),
                      ("J", "unloaded_distance_m"), ("K", "unloaded_grade"), ("L", "unloaded_speed_kmh"), ("M", "unloaded_time_s")):
            T.check("A.segments", f"row {r} {k}", s[k], e[ek])
        if e["grade_rounded"] is not None:
            T.check("A.segments", f"row {r} ROUND(B,2)", excel_round(s["B"], 2), e["grade_rounded"], exact=True)
    excluded = [s["row"] for s in segs if s["D"] is None]
    T.check("A.segments", "rows excluded from time totals", excluded, ar["segments_excluded_from_time"])
    for k, v in ar["travel_time_totals"].items():
        if isinstance(v, dict):
            T.check("A.totals", f"Travel Time!{k}", out[k], v["value"])
    for k, v in ar["expected"].items():
        T.check("A.outputs", f"ActiveRoute!{k}", out[k], v["value"])
    for row in ar["macro_truck_buttons"]["table"]:
        m = macro_buttons(out, row["button"])
        for k in ("C20", "C24", "C26", "C28"):
            T.check("A.macro(derived)", f"Macro_{row['button']} {k}", m[k], row[k])
    return out


# ----------------------------------------------------------------------------- B. Targets + crew rules
_ALLOWED = (ast.Expression, ast.BinOp, ast.UnaryOp, ast.Compare, ast.Name, ast.Attribute, ast.Constant, ast.Call, ast.Load,
            ast.Add, ast.Sub, ast.Mult, ast.Div, ast.USub, ast.Gt, ast.GtE, ast.Lt, ast.LtE, ast.Eq, ast.NotEq)


def evaluate(expr, env):
    if isinstance(expr, (int, float)):
        return expr
    tree = ast.parse(expr.replace("true", "True"), mode="eval")
    for node in ast.walk(tree):
        if not isinstance(node, _ALLOWED):
            raise ValueError(f"disallowed syntax in rule expression: {expr}")

    def ev(n):
        if isinstance(n, ast.Expression):
            return ev(n.body)
        if isinstance(n, ast.Constant):
            return n.value
        if isinstance(n, ast.Name):
            return True if n.id == "True" else env[n.id]
        if isinstance(n, ast.Attribute):
            return ev(n.value)[n.attr]
        if isinstance(n, ast.UnaryOp):
            return -ev(n.operand)
        if isinstance(n, ast.BinOp):
            a, b = ev(n.left), ev(n.right)
            if isinstance(n.op, ast.Add):
                return a + b
            if isinstance(n.op, ast.Sub):
                return a - b
            if isinstance(n.op, ast.Mult):
                return a * b
            return a / b
        if isinstance(n, ast.Compare):
            a = ev(n.left)
            b = ev(n.comparators[0])
            op = type(n.ops[0])
            return {ast.Gt: a > b, ast.GtE: a >= b, ast.Lt: a < b, ast.LtE: a <= b, ast.Eq: a == b, ast.NotEq: a != b}[op]
        if isinstance(n, ast.Call):
            fn = {"max": max, "min": min}[n.func.id]
            return fn(*[ev(a) for a in n.args])
        raise ValueError(expr)
    return ev(tree)


def run_rules(ruleset, scenario):
    params = {k: v["value"] for k, v in ruleset["params"].items()}
    circuits = [dict(c) for c in scenario["inputs"]["circuits"]]
    for cid, t in scenario.get("overrides", {}).get("circuit_trucks", {}).items():
        for c in circuits:
            if c["id"] == cid:
                c["trucks"] = t
    role_over = scenario.get("overrides", {}).get("roles", {})
    inputs = {"enabling_dozers": scenario["inputs"]["enabling_dozers"]}
    totals = {"total_trucks": sum(c["trucks"] for c in circuits)}
    roles = {r: 0 for r in ruleset["roles"]}
    by_circuit = {}

    def apply(role, value, cid, mode):
        if role in role_over:
            value, mode = role_over[role], "set"
        if mode == "set":
            roles[role] = value
            by_circuit[(role, cid)] = value
        else:
            roles[role] += value
            by_circuit[(role, cid)] = by_circuit.get((role, cid), 0) + value

    for rule in ruleset["rules"]:
        targets = circuits if rule["scope"] == "circuit" else [None]
        for c in targets:
            env = {"params": params, "inputs": inputs, "totals": totals, "roles": roles, "circuit": c or {}}
            if rule["scope"] == "circuit" and not evaluate(rule.get("where", "true"), env):
                continue
            if not evaluate(rule.get("when", "true"), env):
                continue
            for mode in ("set", "add"):
                for role, ex in rule.get(mode, {}).items():
                    apply(role, evaluate(ex, env), c["id"] if c else None, mode)
    return roles, by_circuit, totals


def verify_targets(T, tg):
    days = len(tg["days"])
    circ = {c["id"]: c for c in tg["circuits"]}
    num = lambda v: 0 if v is None else v
    f = lambda cid, key: circ[cid]["fields"][key]["values"]
    computed = {}
    for cid, prod in (("EX09", "target_waste"), ("EX04", "target_waste"), ("EX06", "target_waste"), ("LDR 1/2", "target_waste"), ("LDR 2/2", "target_coal")):
        computed[cid] = [num(f(cid, "hours")[d]) * num(f(cid, "rate")[d]) for d in range(days)]
        for d in range(days):
            T.check("B.plan", f"{cid} {prod} day{d+1}", computed[cid][d], f(cid, prod)[d])
        wt = circ[cid]["fields"][prod].get("week_total")
        if wt:
            T.check("B.plan", f"{cid} {prod} week {wt['cell']}", sum(computed[cid]), wt["value"])
    trucks = [sum(num(f(c, "trucks")[d]) for c in ("EX09", "EX04", "EX06", "LDR 1/2", "LDR 2/2")) for d in range(days)]
    dz = circ["DZR"]["fields"]
    en = circ["DZR - Enabling Tasks"]["fields"]["dozers"]["values"]
    dozers = [(7 - (trucks[d] - 12) - en[d]) if trucks[d] > 12 else (7 - en[d]) for d in range(days)]
    dzr = [dz["hours"]["values"][d] * dz["rate"]["values"][d] * dozers[d] for d in range(days)]
    blank39 = [num(v) for v in circ["LDR 2/2"]["fields"]["target_waste"]["values"]]
    waste = [computed["EX09"][d] + computed["EX04"][d] + computed["EX06"][d] + computed["LDR 1/2"][d] + dzr[d] + blank39[d] for d in range(days)]
    coal = [computed["LDR 1/2"][d] + computed["LDR 2/2"][d] for d in range(days)]
    units = [waste[d] + coal[d] for d in range(days)]
    tot = tg["daily_totals"]
    for d in range(days):
        T.check("B.plan", f"E47 dozers day{d+1}", dozers[d], dz["dozers"]["values"][d])
        T.check("B.plan", f"E48 DZR target day{d+1}", dzr[d], dz["target_waste"]["values"][d])
        T.check("B.plan", f"E55 daily waste day{d+1}", waste[d], tot["daily_waste_bcm"]["values"][d])
        T.check("B.plan", f"E56 daily coal day{d+1}", coal[d], tot["daily_coal"]["values"][d])
        T.check("B.plan", f"E57 trucks day{d+1}", trucks[d], tot["daily_trucks_operating"]["values"][d])
        T.check("B.plan", f"E58 total units day{d+1}", units[d], tot["total_units"]["values"][d])
    T.check("B.plan", "L48 DZR week", sum(dzr), dz["target_waste"]["week_total"]["value"])
    T.check("B.plan", "L55 waste week", sum(waste), tot["daily_waste_bcm"]["week_total"]["value"])
    T.check("B.plan", "L56 coal week", sum(coal), tot["daily_coal"]["week_total"]["value"])
    T.check("B.plan", "L58 units week", sum(units), tot["total_units"]["week_total"]["value"])

    rs = tg["rule_set"]
    blocks = {"rows 65-88": tg["crew_blocks"][0], "rows 93-116": tg["crew_blocks"][1]}
    day_of = {d["date"]: i for i, d in enumerate(tg["days"])}
    for sc in rs["test_scenarios"]:
        roles, by_c, totals = run_rules(rs, sc)
        d = day_of[sc["date"]]
        blk = blocks[sc["crew_block"]]
        total = sum(roles.values())
        T.check("B.crew", f"{sc['id']} total crew", total, sc["expected"]["total_crew"], exact=True)
        T.check("B.crew", f"{sc['id']} total crew vs cell row {blk['total']['row']}", total, blk["total"]["values"][d], exact=True)
        if "total_trucks" in sc["expected"]:
            T.check("B.crew", f"{sc['id']} total trucks", totals["total_trucks"], sc["expected"]["total_trucks"], exact=True)
            T.check("B.crew", f"{sc['id']} bulk push (E47)", roles["dozer_bulk_push"], sc["expected"]["dozer_bulk_push_E47"], exact=True)
        for ln in blk["lines"]:
            mp = ln["maps_to"]
            for col in ("trucks", "equip_op"):
                if col in mp and ln[col][d] is not None:
                    role, cid = mp[col]
                    T.check("B.crew", f"{sc['id']} row {ln['row']} {ln['role']} [{col}]", by_c.get((role, cid), 0), ln[col][d], exact=True)


# ----------------------------------------------------------------------------- C. raw data strings
def verify_raw_strings(T, raw, ar, tables):
    loaded = {r["grade"]: r["max_speed_kmh"] for r in tables["speed_tables"]["loaded"]["rows"]}
    unloaded = {r["grade"]: r["max_speed_kmh"] for r in tables["speed_tables"]["unloaded"]["rows"]}
    cur = [s for s in raw["strings"] if s["is_current_data_dump"]]
    T.check("C.raw", "exactly one string is the current Data Dump", len(cur), 1, exact=True)
    T.check("C.raw", "current string points == Data Dump points", cur[0]["points"], ar["points"])
    for s in raw["strings"]:
        segs = travel_time_sheet(s["points"], loaded, unloaded)
        tl = sum(x["D"] for x in segs if x["D"] is not None)
        tu = sum(x["M"] for x in segs if x["M"] is not None)
        T.check("C.raw", f"{s['id']} loaded_time_s (derived)", tl, s["spreadsheet_mode_travel"]["loaded_time_s"])
        T.check("C.raw", f"{s['id']} unloaded_time_s (derived)", tu, s["spreadsheet_mode_travel"]["unloaded_time_s"])
        T.check("C.raw", f"{s['id']} point_count", len(s["points"]), s["point_count"], exact=True)
    T.check("C.raw", "current string loaded time == Travel Time!F15", cur[0]["spreadsheet_mode_travel"]["loaded_time_s"], ar["travel_time_totals"]["F15"]["value"])
    T.check("C.raw", "current string unloaded time == Travel Time!H15", cur[0]["spreadsheet_mode_travel"]["unloaded_time_s"], ar["travel_time_totals"]["H15"]["value"])


# ----------------------------------------------------------------------------- D. workbook cross-check
def verify_workbook(T, path, ar, tables, tg, raw):
    import datetime
    import warnings
    warnings.filterwarnings("ignore")
    import openpyxl
    wb = openpyxl.load_workbook(path, data_only=True)

    def val(sheet, ref):
        v = wb[sheet][ref].value
        if isinstance(v, datetime.datetime):
            return v.date().isoformat() if v.time() == datetime.time(0) else v.isoformat()
        return v

    def split(ref):
        sheet, cell = ref.rsplit("!", 1)
        return sheet.strip("'"), cell

    # D1 points
    dd = wb["Data Dump"]
    pts = []
    for r in range(2, dd.max_row + 1):
        row = [dd.cell(r, c).value for c in (1, 2, 3)]
        if any(v is not None for v in row):
            pts.append(row)
    T.check("D.workbook", "Data Dump points == fixture", pts, ar["points"])
    # D2 tables
    for leg, (gc, sc) in (("loaded", ("P", "Q")), ("unloaded", ("S", "T"))):
        for i, row in enumerate(tables["speed_tables"][leg]["rows"]):
            r = 3 + i
            T.check("D.workbook", f"{leg} speed row {r}", [val("Travel Time", f"{gc}{r}"), val("Travel Time", f"{sc}{r}")],
                    [row["grade"], row["max_speed_kmh"]])
    for code, ex in tables["excavator_assumptions"]["excavators"].items():
        r0 = int(ex["source_rows"].split("!H")[1].split(":")[0])
        T.check("D.workbook", f"EX {code}", [val("ActiveRoute", f"H{r0}"), val("ActiveRoute", f"I{r0+1}"), val("ActiveRoute", f"I{r0+2}"),
                                             val("ActiveRoute", f"I{r0+3}"), val("ActiveRoute", f"I{r0+4}")],
                [code, ex["dump_time_s"], ex["spot_time_s"], ex["loading_time_s"], ex["planned_rate_bcm_per_pt_hr"]])
    for tt, v in tables["truck_load_bcm"]["truck_type_to_load"]["map"].items():
        T.check("D.workbook", f"truck load {tt}", val("ActiveRoute", v["cell"]), v["bcm"], exact=True)
    # D3 cached outputs and segments
    for k, v in list(ar["expected"].items()) + [(k, v) for k, v in ar["travel_time_totals"].items() if isinstance(v, dict)]:
        s, c = split(v["cell"])
        T.check("D.workbook", v["cell"], val(s, c), v["value"], exact=True)
    for e in ar["segments"]:
        r = e["travel_time_row"]
        for col, key in (("A", "distance_m"), ("B", "grade"), ("C", "loaded_speed_kmh"), ("D", "loaded_time_s"),
                         ("J", "unloaded_distance_m"), ("K", "unloaded_grade"), ("L", "unloaded_speed_kmh"), ("M", "unloaded_time_s")):
            T.check("D.workbook", f"Travel Time!{col}{r}", val("Travel Time", f"{col}{r}"), e[key], exact=True)
    T.check("D.workbook", "Travel Time!D120 blank", val("Travel Time", "D120"), None)
    # D4 recompute straight from workbook values
    ws = wb["ActiveRoute"]
    tbl = {"speed_tables": {
        "loaded": {"rows": [{"grade": val("Travel Time", f"P{r}"), "max_speed_kmh": val("Travel Time", f"Q{r}")} for r in range(3, 36)]},
        "unloaded": {"rows": [{"grade": val("Travel Time", f"S{r}"), "max_speed_kmh": val("Travel Time", f"T{r}")} for r in range(3, 36)]}},
        "excavator_assumptions": {"excavators": {}},
        "truck_load_bcm": {"truck_type_to_load": {"map": {}}}}
    for r0 in (4, 10, 16, 22, 28):
        tbl["excavator_assumptions"]["excavators"][ws[f"H{r0}"].value] = {
            "dump_time_s": ws[f"I{r0+1}"].value, "spot_time_s": ws[f"I{r0+2}"].value,
            "loading_time_s": ws[f"I{r0+3}"].value, "planned_rate_bcm_per_pt_hr": ws[f"I{r0+4}"].value}
    for name, ref in (("CAT789C (OB)", "N12"), ("KOM1500HD (OB)", "N13"), ("CAT789C (COAL)", "N16"),
                      ("KOM1500HD (COAL)", "N17"), ("CAT789D (OB)", "N14"), ("CAT789D (COAL)", "N18")):
        tbl["truck_load_bcm"]["truck_type_to_load"]["map"][name] = {"bcm": ws[ref].value}
    inputs = {"B3": ws["B3"].value, "C3": ws["C3"].value, "C6": ws["C6"].value, "C11": ws["C11"].value,
              "C20": ws["C20"].value, "I34": ws["I34"].value}
    segs, out = active_route_chain(pts, tbl, inputs)
    for s in segs:
        for col in ("A", "B", "C", "D", "J", "K", "L", "M"):
            T.check("D.recompute", f"Travel Time!{col}{s['row']}", s[col], val("Travel Time", f"{col}{s['row']}"))
    for k in ("C4", "C5", "C7", "C8", "C9", "C10", "C12", "C14", "C15", "C16", "C17", "C19", "C20", "C21", "C22", "C24", "C26", "C28"):
        T.check("D.recompute", f"ActiveRoute!{k}", out[k], ws[k].value)
    for k in ("F15", "F16", "H15", "H16"):
        T.check("D.recompute", f"Travel Time!{k}", out[k], val("Travel Time", k))
    # D5 targets
    TG = "Targets & Haulage Priorities"
    cols = ["E", "F", "G", "H", "I", "J", "K"]
    for c in tg["circuits"]:
        for key, fld in c["fields"].items():
            T.check("D.workbook", f"Targets {c['id']} {key} row {fld['row']}", [val(TG, f"{x}{fld['row']}") for x in cols], fld["values"])
    for key, fld in tg["daily_totals"].items():
        T.check("D.workbook", f"Targets {key} row {fld['row']}", [val(TG, f"{x}{fld['row']}") for x in cols], fld["values"])
    pairs = [("D", "E"), ("F", "G"), ("H", "I"), ("J", "K"), ("L", "M"), ("N", "O"), ("P", "Q")]
    for blk in tg["crew_blocks"]:
        for ln in blk["lines"]:
            T.check("D.workbook", f"crew row {ln['row']} trucks", [val(TG, f"{t}{ln['row']}") for t, _ in pairs], ln["trucks"])
            T.check("D.workbook", f"crew row {ln['row']} equip", [val(TG, f"{e}{ln['row']}") for _, e in pairs], ln["equip_op"])
        T.check("D.workbook", f"crew total row {blk['total']['row']}", [val(TG, f"{t}{blk['total']['row']}") for t, _ in pairs], blk["total"]["values"])
    # D6 raw data strings
    rd = wb["Raw Data"]
    for s in raw["strings"]:
        T.check("D.workbook", f"Raw Data title row {s['title_row']}", rd.cell(s["title_row"], 1).value, s["title"])
        got = [[rd.cell(r, c).value for c in (5, 6, 7)] for r in range(s["first_point_row"], s["last_point_row"] + 1)
               if isinstance(rd.cell(r, 5).value, (int, float))]
        T.check("D.workbook", f"Raw Data points {s['id']}", got, s["points"])


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--workbook", help="path to calc.xlsm for the cross-check (needs openpyxl)")
    ap.add_argument("-v", "--verbose", action="store_true")
    args = ap.parse_args()

    ar = load("spreadsheet-active-route.json")
    tables = load("spreadsheet-tables.json")
    tg = load("spreadsheet-targets-crew.json")
    raw = load("raw-data-strings.json")
    T = Tally()
    out = verify_active_route(T, ar, tables)
    verify_targets(T, tg)
    verify_raw_strings(T, raw, ar, tables)
    if args.workbook:
        verify_workbook(T, args.workbook, ar, tables, tg, raw)
    else:
        print("(workbook cross-check skipped; pass --workbook path/to/calc.xlsm)")

    print("section                 pass  fail")
    for sec, (p, f) in sorted(T.by_section.items()):
        print(f"{sec:22s} {p:5d} {f:5d}")
    print(f"TOTAL                  {T.passed:5d} {T.failed:5d}")
    print(f"max relative error on toleranced numeric checks: {T.max_rel:.3e}")
    if args.verbose:
        for k in ("C4", "C5", "C7", "C14", "C16", "C24", "C28"):
            print(f"  {k} = {out[k]!r}")
    for f in T.failures[:50]:
        print("FAIL", f)
    sys.exit(1 if T.failed else 0)


if __name__ == "__main__":
    main()
