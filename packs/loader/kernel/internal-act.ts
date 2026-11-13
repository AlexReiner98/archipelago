// An internal pack's action (a root or service pack's, docs/kernel-packs.md): its code runs in the server's process,
// never in the sandbox, as the service its pack provides under the action's verb and name, `act.<verb>.<name>`
// (packs/loader/kernel/declared.ts, checkDeclared). The service answers as a sandboxed handler does (ops, a reason, an
// answer: packs/loader/kernel/packhost.ts, Done), and that answer is made so by the same path a handler's is
// (PackHost.applied): checked against a limited token, held to the pack's manifest, its ops one change set naming the
// action, its pack and the part that sent it, on the caller's authority. Whether it applies or waits is the rules'.

import type { ActionDef } from './declared.ts';
import type { Check, Done, PackHost } from './packhost.ts';
import type { Registry } from './packs.ts';
import { providedBy } from './services.ts';
import type { Actor, Archipelago, PartRef } from '../../write/kernel/pelago.ts';

/** The service an internal pack's action runs as: styles.keep, of the verb capture, is act.capture.keep. */
export const actService = (def: Pick<ActionDef, 'id' | 'verb'>) => `act.${def.verb}.${def.id.slice(def.id.indexOf('.') + 1)}`;

/** Run an internal pack's action in-process and make what it answers so, as `actor`. Only the declaring pack's service counts. */
export async function internalAct(l: Archipelago, reg: Registry, host: PackHost, actor: Actor, pack: string, def: ActionDef, input: unknown, check?: Check, part?: PartRef) {
  const service = actService(def);
  const file = reg.packs.find((p) => p.id === pack);
  if (!file || !providedBy(file).includes(service)) throw new Error(`The ${pack} pack runs in the server's process and provides no ${service} for its action "${def.id}".`);
  const { callAs } = await import('./kernel-context.ts');
  const done = await callAs<Done | null | undefined>(l, service, input ?? {});
  if (done !== undefined && done !== null && (typeof done !== 'object' || Array.isArray(done))) throw new Error(`${service} answered with no ops, reason and answer.`);
  return host.applied(l, actor, pack, def.id, done ?? {}, input, 'action', check, part);
}
