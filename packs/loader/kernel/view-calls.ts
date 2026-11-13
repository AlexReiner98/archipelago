// A view's drawing sends its pack's actions, as the person looking (decision e_k9qu6s4g, the owner, 13 Nov 2026): a
// view a pack ships names them (`sends` in its style), its drawing asks for one (`act`), and the page calls it as the
// person, naming the view and the hash of the drawing's code (`part: { view, hash }`). Checked here as a part's sends
// are (packs/loader/kernel/part-calls.ts): the call is a person's, the drawing is one this map draws at that hash, and
// the action (or view) is one the view's pack declares and its preset names. What a view sends is read from the pack
// as it ships it, never from a version kept on the map, so no change on the map widens it.

import type { ActionDef } from './declared.ts';
import { presetsOf } from './declared.ts';
import { drawingsBy, layoutsOf } from './layouts.ts';
import type { Registry } from './packs.ts';
import type { Actor, Archipelago, PartRef } from '../../write/kernel/pelago.ts';

const HASH = /^[0-9a-f]{64}$/;
const ITEM = /^e_[a-z0-9]{8}$/;

const no = (why: string) => new Error(`A view may not send this: ${why}`);

/** The preset a view is: a pack's own by its id, or the one a view kept on the map is the owner's version of. */
async function presetOf(l: Archipelago, reg: Registry, view: string): Promise<string | undefined> {
  if (!ITEM.test(view)) return view;
  const { rows } = await l.db.query<{ props: Record<string, unknown> }>(`select ${l.props} as props from entity where id = $1 and type = any($2::text[]) and archived_at is null`, [view, reg.family('lens')]);
  const preset = rows[0]?.props.preset;
  return typeof preset === 'string' ? preset : undefined;
}

/** Whether a drawing at this hash is one this map draws: as a pack ships it, or as an open version on the map changes it. */
async function drawn(l: Archipelago, reg: Registry, hash: string): Promise<boolean> {
  const ids = layoutsOf(reg.packs).map((d) => d.id);
  if (!ids.length) return false;
  const { rows } = await l.db.query<{ is_open: boolean; props: Record<string, unknown> }>(
    `select is_open, ${l.props} as props from entity where type = any($1::text[]) and archived_at is null and (${l.props.replace(/\s+as props$/, '')}) ->> 'preset' = any($2::text[]) -- index entity_type`,
    [reg.family('layout'), ids],
  );
  return drawingsBy(reg, rows).has(hash);
}

/** The view a call names, checked for this action or view (its tool's name): what its change records. Throws why it may not. */
export async function viewCall(l: Archipelago, actor: Actor, reg: Registry, tool: string, ref: { view?: unknown; hash?: unknown }): Promise<PartRef> {
  if (actor.kind !== 'human') throw no("a view's action is sent by the page, as the person looking at it.");
  if (typeof ref.view !== 'string' || typeof ref.hash !== 'string' || !HASH.test(ref.hash)) throw no('part is { view, hash }: the view and the hash of the code that drew it.');
  const found = reg.tools.get(tool);
  if (!found || (found.call !== 'action' && found.call !== 'view')) throw no(`"${tool}" is no pack's action or view.`);
  const def = found.def as ActionDef;
  const id = await presetOf(l, reg, ref.view.slice(0, 80));
  const view = presetsOf(reg.packs, 'lens').find((p) => p.id === id);
  if (!view) throw no(`no view "${ref.view.slice(0, 80)}" a pack ships.`);
  // What it sends is its style's `sends`: by gesture, each an action or view of its own pack.
  const sends = (view.props as { style?: { sends?: unknown } } | undefined)?.style?.sends;
  const named = sends && typeof sends === 'object' ? Object.values(sends) : [];
  if (view.pack !== found.pack || !named.includes(def.id)) throw no(`${view.id} does not send "${def.id}": a view sends what its pack declares for it.`);
  if (def.humanOnly || def.admin) throw no(`"${def.id}" is one a person chooses to call themselves.`);
  if (!(await drawn(l, reg, ref.hash))) throw no('no drawing with that code is drawn here.');
  return { id: view.id, hash: ref.hash };
}
