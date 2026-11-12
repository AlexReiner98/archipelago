// The walls root pack (docs/kernel-packs.md, "The root packs", 5): what may leave the server and what a page may run.
// While the wave lasts every other module still reaches its code through the shims in src/, so start loads nothing
// at boot that the server did not load before: it answers its parts, each loaded when first asked for.
// css-check stays in src/ for now: the page is served that file from there (FROM_SOURCE in src/ui-files.ts).

import type { RootContext, RootStarted } from '../../../src/boot.ts';

export function start(_ctx: RootContext): RootStarted {
  return {
    fetch: () => import('./outbound.ts'),
    pagePolicy: () => import('./page-policies.ts'),
    drawHost: () => import('./draw-host.ts'),
    cssCheck: () => import('../../../src/css-check.ts'),
    svgFigure: () => import('./svg-figure.ts'),
    publicDocument: () => import('./public-document.ts'),
    unscopedRead: () => import('./outbox.ts'),
    outside: () => import('./outside.ts'),
    mailGate: () => import('./notify-mail.ts'),
  };
}
