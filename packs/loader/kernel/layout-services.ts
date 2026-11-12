// The loader root's services for the publish pack (docs/kernel-packs.md, "Root services"), called only by the packs
// packs/roots.json names: what a pack's drawing is as this server ships it (root.layout), and its first frame on what
// a page would give it (root.scene), run in a sandboxed process of its own (../../walls/kernel/drawing-box.ts). Only a
// drawing whose code is a pack's own is ever run here, found by its id among what the packs ship: a version changed on
// the map is code anyone who may change the map wrote, and runs only in a reader's sandbox. Values in, values out.

import type { RootCall } from './root-calls.ts';
import { startedFrom } from '../../database/kernel/config.ts';
import { cssProblem } from '../../walls/kernel/css-check.ts';
import { drawOnce } from '../../walls/kernel/drawing-box.ts';
import { packLayout } from './layouts.ts';

const registryOf = (call: RootCall) => {
  if (!call.map) throw new Error('A drawing is read of a map: a server duty has none');
  return call.map.registry;
};

/** root.layout: a pack's drawing as this server ships it, its hash and whether it has code to run, and the commit the server runs; null when no pack ships one by that id. */
export async function layout(call: RootCall, input: { id: string }): Promise<{ hash: string; entry: boolean; commit: string | null } | null> {
  const own = packLayout(registryOf(call), String(input?.id));
  return own ? { hash: own.hash, entry: Boolean(own.entry), commit: startedFrom() ?? null } : null;
}

/**
 * root.scene: the scene a pack's drawing opens on, given what the page would give it, and whether the stylesheet it
 * sent is one a drawing's may be (css_ok); null when no pack ships that drawing with code, or its hash is not `hash`.
 * Throws what the drawing threw.
 */
export async function scene(call: RootCall, input: { id: string; hash?: string; input: unknown }): Promise<{ scene: Record<string, unknown> | null; css_ok: boolean } | null> {
  const own = packLayout(registryOf(call), String(input?.id));
  if (!own?.entry || (input.hash !== undefined && own.hash !== input.hash)) return null;
  // The drawing's code runs only in its own process, with no network, no files but its own and no process to start.
  const drawn = await drawOnce(own.entry, input.input);
  return { scene: drawn, css_ok: typeof drawn?.css === 'string' && !cssProblem(drawn.css) };
}
