// What the surface's server tells this pack for the whole process (surface.looks, packs/surface/kernel/above.ts): the
// address its Chrome reaches the server at.

import type { KernelContext } from '#pelago/kernel';
import { setLookOrigin } from './looks.ts';

export const served = (_ctx: KernelContext) => ({ setOrigin: setLookOrigin });
