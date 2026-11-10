// The hooks of a surface an agent works in (task e_chb65gx7, decision e_6t8f46u6): POST /hooks/<surface>/<event>,
// and /hooks/<event> for hooks installed before there were surfaces. A server pack that translates a surface declares
// two functions of its handler (reach.server.adapter): in, from the surface's body to the kernel's, and out, from the
// kernel's answer to the surface's shape. What a session is told stays the kernel's (src/hook-answers.ts); the pack
// reads no map.
//
// A seam for now: /hooks/<event> is answered by the kernel as before, and a named surface is not answered.

import { answerHook, type HookCall } from './hook-answers.ts';
import type { ServerPacks } from './server-host.ts';

/** The surface and the event an address under /hooks/ names: <event>, or <surface>/<event>. */
export function hookAt(rest: string): { surface?: string; event: string } {
  const [a = '', b] = rest.split('/');
  return b === undefined ? { event: a } : { surface: a, event: b };
}

/** The answer to one hook of a surface, or undefined for one there is none for. */
export async function answerAt(_packs: ServerPacks, surface: string | undefined, event: string, call: HookCall): Promise<object | undefined> {
  if (surface !== undefined) return undefined;
  return answerHook(event, call);
}
