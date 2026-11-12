// The write root pack (docs/kernel-packs.md, "The root packs", 8): the one write path and the shape of an item.
// While the wave lasts every other module still reaches its code through the shims in src/, so start loads nothing
// at boot that the server did not load before: it answers its parts, each loaded when first asked for. The hook
// points it opens (write.*, src/write-hooks.ts) are still filled at a workspace's open by the loader's slot.

import type { RootContext, RootStarted } from '../../../src/boot.ts';

export function start(_ctx: RootContext): RootStarted {
  return {
    map: () => import('./pelago.ts'),
    apply: () => import('./change-apply.ts'),
    plan: () => import('./change-plan.ts'),
    proposals: () => import('./proposals.ts'),
    undo: () => import('./undo.ts'),
    forget: () => import('./forget.ts'),
  };
}
