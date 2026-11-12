// What a reader relies on has moved: an item reads another by a link of a type that crosses (core's reads, of a
// finding), the item read is of a type that promises some of its fields (the `promised` capability), and one of
// those fields changed after the reader last changed or checked itself, and after the reading began. Read from the
// log and the links alone: nothing runs when a finding moves, and the reason goes once the reader is changed or said
// still true (an update of only its id). The values are the finding's own, before the reader's last word and now.

import type { KernelContext } from '#pelago/kernel';
import { byId, type Item, type Link } from './rows.ts';

/** One moved reading: the item read, each promised field that moved (from what to what), and when it last moved. */
export interface Moved {
  finding: string;
  title: string;
  moved: { field: string; from: unknown; to: unknown }[];
  on: string;
}

type Reg = Pick<KernelContext, 'registry'>;

/** The link types that may cross between islands, and every type extending one: a reading. */
export function readingTypes(ctx: Reg): string[] {
  const reg = ctx.registry;
  return reg.relationFamily(...[...reg.relations.values()].filter((r) => r.crosses).map((r) => r.id));
}

/** The types whose readers are told when they move: those promising fields. */
export function promisedTypes(ctx: Reg): string[] {
  return ctx.registry.having('promised');
}

/** Of these items, the readings that have moved since each reader last changed or checked itself. */
export async function movedReadings(ctx: KernelContext, readers: string[]): Promise<Map<string, Moved[]>> {
  const out = new Map<string, Moved[]>();
  const kinds = readingTypes(ctx);
  const promised = promisedTypes(ctx);
  if (!readers.length || !kinds.length || !promised.length) return out;
  const reading = (await ctx.reads({ links: { from: readers, types: kinds } })) as Link[];
  const read = await byId(ctx, [...new Set(reading.map((r) => r.to_id))]);
  const links = reading.flatMap((r) => {
    const e = read.get(r.to_id);
    return e && promised.includes(e.type) && !e.archived_at ? [{ id: r.id, from_id: r.from_id, to_id: r.to_id, type: e.type, title: e.title }] : [];
  });
  if (!links.length) return out;
  // Where each reading began, and each reader's last word: positions in the log, so the order is the log's.
  const last = (await ctx.reads({ history: { ids: [...new Set(links.map((k) => k.from_id)), ...links.map((k) => k.id)], last: true } })) as { id: string; pos: number }[];
  const at = new Map(last.map((r) => [r.id, r.pos]));
  const fieldsOf = (type: string) => ctx.registry.type(type)?.capabilities.promised?.fields ?? [];
  const fields = [...new Set(links.flatMap((k) => fieldsOf(k.type)))];
  const facts = (await ctx.reads({ history: { ids: [...new Set(links.map((k) => k.to_id))], fields } })) as { id: string; field: string; value: unknown; op: string; pos: number; at: Date }[];
  for (const k of links) {
    const since = Math.max(at.get(k.from_id) ?? 0, at.get(k.id) ?? 0);
    const mine = facts.filter((f) => f.id === k.to_id);
    const moved: Moved['moved'] = [];
    let on: Date | undefined;
    for (const field of fieldsOf(k.type)) {
      const of = mine.filter((f) => f.field === field);
      const after = of.filter((f) => f.pos > since);
      if (!after.length) continue;
      const valueOf = (f: (typeof of)[number] | undefined) => (f && f.op === '+' ? f.value : null);
      const from = valueOf(of.filter((f) => f.pos <= since).at(-1));
      const to = valueOf(after.at(-1));
      if (JSON.stringify(from) === JSON.stringify(to)) continue;
      moved.push({ field, from, to });
      const when = new Date(after.at(-1)!.at);
      if (!on || when > on) on = when;
    }
    if (!moved.length) continue;
    out.set(k.from_id, [...(out.get(k.from_id) ?? []), { finding: k.to_id, title: k.title, moved, on: on!.toISOString() }]);
  }
  return out;
}

/** The open items that read a promised item: a person's (owned by them, or by nobody when they are the owner), or everyone's. */
export async function readersOf(ctx: KernelContext, me?: string, isOwner = false): Promise<string[]> {
  const kinds = readingTypes(ctx);
  const promised = promisedTypes(ctx);
  if (!kinds.length || !promised.length) return [];
  const links = (await ctx.reads({ links: { types: kinds } })) as Link[];
  const ends = await byId(ctx, [...new Set(links.flatMap((r) => [r.from_id, r.to_id]))]);
  const theirs = (e: Item) => me == null || e.owner === me || (isOwner && e.owner === null);
  return [...new Set(links.flatMap((r) => {
    const [e, f] = [ends.get(r.from_id), ends.get(r.to_id)];
    return e && f && promised.includes(f.type) && e.is_open && !e.archived_at && theirs(e) ? [r.from_id] : [];
  }))];
}

/** The query term `moved`: every open item whose reading has moved, as the viewer may see them. */
export async function movedIds(ctx: KernelContext): Promise<string[]> {
  return [...(await movedReadings(ctx, await readersOf(ctx))).keys()];
}
