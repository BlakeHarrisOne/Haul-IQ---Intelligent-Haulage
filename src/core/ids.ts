let counter = 0;
/** Short, sortable, collision-resistant ids (no crypto dependency, works in workers and Node). */
export function uid(prefix = 'id'): string {
  counter = (counter + 1) % 1679616;
  const t = Date.now().toString(36);
  const c = counter.toString(36).padStart(4, '0');
  const r = Math.floor(Math.random() * 1679616).toString(36).padStart(4, '0');
  return `${prefix}_${t}${c}${r}`;
}

export const nowIso = () => new Date().toISOString();
