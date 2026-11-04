/**
 * OWNER: scene actors & tools agent. The scene modules mounted by the Viewport (scene core), in order.
 * Order matters for pointer routing (first registered handles first) and overlay drawing (later draws on top):
 *   strings  - road ribbons, pins, stop signs, handles, hover → store.hover, screen-space picking (bus)
 *   actors   - trucks / loaders / dozers, playback (sole advancer of timeline.tMin while playing), follow pose, truck card
 *   tools    - select / draw / edit / route / section / measure interactions, hint chip, cursor
 *   cockpit  - POV driver's-seat frame + glass HUD (camera === 'pov')
 */
import type { SceneModule } from './context';
import { stringsModule } from './strings';
import { actorsModule } from './actors';
import { toolsModule } from './tools';
import { cockpitModule } from './cockpit';

export const sceneModules: SceneModule[] = [stringsModule, actorsModule, toolsModule, cockpitModule];
