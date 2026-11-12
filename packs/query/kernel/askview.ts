// Asking a standing question by its name: the kernel's operational views, and the views packs declare, by their
// short names (a pack's software.handoff answers as handoff, core's core.attention as attention), so what agents and
// hooks ask for does not change as views move into packs. A view a pack declares is answered by a read of the
// kernel's that it names (./query-presets.ts), or by its own code, run in the sandbox (the loader's root.pack_view).
// A kernel view's name wins; among packs, the first to load.

import type { KernelContext } from '#pelago/kernel';
import { answerPreset, type PresetDef } from './query-presets.ts';
import { VIEWS, type Actor } from './views.ts';

type Registry = KernelContext['registry'];
type Manifest = Registry['packs'][number];
/** A view a pack declares, as the list of views reads it. */
type ViewDef = PresetDef & { description: string };

/** The kernel's own pack: its views, wherever they live now, are the kernel's. */
const KERNEL_PACKS = ['core'];

const short = (id: string) => id.slice(id.indexOf('.') + 1);

/** The views a pack declares that are views (not a tree, a screen or a reason): what the loader's parts reads as views. */
const viewsOf = (pack: Manifest): ViewDef[] => ((pack.views ?? []) as unknown as (ViewDef & { form?: string })[]).filter((v) => v.form === undefined);

/** Whether a view is the kernel's: its pack's, or by its id (`core.x`) wherever it lives now: a pack that took it from core keeps the id. */
const kernels = (pack: string, id: string) => KERNEL_PACKS.includes(pack) || KERNEL_PACKS.some((k) => id.startsWith(`${k}.`));

/** The pack view a short name stands for, if a loaded pack declares one. */
function packView(reg: Registry, name: string): { pack: string; def: ViewDef } | undefined {
  for (const pack of reg.packs) {
    const def = viewsOf(pack).find((v) => short(v.id) === name);
    if (def) return { pack: pack.id, def };
  }
  return undefined;
}

/** Old views attention answers now, each with the params that ask it (the attention pack's REPLACED, copied). */
const REPLACED: Record<string, string> = {
  needs_me: '{ person: "me", reasons: ["waits_on", "to_confirm", "due", "unsettled", "ready"] }',
  blocked_on_me: '{ person: "me", reasons: ["holding_up"] }',
  waiting_on: '{ person: "me", reasons: ["blocked"] }',
  at_risk: '{ reasons: ["due"], days: 7, within: <a project> }',
  blockers: '{ reasons: ["blocked"], within: <a project> }',
  available_now: '{ reasons: ["ready"], person: "me" }',
  oldest: '{ reasons: ["stale"], within: <an item or a repository> }',
  questions: '{ reasons: ["unsettled"], within: <a project> }',
  to_confirm: '{ person: "me", reasons: ["to_confirm"] }',
  home: '{ person: "me" }: Home is a screen now',
};

/** Every question that can be asked here, with what each answers. */
export function viewList(at: { registry: Registry }): Record<string, string> {
  const out = Object.fromEntries(Object.entries(VIEWS).map(([name, v]) => [name, v.description]));
  for (const pack of at.registry.packs) for (const v of viewsOf(pack)) out[short(v.id)] ??= kernels(pack.id, v.id) ? v.description : `${v.description} (from the ${pack.id} pack)`;
  return out;
}

/** The name of every question that can be asked here, the flat lens first: what the tool list says, the list above saying the rest. */
export function viewNames(reg: Pick<Registry, 'packs'>): string[] {
  const names = new Set(['flat', ...Object.keys(VIEWS)]);
  for (const pack of reg.packs) for (const v of viewsOf(pack)) names.add(short(v.id));
  return [...names];
}

/** The views the other packs on here add, by name, or nothing when only core is on. */
function packsSaid(reg?: Pick<Registry, 'packs'>): string {
  const added = (reg?.packs ?? []).flatMap((p) => viewsOf(p).filter((v) => !kernels(p.id, v.id)).map((v) => short(v.id)));
  return added.length ? ` The other packs on here add their own (${[...new Set(added)].join(', ')}): call with no name for what each answers.` : '';
}

/** What the view tool says it answers: the kernel's views by their ids, wherever they live (none without a registry), the flat lens first, then the kernel's own views, then the packs'. */
export function viewsSaid(reg?: Pick<Registry, 'packs'>): string {
  const core = (reg?.packs ?? []).flatMap((p) => viewsOf(p).filter((v) => kernels(p.id, v.id)));
  const queries = core.map((v): [string, string] => [short(v.id), v.description]).sort(([a], [b]) => Number(b === 'flat') - Number(a === 'flat'));
  const views = [...queries, ...Object.entries(VIEWS).map(([name, v]): [string, string] => [name, v.description])];
  return (
    'Answer one of the standing questions. Call with no name to list them. Answers drop empty fields and cut long lists (params.full: true for all).' +
    views.map(([name, said]) => `${name}: ${said}`).join(' ') +
    packsSaid(reg)
  );
}

/** Whether a question of this name can be asked here. */
export const canAsk = (at: { registry: Registry }, name: string) => Boolean(VIEWS[name] ?? packView(at.registry, name));

/** A use of a view, counted on the workspace a moment after it is asked (the usage pack keeps the counts, root.uses). */
const used = (ctx: KernelContext, id: string) => {
  if (id) void ctx.call('root.uses', { workspace: ctx.workspace, add: [{ key: `view:${id.replace(/\s/g, '_')}`, n: 1 }] }).catch((err: Error) => console.error(`counting a use on ${ctx.workspace} failed: ${err.message}`));
};

/** Answer a question by its name. */
export async function askView(map: KernelContext, actor: Actor, name: string, params: Record<string, unknown> = {}): Promise<unknown> {
  // A read that names an island is read as that island runs: through the version of its pack it names, if any.
  const ctx = typeof params.island === 'string' ? await map.island(params.island) : map;
  const view = VIEWS[name];
  if (view) return view.run(ctx, params, actor);
  const found = packView(ctx.registry, name);
  if (!found && REPLACED[name]) throw new Error(`No view "${name}": attention answers it now. Ask query attention with params ${REPLACED[name]}.`);
  if (!found) throw new Error(`No view "${name}". Views: ${Object.keys(viewList(ctx)).join(', ')}`);
  used(ctx, found.def.id);
  if (found.def.lens) return answerPreset(ctx, found.def, params);
  // A pack's own code answers it, in the sandbox, as the one who asked.
  return map.call('root.pack_view', { pack: found.pack, view: found.def.id, params, actor });
}
