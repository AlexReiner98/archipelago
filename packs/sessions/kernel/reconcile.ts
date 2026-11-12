// What a session has left unsaid when it ends (report, action session_end): the open work it has to change, vouch
// for, or say it cannot tell about. Kept beside what asks it (packs/sessions/kernel/sessions.ts).

import type { KernelContext } from '#pelago/kernel';
import { placesOf } from './places.ts';
import { touchedBy } from './touched.ts';
import type { Item as Run } from './types.ts';

export type Item = { id: string; type: string; title: string; status: string; touched?: true };

/**
 * What a session has left unsaid: the open work of the repository it ran in,
 * and what it touched itself (packs/sessions/kernel/touched.ts) wherever that is, that nobody
 * has changed since it began. A session that settled something says so by
 * changing it; what it leaves as it found it, it has to vouch for, or say it
 * could not tell. What it touched comes first, marked touched: it looked at
 * those. What waits on a person's answer is not asked about: no work in the
 * repository settles it. Nor is what has a change waiting for the human: what
 * was found has been said, and is theirs to confirm.
 */
export async function unreconciled(ctx: KernelContext, run: Pick<Run, 'id' | 'created_at'>): Promise<Item[]> {
  const [repos, mine] = await Promise.all([placesOf(ctx, run.id), touchedBy(ctx, run.id)]);
  if (!repos.length && !mine.length) return [];
  const scope = [...(repos.length ? ((await ctx.reads({ within: { id: repos[0], open: true } })) as string[]) : []), ...mine];
  const types = [...ctx.registry.types.values()].filter((t) => t.fields.tokens_estimated || t.capabilities.settles).map((t) => t.id);
  const work = (await ctx.reads({ open_work: { ids: scope, types } })) as Item[];
  const blocked = work.length ? ((await ctx.reads({ blocked: work.map((i) => i.id) })) as Record<string, { waits_on_someone: boolean }>) : {};
  const proposed = new Set((await ctx.reads({ pending_ids: true })) as string[]);
  const open = work.filter((i) => !blocked[i.id]?.waits_on_someone && !proposed.has(i.id));
  const untouched = new Set((await ctx.reads({ untouched: { ids: open.map((i) => i.id), at: new Date(run.created_at).toISOString() } })) as string[]);
  const left = open.filter((i) => untouched.has(i.id)).map(({ id, type, title, status }): Item => ({ id, type, title, status, ...(mine.includes(id) && { touched: true as const }) }));
  return [...left.filter((i) => i.touched), ...left.filter((i) => !i.touched)];
}
