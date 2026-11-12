// The identity root pack (docs/kernel-packs.md, "The root packs", 4): who is asking. People, members, tokens and
// sign-ins, the workspaces a server holds and its control database, who is asking and a workspace's standing, and
// the server's policy on agents' changes. While the wave lasts every other module still reaches its code through the shims in src/, so start
// loads nothing at boot that the server did not load before: it answers its parts, each loaded when first asked for.

import type { RootContext, RootStarted } from '../../../src/boot.ts';

export function start(_ctx: RootContext): RootStarted {
  return {
    auth: () => import('./auth.ts'),
    members: () => import('./members.ts'),
    workspaces: () => import('./workspaces.ts'),
    standing: () => import('./standing.ts'),
    unscopedRead: () => import('./outbox.ts'),
    actors: () => import('./actor-checks.ts'),
    policy: () => import('./policy.ts'),
  };
}
