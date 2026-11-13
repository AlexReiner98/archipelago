// The actions the styles pack's parts send (packs/styles/parts/), run in the server's process as an internal pack's
// are (act.<verb>.<action>, pack.json kernel.provides): each answers with the ops it makes, on the person's authority as
// the part's press, and whether the change applies or waits is the rules' to say. A style or layout it names is read
// first, so an action never touches what is not one.

import type { KernelContext } from '#pelago/kernel';

/** What an action answers: its ops, why, and what the part is told. */
export interface Made { ops: Record<string, unknown>[]; reason: string; answer: Record<string, unknown> }
/** An item as an action reads it. */
export interface Read { id: string; type: string; title: string }

/** The fields a version keeps of its preset: everything it ships but the names a version keeps for itself. */
function fieldsOf(props: unknown): Record<string, unknown> {
  if (!props || typeof props !== 'object' || Array.isArray(props)) throw new Error("A preset's fields are an object.");
  const { preset: _p, on: _o, ...rest } = props as Record<string, unknown>;
  return rest;
}

const words = (v: unknown, what: string) => {
  if (typeof v !== 'string' || !v.trim()) throw new Error(`${what} is needed.`);
  return v.trim().slice(0, 60);
};

/** The owner's version of a preset, as it ships: the change they make is then the only difference. */
export function keep(input: { preset?: unknown; title?: unknown; props?: unknown; on?: unknown }): Made {
  const named = words(input.title, 'A name');
  const where = Array.isArray(input.on) && input.on.length ? { on: input.on.map(String) } : {};
  return {
    ops: [{ op: 'create', ref: 'mine', type: 'style', title: named, status: 'current', props: { ...fieldsOf(input.props), ...where, preset: words(input.preset, 'The preset') } }],
    reason: `${named}: the owner's version of the preset`,
    answer: { item: '{mine}' },
  };
}

/** A version of a preset used again, or retired. `item` is the style read, or nothing when it is no style. */
export function use(item: Read | undefined, on: boolean): Made {
  if (!item) throw new Error('That is not a style.');
  return { ops: [{ op: 'update', id: item.id, status: on ? 'current' : 'retired' }], reason: `${item.title} ${on ? 'used again' : 'retired'}`, answer: { item: item.id } };
}

/** A theme chosen: its version kept or used again, every other kept theme retired, in one change. `styles` are the styles read of those named. */
export function chooseTheme(input: { preset?: unknown; title?: unknown; props?: unknown; item?: unknown; others?: unknown }, styles: Set<string>): Made {
  const named = words(input.title, 'A name');
  const others = Array.isArray(input.others) ? input.others.filter((o): o is string => typeof o === 'string' && styles.has(o)) : [];
  const item = typeof input.item === 'string' ? input.item : undefined;
  if (item && !styles.has(item)) throw new Error('That is not a style.');
  const mine = item
    ? { op: 'update', id: item, status: 'current' }
    : { op: 'create', ref: 'mine', type: 'style', title: named, status: 'current', props: { ...fieldsOf(input.props), preset: words(input.preset, 'The preset') } };
  return { ops: [...others.map((o) => ({ op: 'update', id: o, status: 'retired' })), mine], reason: `${named} chosen as the workspace's theme`, answer: { item: item ?? '{mine}' } };
}

/** A layout kept on the map archived: it leaves every choice and stays in the history. */
export function deleteLayout(layout: Read | undefined): Made {
  if (!layout) throw new Error('That is not a layout kept on the map.');
  return { ops: [{ op: 'archive', id: layout.id }], reason: `${layout.title}: deleted from the view band`, answer: { layout: layout.id } };
}

/** The items named, as the person may read them, kept only where they are of `type` (or a flavour of it). */
async function readOf(ctx: KernelContext, ids: unknown[], type: string): Promise<Read[]> {
  const asked = ids.filter((id): id is string => typeof id === 'string' && /^e_[a-z0-9]{8}$/.test(id));
  if (!asked.length) return [];
  const rows = (await ctx.reads({ ids: asked })) as Read[];
  return rows.filter((r) => ctx.registry.isA(r.type, type));
}

export const keepAct = async (_ctx: KernelContext, input: Record<string, unknown>) => keep(input ?? {});
export const useAct = async (ctx: KernelContext, input: { item?: unknown; use?: unknown }) => use((await readOf(ctx, [input?.item], 'style'))[0], input?.use === true);
export const chooseThemeAct = async (ctx: KernelContext, input: { item?: unknown; others?: unknown } & Record<string, unknown>) =>
  chooseTheme(input ?? {}, new Set((await readOf(ctx, [input?.item, ...(Array.isArray(input?.others) ? input.others : [])], 'style')).map((r) => r.id)));
export const deleteLayoutAct = async (ctx: KernelContext, input: { layout?: unknown }) => deleteLayout((await readOf(ctx, [input?.layout], 'layout'))[0]);
