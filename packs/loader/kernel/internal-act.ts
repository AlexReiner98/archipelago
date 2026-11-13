// An internal pack's action (a root or service pack's, docs/kernel-packs.md): its code runs in the server's process,
// never in the sandbox, as the service it provides by the action's verb and name, `act.<verb>.<name>`
// (packs/loader/kernel/declared.ts, checkDeclared). What it answers is applied as a sandboxed handler's is
// (packs/loader/kernel/packhost.ts, act): its ops one change set naming the action, its pack and the part that sent it,
// as the one who called it; a {ref} in its answer is the id of what that change made.

import type { ActionDef } from './declared.ts';
import type { Check, Done } from './packhost.ts';
import type { Actor, Archipelago, PartRef } from '../../write/kernel/pelago.ts';

/** The service an internal pack's action runs as. */
export const actService = (def: Pick<ActionDef, 'id' | 'verb'>) => `act.${def.verb}.${def.id.slice(def.id.indexOf('.') + 1)}`;

/** Run an internal pack's action in-process and apply what it answers, on `actor`'s authority. */
export async function internalAct(l: Archipelago, actor: Actor, pack: string, def: ActionDef, input: unknown, check?: Check, part?: PartRef) {
  const { callAs } = await import('./kernel-context.ts');
  const done = await callAs<Done>(l, actService(def), input ?? {});
  await check?.(done);
  const island = (input as { island?: unknown } | null)?.island;
  const changed = done.ops?.length
    ? await l.change(actor, { ops: done.ops, reason: done.reason?.trim() || def.id, action: def.id, pack, ...(typeof island === 'string' && island && { island }), ...(part && { part }) })
    : undefined;
  const made = (changed as { created?: Record<string, string> } | undefined)?.created ?? {};
  const answer = done.answer === undefined ? null : JSON.parse(JSON.stringify(done.answer).replace(/\{([^{}\s"]+)\}/g, (whole, ref: string) => made[ref] ?? whole));
  return { answer, ...changed };
}
