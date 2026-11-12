// What the surface's server holds of this pack for the whole process (surface.connect, packs/surface/kernel/above.ts):
// the install pages it hands out. A system's request for its token and its poll are answered on the map they are for
// (surface.token_asked, surface.token_polled: ./connect.ts).

import type { KernelContext } from '#pelago/kernel';
import { installed } from './connect.ts';

export const served = (_ctx: KernelContext) => ({ installed });
