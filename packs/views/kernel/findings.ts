// An island's findings, one row each, as an agent and a person read them alike (task e_p27ddjqt; question e_5xg2xd7q):
// the claim (its title), its value with its unit, how sure (confidence), as of when, and how many read it. A finding is
// an item of a type that promises fields to its readers (the `promised` capability); the kernel names no such type.
// Read by `brief` of an island (packs/views/kernel/brief.ts) and drawn on the island's page from that same answer (ui/findings.js).

import type { KernelContext } from '#pelago/kernel';
import type { Item, Link } from './rows.ts';

/** The link types that may cross between islands, and every type extending one: a reading (as the attention pack's moved.ts reads them). */
const readingTypes = (ctx: KernelContext): string[] => ctx.registry.relationFamily(...[...ctx.registry.relations.values()].filter((r) => r.crosses).map((r) => r.id));

/** The types whose readers are told when they move: those promising fields. */
const promisedTypes = (ctx: KernelContext): string[] => ctx.registry.having('promised');

/** Every open item of some types whose field island is this island: a page at a time, each type with its flavours. */
async function onIsland(ctx: KernelContext, island: string, kinds: string[]): Promise<(Item & { confidence: number | null })[]> {
  const found = new Set<string>();
  for (const type of kinds) {
    for (let after: string | undefined, first = true; first || after; first = false) {
      const page = (await ctx.reads({ items: { type, where: { island } }, page: after ? { after } : {} })) as { rows: Item[]; next?: string };
      for (const e of page.rows) if (kinds.includes(e.type) && e.is_open) found.add(e.id);
      after = page.next;
    }
  }
  return found.size ? ((await ctx.reads({ ids: [...found] })) as (Item & { confidence: number | null })[]) : [];
}

/** One finding as a row: what it claims, its value as said (with its unit), how sure, as of when, how many read it. */
export interface FindingRow {
  id: string;
  title: string;
  value?: string;
  confidence: number;
  as_of?: string;
  readers: number;
}

/** How many published findings a brief lists of one island, and how many working ones; what is past each is counted. */
export const FINDINGS_LIMIT = 40;
export const WORKING_LIMIT = 8;

/** Some rows of a longer list: those listed, and how many more there are. */
export interface Listed { rows: FindingRow[]; more: number }

/** A value as it is read: a yes or no for a boolean, the number or text as written, its unit after it when one is said. */
export function valueText(props: Record<string, unknown>): string | undefined {
  const v = props.value;
  if (v === undefined || v === null || v === '') return undefined;
  const said = typeof v === 'boolean' || props.value_type === 'boolean' ? (v === true || v === 'true' ? 'yes' : v === false || v === 'false' ? 'no' : String(v)) : typeof v === 'object' ? JSON.stringify(v) : String(v);
  const unit = typeof props.unit === 'string' && props.unit.trim() ? props.unit.trim() : '';
  return unit ? `${said} ${unit}` : said;
}

/**
 * The open findings that live on an island, apart: those it stands by (marked published, by the field its type's
 * `promised` names; every one of a type that marks none) and its working ones. Each most read first, then newest.
 */
export async function islandFindings(ctx: KernelContext, island: string, limit = FINDINGS_LIMIT, working = WORKING_LIMIT): Promise<{ published: Listed; working: Listed }> {
  const kinds = promisedTypes(ctx);
  if (!kinds.length) return { published: { rows: [], more: 0 }, working: { rows: [], more: 0 } };
  const rows = await onIsland(ctx, island, kinds);
  const reading = readingTypes(ctx);
  const ids = rows.map((r) => r.id);
  const counts = new Map<string, number>();
  if (ids.length && reading.length) for (const r of (await ctx.reads({ links: { to: ids, types: reading } })) as Link[]) counts.set(r.to_id, (counts.get(r.to_id) ?? 0) + 1);
  const asOf = (p: Record<string, unknown>) => (typeof p.as_of === 'string' && p.as_of ? p.as_of.slice(0, 10) : undefined);
  const stands = (r: (typeof rows)[number]) => { const mark = ctx.registry.type(r.type)?.capabilities.promised?.published; return !mark || r.props[mark] === true; };
  const row = (r: (typeof rows)[number]): FindingRow => ({ id: r.id, title: r.title, value: valueText(r.props), confidence: r.confidence ?? 1, as_of: asOf(r.props), readers: counts.get(r.id) ?? 0 });
  const when = (f: FindingRow) => f.as_of ?? '';
  const listed = (of: typeof rows, n: number): Listed => {
    const all = of.map(row).sort((a, b) => b.readers - a.readers || when(b).localeCompare(when(a)) || a.title.localeCompare(b.title));
    return { rows: all.slice(0, n), more: Math.max(0, all.length - n) };
  };
  return { published: listed(rows.filter(stands), limit), working: listed(rows.filter((r) => !stands(r)), working) };
}

/** A finding as one line of text: the claim, its value, how sure (said only when less than sure), as of when, how many read it, and its id to act on. */
export const findingLine = (f: FindingRow) =>
  `- ${f.title}${f.value !== undefined ? `: ${f.value}` : ': (no value)'}${f.confidence < 1 ? ` · sure ${f.confidence}` : ''} · ${f.as_of ? `as of ${f.as_of}` : 'no date'} · ${f.readers} read · ${f.id}`;
