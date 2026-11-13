// A part of the page sends its own pack's actions, as the person looking (decision e_3mdf9gn8, task e_9ests3je). The
// page names the part and the hash of its code on the call (`part`), and here that is checked before the action runs:
// the call is a person's, the part is drawn here at that hash (its pack's code, or the owner's version of it), the
// action is one of its `sends`, its own pack's, and not one only a person or an admin may choose to call. The change it
// makes then names the part (`ChangeInput.part`), so the log says which version of which part asked. Whether that
// change applies or waits is the rules' to say, as for any change of that person's: nothing here lifts a hold.
//
// The kernel's own acts (approve, tokens, members, forget, publish, workspace settings) are no pack's action, so no
// part's `sends` can name them, and a call that names a part is a pack action or is refused (packs/surface/kernel/tools.ts).

import type { ActionDef } from './declared.ts';
import { islandRegistry } from './island-pin.ts';
import type { Registry } from './packs.ts';
import { partsFor } from './ui-parts.ts';
import { viewCall } from './view-calls.ts';
import type { Actor, Archipelago, PartRef } from '../../write/kernel/pelago.ts';

const HASH = /^[0-9a-f]{64}$/;

const no = (why: string) => new Error(`A part may not send this: ${why}`);

/** The owner's versions of one part (core's part type naming it as its preset), open or retired. */
async function versionsOf(l: Archipelago, reg: Registry, id: string) {
  const { rows } = await l.db.query<{ is_open: boolean; props: Record<string, unknown> }>(
    `select is_open, ${l.props} as props from entity where type = any($1::text[]) and archived_at is null and props ->> 'preset' = $2 -- index entity_type`,
    [reg.family('part'), id],
  );
  return rows;
}

/**
 * The part a call names, checked for this action (its tool's name, as packs/loader/kernel/declared.ts toolName makes it) on the island the call is given (its `island` input): what its
 * change records. Throws why it may not send it.
 */
export async function partCall(l: Archipelago, actor: Actor, action: string, island: unknown, given: unknown): Promise<PartRef> {
  if (actor.kind !== 'human') throw no("a part's action is sent by the page, as the person looking at it.");
  // A view's drawing names its view, not a part (packs/loader/kernel/view-calls.ts).
  if (typeof (given as { view?: unknown } | undefined)?.view === 'string') return viewCall(l, actor, await islandRegistry(l, island), action, given as { view: string });
  const ref = (given ?? {}) as Partial<PartRef>;
  if (typeof ref.id !== 'string' || typeof ref.hash !== 'string' || !HASH.test(ref.hash)) throw no('part is { id, hash }: the part and the hash of its code.');
  const reg = await islandRegistry(l, island);
  const found = reg.tools.get(action);
  if (!found || found.call !== 'action') throw no(`"${action}" is no pack's action.`);
  const def = found.def as ActionDef;
  // As its pack ships it, or as the owner's open version of it changes it: either may be on the person's screen.
  const kept = await versionsOf(l, reg, ref.id);
  const part = [...partsFor(reg, kept), ...partsFor(reg)].find((p) => p.id === ref.id && p.hash === ref.hash);
  if (!part) throw no(`no part "${ref.id.slice(0, 80)}" with that code is drawn here.`);
  if (!part.sends.includes(def.id) || found.pack !== part.pack) throw no(`${part.id} does not send "${def.id}": a part sends the actions its pack declares for it.`);
  if (def.humanOnly || def.admin) throw no(`"${def.id}" is one a person chooses to call themselves.`);
  return { id: part.id, hash: part.hash };
}
