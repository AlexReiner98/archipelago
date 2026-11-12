// The seal root pack (docs/kernel-packs.md, "The root packs", 2): keys, and what forget destroys of them.
// While the wave lasts every other module still reaches its code through the shims in src/, so start loads nothing
// at boot that the server did not load before: it answers its parts, each loaded when first asked for.

import type { RootContext, RootStarted } from '../../../src/boot.ts';

export function start(_ctx: RootContext): RootStarted {
  return {
    seal: () => import('./seal.ts'),
    opseal: () => import('./opseal.ts'),
    vault: () => import('./vault.ts'),
    secrets: () => import('./secrets.ts'),
    backupSeal: () => import('./backup-seal.ts'),
  };
}
