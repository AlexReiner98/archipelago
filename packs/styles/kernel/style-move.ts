// Styles made for one view move into it (decision e_47pjkbxb): a view holds its own layout and settings, and a style is
// shared or does not exist. A migration, run when a workspace opens: a change like any other, so the log keeps what
// each style said.
//
// A style about a view, or about an item that has views, has its fields put in those views, the one about the view
// last, its own settings over them, and is retired. One about only what is archived is retired. One with code is a
// layout: it stays, and a view it is about itself names it if that view holds no style; the views of an item it is
// about are left as they are, so it never changes a view's style unasked. One about an item with no view stays until that item has
// one, and one that sets how a page looks stays, as what it says belongs to the page.

import type { KernelContext } from '#pelago/kernel';
import { ownStyle } from './styles.ts';

type Props = Record<string, unknown>;

/** A fact of the log (src/log.ts, Fact): a field set, or taken off. */
export type Fact = ['+', string, string, unknown] | ['-', string, string];

const PAGE_FIELDS = ['theme', 'page', 'page_css', 'faces', 'type', 'emblem', 'icon', 'font'];

export interface Tie {
  style: string;
  to: string;
  to_type: string;
  gone: boolean;
}

/** What each view should hold and which styles leave, worked out from the styles and what they are about. Pure. */
export function stylesMoved(styles: { id: string; props: Props }[], ties: Tie[], viewsOf: Map<string, string[]>, isView: (type: string) => boolean, views: Map<string, Props>) {
  const held = new Map<string, Props>();
  const retired: string[] = [];
  const hold = (view: string, fields: Props) => held.set(view, { ...held.get(view), ...fields });
  const of = (style: string) => ties.filter((t) => t.style === style);
  // Those about an item first, so one about the view itself lies over them, as it did.
  const near = (id: string) => (of(id).some((t) => !t.gone && isView(t.to_type)) ? 1 : 0);
  for (const style of [...styles].sort((a, b) => near(a.id) - near(b.id))) {
    const tied = of(style.id);
    if (!tied.length) continue;
    const live = tied.filter((t) => !t.gone);
    const into = [...new Set(live.flatMap((t) => (isView(t.to_type) ? [t.to] : (viewsOf.get(t.to) ?? []))))];
    if (typeof style.props.code === 'string') {
      // Named only by a view it is about itself that holds no style yet: never by the views of an item it is about, nor over a style a view was given.
      for (const t of live) if (isView(t.to_type) && views.get(t.to)?.style === undefined) hold(t.to, { style: style.id });
      continue;
    }
    if (PAGE_FIELDS.some((field) => style.props[field] != null)) continue;
    if (into.length) for (const view of into) hold(view, ownStyle(style.props));
    if (into.length || !live.length) retired.push(style.id);
  }
  return { held, retired };
}

/** Why the move is made, as the log keeps it. */
export const STYLES_MOVED = 'A view holds its own layout and settings: each style made for one view moves into it';

/**
 * The migration, planned: the facts that put each style's fields in its views and retire it, and how many views took
 * settings and how many styles left. What it reads is the styles pack's read (style_moves); the kernel appends the
 * facts as the system's move (src/style-move.ts), which a service pack may not.
 */
export async function planStyles(ctx: KernelContext): Promise<{ facts: Fact[]; views: number; retired: number }> {
  const lens = ctx.registry.family('lens');
  const read = (await ctx.reads({ style_moves: true })) as { styles: { id: string; props: Props }[]; ties: Tie[]; about: { view: string; item: string }[]; kept: { id: string; props: Props }[] } | null;
  if (!read) return { facts: [], views: 0, retired: 0 };
  const { styles, ties, about, kept } = read;
  const viewsOf = new Map<string, string[]>();
  for (const { view, item } of about) viewsOf.set(item, [...(viewsOf.get(item) ?? []), view]);
  const views = new Map(kept.map((v) => [v.id, v.props]));
  const { held, retired } = stylesMoved(styles, ties, viewsOf, (type) => lens.includes(type), views);
  const leaving = new Set(retired);
  const facts: Fact[] = [];
  for (const [id, fields] of held) {
    const own = { ...((views.get(id)?.style ?? {}) as Props) };
    // A view that named a style leaving keeps what that style said, and names it no longer.
    if (typeof own.style === 'string' && leaving.has(own.style)) delete own.style;
    facts.push(['+', id, 'style', { ...fields, ...own }]);
  }
  for (const id of retired) facts.push(['+', id, 'status', 'retired']);
  return { facts, views: held.size, retired: retired.length };
}
