// The hooks of a surface an agent works in (task e_chb65gx7, decision e_6t8f46u6): POST /hooks/<surface>/<event>,
// and /hooks/<event> for hooks installed before there were surfaces, the surface whose adapter says so (before). A server
// pack that translates a surface declares two functions of its handler (reach.server.adapter): in, from the surface's
// body to the kernel's, and out, from the kernel's neutral answer to the surface's shape. What a session is told stays
// the sessions pack's (sessionAnswer, its filling of loader.calls, ./own-calls.ts, on its own context of the map, whether
// or not the map has it on); the adapter reads no map, and is asked as a gate is: by the kernel, asking for nothing.

import type { HookAsk, HookBody, Neutral } from '../../sessions/kernel/hook-answers.ts';
import { ownCall } from './own-calls.ts';
import type { Archipelago } from '../../../src/pelago.ts';
import type { ServerPacks } from '../../../src/server-host.ts';

/** A hook as the server hands it: the map as the token's person sees it, and what the session is answered from. */
export interface HookCall extends HookAsk {
  /** The whole workspace's database, as callers hand it still: no longer read. */
  whole?: unknown;
  /** The map as the token's person sees it. */
  pelago: Archipelago;
}

/**
 * The adapter of the surface that was before there were surfaces (reach.server.adapter.before), if a pack declares one:
 * /hooks/<event> is its hooks, and what it says of the names then used is read from it (actor, agent).
 */
export function adapterBefore(packs: Pick<ServerPacks, 'packs'>) {
  const pack = packs.packs.find((p) => p.file.reach.server.adapter?.before);
  return pack && { id: pack.file.id, ...pack.file.reach.server.adapter!, before: pack.file.reach.server.adapter!.before! };
}

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
  const adapter = surface === undefined ? adapterBefore(packs) : adapterOf(packs, surface);
  if (!adapter) return undefined;
  const inward = await packs.call(adapter.id, 'entry', adapter.in, { event, body: call.body }, undefined, true);
  const kernel = isObject(inward) && typeof inward.event === 'string' ? inward.event : undefined;
  const body = (isObject(inward) && isObject(inward.body) ? inward.body : {}) as HookBody;
  const { pelago, whole: _whole, ...ask } = call;
  const neutral = kernel === undefined ? {} : await ownCall<Neutral | undefined>(pelago, 'sessionAnswer', kernel, { ...ask, body });
  if (!neutral) return undefined;
  const out = await packs.call(adapter.id, 'entry', adapter.out, { event, kernel, answer: neutral }, undefined, true);
  return isObject(out) ? out : {};
}
