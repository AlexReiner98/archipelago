// The pack's clock: each hour, every open reflex is judged by its record (promote.ts) and the moves are sent as this
// pack's change, on the record's authority (decided, e_qmx3v2bx). The thresholds are the pack's settings, set on its
// card on the Packs page (workspace_set settings).

import type { KernelContext } from '#pelago/kernel';
import { movesOf, thresholdsOf } from './promote.ts';
import { MOST, said_record } from './reads.ts';
import { iso } from './misses-read.ts';

type Item = { id: string; status?: string; created_at?: string | Date; props?: Record<string, unknown> };

/** Judge the open reflexes and move those their record says: what moved. */
export async function tick(ctx: KernelContext): Promise<{ moved: number }> {
  const nodes = ((await ctx.reads({ items: { type: 'reflex', status: ['trial', 'current'] } })) as Item[]).map((i) => ({
    id: i.id,
    status: i.status ?? 'trial',
    created_at: iso(i.created_at) || ctx.now().toISOString(),
    ...(typeof i.props?.until === 'string' && { until: i.props.until }),
  }));
  if (!nodes.length) return { moved: 0 };
  const setting = (key: string) => ctx.reads({ pack_setting: `reflex_${key}` });
  const t = thresholdsOf({ promote_held: await setting('promote_held'), retire_failed: await setting('retire_failed'), retire_unsaid_days: await setting('retire_unsaid_days') });
  const records = new Map<string, Awaited<ReturnType<typeof said_record>>[number]>();
  for (let i = 0; i < nodes.length; i += MOST) {
    for (const r of await said_record(ctx, { said_record: { ids: nodes.slice(i, i + MOST).map((n) => n.id), days: Math.max(t.retire_unsaid_days, 30) } })) records.set(r.id, r);
  }
  // A move already waiting for the owner (where holds are on) is not proposed again each hour.
  const all = movesOf(nodes, records, t, ctx.now());
  const waiting = await Promise.all(all.map((m) => ctx.reads({ proposed: { op: 'update', id: m.id, status: m.status } }) as Promise<boolean>));
  const moves = all.filter((_, i) => !waiting[i]);
  if (!moves.length) return { moved: 0 };
  await ctx.change({
    ops: moves.map((m) => ({ op: 'update', id: m.id, status: m.status })),
    reason: moves.map((m) => `${m.id} ${m.status === 'current' ? 'promoted' : 'retired'}: ${m.why}`).join('; ').slice(0, 1000),
    basis: 'its record of sayings and misses (the reflex_said pack, decided e_qmx3v2bx)',
  });
  return { moved: moves.length };
}
