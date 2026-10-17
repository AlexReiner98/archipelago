// Asking a standing question by its name: the kernel's views, and the views packs declare, by their short names
// (a pack's software.handoff answers as handoff), so what agents and hooks ask for does not change as views move
// into packs. A kernel view's name wins; among packs, the first to load.

import type { ViewDef } from './declared.ts';
import { hostFor } from './packtools.ts';
import type { Actor, Archipelago } from './pelago.ts';
import { REPLACED } from './attention.ts';
import { setPackAsker, VIEWS } from './views.ts';

const short = (id: string) => id.slice(id.indexOf('.') + 1);

/** The pack view a short name stands for, if a loaded pack declares one. */
function packView(l: Archipelago, name: string): { pack: string; def: ViewDef } | undefined {
  for (const pack of l.registry.packs) {
    const def = (pack.views ?? []).find((v) => short(v.id) === name);
    if (def) return { pack: pack.id, def };
  }
  return undefined;
}

/** Every question that can be asked here, with what each answers. */
export function viewList(l: Archipelago): Record<string, string> {
  const out = Object.fromEntries(Object.entries(VIEWS).map(([name, v]) => [name, v.description]));
  for (const pack of l.registry.packs) for (const v of pack.views ?? []) out[short(v.id)] ??= `${v.description} (from the ${pack.id} pack)`;
  return out;
}

/** Whether a question of this name can be asked here. */
export const canAsk = (l: Archipelago, name: string) => Boolean(VIEWS[name] ?? packView(l, name));

/** The kernel's own views ask what a pack answers (the gate, a pack's proof) through this. */
setPackAsker((l, name, params) => askView(l, { kind: 'agent', name: 'kernel' }, name, params));

/** Answer a question by its name. */
export async function askView(l: Archipelago, actor: Actor, name: string, params: Record<string, unknown> = {}): Promise<unknown> {
  const view = VIEWS[name];
  if (view) return view.run(l, params);
  const found = packView(l, name);
  if (!found && REPLACED[name]) throw new Error(`No view "${name}": attention answers it now. Ask view attention with params ${REPLACED[name]}.`);
  if (!found) throw new Error(`No view "${name}". Views: ${Object.keys(viewList(l)).join(', ')}`);
  return (await hostFor(l.registry).call(l, actor, found.pack, 'view', found.def.id, params, found.def.limit_ms)).answer ?? null;
}
