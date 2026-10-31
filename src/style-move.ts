// Styles made for one view move into it (decision e_47pjkbxb): a view holds its own layout and settings, and a style is
// shared or does not exist. A migration, run when a workspace opens: a change like any other, so the log keeps what
// each style said.
//
// A style about a view, or about an item that has views, has its fields put in those views, the one about the view
// last, its own settings over them, and is retired. One about only what is archived is retired. One with code is a
// layout: it stays, and a view of what it was about names it. One about an item with no view stays until that item has
// one, and one that sets how a page looks stays, as what it says belongs to the page.

import { ownStyle } from './styles.ts';
import type { Fact } from './log.ts';
import type { Archipelago } from './pelago.ts';

type Props = Record<string, unknown>;

const PAGE_FIELDS = ['theme', 'page', 'page_css', 'faces', 'type', 'emblem', 'font'];

interface Tie {
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
      for (const view of into) if (!(views.get(view)?.style as Props | undefined)?.style) hold(view, { style: style.id });
      continue;
    }
    if (PAGE_FIELDS.some((field) => style.props[field] != null)) continue;
    if (into.length) for (const view of into) hold(view, ownStyle(style.props));
    if (into.length || !live.length) retired.push(style.id);
  }
  return { held, retired };
}

/** The migration: returns how many views took settings and how many styles left. */
export async function moveStyles(l: Archipelago): Promise<{ views: number; retired: number }> {
  const style = l.registry.family('style'), lens = l.registry.family('lens');
  const { rows: styles } = await l.db.query<{ id: string; props: Props }>(
    `select id, props from entity where type = any($1::text[]) and archived_at is null and is_open and props ->> 'preset' is null and not props ? 'on' order by updated_at, id -- index entity_type`,
    [style],
  );
  if (!styles.length) return { views: 0, retired: 0 };
  const { rows: ties } = await l.db.query<Tie>(
    `select r.from_id as style, r.to_id as "to", t.type as to_type, t.archived_at is not null as gone from relation r join entity t on t.id = r.to_id where r.type = 'about' and r.valid_to is null and r.from_id = any($1::text[]) order by r.id`,
    [styles.map((s) => s.id)],
  );
  if (!ties.length) return { views: 0, retired: 0 };
  const { rows: about } = await l.db.query<{ view: string; item: string }>(
    `select r.from_id as view, r.to_id as item from relation r join entity v on v.id = r.from_id where r.type = 'about' and r.valid_to is null and r.to_id = any($1::text[]) and v.type = any($2::text[]) and v.archived_at is null order by r.id`,
    [[...new Set(ties.map((t) => t.to))], lens],
  );
  const viewsOf = new Map<string, string[]>();
  for (const { view, item } of about) viewsOf.set(item, [...(viewsOf.get(item) ?? []), view]);
  const ids = [...new Set([...about.map((a) => a.view), ...ties.filter((t) => lens.includes(t.to_type) && !t.gone).map((t) => t.to)])];
  const { rows: kept } = await l.db.query<{ id: string; props: Props }>(`select id, props from entity where id = any($1::text[])`, [ids]);
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
  if (facts.length) await l.db.transaction((tx) => l.moved(tx, 'lens.moved', 'A view holds its own layout and settings: each style made for one view moves into it', facts));
  return { views: held.size, retired: retired.length };
}
