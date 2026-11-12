// The database root pack (docs/kernel-packs.md, "The root packs", 1): storage, row-level security, the shared lock.
// While the wave lasts every other module still reaches its code through the shims in src/, so start loads nothing
// at boot that the server did not load before: it answers its parts, each loaded when first asked for.

import type { RootContext, RootStarted } from '../../../src/boot.ts';

export function start(_ctx: RootContext): RootStarted {
  return {
    db: () => import('./db.ts'),
    migrate: () => import('./migrate.ts'),
    leader: () => import('./leader.ts'),
  };
}
