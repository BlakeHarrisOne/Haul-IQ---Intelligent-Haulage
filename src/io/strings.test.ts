import { describe, expect, it } from 'vitest';
import { dxfLayerName, parseStringsText, toCsv, toDataDump, toDxf3dPolyline, toXyz } from './strings';

/** The calculator's 'Raw Data' sheet as Excel puts it on the clipboard (tab separated). */
const RAW_DATA = [
  'EX07 - S51 Haul West from Mid Point (Option 1 - FRONT DUMP TIER)\t\t\t\t\t\t\t\t5 trucks',
  'No.\tT\type\tColour\tX\tY\tZ\tW Name',
  '\t1:00:00\t0\t...\t236037.82\t7051810.44\t329.06\t0',
  '\t2:00:00\t1\t...\t235827.46\t7051950.95\t330.65\t0',
  '\t3:00:00\t1\t...\t235633.26\t7052118.99\t330.81\t0',
  '',
  'EX07 - S51 Haul West from Mid Point (Option 2 - FL LEVEL)\t\t\t\t\t\t\t\t5 trucks',
  'No.\tT\type\tColour\tX\tY\tZ\tW Name',
  '\t1:00:00\t0\t...\t236037.82\t7051810.44\t329.06\t0',
  '\t2:00:00\t1\t...\t236037.82\t7051810.44\t329.06\t0',
  '\t3:00:00\t1\t...\t235827.46\t7051950.95\t330.65\t0',
  '\t4:00:00\t1\t...\t235633.26\t7052118.99\t330.81\t0',
  '',
  'EX09 - B7-9 to RL325\t\t\t\t\t\t\t\t5\tTrucks req at 0.92hrs PT hang/shift (32kbcm)\t\t\t\t\t\tcentroid-to-centroid',
  'No.\tT\type\tColour\tX\tY\tZ\tW Name',
  '\t\t\t\t236494.145034093\t7051413.66124887\t291.315211467443',
  '\t\t\t\t236534.949189685\t7051379.40610139\t295.616968455145',
].join('\r\n');

describe('parseStringsText', () => {
  it('reads the Raw Data export-properties blocks with their titles', () => {
    const r = parseStringsText(RAW_DATA);
    expect(r.strings.map(s => s.name)).toEqual([
      'EX07 - S51 Haul West from Mid Point (Option 1 - FRONT DUMP TIER)',
      'EX07 - S51 Haul West from Mid Point (Option 2 - FL LEVEL)',
      'EX09 - B7-9 to RL325',
    ]);
    expect(r.strings[0].points).toEqual([[236037.82, 7051810.44, 329.06], [235827.46, 7051950.95, 330.65], [235633.26, 7052118.99, 330.81]]);
    expect(r.strings[1].points.length).toBe(3); // repeated first point removed
    expect(r.warnings.some(w => /Option 2.*removed 1 repeated point/.test(w))).toBe(true);
    expect(r.strings[2].points[1]).toEqual([236534.949189685, 7051379.40610139, 295.616968455145]);
  });

  it('the same rows written with " | " separators (as in the spec) parse too', () => {
    const text = [
      'EX07 - S51 Haul West from Mid Point (Option 1 - FRONT DUMP TIER)',
      'No. | Time | Type | Colour | X | Y | Z | W Name',
      '1 | 1:00 | Point | 3 | 236037.82 | 7051810.44 | 329.06 | ',
      '2 | 2:00 | Point | 3 | 235827.46 | 7051950.95 | 330.65 | ',
    ].join('\n');
    const r = parseStringsText(text);
    expect(r.strings.length).toBe(1);
    expect(r.strings[0].points[1]).toEqual([235827.46, 7051950.95, 330.65]);
  });

  it("detects the Data Dump's swapped NORTHING / EASTING labels by magnitude and says so", () => {
    const text = 'NORTHING\tEASTING\tELEVATION\n236494.145034092\t7051413.66124887\t294.727579310536\n236508.146852738\t7051402.2999323\t295.09825537488\n236518.006145756\t7051394.2999323\t295.217721042514\n';
    const r = parseStringsText(text, 'Data Dump.csv');
    expect(r.strings.length).toBe(1);
    expect(r.strings[0].name).toBe('Data Dump');
    expect(r.strings[0].points[0]).toEqual([236494.145034092, 7051413.66124887, 294.727579310536]);
    expect(r.warnings.join(' ')).toMatch(/headed 'NORTHING' holds eastings/);
  });

  it('plain CSV with a header, headerless whitespace XYZ, N-E-Z order and blank-line splits', () => {
    const csv = parseStringsText('Easting,Northing,RL\n"236,000.5",7051000,300\n236010,7051010,301\n');
    expect(csv.strings[0].points[0]).toEqual([236000.5, 7051000, 300]);
    const ws = parseStringsText('236000 7051000 300\n236010 7051010 301\n\n236100 7051100 310\n236110 7051110 311\n', 'pasted');
    expect(ws.strings.map(s => s.name)).toEqual(['pasted 1', 'pasted 2']);
    const nez = parseStringsText('7051000\t236000\t300\n7051010\t236010\t301\n');
    expect(nez.strings[0].points[0]).toEqual([236000, 7051000, 300]);
    expect(nez.warnings.join(' ')).toMatch(/looks like northings/);
    const twoD = parseStringsText('X,Y\n1,2\n3,4\n');
    expect(twoD.strings[0].points).toEqual([[1, 2, 0], [3, 4, 0]]);
    expect(twoD.warnings.join(' ')).toMatch(/no Z/);
    const local = parseStringsText('1 100.0 200.0 15.0 7\n2 110.0 210.0 16.0 7\n');
    expect(local.strings[0].points[0]).toEqual([200, 15, 7]); // last three numbers when nothing looks like map coordinates
  });

  it('warns when nothing usable is found', () => {
    const r = parseStringsText('hello\nworld\n');
    expect(r.strings).toEqual([]);
    expect(r.warnings.join(' ')).toMatch(/No coordinates found/);
    expect(parseStringsText('A\n236000 7051000 300\n').warnings.join(' ')).toMatch(/fewer than 2 points/);
  });
});

describe('exports', () => {
  const s = { name: 'EX09 → S51 West (long haul)', points: [[236000, 7051000, 300], [236010.123456, 7051010, 301.5]] as number[][] };
  const sp = { name: 'B', points: [{ e: 1, n: 2, z: 3 }, { e: 4, n: 5, z: 6 }] };

  it('CSV / XYZ / Data Dump', () => {
    expect(toCsv(s)).toBe('E,N,Z\n236000.000,7051000.000,300.000\n236010.123,7051010.000,301.500\n');
    expect(toXyz(sp, { decimals: 1 })).toBe('1.0 2.0 3.0\n4.0 5.0 6.0\n');
    expect(toDataDump(s)).toBe('236000\t7051000\t300\r\n236010.123456\t7051010\t301.5\r\n');
    expect(toDataDump(sp, { header: true }).split('\r\n')[0]).toBe('NORTHING\tEASTING\tELEVATION');
    // what we write, we read back
    expect(parseStringsText(toCsv(s)).strings[0].points[1]).toEqual([236010.123, 7051010, 301.5]);
    expect(parseStringsText(toDataDump(s, { header: true })).strings[0].points[0]).toEqual([236000, 7051000, 300]);
  });

  it('DXF R12 3D polylines: structure, layers and vertices', () => {
    const dxf = toDxf3dPolyline([s, sp, { ...sp }]);
    const lines = dxf.split('\r\n');
    const pairs: Array<[string, string]> = [];
    for (let i = 0; i + 1 < lines.length; i += 2) pairs.push([lines[i].trim(), lines[i + 1]]);
    const val = (code: string) => pairs.filter(p => p[0] === code).map(p => p[1]);
    expect(pairs[0]).toEqual(['0', 'SECTION']);
    expect(pairs.find(p => p[0] === '1')![1]).toBe('AC1009');
    expect(val('0').filter(v => v === 'POLYLINE').length).toBe(3);
    expect(val('0').filter(v => v === 'VERTEX').length).toBe(6);
    expect(val('0').filter(v => v === 'SEQEND').length).toBe(3);
    expect(pairs[pairs.length - 1]).toEqual(['0', 'EOF']);
    // POLYLINE flag 8 (3D) and VERTEX flag 32 (3D vertex)
    const i0 = pairs.findIndex(p => p[1] === 'POLYLINE');
    expect(pairs.slice(i0, i0 + 8).find(p => p[0] === '70')![1]).toBe('8');
    const iv = pairs.findIndex(p => p[1] === 'VERTEX');
    const vert = pairs.slice(iv, iv + 6);
    expect(vert.find(p => p[0] === '10')![1]).toBe('236000.0000');
    expect(vert.find(p => p[0] === '20')![1]).toBe('7051000.0000');
    expect(vert.find(p => p[0] === '30')![1]).toBe('300.0000');
    expect(vert.find(p => p[0] === '70')![1]).toBe('32');
    // layers declared and unique
    const layers = pairs.filter((p, k) => p[0] === '2' && pairs[k - 1]?.[1] === 'LAYER').map(p => p[1]);
    expect(layers).toEqual(['0', 'EX09_S51_WEST_LONG_HAUL', 'B', 'B_2']);
    expect(dxfLayerName('  ')).toBe('STRING');
    expect(dxfLayerName('x'.repeat(40)).length).toBe(31);
  });
});
