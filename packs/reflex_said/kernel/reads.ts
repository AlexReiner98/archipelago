// The reads of the reads API this pack answers (surface's slot surface.reads), each handed the context of the map
// that asks: said_here keeps what the agents pack says on this pack's stream; said_record reads it back with the runs'
// stories and what each instruction answers, and record.ts judges it.

import type { KernelContext } from '#pelago/kernel';
import { records, sayingFacts, sayingsOf, type Answering, type Beat } from './record.ts';

/** The stream sayings are kept on: this pack's own, kept by its rule said. */
export const STREAM = 'pack:reflex_said';
/** The most instructions one read of their record answers. */
export const MOST = 50;
/** How far back a record reads unless asked, and at most, in days. */
const DAYS = 30;
const DAYS_MOST = 90;
/** The most sayings read of one instruction. */
const SAYINGS_MOST = 2000;
/** The most runs whose stories one record reads. */
const RUNS_MOST = 500;

const strings = (v: unknown, what: string): string[] => {
  if (!Array.isArray(v) || v.some((s) => typeof s !== 'string')) throw new Error(`${what} is a list of ids`);
  return v as string[];
};
const day = (at: Date) => at.toISOString().slice(0, 10);

/** `said_here: { ids, run, where }`: each instruction said, kept as said to that run there; answered true. */
export async function said_here(ctx: KernelContext, q: { said_here: { ids: unknown; run: unknown; where: unknown } }): Promise<true> {
  const { ids, run, where } = q.said_here ?? ({} as never);
  const of = strings(ids, 'said_here.ids');
  if (typeof run !== 'string' || !run || typeof where !== 'string' || !where) throw new Error('said_here names the run it was said to and where (its for place)');
  if (of.length) await ctx.record(STREAM, sayingFacts(of, run, where));
  return true;
}

type Item = { id: string; type?: string; props?: Record<string, unknown> };
type Link = { from_id?: string; from?: string; to_id?: string; to?: string };

/** `said_record: { ids, days? }`: each instruction's record (record.ts), in the order asked. */
export async function said_record(ctx: KernelContext, q: { said_record: { ids: unknown; days?: unknown } }) {
  const ids = [...new Set(strings(q.said_record?.ids, 'said_record.ids'))];
  if (ids.length > MOST) throw new Error(`said_record reads ${MOST} instructions at most`);
  const days = Math.min(DAYS_MOST, Math.max(1, Number(q.said_record?.days ?? DAYS) || DAYS));
  const now = ctx.now();
  const range: [string, string] = [day(new Date(now.getTime() - days * 86_400_000)), day(now)];
  const entries = (await Promise.all(ids.map((id) => ctx.reads({ own_stream: { about: id, days: range, limit: SAYINGS_MOST } }) as Promise<{ at: string; facts: unknown[] }[]>))).flat();
  const sayings = sayingsOf(entries);
  const runs = [...new Set(sayings.map((s) => s.run))].slice(-RUNS_MOST);
  const ran = runs.length ? ((await ctx.reads({ ids: runs })) as Item[]) : [];
  const stories = Object.fromEntries(ran.map((r) => [r.id, (Array.isArray(r.props?.story) ? r.props!.story : []) as Beat[]]));
  // What each kept one answers: the phrases of its field misses, and where its answers links point. A preset has neither.
  const kept = ids.filter((id) => id.startsWith('e_'));
  const items = kept.length ? ((await ctx.reads({ ids: kept })) as Item[]) : [];
  const links = kept.length ? ((await ctx.reads({ links: { from: kept, types: ['answers'] } })) as Link[]) : [];
  const answering: Answering[] = items.map((it) => ({
    id: it.id,
    misses: Array.isArray(it.props?.misses) ? (it.props!.misses as unknown[]).map(String) : [],
    answers: links.filter((k) => (k.from_id ?? k.from) === it.id).map((k) => String(k.to_id ?? k.to)),
  }));
  return records(ids, sayings, stories, answering);
}

/** answer.said_record: the record of some instructions, for the view reflex_said.record. */
export const recordAnswer = (ctx: KernelContext, input: { ids: unknown; days?: unknown }) => said_record(ctx, { said_record: input });
