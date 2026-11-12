// The loader root pack (docs/kernel-packs.md, "The root packs", 6): packs, versions, islands, the sandbox and the
// in-process tier. While the wave lasts every other module still reaches its code through the shims in src/, so start
// loads nothing at boot that the server did not load before: it answers its parts, each loaded when first asked for.

import type { RootContext, RootStarted } from '../../../src/boot.ts';

export function start(_ctx: RootContext): RootStarted {
  return {
    registry: () => import('./packs.ts'),
    manifest: () => import('./manifest.ts'),
    order: () => import('./packorder.ts'),
    states: () => import('./packstate.ts'),
    pins: () => import('./island-pin.ts'),
    islands: () => import('./islands.ts'),
    reach: () => import('./reach.ts'),
    host: () => import('./packhost.ts'),
    outside: () => import('./outside.ts'),
  };
}
