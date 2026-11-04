"""Independent re-derivation of calc.xlsm 'Travel Time' + 'ActiveRoute' straight from the workbook (audit).

Reads tables / assumptions / strings from the workbook itself (not from the docs fixtures), evaluates the cell
formulas literally (operation order as written in Excel), validates the model against the cached cells, then writes
expected values for a set of audit cases to tests/audit/workbook-derived.json for the vitest comparison.
usage: python3 -I tests/audit/tools/xlmodel.py <calc.xlsm> tests/audit/workbook-derived.json
"""
import json, math, sys, warnings
from decimal import Decimal, ROUND_HALF_UP
import openpyxl

warnings.filterwarnings('ignore')
WB, OUT = sys.argv[1], sys.argv[2]
wbv = openpyxl.load_workbook(WB, data_only=True)
wbf = openpyxl.load_workbook(WB, data_only=False)
AR, TT, DD, RD = wbv['ActiveRoute'], wbv['Travel Time'], wbv['Data Dump'], wbv['Raw Data']
ARF = wbf['ActiveRoute']

# ── tables straight from the sheets
LOADED = [(TT.cell(r, 16).value, TT.cell(r, 17).value) for r in range(3, 36)]   # P3:Q35
UNLOADED = [(TT.cell(r, 19).value, TT.cell(r, 20).value) for r in range(3, 36)]  # S3:T35 (T cached values)
H = {r: AR.cell(r, 8).value for r in range(4, 33)}   # H4:H32
I = {r: AR.cell(r, 9).value for r in range(4, 33)}   # I4:I32
I34 = AR['I34'].value
N = {r: AR.cell(r, 14).value for r in range(12, 19)}

def xround(x, d):
    """Excel ROUND: half away from zero on the 15-significant-digit value."""
    q = Decimal(1).scaleb(-d)
    return float(Decimal(format(x, '.15g')).quantize(q, rounding=ROUND_HALF_UP))

def vlookup_exact(v, table):
    for g, s in table:            # first exact match (Excel compares doubles)
        if g == v:
            return s
    return None                   # #N/A

def match_ex(b3):
    """MATCH(B3, H4:H32, 0) → 1-based position, then INDEX(I4:I32, pos + k)."""
    for k, r in enumerate(range(4, 33), start=1):
        if H[r] == b3:
            return k
    raise KeyError(b3)

def index_I(pos):
    return I[4 + pos - 1]

def c21(c3):
    m = {'CAT789C (OB)': N[12], 'KOM1500HD (OB)': N[13], 'CAT789C (COAL)': N[16], 'KOM1500HD (COAL)': N[17],
         'CAT789D (OB)': N[14], 'CAT789D (COAL)': N[18]}
    return m.get(c3, '')

def c26_rate(b3):
    # IF(B$3=H4,I8,IF(B$3=H10,I14,IF(B$3=H16,I20,IF(B$3=H22,I26,IF(B$3=H28,I32,"")))))
    for h, i in ((4, 8), (10, 14), (16, 20), (22, 26), (28, 32)):
        if b3 == H[h]:
            return I[i]
    return ''

def travel(points):
    """Data Dump rows 2.. = points; Travel Time rows 4..3328 (row r uses DD r-1 (to) and r-2 (from))."""
    dd = {k + 2: p for k, p in enumerate(points)}
    blank = (None, None, None)
    rows = []
    F15 = 0.0
    H15 = 0.0
    nmax = len(points) + 2
    for r in range(4, min(3328, nmax + 1) + 1):
        to = dd.get(r - 1, blank)
        fr = dd.get(r - 2, blank)
        z = lambda v: 0 if v is None else v
        # A
        if z(to[0]) == 0:
            A = ''
        else:
            A = math.sqrt((z(to[0]) - z(fr[0])) ** 2 + (z(to[1]) - z(fr[1])) ** 2 + (z(to[2]) - z(fr[2])) ** 2)
        # B
        try:
            B = (z(to[2]) - z(fr[2])) / A if A != '' else ''
        except ZeroDivisionError:
            B = ''
        # C / D
        RB = xround(B, 2) if B != '' else None
        C = vlookup_exact(RB, LOADED) if RB is not None else None
        D = ((A / 1000) / C) * 60 * 60 if C is not None else None
        # J/K/L/M
        K = -B if B != '' else ''
        RK = xround(K, 2) if K != '' else None
        L = vlookup_exact(RK, UNLOADED) if RK is not None else None
        M = ((A / 1000) / L) * 60 * 60 if L is not None else None
        if D is not None:
            F15 += D
        if M is not None:
            H15 += M
        if A == '' and r - 1 > nmax - 1:
            continue
        rows.append({'row': r, 'i': r - 4, 'A': A if A != '' else None, 'B': B if B != '' else None, 'R': RB, 'C': C, 'D': D,
                     'RK': RK, 'L': L, 'M': M})
    return rows, F15, H15

def chain(points, b3, c3, c6, c11, c20, i34):
    rows, F15, H15 = travel(points)
    C4, C5 = F15, H15
    C7 = (C4 + C5) / c6                      # SUM(C4,C5)/C6
    pos = match_ex(b3)
    C8, C9, C10 = index_I(pos + 1), index_I(pos + 2), index_I(pos + 3)
    C12 = 60 * c11
    C14 = C7 + C8 + C9 + C10 + C12             # SUM(C7:C10,C12) (C11 is the stop count, excluded)
    C15 = C14 / 60
    C21 = c21(c3)
    C16 = (60 / C15) * C21
    C22 = i34
    C19 = index_I(pos + 4) * i34
    rate = c26_rate(b3)

    def at(c20v):
        C17 = c20v / C16
        C24 = C17 / C22
        C26 = c20v / rate
        C28 = (C22 / 2) - (C26 / 2)
        return {'C20': c20v, 'C17': C17, 'C24': C24, 'C26': C26, 'C28': C28}
    out = {'C4': C4, 'C5': C5, 'C7': C7, 'C8': C8, 'C9': C9, 'C10': C10, 'C12': C12, 'C14': C14, 'C15': C15, 'C16': C16,
           'C19': C19, 'C21': C21, 'C22': C22, **at(c20)}
    macro = []
    for n in range(1, 10):
        goal = n * C22 * C16           # GoalSeek C24 := n (C24 linear in C20) — exact solution
        c20n = C19 if goal > C19 else goal
        macro.append({'n': n, 'goal': goal, 'capped': goal > C19, **at(c20n)})
    return rows, out, macro

# ── 1. validate the model against the workbook's cached cells (current Data Dump + ActiveRoute inputs)
dd_pts = []
for r in range(2, 3328):
    v = [DD.cell(r, c).value for c in (1, 2, 3)]
    if all(x is None for x in v):
        break
    dd_pts.append(v)
inp = dict(b3=AR['B3'].value, c3=AR['C3'].value, c6=AR['C6'].value, c11=AR['C11'].value, c20=AR['C20'].value, i34=I34)
rows, out, macro = chain(dd_pts, **inp)
bad = []
for k in ['C4', 'C5', 'C7', 'C8', 'C9', 'C10', 'C12', 'C14', 'C15', 'C16', 'C17', 'C19', 'C20', 'C21', 'C22', 'C24', 'C26', 'C28']:
    cv = AR[k].value
    if abs(out[k] - cv) > 1e-12 * max(1, abs(cv)):
        bad.append((k, out[k], cv))
for rw in rows:
    r = rw['row']
    for col, key in ((1, 'A'), (2, 'B'), (3, 'C'), (4, 'D'), (12, 'L'), (13, 'M')):
        cv = TT.cell(r, col).value
        mv = rw[key]
        if cv in (None, ''):
            if mv is not None:
                bad.append((f'TT!{col}{r}', mv, cv))
        elif mv is None or abs(mv - cv) > 1e-12 * max(1, abs(cv)):
            bad.append((f'TT!{col}{r}', mv, cv))
print(f'model vs cached workbook: {len(rows)} rows, {len(bad)} mismatches', bad[:5])
assert not bad

# ── 2. Raw Data strings straight from the sheet (title row in A followed by a 'No.' header row; points = E/F/G)
strings = []
r = 1
maxr = RD.max_row
while r <= maxr:
    a = RD.cell(r, 1).value
    if isinstance(a, str) and a.strip() and a.strip() != 'No.' and RD.cell(r + 1, 1).value == 'No.':
        pts = []
        q = r + 2
        while q <= maxr and all(isinstance(RD.cell(q, c).value, (int, float)) for c in (5, 6, 7)):
            pts.append([RD.cell(q, 5).value, RD.cell(q, 6).value, RD.cell(q, 7).value])
            q += 1
        strings.append({'n': len(strings) + 1, 'row': r, 'title': a.strip(), 'points': pts})
        r = q
    else:
        r += 1
print('raw strings parsed:', len(strings), [len(s['points']) for s in strings])
assert strings[-1]['points'] == dd_pts, 'string 23 should equal Data Dump'

# ── 3. audit cases
EXU = {'EX04': 'EX04', 'EX07': 'EX07', 'EX06': 'EX06', 'LDR': 'LDR1', 'EX09': 'EX09'}
TRK = {'CAT789C (OB)': ('CAT_789C', 'OB'), 'KOM1500HD (OB)': ('KOM_HD1500_7', 'OB'), 'CAT789C (COAL)': ('CAT_789C', 'CL'),
       'KOM1500HD (COAL)': ('KOM_HD1500_7', 'CL'), 'CAT789D (OB)': ('CAT_789D', 'OB'), 'CAT789D (COAL)': ('CAT_789D', 'CL')}
cases = []

def add(cid, title, pts, b3, c3, c6=0.85, c11=2, c20=None, i34=20, note=''):
    pos = match_ex(b3)
    if c20 is None:
        c20 = index_I(pos + 4) * i34
    rows, out, macro = chain(pts, b3, c3, c6, c11, c20, i34)
    cases.append({'id': cid, 'title': title, 'note': note, 'points': pts,
                  'inputs': {'B3': b3, 'C3': c3, 'C6': c6, 'C11': c11, 'C20': c20, 'I34': i34, 'unit': EXU[b3],
                             'truckId': TRK[c3][0], 'materialId': TRK[c3][1]},
                  'rows': rows, 'expected': out, 'macro': macro})

add('activeroute', 'Data Dump (EX09 - B7-9 to RL282), cached inputs', dd_pts, **inp)
S = {s['n']: s for s in strings}
add('raw01', S[1]['title'], S[1]['points'], 'EX07', 'CAT789C (OB)')
add('raw02', S[2]['title'], S[2]['points'], 'EX07', 'KOM1500HD (OB)', note='duplicate consecutive points')
add('raw07', S[7]['title'], S[7]['points'], 'EX06', 'CAT789C (OB)', c20=20000, note='manual C20 > C19 → C28 < 0')
add('raw08', S[8]['title'], S[8]['points'], 'EX04', 'KOM1500HD (OB)', c6=0.83, c11=3)
add('raw14', S[14]['title'], S[14]['points'], 'EX09', 'CAT789D (OB)', c6=0.9, c11=0)
add('raw17', S[17]['title'], S[17]['points'], 'LDR', 'CAT789C (COAL)', i34=18, c20=11700)
add('raw18', S[18]['title'], S[18]['points'], 'LDR', 'KOM1500HD (COAL)')
add('raw20', S[20]['title'], S[20]['points'], 'EX09', 'CAT789D (OB)', c20=30000)
add('raw21', S[21]['title'], S[21]['points'], 'LDR', 'CAT789D (COAL)', c11=4)
add('raw22', S[22]['title'], S[22]['points'], 'EX09', 'CAT789D (OB)', note='starts with a 3.4 m vertical step')
# every workbook truck type on the ActiveRoute string
for c3 in TRK:
    add('truck:' + c3, 'Data Dump × ' + c3, dd_pts, 'EX09', c3)
# every EX block
for b3 in EXU:
    add('ex:' + b3, 'Data Dump × ' + b3, dd_pts, b3, 'CAT789D (OB)')

# synthetic edge cases — small local coordinates so the ties survive in the 15-digit view
def vertical_profile(legs, e0=1000.0, n0=2000.0, z0=100.0):
    pts = [[e0, n0, z0]]
    e, n, z = e0, n0, z0
    for d, g in legs:
        dz = d * g
        e += math.sqrt(d * d - dz * dz)
        z += dz
        pts.append([e, n, z])
    return pts

def tie_profile(targets, e0=10.0, n0=2000.0, z0=0.0, d=50.0):
    """Segments whose computed grade dZ/d3 has the exact 15-digit decimal form of each target (true Excel ties)."""
    pts = [[e0, n0, z0]]
    for g in targets:
        e, n, z = pts[-1]
        e1, z1 = e + math.sqrt(d * d - (d * g) ** 2), z + d * g
        want = format(g, '.15g')
        grade = lambda zz: (zz - z) / math.sqrt((e1 - e) ** 2 + (n - n) ** 2 + (zz - z) ** 2)
        lo = hi = z1
        for _ in range(20000):
            if format(grade(lo), '.15g') == want: z1 = lo; break
            if format(grade(hi), '.15g') == want: z1 = hi; break
            lo, hi = math.nextafter(lo, -math.inf), math.nextafter(hi, math.inf)
        else:
            raise RuntimeError(f'no tie for {g}')
        pts.append([e1, n, z1])
    return pts

ties = [0.155, -0.155, 0.165, -0.165, 0.075, -0.075, 0.065, -0.065, 0.055, -0.055, 0.005, -0.005, 0.085, -0.085, 0.16, -0.16, 0.0, 0.1549999, 0.1650001, 0.0749999999999999, 0.0550000000000001, 0.125, -0.125, 0.025, -0.045, 0.145, -0.135]
tie_pts = tie_profile(ties)
add('edge:ties', 'grades at ±0.155 / ±0.165 / other half-steps', tie_pts, 'EX09', 'CAT789D (OB)')
import random
rng = random.Random(20261104)
fz = []
for _ in range(1500):
    k = rng.randint(-17, 16)
    g = (k + 0.5) / 100 + rng.choice([0, 0, 1e-15, -1e-15, 1e-12, -1e-12, 1e-9, -1e-9, rng.uniform(-0.004, 0.004)])
    fz.append((rng.uniform(5, 60), g))
add('edge:fuzz', 'seeded near-tie fuzz (1500 segments)', vertical_profile(fz, e0=500.0, n0=3000.0, z0=50.0), 'EX07', 'CAT789C (OB)', c6=0.83, c11=3)
add('edge:single', 'single segment 500 m @ +7.5 %', vertical_profile([(500.0, 0.075)]), 'EX04', 'KOM1500HD (OB)')
dup = vertical_profile([(100.0, 0.03), (100.0, -0.02)])
dup.insert(1, list(dup[1]))      # duplicated interior point
dup.insert(0, list(dup[0]))      # duplicated first point
add('edge:dup', 'duplicate first and interior points', dup, 'EX09', 'CAT789D (OB)')
add('edge:vertical', 'pure vertical step + flat', [[1000.0, 2000.0, 100.0], [1000.0, 2000.0, 103.4], [1100.0, 2000.0, 103.4]], 'EX09', 'CAT789D (OB)')

# blank interior row (workbook phantom segment) — expected workbook numbers for the report
blank_pts = [list(p) for p in dd_pts[:10]] + [[None, None, None]] + [list(p) for p in dd_pts[10:20]]
rows_b, F15b, H15b = travel(blank_pts)
blank_info = {'C4': F15b, 'C5': H15b, 'note': 'blank row 11 inside Data Dump'}

# tie classification for the report
tie_report = []
for rw in [c for c in cases if c['id'] == 'edge:ties'][0]['rows']:
    tie_report.append({'row': rw['row'], 'B': rw['B'], 'B15g': format(rw['B'], '.15g') if rw['B'] is not None else None, 'R': rw['R'], 'C': rw['C'], 'RK': rw['RK'], 'L': rw['L']})

# all 23 strings: travel only
all_travel = []
for s in strings:
    rows_s, f, h = travel(s['points'])
    all_travel.append({'n': s['n'], 'title': s['title'], 'points': s['points'], 'C4': f, 'C5': h,
                       'dropped': sum(1 for x in rows_s if x['A'] is not None and x['B'] is not None and (x['C'] is None or x['L'] is None))})

json.dump({'source': 'calc.xlsm (re-derived by tests/audit xlmodel.py from the workbook cells, not from docs fixtures)',
           'model_check': {'rows': len(rows), 'mismatches': len(bad)}, 'cases': cases, 'allStrings': all_travel,
           'blankRow': blank_info, 'ties': tie_report}, open(OUT, 'w'), separators=(',', ':'))
print('cases', len(cases), 'written', OUT)
for t in tie_report:
    print(t)
print('blank row phantom:', blank_info)
