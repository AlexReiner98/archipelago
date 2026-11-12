// An agent reuses a view rather than make it twice (task e_av382ad4): a new view with the name or the query of one
// already kept, about the same items (or, about nothing, the workspace's), is refused, naming the one there to open or
// change. Read across the whole change, since a view's about links come in it beside the view.

import type { KernelContext } from '#pelago/kernel';
import { everyItem } from './query-kept.ts';

type Props = Record<string, unknown>;
type Op = { op: string; ref?: string; type?: unknown; title?: unknown; props?: Props; from?: unknown; to?: unknown };

/** A value as text, its keys in order: the map keeps an object's keys in an order of its own. */
const canonical = (v: unknown): string =>
  Array.isArray(v) ? `[${v.map(canonical).join(',')}]` : v && typeof v === 'object' ? `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${canonical((v as Props)[k])}`).join(',')}}` : JSON.stringify(v ?? null);

/** What a view is the same by: its query, as flat reads it. */
const query = (p: Props) => canonical({ filter: p.filter, walk: p.walk, view: p.view, time: p.time });

/** The views each view an agent makes in these ops is one of already: the same name or query, about the same items. */
export async function twinsOf(ctx: KernelContext, ops: Op[]): Promise<string[]> {
  const types = ctx.registry.family('lens');
  const made = ops.filter((o): o is Op & { title: string } => o.op === 'create' && types.includes(String(o.type)) && typeof o.title === 'string');
  if (!made.length) return [];
  const refs = new Set(ops.flatMap((o) => (o.op === 'create' && o.ref ? [o.ref] : [])));
  const aboutOf = (key: string | undefined) => ops.filter((o) => o.op === 'link' && o.type === 'about' && key !== undefined && o.from === key).map((o) => String(o.to));
  // The open views kept that could be one: the same name, or a query of their own.
  const titles = made.map((o) => o.title.trim().toLowerCase());
  const rows = (await everyItem(ctx, 'lens')).filter((r) => r.is_open && (titles.includes(r.title.toLowerCase()) || 'filter' in (r.props ?? {}) || 'view' in (r.props ?? {})));
  if (!rows.length) return [];
  const links = (await ctx.reads({ links: { from: rows.map((r) => r.id), types: ['about'] } })) as { from_id: string; to_id: string }[];
  const same = (a: string[], b: string[]) => a.length === b.length && a.every((x) => b.includes(x));
  const twins: string[] = [];
  for (const op of made) {
    const about = aboutOf(op.ref);
    // About an item this change makes, it can have no twin yet.
    if (about.some((to) => refs.has(to))) continue;
    const mine = query((op.props ?? {}) as Props);
    const twin = rows.find((r) => same(links.filter((x) => x.from_id === r.id).map((x) => x.to_id), about) && (r.title.trim().toLowerCase() === op.title.trim().toLowerCase() || query(r.props ?? {}) === mine));
    if (twin) twins.push(`"${op.title}": "${twin.title}" (${twin.id}) is that view already, ${about.length ? 'about the same item' : 'of the workspace'}: open it with report show, or change it, rather than make it twice.`);
  }
  return twins;
}

/** Refuse each view an agent makes that is one there already: the same name or query, about the same items. */
export async function noTwins(ctx: KernelContext, ops: Op[]): Promise<void> {
  const twins = await twinsOf(ctx, ops);
  if (twins.length) throw new Error(`Change rejected:\n${twins.map((t) => `- ${t}`).join('\n')}`);
}
