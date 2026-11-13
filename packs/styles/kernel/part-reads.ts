// What the styles pack's parts read (packs/styles/parts/): the presets the packs ship with the owner's version of each
// (answer.style_presets, the presets and themes cards on the Workspace page), and the layouts a view may be drawn in
// (answer.layouts, the layout switch in the view band): those the packs ship, then those kept on the map, each with how
// many kept views are drawn in it.

import type { KernelContext } from '#pelago/kernel';
import { withStyles, type Preset, type Kept } from './styles.ts';

/** The presets the packs ship as styles (not drawings), each with its pack: as the schema lists them (stylesOf). */
const presetsOf = (packs: readonly { id: string; styles?: Omit<Preset, 'pack'>[] }[]): Preset[] =>
  packs.flatMap((pack) => (pack.styles ?? []).filter((s) => (s.type ?? 'style') === 'style').map((s) => ({ ...s, pack: pack.id })));

/** Every preset with the owner's version of it (`item`, `retired`): what the Workspace page's style cards draw. */
export async function stylePresets(ctx: KernelContext): Promise<{ styles: (Preset & { item?: string; retired?: boolean })[] }> {
  const { styles } = await withStyles(ctx, { styles: presetsOf(ctx.registry.packs as never) });
  return { styles };
}

/** How many kept views are looked through to count those drawn in a layout. */
const VIEWS_COUNTED = 200;

/** A view kept on the map draws in a kept layout when its style names it. */
const drawnIn = (view: Kept) => {
  const style = view.props?.style as { style?: unknown } | undefined;
  return typeof style?.style === 'string' ? style.style : undefined;
};

/**
 * The layouts a view may be drawn in: the packs' drawings by their shape (the first is the default), and the layouts
 * kept on the map that are not the owner's version of a pack's, by name, each with how many kept views draw in it; and
 * the styles kept on the map by name (`named`), so one a view is drawn with (Use here) is called by its title, not listed.
 */
export async function layoutsListed(ctx: KernelContext): Promise<{ shapes: { shape: string; title: string }[]; kept: { id: string; title: string; views: number }[]; named: { id: string; title: string }[] }> {
  const shapes = (ctx.registry.packs as { layouts?: { shape: string; title: string }[] }[]).flatMap((p) => (p.layouts ?? []).map((d) => ({ shape: d.shape, title: d.title })));
  const all = (await ctx.reads({ looks: { types: ['layout', 'style'] } })) as Kept[];
  const looks = all.filter((k) => ctx.registry.isA(k.type ?? 'layout', 'layout'));
  const named = all.filter((k) => !looks.includes(k) && !k.props?.preset).map((k) => ({ id: k.id, title: k.title }));
  // The views kept on the map, one page of them (as many as the switch ever counted): open ones alone draw.
  const page = (await ctx.reads({ items: { type: 'lens' }, page: { size: VIEWS_COUNTED } })) as { rows: (Kept & { is_open?: boolean })[] };
  const views = page.rows.filter((v) => v.is_open !== false);
  const kept = looks
    .filter((k) => !k.props?.preset)
    .map((k) => ({ id: k.id, title: k.title, views: views.filter((v) => drawnIn(v) === k.id).length }))
    .sort((a, b) => a.title.localeCompare(b.title));
  return { shapes, kept, named };
}
