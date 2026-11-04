/** UI kit gallery (open the app with ?gallery). Used for visual QA of icons and primitives in both themes. */
import { useState } from 'react';
import { Badge, Button, Card, CardBody, CardHead, Chrome, ChromeLabel, ChromeSep, Ctl, Kpi, Row, Section, Segmented, Swatch } from './primitives';
import { Check, Field, NumberField, Range, Select, Toggle } from './fields';
import { Icon, iconNames, StatusGlyph } from './icons';
import { Brand } from './Brand';
import { AxisX, GridY, Legend, linePath, linear, CAT } from './chart';

export function Gallery() {
  const [theme, setTheme] = useState<'light' | 'dark'>('light');
  const [seg, setSeg] = useState('a');
  const [n, setN] = useState(0.85);
  const [t, setT] = useState(true);
  const [r, setR] = useState(40);
  document.documentElement.dataset.theme = theme;
  const x = linear([0, 60], [60, 520]), y = linear([0, 1200], [220, 20]);
  const curve: [number, number][] = Array.from({ length: 61 }, (_, i) => [i, Math.min(1100, 9000 / Math.max(i, 7.5))]);
  return (
    <div style={{ height: '100%', overflow: 'auto', padding: 24, display: 'grid', gap: 20, background: 'var(--bg-app)' }}>
      <Chrome style={{ width: 'fit-content' }}>
        <span style={{ padding: '0 10px' }}><Brand /></span>
        <ChromeSep />
        <Ctl icon="select" on tip="Select" shortcut="V" />
        <Ctl icon="string" tip="Draw haul string" shortcut="D" />
        <Ctl icon="route" tip="Auto-route" shortcut="R" />
        <Ctl icon="section" tip="Section" shortcut="X" />
        <ChromeSep />
        <Ctl icon="layers">Layers</Ctl>
        <Ctl icon="report" accent>Report</Ctl>
        <ChromeSep />
        <ChromeLabel>Theme</ChromeLabel>
        <Ctl icon={theme === 'light' ? 'moon' : 'sun'} onClick={() => setTheme(theme === 'light' ? 'dark' : 'light')} tip="Toggle theme" />
      </Chrome>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, 92px)', gap: 8 }}>
        {iconNames.map(nm => (
          <div key={nm} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6, padding: '12px 4px', background: 'var(--surface)', borderRadius: 10, border: '1px solid var(--hair)', color: 'var(--ink)' }}>
            <Icon name={nm} size={24} />
            <span style={{ fontSize: 11, color: 'var(--ink-3)' }}>{nm}</span>
          </div>
        ))}
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '400px 1fr', gap: 20, alignItems: 'start' }}>
        <Card>
          <CardHead title="EX09 → S51 West" sub="OB · CAT 789D" icon="excavator" actions={<Badge tone="ok" icon="tick">Balanced</Badge>} />
          <CardBody>
            <Section title="Cycle">
              <Row icon="truck" label="Travel loaded" value="2:52" unit="min" />
              <Row icon="truck" label="Travel empty" value="2:44" unit="min" />
              <Row icon="clock" label="Cycle time" value="11.9" unit="min" on />
              <Row icon="warning" label="Lost PT" hint="per shift" value="1.4" unit="h" tone="bad" />
              <Row icon="tick" label="Trucks needed" value="3.44" tone="ok" trailing={<Icon name="right" size={16} />} onClick={() => {}} />
            </Section>
            <Section title="Assumptions">
              <div style={{ padding: '6px 16px', display: 'grid', gap: 10 }}>
                <Field label="Haul efficiency factor"><NumberField value={n} onChange={setN} step={0.01} changed /></Field>
                <Field label="Truck model"><Select value="789d" onChange={() => {}} options={[{ value: '789d', label: 'CAT 789D' }, { value: '1500', label: 'KOM HD1500-7' }]} /></Field>
                <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}><Toggle on={t} onChange={setT} label="Rimpull model" /><Check on={t} onChange={setT} /></div>
                <Range value={r} min={0} max={100} onChange={setR} />
                <Segmented value={seg} onChange={setSeg} options={[{ value: 'a', label: 'Spreadsheet' }, { value: 'b', label: 'Rimpull' }, { value: 'c', label: 'Both' }]} />
              </div>
            </Section>
          </CardBody>
        </Card>
        <div style={{ display: 'grid', gap: 20 }}>
          <Card><CardBody pad>
            <div style={{ display: 'flex', gap: 32 }}>
              <Kpi label="Trucks needed" value="3.44" size="lg" delta="+0.4 vs plan" deltaTone="warn" />
              <Kpi label="PT / day" value="20.0" unit="h" />
              <Kpi label="Production" value="36,000" unit="bcm/d" delta="On target" deltaTone="ok" />
              <Kpi label="Lost PT" value="1.4" unit="h/shift" delta="Under-trucked" deltaTone="bad" icon="warning" />
            </div>
            <div style={{ display: 'flex', gap: 8, marginTop: 16, flexWrap: 'wrap', alignItems: 'center' }}>
              <Button variant="primary" icon="plus">New circuit</Button><Button icon="upload">Import .00t</Button><Button variant="ghost">Cancel</Button><Button variant="danger" icon="trash">Delete</Button>
              <Badge tone="ok">ok</Badge><Badge tone="bad">fail</Badge><Badge tone="warn">over</Badge><Badge tone="info">info</Badge><Badge tone="na">n/a</Badge>
              <StatusGlyph kind="ok" /><StatusGlyph kind="fail" /><StatusGlyph kind="warn" /><StatusGlyph kind="na" />
              {CAT.map(c => <Swatch key={c} color={c} />)}
            </div>
          </CardBody></Card>
          <Card><CardHead title="Rimpull – CAT 789D" icon="curve" /><CardBody pad>
            <svg width="560" height="260">
              <GridY y={y} x0={60} x1={520} label="kN" />
              <AxisX x={x} y0={220} label="km/h" />
              <path d={linePath(curve, x, y)} fill="none" stroke="var(--c1)" strokeWidth={2.2} />
            </svg>
            <Legend items={[{ label: 'Rimpull', color: 'var(--c1)' }, { label: 'Resistance 12%', color: 'var(--c6)', dash: true }]} />
          </CardBody></Card>
        </div>
      </div>
    </div>
  );
}
