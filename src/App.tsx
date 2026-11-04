import { Shell } from '@/features/workspace';
import { Gallery } from '@/ui/Gallery';

/** Root component. Layout and chrome live in features/workspace (Shell). `?gallery` shows the UI kit. */
export function App() {
  if (typeof location !== 'undefined' && /[?&]gallery\b/.test(location.search)) return <Gallery />;
  return <Shell />;
}
