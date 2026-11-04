/** Number formatting used everywhere in the UI (en-AU, fixed-width figures in CSS). */
const nf = new Map<string, Intl.NumberFormat>();
function fmt(min: number, max: number) {
  const k = `${min}:${max}`;
  let f = nf.get(k);
  if (!f) { f = new Intl.NumberFormat('en-AU', { minimumFractionDigits: min, maximumFractionDigits: max }); nf.set(k, f); }
  return f;
}
export const num = (v: number | null | undefined, dp = 0) =>
  v == null || !Number.isFinite(v) ? '–' : fmt(dp, dp).format(v);
export const pct = (fraction: number | null | undefined, dp = 1) =>
  fraction == null || !Number.isFinite(fraction) ? '–' : `${fmt(dp, dp).format(fraction * 100)}%`;
export const signed = (v: number, dp = 1) => (v > 0 ? '+' : v < 0 ? '−' : '') + num(Math.abs(v), dp);
export const secs = (s: number) => {
  if (!Number.isFinite(s)) return '–';
  const m = Math.floor(s / 60), r = Math.round(s - m * 60);
  return m > 0 ? `${m}:${String(r).padStart(2, '0')}` : `${r}s`;
};
export const hrs = (h: number, dp = 1) => `${num(h, dp)} h`;
export const clock = (startHour: number, tMin: number) => {
  const total = Math.round(startHour * 60 + tMin) % 1440;
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
};
export const grade = (g: number, dp = 1) => `${g >= 0 ? '+' : '−'}${num(Math.abs(g * 100), dp)}%`;
