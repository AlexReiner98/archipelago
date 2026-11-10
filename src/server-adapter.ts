// The hooks of a surface an agent works in (task e_chb65gx7, decision e_6t8f46u6): POST /hooks/<surface>/<event>,
// and /hooks/<event> for hooks installed before there were surfaces. A server pack that translates a surface declares
// two functions of its handler (reach.server.adapter): in, from the surface's body to the kernel's, and out, from the
// kernel's neutral answer to the surface's shape. What a session is told stays the kernel's (src/hook-answers.ts); the
// pack reads no map, and is asked as a gate is: by the kernel, asking for nothing.
//
// /hooks/<event> is Claude Code's, put in its shape by answerHook (src/claude-code.ts) until the claude_code pack takes it.

import { answerHook, sessionAnswer, type HookBody, type HookCall, type Neutral } from './hook-answers.ts';
import type { ServerPacks } from './server-host.ts';

/** The surface and the event an address under /hooks/ names: <event>, or <surface>/<event>. */
export function hookAt(rest: string): { surface?: string; event: string } {
  const [a = '', b] = rest.split('/');
  return b === undefined ? { event: a } : { surface: a, event: b };
}

/** The server pack that translates a surface's hooks, if one does. */
export function adapterOf(packs: ServerPacks, surface: string) {
  const pack = packs.packs.find((p) => p.file.reach.server.adapter?.surface === surface);
  return pack && { id: pack.file.id, ...pack.file.reach.server.adapter! };
}

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/**
 * The answer to one hook of a surface, or undefined for one there is none for (no pack translates the surface, or the
 * kernel answers no such event). in is given { event, body } and answers { event, body }: the kernel's event and
 * HookBody, or no event for a hook the kernel is not asked. out is given { event, kernel, answer }: the surface's
 * event, the kernel's, and the neutral answer; what it answers is sent as it is, an object.
 */
export async function answerAt(packs: ServerPacks, surface: string | undefined, event: string, call: HookCall): Promise<object | undefined> {
  if (surface === undefined) return answerHook(event, call);
  const adapter = adapterOf(packs, surface);
  if (!adapter) return undefined;
  const inward = await packs.call(adapter.id, 'entry', adapter.in, { event, body: call.body }, undefined, true);
  const kernel = isObject(inward) && typeof inward.event === 'string' ? inward.event : undefined;
  const body = (isObject(inward) && isObject(inward.body) ? inward.body : {}) as HookBody;
  const neutral: Neutral | undefined = kernel === undefined ? {} : await sessionAnswer(kernel, { ...call, body });
  if (!neutral) return undefined;
  const out = await packs.call(adapter.id, 'entry', adapter.out, { event, kernel, answer: neutral }, undefined, true);
  return isObject(out) ? out : {};
}
