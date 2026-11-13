// The actions the styles pack's parts send (packs/styles/parts/), run in the server's process as an internal pack's
// are (act.<verb>.<action>, pack.json kernel.provides): each answers with the ops it makes, on the person's authority as
// the part's press, and whether the change applies or waits is the rules' to say. A preset is read from the packs, its
// owner's version from the map, and a layout is read first, so an action never touches what is not one.
//
// styles.use: a preset used (the owner's version kept as the preset ships it, or used again) or not (retired). A theme
// used retires every other theme kept, so one is chosen. styles.delete_layout: a layout kept on the map archived.

import type { KernelContext } from '#pelago/kernel';
import type { Preset } from './styles.ts';

/** What an action answers: its ops, why, and what the part is told. */
export interface Made { ops: Record<string, unknown>[]; reason: string; answer: Record<string, unknown> }
/** The owner's version of a preset, as the map keeps it. */
export interface Version { id: string; title: string; is_open: boolean; props: Record<string, unknown> }
/** An item as an action reads it. */
export interface Read { id: string; type: string; title: string }

/** A preset used or not, given the presets the packs ship and the owner's versions of them. */
export function use(presetId: unknown, on: boolean, presets: Preset[], versions: Version[]): Made {
  const preset = presets.find((p) => p.id === presetId);
  if (!preset) throw new Error('That is not a style preset.');
  const mine = versions.find((v) => v.props.preset === preset.id);
  if (!on) {
    if (!mine?.is_open) return { ops: [], reason: `${preset.title}: not used already`, answer: { preset: preset.id } };
    return { ops: [{ op: 'update', id: mine.id, status: 'retired' }], reason: `${preset.title} retired`, answer: { preset: preset.id, item: mine.id } };
  }
  // A theme is chosen alone: any other kept is retired in the same change.
  const theme = preset.over === 'chosen';
  const others = theme ? versions.filter((v) => v.is_open && v !== mine && presets.some((p) => p.over === 'chosen' && p.id === v.props.preset)) : [];
  const retire = others.map((v) => ({ op: 'update', id: v.id, status: 'retired' }));
  const { preset: _p, on: _o, ...fields } = preset.props ?? {};
  const mineOp = mine
    ? mine.is_open ? null : { op: 'update', id: mine.id, status: 'current' }
    : { op: 'create', ref: 'mine', type: 'style', title: preset.title.slice(0, 60), status: 'current', props: { ...fields, ...(preset.on?.length && { on: preset.on }), preset: preset.id } };
  return {
    ops: [...retire, ...(mineOp ? [mineOp] : [])],
    reason: theme ? `${preset.title} chosen as the workspace's theme` : mine ? `${preset.title} used again` : `${preset.title}: the owner's version of the preset`,
    answer: { preset: preset.id, item: mine?.id ?? '{mine}' },
  };
}

/** A layout kept on the map archived: it leaves every choice and stays in the history. */
export function deleteLayout(layout: Read | undefined): Made {
  if (!layout) throw new Error('That is not a layout kept on the map.');
  return { ops: [{ op: 'archive', id: layout.id }], reason: `${layout.title}: deleted from the view band`, answer: { layout: layout.id } };
}

/** The presets the packs ship as styles, each with its pack (as the schema lists them). */
const presetsOf = (ctx: KernelContext): Preset[] =>
  (ctx.registry.packs as { id: string; styles?: Omit<Preset, 'pack'>[] }[]).flatMap((pack) => (pack.styles ?? []).filter((s) => (s.type ?? 'style') === 'style').map((s) => ({ ...s, pack: pack.id })));

export const useAct = async (ctx: KernelContext, input: { preset?: unknown; use?: unknown }) =>
  use(input?.preset, input?.use !== false, presetsOf(ctx), (await ctx.reads({ versions: 'style' })) as Version[]);

export const deleteLayoutAct = async (ctx: KernelContext, input: { layout?: unknown }) => {
  const id = typeof input?.layout === 'string' && /^e_[a-z0-9]{8}$/.test(input.layout) ? input.layout : undefined;
  const rows = id ? ((await ctx.reads({ ids: [id] })) as Read[]) : [];
  return deleteLayout(rows.find((r) => ctx.registry.isA(r.type, 'layout')));
};
