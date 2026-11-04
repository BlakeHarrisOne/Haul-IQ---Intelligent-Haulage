/**
 * hAIul SIM icon set. One grammar (inherited from Haul Road Lab v6): 20 × 20 grid, 1.7 px stroke, round caps
 * and joins, no fills, currentColor. Icons marked (HRL) are the Haul Road Lab originals, verbatim.
 * Usage: <Icon name="truck" />  (size defaults to 20; colour follows `color`).
 */
import type { CSSProperties, ReactElement } from 'react';

type IconDef = string | ReactElement;

const P: Record<string, IconDef> = {
  // ── Haul Road Lab originals (HRL)
  eye: 'M1.8 10s3.2-5.6 8.2-5.6 8.2 5.6 8.2 5.6-3.2 5.6-8.2 5.6S1.8 10 1.8 10z|C10,10,2.6',
  give: 'M3 4.5h14L10 16.5z',
  angle: 'M3 16.5h14M3 16.5L13.5 4|M8.3 16.5a5.3 5.3 0 0 0-1.6-3.8',
  level: 'M2.5 14.5h15|M4.5 10.5h11|M4.5 8v5M15.5 8v5',
  cab: 'C10,10,7.2|C10,10,1.8|M2.8 10h5.4M11.8 10h5.4M10 11.8v5.4',
  rings: 'C10,10,7.2|C10,10,3.4',
  dig: 'M4 16l7-7|M11 3.5l5.5 5.5-2.6 2.6L8.4 6.1z',
  down: 'M5.5 8l4.5 4.5L14.5 8',
  up: 'M5.5 12l4.5-4.5 4.5 4.5',
  left: 'M12 5.5L7.5 10l4.5 4.5',
  right: 'M8 5.5l4.5 4.5L8 14.5',
  x: 'M5.5 5.5l9 9M14.5 5.5l-9 9',
  tick: 'M4.8 10.4l3.3 3.3 7.1-7.4',
  plus: 'M10 4v12M4 10h12',
  minus: 'M4 10h12',
  undo: 'M6.5 6.5H12a4.5 4.5 0 0 1 0 9H7|M8.8 3.8L6 6.5l2.8 2.8',
  redo: 'M13.5 6.5H8a4.5 4.5 0 0 0 0 9h5|M11.2 3.8L14 6.5l-2.8 2.8',
  reset: 'M4.2 10a5.8 5.8 0 1 0 1.9-4.3|M4 3.2v3.6h3.6',
  info: 'C10,10,7.2|M10 9v5M10 6.2v.1',
  edit: 'M4 16l1-3.6 7.6-7.6 2.6 2.6L7.6 15z',
  road: 'M6.5 17.5L8.6 2.5M13.5 17.5L11.4 2.5M10 5v1.8M10 9.4v1.8M10 13.8v1.8',
  ix: 'M8 2.5v6.3H2.5M12 2.5v6.3h5.5M2.5 12.2H17.5',
  width: 'M2.5 10h15|M5.5 7l-3 3 3 3M14.5 7l3 3-3 3',
  grade: 'M2.5 15.5h15L17.5 6z',
  report: 'R3.5,3,13,14,2|M7 7.5h6M7 10.5h6M7 13.5h3.5',
  gear: 'M8.28 4.36L8.51 2.34A7.80 7.80 0 0 1 11.49 2.34L11.72 4.36A5.90 5.90 0 0 1 14.02 5.69L15.89 4.88A7.80 7.80 0 0 1 17.38 7.46L15.75 8.67A5.90 5.90 0 0 1 15.75 11.33L17.38 12.54A7.80 7.80 0 0 1 15.89 15.12L14.02 14.31A5.90 5.90 0 0 1 11.72 15.64L11.49 17.66A7.80 7.80 0 0 1 8.51 17.66L8.28 15.64A5.90 5.90 0 0 1 5.98 14.31L4.11 15.12A7.80 7.80 0 0 1 2.62 12.54L4.25 11.33A5.90 5.90 0 0 1 4.25 8.67L2.62 7.46A7.80 7.80 0 0 1 4.11 4.88L5.98 5.69A5.90 5.90 0 0 1 8.28 4.36Z|C10,10,2.4',
  camera: 'M3 6.5h3l1.4-2h5.2l1.4 2h3v9H3z|C10,11,2.8',
  pin: 'M10 17.5s5.5-5.2 5.5-9.4a5.5 5.5 0 0 0-11 0c0 4.2 5.5 9.4 5.5 9.4z|C10,8,2',
  spin: 'M10 2.8a7.2 7.2 0 0 1 7.2 7.2',

  // ── equipment
  truck: 'M2.5 6.2h9.2l-1.1 6.3H3.6z|M11.4 8.6h2.9l2.6 2.6v2.3h-5.2|C5.6,14.8,1.9|C14,14.8,1.9|M7.5 14.8h4.6',
  excavator: 'R2.5,14,9.5,3,1.5|M3.6 14v-3.4h5.2V14|M8.8 11.2l3.6-6.6 3.8 3.6|M16.2 8.2l1.3 3.6h-3.3z',
  loader: 'M2.6 8.6h3.2l.9 4.4H3.4z|M6.4 10.6l3-1.2|M9.4 13.2V6.6h3.4l.8 3.4h3.8v3.2|C8,15,1.9|C14.6,15,1.9',
  dozer: 'R4.2,12.4,12,4.1,2|M7 12.4V8h4.6l1.6 4.4|M2.5 9v7.4|M2.5 12.6h1.7',
  grader: 'M2.5 12.5h15|M12 12.5V7h3.4l1.1 2.6v2.9|C4.4,15,1.6|C12.6,15,1.6|C16,15,1.6|M6.2 15.6l3.4-3.1',
  watercart: 'M2.5 7.5h9v5h-9z|M11.5 9h3l2.5 2.5v1H11.5|C5,14.7,1.7|C14,14.7,1.7|M5 4.2c0 .9-.7 1.3-.7 2|M8 3.6c0 .9-.7 1.3-.7 2',
  lv: 'M2.5 12.5v-2l2-3.5h7l3 3.5h3v2|C6,13.8,1.7|C14,13.8,1.7|M4.5 10h11',
  crew: 'C7.5,7,2.6|M2.5 16.5c0-2.8 2.2-4.6 5-4.6s5 1.8 5 4.6|M12.8 4.6a2.4 2.4 0 1 1 0 4.8|M14.2 11.8c1.9.5 3.3 2 3.3 4.7',
  person: 'C10,6.5,3|M4 17c0-3.3 2.7-5.5 6-5.5s6 2.2 6 5.5',
  coal: 'M3.5 12.5l3-6 5-1.5 5 4.5-1.5 5-6 1.5z|M6.5 6.5l3 4 6.5-1.5|M9.5 10.5l-.5 5',

  // ── geometry / tools
  select: 'M5.2 3l10 6.6-4.4 1.2 2.6 4.8-2 1.1-2.6-4.8L5.2 15.1z',
  string: 'M3.4 15.2l4.3-6 4.3 3.4 4.6-7.6|C3.4,15.2,1.5|C7.7,9.2,1.5|C12,12.6,1.5|C16.6,5,1.5',
  route: 'M4.5 15.5c0-4.6 3-4.6 5.5-6.2s5.5-1.8 5.5-5|C4.5,15.5,1.8|C15.5,4.3,1.8',
  section: 'M2.5 16.5h15|M2.5 12.5c2.4 0 3-4.4 5.6-4.4s3 3.2 5 3.2 2.4-2.2 4.4-2.2|M10 2.5v2.5M10 6.6v1',
  measure: 'M3.4 13.6l10.2-10.2 3 3L6.4 16.6z|M6.6 10.4l1.6 1.6M9.2 7.8l1.6 1.6M11.8 5.2l1.6 1.6',
  solid: 'M10 2.8l6.5 3.6v7.2L10 17.2l-6.5-3.6V6.4z|M3.5 6.4L10 10l6.5-3.6|M10 10v7.2',
  surface: 'M2 15.6h16|M3.2 15.6l4.6-7.2 3.1 4 2.6-3.2 3.7 6.4',
  target: 'C10,10,6.4|C10,10,2.2|M10 1.8v2.4M10 15.8v2.4M1.8 10h2.4M15.8 10h2.4',
  stop: 'M7 2.8h6l4.2 4.2v6L13 17.2H7L2.8 13V7z|M6.8 10h6.4',
  speed: 'M3.2 14.5a6.8 6.8 0 1 1 13.6 0|M10 14.5l3.6-4.6|M3.2 14.5h1.6M15.2 14.5h1.6',
  dump: 'M4.5 17V3.5|M4.5 4h9.5l-2.2 3.2 2.2 3.2H4.5',
  fit: 'M3 7V3h4M13 3h4v4M17 13v4h-4M7 17H3v-4',
  plan: 'R3,3,14,14,2|M3 10h14M10 3v14',
  orbit: 'M10 2.8v14.4|M2.8 10c0-2 3.2-3.6 7.2-3.6s7.2 1.6 7.2 3.6-3.2 3.6-7.2 3.6|M8.4 11.9l1.6 1.7-1.6 1.7',
  pov: 'M2.5 12.5c1.6-4 4.4-6 7.5-6s5.9 2 7.5 6|M6.5 12.5a3.5 3.5 0 0 1 7 0|M2.5 15.5h15',
  chase: 'R2.5,6,10.5,8,1.6|M13 9l4.5-2.4v6.8L13 11',
  layers: 'M10 3l7.5 3.8L10 10.6 2.5 6.8z|M2.5 10.2L10 14l7.5-3.8|M2.5 13.6l7.5 3.8 7.5-3.8',
  cross: 'M10 2.5v15M2.5 10h15',
  vertex: 'R6.5,6.5,7,7,1.5|M2.5 10h4M13.5 10h4',
  insert: 'M2.8 13.5l4.7-6 9.7-2.5|C7.5,7.5,1.4|M14.5 11.5v6M11.5 14.5h6',
  scissors: 'C5.5,6,2.2|C5.5,14,2.2|M7.5 7.2L17 14M7.5 12.8L17 6',
  reverse: 'M4 7h11l-3-3|M16 13H5l3 3',
  snap: 'M4.5 4.5v6a5.5 5.5 0 0 0 11 0v-6|M4.5 7.5h3M12.5 7.5h3',
  lock: 'R4.5,9,11,8,2|M7 9V6.5a3 3 0 0 1 6 0V9',
  unlock: 'R4.5,9,11,8,2|M7 9V6.5a3 3 0 0 1 5.8-1',
  link: 'M8.5 11.5a3.2 3.2 0 0 0 4.6 0l2.5-2.5a3.2 3.2 0 0 0-4.6-4.6l-.8.8|M11.5 8.5a3.2 3.2 0 0 0-4.6 0L4.4 11a3.2 3.2 0 0 0 4.6 4.6l.8-.8',

  // ── time / simulation
  play: 'M6.5 4.4v11.2l9-5.6z',
  pause: 'M7 4.5v11M13 4.5v11',
  skipBack: 'M5 4.5v11|M15.2 4.5v11L7.6 10z',
  skipFwd: 'M15 4.5v11|M4.8 4.5v11l7.6-5.5z',
  clock: 'C10,10,7.2|M10 6v4l2.8 1.8',
  crib: 'M4 7h9v4.8a4.2 4.2 0 0 1-4.2 4.2h-.6A4.2 4.2 0 0 1 4 11.8z|M13 8.5h1.4a2 2 0 0 1 0 4H13|M7 2.8v2M10 2.8v2',
  fuel: 'M4.5 17V4.5a1 1 0 0 1 1-1h5a1 1 0 0 1 1 1V17|M3.5 17h9|M11.5 8h2l2 2v4.6a1.2 1.2 0 0 0 2.4 0V7.6L16 5.6|M6.5 6.5h3',
  swap: 'M4 7h11l-3-3|M16 13H5l3 3',
  blast: 'M10 2.5l1.4 4.3 4.3-1.9-1.9 4.3 4.3 1.4-4.3 1.4 1.9 4.3-4.3-1.9L10 17.5l-1.4-4.6-4.3 1.9 1.9-4.3L2.5 9.1l4.3-1.4-1.9-4.3 4.3 1.9z',
  calendar: 'R3,4,14,13,2|M3 8h14|M7 2.5v3M13 2.5v3',
  flagStart: 'M5 17.5V3|M5 3.5h8.5l-1.6 3 1.6 3H5|M3 17.5h4',
  hardhat: 'M3 14.5h14|M4.5 14.5v-2a5.5 5.5 0 0 1 11 0v2|M8.5 7.4V5.5h3v1.9',

  // ── analysis / app
  chart: 'M3 16.5h14|M5.6 13.5v-4|M9 13.5V5.5|M12.4 13.5v-6|M15.8 13.5v-2.6',
  curve: 'M3 3v14h14|M5.2 5.6c3 0 4 5.2 7 6.6s4 .9 4.6.9',
  compare: 'R3,4.5,5.6,11,1.4|R11.4,8,5.6,7.5,1.4',
  priority: 'M4 5.5h7M4 10h5M4 14.5h3|M14.5 4v12|M12 13.5l2.5 2.5 2.5-2.5',
  assumptions: 'R4.5,4,11,13.5,2|M7.5 2.8h5v2.4h-5z|M7.5 9h5M7.5 12h5M7.5 15h2.6',
  formula: 'M12.5 3.5c-2.5-.3-3 1-3.3 3L8 14c-.3 2-1 3-3.2 2.6|M5.5 8h7|M11.5 11.5l4.5 4.5M16 11.5l-4.5 4.5',
  table: 'R3,3.5,14,13,2|M3 8h14M3 12.3h14M8 8v8.5',
  folder: 'M2.5 5.5h5l1.6 2h8.4v8.6h-15z',
  save: 'M4 3.5h9.4L16 6.1v10.4H4z|M7 3.5v3.8h5.6V3.5|M7 16.5v-5h6v5',
  upload: 'M10 13V3.6|M6 7.5l4-3.9 4 3.9|M3.5 13v3.5h13V13',
  download: 'M10 3.5V13|M6 9.1L10 13l4-3.9|M3.5 13v3.5h13V13',
  file: 'M5 2.8h6.5L15.5 7v10.2H5z|M11.5 2.8V7h4',
  sun: 'C10,10,3.2|M10 2v1.8M10 16.2V18M2 10h1.8M16.2 10H18M4.3 4.3l1.3 1.3M14.4 14.4l1.3 1.3M4.3 15.7l1.3-1.3M14.4 5.6l1.3-1.3',
  moon: 'M15.8 12.6A6.6 6.6 0 0 1 7.4 4.2a6.6 6.6 0 1 0 8.4 8.4z',
  sparkle: 'M9.5 2.5l1.7 4.6 4.6 1.7-4.6 1.7-1.7 4.6-1.7-4.6L3.2 8.8l4.6-1.7z|M15.4 12.8l.8 2 2 .8-2 .8-.8 2-.8-2-2-.8 2-.8z',
  search: 'C8.8,8.8,5.6|M13 13l4.2 4.2',
  sliders: 'M3.5 6h8M15 6h1.5M3.5 14h1.5M8.5 14h8|M13 4v4M6.5 12v4',
  warning: 'M10 3l7.6 13.2H2.4z|M10 8.2v3.6M10 14.2v.1',
  trash: 'M4 5.5h12|M8 5.5V3.5h4v2|M5.5 5.5l.8 11h7.4l.8-11',
  copy: 'R6.5,6.5,10,10,2|M13.5 6.5V4.6a1 1 0 0 0-1-1H4.6a1 1 0 0 0-1 1v7.9a1 1 0 0 0 1 1h1.9',
  more: 'M5 10h.01M10 10h.01M15 10h.01',
  drag: 'M7 5.5h.01M13 5.5h.01M7 10h.01M13 10h.01M7 14.5h.01M13 14.5h.01',
  panel: 'R3,4,14,12,2|M12.5 4v12',
  panelBottom: 'R3,4,14,12,2|M3 11.5h14',
  expand: 'M11.5 3.5h5v5|M16.5 3.5l-5.5 5.5|M8.5 16.5h-5v-5|M3.5 16.5L9 11',
  collapse: 'M16.5 3.5L11 9|M11 4.5V9h4.5|M3.5 16.5L9 11|M4.5 11H9v4.5',
  keyboard: 'R2.5,5,15,10,2|M5.5 8h.01M8.5 8h.01M11.5 8h.01M14.5 8h.01M6.5 12h7',
  help: 'C10,10,7.2|M7.8 7.8a2.3 2.3 0 0 1 4.4 1c0 1.6-2.2 1.9-2.2 3.3|M10 14.4v.1',
  bolt: 'M11 2.5L4.5 11h5L9 17.5 15.5 9h-5z',
  scale: 'M3 13.5v3h14v-3|M10 16.5v-3',
  external: 'M11.5 3.5h5v5|M16.5 3.5L9 11|M14.5 11.5v5h-11v-11h5',
};

/** Draw-op mini language: "M…" path, "C,cx,cy,r" circle, "R,x,y,w,h,rx" rect; ops separated by "|". */
function render(def: string) {
  return def.split('|').map((op, i) => {
    if (op.startsWith('C')) {
      const [cx, cy, r] = op.slice(1).split(',').map(Number);
      return <circle key={i} cx={cx} cy={cy} r={r} />;
    }
    if (op.startsWith('R')) {
      const [x, y, w, h, rx] = op.slice(1).split(',').map(Number);
      return <rect key={i} x={x} y={y} width={w} height={h} rx={rx} />;
    }
    // dot rows ("M7 5.5h.01 …", the HRL drag/more glyphs) are drawn with a heavier stroke so they read as dots
    return <path key={i} d={op} strokeWidth={op.includes('h.01') ? 2.6 : undefined} />;
  });
}

export type IconName = keyof typeof P;
export const iconNames = Object.keys(P) as IconName[];

export interface IconProps {
  name: IconName | (string & {});
  size?: number;
  strokeWidth?: number;
  className?: string;
  style?: CSSProperties;
  title?: string;
}

export function Icon({ name, size = 20, strokeWidth = 1.7, className, style, title }: IconProps) {
  const def = P[name as IconName];
  if (def == null) return null;
  return (
    <svg
      className={className}
      style={{ flex: 'none', display: 'block', ...style }}
      width={size}
      height={size}
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden={title ? undefined : true}
      role={title ? 'img' : undefined}
    >
      {title && <title>{title}</title>}
      {typeof def === 'string' ? render(def) : def}
    </svg>
  );
}

/** Filled status glyphs (HRL st-ok / st-fail / st-na). */
export function StatusGlyph({ kind, size = 18 }: { kind: 'ok' | 'fail' | 'na' | 'warn'; size?: number }) {
  const c = kind === 'ok' ? 'var(--ok)' : kind === 'fail' ? 'var(--bad)' : kind === 'warn' ? 'var(--warn)' : 'var(--na)';
  return (
    <svg width={size} height={size} viewBox="0 0 18 18" style={{ flex: 'none', display: 'block' }} aria-hidden>
      {kind === 'na' ? (
        <>
          <circle cx="9" cy="9" r="7.2" fill="none" stroke={c} strokeWidth="1.6" />
          <path d="M6 9h6" stroke={c} strokeWidth="1.8" strokeLinecap="round" />
        </>
      ) : (
        <>
          <circle cx="9" cy="9" r="8" fill={c} />
          {kind === 'ok' && <path d="M5.4 9.3l2.4 2.4 4.8-5" fill="none" stroke="#fff" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />}
          {kind === 'fail' && <path d="M6.2 6.2l5.6 5.6M11.8 6.2l-5.6 5.6" stroke="#fff" strokeWidth="1.8" strokeLinecap="round" />}
          {kind === 'warn' && <path d="M9 4.8v5M9 12.8v.1" stroke="#fff" strokeWidth="2" strokeLinecap="round" />}
        </>
      )}
    </svg>
  );
}
