// Asking a standing question by its name: the kernel's operational views, and the views packs declare, by their
// short names (a pack's software.handoff answers as handoff, core's core.attention as attention), so what agents and
// hooks ask for does not change as views move into packs. A view a pack declares is answered by a read of the
// kernel's that it names (src/query-presets.ts), or by its own code. A kernel view's name wins; among packs, the first to load.

import type { ViewDef } from './declared.ts';
import { parts } from './manifest.ts';
import { KERNEL_PACKS } from './packorder.ts';
import { hostIn } from './packtools.ts';
import type { Actor, Archipelago } from './pelago.ts';
import type { Registry } from './packs.ts';
import { REPLACED } from './attention.ts';
import { answerPreset } from './query-presets.ts';
import { islandRegistry } from './island-pin.ts';
import { setPackAsker, VIEWS } from './views.ts';
import { used } from './uses.ts';

const short = (id: string) => id.slice(id.indexOf('.') + 1);

/** Whether a view is the kernel's: its pack's, or by its id (`core.x`) wherever it lives now: a pack that took it from core keeps the id (src/pack-moved.ts). */
const kernels = (pack: string, id: string) => KERNEL_PACKS.includes(pack) || KERNEL_PACKS.some((k) => id.startsWith(`${k}.`));

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
  for (const pack of l.registry.packs) for (const v of parts(pack).views) out[short(v.id)] ??= kernels(pack.id, v.id) ? v.description : `${v.description} (from the ${pack.id} pack)`;
  return out;
}

/** The name of every question that can be asked here, the flat lens first: what the tool list says, the list above saying the rest. */
export function viewNames(reg: Registry): string[] {
  const names = new Set(['flat', ...Object.keys(VIEWS)]);
  for (const pack of reg.packs) for (const v of parts(pack).views) names.add(short(v.id));
  return [...names];
}

/** The views the other packs on here add, by name, or nothing when only core is on. */
function packsSaid(reg?: Registry): string {
  const added = (reg?.packs ?? []).flatMap((p) => parts(p).views.filter((v) => !kernels(p.id, v.id)).map((v) => short(v.id)));
  return added.length ? ` The other packs on here add their own (${[...new Set(added)].join(', ')}): call with no name for what each answers.` : '';
}

/** What the view tool says it answers: the kernel's views by their ids, wherever they live (none without a registry), the flat lens first, then the kernel's own views, then the packs'. */
export function viewsSaid(reg?: Registry): string {
  const core = (reg?.packs ?? []).flatMap((p) => parts(p).views.filter((v) => kernels(p.id, v.id)));
  const queries = core.map((v): [string, string] => [short(v.id), v.description]).sort(([a], [b]) => Number(b === 'flat') - Number(a === 'flat'));
  const views = [...queries, ...Object.entries(VIEWS).map(([name, v]): [string, string] => [name, v.description])];
  return (
    'Answer one of the standing questions. Call with no name to list them. Answers drop empty fields and cut long lists (params.full: true for all).' +
    views.map(([name, said]) => `${name}: ${said}`).join(' ') +
    packsSaid(reg)
  );
}

/** Whether a question of this name can be asked here. */
export const canAsk = (l: Archipelago, name: string) => Boolean(VIEWS[name] ?? packView(l, name));

/** The kernel's own views ask what a pack answers (the gate, a pack's proof) through this. */
setPackAsker((l, name, params) => askView(l, { kind: 'agent', name: 'kernel' }, name, params));

/** Answer a question by its name. */
export async function askView(map: Archipelago, actor: Actor, name: string, params: Record<string, unknown> = {}): Promise<unknown> {
  // A read that names an island is read as that island runs: through the version of its pack it names, if any.
  const l = typeof params.island === 'string' ? map.readIn(await islandRegistry(map, params.island)) : map;
  const view = VIEWS[name];
  if (view) return view.run(l, params, actor);
  const found = packView(l, name);
  if (!found && REPLACED[name]) throw new Error(`No view "${name}": attention answers it now. Ask query attention with params ${REPLACED[name]}.`);
  if (!found) throw new Error(`No view "${name}". Views: ${Object.keys(viewList(l)).join(', ')}`);
  used(l.workspace, 'view', found.def.id);
  if (found.def.lens) return answerPreset(l, found.def, params);
  return (await (await hostIn(map, found.pack, params.island)).call(l, actor, found.pack, 'view', found.def.id, params, found.def.limit_ms)).answer ?? null;
}
