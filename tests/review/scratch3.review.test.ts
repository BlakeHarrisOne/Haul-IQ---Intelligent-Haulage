import { it } from 'vitest';
import { TRUCK_MODELS } from '@/data';
it('t', () => { for (const t of TRUCK_MODELS as any[]) console.log(t.id, t.make, t.drive, t.rimpull?.length, t.retarder?.length, t.rimpullGears?.length, t.retarderGears?.length, t.descentRule, t.topSpeedKmh, JSON.stringify(t.spreadsheetSpeeds?.loaded?.length)); });
