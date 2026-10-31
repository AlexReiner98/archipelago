// Asking a standing question by its name: the kernel's operational views, and the views packs declare, by their
// short names (a pack's software.handoff answers as handoff, core's core.attention as attention), so what agents and
// hooks ask for does not change as views move into packs. A view a pack declares is answered by a read of the
// kernel's that it names (src/query-presets.ts), or by its own code. A kernel view's name wins; among packs, the first to load.

import type { ViewDef } from './declared.ts';
import { parts } from './manifest.ts';
import { hostFor } from './packtools.ts';
import type { Actor, Archipelago } from './pelago.ts';
import type { Registry } from './packs.ts';
import { REPLACED } from './attention.ts';
import { answerPreset } from './query-presets.ts';
import { setPackAsker, VIEWS } from './views.ts';

const short = (id: string) => id.slice(id.indexOf('.') + 1);

/** The pack view a short name stands for, if a loaded pack declares one. */
function packView(l: Archipelago, name: string): { pack: string; def: ViewDef } | undefined {
  for (const pack of l.registry.packs) {
    const def = parts(pack).views.find((v) => short(v.id) === name);
    if (def) return { pack: pack.id, def };
  }
  return undefined;
}

/** Every question that can be asked here, with what each answers. */
export function viewList(l: Archipelago): Record<string, string> {
  const out = Object.fromEntries(Object.entries(VIEWS).map(([name, v]) => [name, v.description]));
  for (const pack of l.registry.packs) for (const v of parts(pack).views) out[short(v.id)] ??= pack.id === 'core' ? v.description : `${v.description} (from the ${pack.id} pack)`;
  return out;
}

/** What the view tool says it answers: the views the core pack declares (none without a registry), the flat lens first, then the kernel's own views, then the packs'. */
export function viewsSaid(reg?: Registry): string {
  const core = reg ? parts(reg.packs.find((p) => p.id === 'core')!).views : [];
  const lenses = core.map((v): [string, string] => [short(v.id), v.description]).sort(([a], [b]) => Number(b === 'flat') - Number(a === 'flat'));
  const views = [...lenses, ...Object.entries(VIEWS).map(([name, v]): [string, string] => [name, v.description])];
  return (
    'Answer one of the standing questions. Call with no name to list them. An agent is given each answer without its empty fields and with long lists cut to what is read (params.full: true for all of it). ' +
    views.map(([name, said]) => `${name}: ${said}`).join(' ') +
    ' The packs here add their own (the repository views handoff, repo_work, recheck and agent_usage, and a release’s gate, are the software pack’s): call with no name for all of them.'
  );
}

/** Whether a question of this name can be asked here. */
export const canAsk = (l: Archipelago, name: string) => Boolean(VIEWS[name] ?? packView(l, name));

/** The kernel's own views ask what a pack answers (the gate, a pack's proof) through this. */
setPackAsker((l, name, params) => askView(l, { kind: 'agent', name: 'kernel' }, name, params));

/** Answer a question by its name. */
export async function askView(l: Archipelago, actor: Actor, name: string, params: Record<string, unknown> = {}): Promise<unknown> {
  const view = VIEWS[name];
  if (view) return view.run(l, params, actor);
  const found = packView(l, name);
  if (!found && REPLACED[name]) throw new Error(`No view "${name}": attention answers it now. Ask query attention with params ${REPLACED[name]}.`);
  if (!found) throw new Error(`No view "${name}". Views: ${Object.keys(viewList(l)).join(', ')}`);
  if (found.def.lens) return answerPreset(l, found.def, params);
  return (await hostFor(l.registry).call(l, actor, found.pack, 'view', found.def.id, params, found.def.limit_ms)).answer ?? null;
}
