// The log root pack (docs/kernel-packs.md, "The root packs", 3): the record, its streams and projections, its copies.
// An appended entry is never rewritten (docs/log.md). While the wave lasts every other module still reaches its code
// through the shims in src/, so start loads nothing at boot that the server did not load before: it answers its
// parts, each loaded when first asked for. The projector's pure part (src/project.ts) stays in src/ for now: the page
// is served it from that file (src/ui-files.ts), and a shim there would not run in a browser.

import type { RootContext, RootStarted } from '../../../src/boot.ts';

export function start(_ctx: RootContext): RootStarted {
  return {
    log: () => import('./log.ts'),
    streams: () => import('./streams.ts'),
    replay: () => import('./replay.ts'),
    snapshot: () => import('./snapshot.ts'),
    rebuild: () => import('./rebuild.ts'),
    tail: () => import('./tail.ts'),
    backup: () => import('./backup.ts'),
  };
}
