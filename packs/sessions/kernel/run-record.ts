// A run that happened where Archipelago cannot watch it, told once it is over (report, action run_report).

import { bookkeep } from './bookkeeping.ts';
import { livesInFor, placeFor } from '../../../src/places.ts';
import { actorId, type Actor, type Archipelago } from '../../../src/pelago.ts';
import type { StartedBy } from '../../../src/launcher.ts';

/**
 * A run that happened where Archipelago cannot watch it (the agent in GitHub
 * Actions that reads a push, or re-checks the map) says so once it is over:
 * what it was, how it ended and what it used. It is kept as a run that has
 * ended, in the repository it ran for. Told twice of the same run (its link
 * is the same), it is recorded once.
 */
export async function recordRun(
  l: Archipelago,
  actor: Actor,
  input: { repo: string; title: string; ok?: boolean; tokens?: number; cost_usd?: number; turns?: number; link?: string; summary?: string; surface?: string; started_by?: StartedBy },
) {
  const repo = /^e_[a-z0-9]{8}$/.test(input.repo) ? await l.entity(input.repo) : await placeFor(l, { remote: input.repo });
  if (!repo) throw new Error(`No repository "${input.repo}" in the map`);
  if (input.link) {
    const { rows } = await l.db.query<{ id: string }>(`select id from entity where type = any($1::text[]) and props->>'link' = $2 and title = $3 and archived_at is null limit 1`, [l.registry.family('run'), input.link, input.title]);
    if (rows.length) return { run: rows[0].id, recorded: false };
  }
  const number = (n: unknown) => (typeof n === 'number' && Number.isFinite(n) && n >= 0 ? n : undefined);
  const props: Record<string, unknown> = { surface: input.surface ?? 'github-actions', last_seen: new Date().toISOString() };
  if (number(input.tokens) !== undefined) props.tokens_used = Math.round(input.tokens!);
  if (number(input.cost_usd) !== undefined) props.cost_usd = Math.round(input.cost_usd! * 10_000) / 10_000;
  if (number(input.turns) !== undefined) props.turns = input.turns;
  if (input.link) props.link = input.link; if (input.started_by) props.started_by = input.started_by;
  const { created } = await bookkeep(l, actorId(actor), {
    ops: [
      { op: 'create', ref: 'run', type: 'run', title: input.title, status: input.ok === false ? 'failed' : 'finished', body: input.summary?.slice(0, 4000), props },
      { op: 'link', type: livesInFor(l, repo.type), from: 'run', to: repo.id },
    ],
    reason: 'Run reported',
  });
  return { run: created.run, recorded: true };
}
