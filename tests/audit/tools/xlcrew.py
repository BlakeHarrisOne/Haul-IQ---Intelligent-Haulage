"""Re-derive the 14 crew scenarios (2 blocks × 7 days) of 'Targets & Haulage Priorities' rows 47, 52, 57, 65–116
straight from the workbook cells, evaluating each line's formula semantics and checking them against the cached values.
Also emits synthetic day plans (push-dozer rule above 12 trucks) evaluated with the same formulas.
usage: python3 -I tests/audit/tools/xlcrew.py <calc.xlsm> tests/audit/workbook-crew.json
"""
import json, sys, warnings
import openpyxl
from openpyxl.utils import get_column_letter as L

warnings.filterwarnings('ignore')
wbv = openpyxl.load_workbook(sys.argv[1], data_only=True)
wbf = openpyxl.load_workbook(sys.argv[1], data_only=False)
v, f = wbv['Targets & Haulage Priorities'], wbf['Targets & Haulage Priorities']
num = lambda x: x if isinstance(x, (int, float)) else 0

def plan_day(col):
    """Plan inputs for a day column E..K (5..11)."""
    t = {'EX09': num(v.cell(6, col).value), 'EX04': num(v.cell(13, col).value), 'EX06': num(v.cell(20, col).value),
         'LDR1': num(v.cell(28, col).value), 'LDR2': num(v.cell(36, col).value)}
    e52 = num(v.cell(52, col).value)
    e57 = t['EX09'] + t['EX04'] + t['EX06'] + t['LDR1'] + t['LDR2']           # =E6+E13+E20+E28+E36
    e47 = 7 - (e57 - 12) - e52 if e57 > 12 else 7 - e52                      # =IF(E57>12,7-(E57-12)-E52,7-E52)
    assert e57 == v.cell(57, col).value and e47 == v.cell(47, col).value, (col, e57, e47)
    return t, e52, e57, e47

def crew_lines(t, e52, e47, typed=None):
    """Lines of one crew block for one day (block 1 formulas; typed = block-2 typed overrides)."""
    typed = typed or {}
    tr = {**t, **typed.get('trucks', {})}
    lines = {
        'trucks': sum(tr.values()),
        'EX09_op': 1 if tr['EX09'] > 0 else 0, 'EX09_dzr': 2 if tr['EX09'] > 0 else 0,
        'EX04_op': 1 if tr['EX04'] > 0 else 0, 'EX04_dzr': 2 if tr['EX04'] > 0 else 0,
        'EX06_op': 1 if tr['EX06'] > 0 else 0, 'EX06_dzr': 2 if tr['EX06'] > 0 else 0,
        'LDR1_op': 1 if tr['LDR1'] > 0 else 0, 'LDR1_coal': 1 if tr['LDR1'] > 0 else 0,
        'LDR2_op': 1 if tr['LDR2'] > 0 else 0, 'LDR2_coal': 1 if tr['LDR2'] > 0 else 0,
        'support_ex': 1 if tr['LDR1'] > 0 else 0,            # =IF(D75>0,1,0) — LDR 1 only
    }
    push = typed.get('push', e47)                              # =$E$47 (block 1) or typed (block 2)
    lines['push'] = push
    lines['assist'] = 1 if push > 0 else 0                     # =IF(E81>0,1,0)
    lines['enabling'] = e52                                    # =$E$52
    lines['water'] = typed.get('water', 2)
    lines['grader'] = typed.get('grader', 2)
    lines['sup_oce'] = typed.get('sup_oce', 3)
    lines['total'] = sum(lines.values())
    return lines

ROW = {1: {'EX09': 68, 'EX04': 70, 'EX06': 72, 'LDR1': 75, 'LDR2': 77, 'push': 81, 'assist': 82, 'enabling': 83, 'water': 85, 'grader': 86, 'sup_oce': 87, 'total': 88},
       2: {'EX09': 96, 'EX04': 98, 'EX06': 100, 'LDR1': 103, 'LDR2': 105, 'push': 109, 'assist': 110, 'enabling': 111, 'water': 113, 'grader': 114, 'sup_oce': 115, 'total': 116}}

scenarios = []
bad = []
for day in range(7):
    pc = 5 + day                       # plan column E..K
    tc, ec = 4 + 2 * day, 5 + 2 * day  # crew Trucks / Equip Op columns D/E, F/G, …
    t, e52, e57, e47 = plan_day(pc)
    for blk in (1, 2):
        R = ROW[blk]
        typed = {}
        if blk == 2:
            # typed constants in block 2 (read from the sheet: cells that are not formulas)
            def typed_val(r, c):
                fv = f.cell(r, c).value
                return None if isinstance(fv, str) and fv.startswith('=') else fv
            ex9 = typed_val(R['EX09'], tc)
            if ex9 is not None: typed.setdefault('trucks', {})['EX09'] = ex9
            for key in ('push', 'water', 'grader', 'sup_oce'):
                tv = typed_val(R[key], ec)
                if tv is not None: typed[key] = tv
        lines = crew_lines(t, e52, e47, typed)
        # check against the cached block cells
        cached = {
            'trucks': sum(num(v.cell(R[k], tc).value) for k in ('EX09', 'EX04', 'EX06', 'LDR1', 'LDR2')),
            'push': num(v.cell(R['push'], ec).value), 'assist': num(v.cell(R['assist'], ec).value),
            'enabling': num(v.cell(R['enabling'], ec).value), 'water': num(v.cell(R['water'], ec).value),
            'grader': num(v.cell(R['grader'], ec).value), 'sup_oce': num(v.cell(R['sup_oce'], ec).value),
            'total': v.cell(R['total'], tc).value,
            'EX09_op': num(v.cell(R['EX09'], ec).value), 'EX09_dzr': num(v.cell(R['EX09'] + 1, ec).value),
            'LDR1_op': num(v.cell(R['LDR1'], ec).value), 'support_ex': num(v.cell(R['LDR1'] + 4, ec).value),
        }
        for k, cv in cached.items():
            if lines[k] != cv: bad.append((blk, day, k, lines[k], cv))
        trucks = {**t, **typed.get('trucks', {})}
        scenarios.append({'id': f'block{blk}_day{day + 1}', 'block': blk, 'day': day + 1, 'trucks': trucks, 'enabling': e52,
                          'overrides': {k: typed[k] for k in typed if k != 'trucks'}, 'lines': lines})
print('crew scenarios', len(scenarios), 'mismatches vs cached', bad)
assert not bad

# synthetic day plans with the same formulas (push rule above 12 trucks, LDR2 only, enabling 0/2)
synth = []
for name, t, e52 in [
    ('13 trucks', {'EX09': 6, 'EX04': 4, 'EX06': 0, 'LDR1': 3, 'LDR2': 0}, 1),
    ('14 trucks', {'EX09': 6, 'EX04': 5, 'EX06': 0, 'LDR1': 3, 'LDR2': 0}, 1),
    ('18 trucks + EX06', {'EX09': 6, 'EX04': 5, 'EX06': 4, 'LDR1': 3, 'LDR2': 0}, 1),
    ('20 trucks (push < 0)', {'EX09': 8, 'EX04': 6, 'EX06': 2, 'LDR1': 2, 'LDR2': 2}, 1),
    ('19 trucks, enabling 0 (push 0)', {'EX09': 8, 'EX04': 6, 'EX06': 2, 'LDR1': 3, 'LDR2': 0}, 0),
    ('LDR2 only', {'EX09': 0, 'EX04': 0, 'EX06': 0, 'LDR1': 0, 'LDR2': 3}, 1),
    ('no trucks', {'EX09': 0, 'EX04': 0, 'EX06': 0, 'LDR1': 0, 'LDR2': 0}, 1),
    ('12 trucks, enabling 2', {'EX09': 5, 'EX04': 4, 'EX06': 0, 'LDR1': 3, 'LDR2': 0}, 2),
]:
    e57 = sum(t.values())
    e47 = 7 - (e57 - 12) - e52 if e57 > 12 else 7 - e52
    synth.append({'id': name, 'trucks': t, 'enabling': e52, 'overrides': {}, 'lines': crew_lines(t, e52, e47), 'E47': e47})
json.dump({'source': 'calc.xlsm Targets & Haulage Priorities rows 47–57, 65–116 (re-derived)', 'scenarios': scenarios, 'synthetic': synth},
          open(sys.argv[2], 'w'), indent=1)
for s in scenarios[:2] + synth:
    print(s['id'], s['lines']['total'], s['lines'])
