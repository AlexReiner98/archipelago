// The tool surface root pack (docs/kernel-packs.md, "The root packs", 9): the ten verbs, who may call them, the HTTP
// host, MCP, the CLI and the hook host, the reads API (packreads), and the slots surface.act, surface.read and surface.route. While the wave lasts
// every other module still reaches its code through the shims in src/, so start loads nothing at boot that the server
// did not load before: it answers its parts, each loaded when first asked for.

import type { RootContext, RootStarted } from '../../../src/boot.ts';

export function start(_ctx: RootContext): RootStarted {
  return {
    tools: () => import('./tools.ts'),
    surface: () => import('./surface.ts'),
    slots: () => import('./surface-slots.ts'),
    mcp: () => import('./mcp.ts'),
    server: () => import('./server.ts'),
    packreads: () => import('./packreads.ts'),
  };
}
