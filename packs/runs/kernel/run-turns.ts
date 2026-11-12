// A run's turns as a read (docs/sessions.md, "Wired"): its events (the sessions stream) worked out by the core pack's
// turnsOf, newest first, with the names of the sessions that started any of them. A run's page draws them along time
// (ui/turns.js), its beats among them. The sessions pack names it as its view `turns`.

import type { KernelContext } from '#pelago/kernel';
import type { SessionEvent } from './session-state.ts';
// @ts-expect-error: a plain module of the pack, with no types of its own.
import { turnsOf } from './turns.js';

const LIMIT = 50;
const MOST = 200;

/** A run as its turns read it. */
type Run = { id: string; title: string; status: string; is_open: boolean; created_at: Date };

/** A run's turns, newest first, as "A turn" has them; `more` counts the older ones left out. */
export async function turns(ctx: KernelContext, input: Record<string, unknown>) {
  const key = String(input.run ?? '');
  // A run by its id, or by the session id its surface named it with.
  const run = key ? (((await ctx.reads({ run_of: { key } })) as Run | null) ?? undefined) : undefined;
  if (!run) throw new Error(`No session "${key}": give run, a run id or a session id.`);
  const limit = Math.max(1, Math.min(MOST, Math.floor(Number(input.limit ?? LIMIT)) || LIMIT));
  const events = ((await ctx.reads({ run_events: { runs: [run.id], since: new Date(run.created_at).toISOString() } })) as Record<string, SessionEvent[]>)[run.id] ?? [];
  const all = (turnsOf(events) as { by: string | null; from: string | null }[]).reverse();
  const shown = all.slice(0, limit);
  // A turn another session started names that run: its title and name, read by the ids, so a page says who and not an id.
  const ids = [...new Set(shown.filter((t) => t.by === 'session' && t.from).map((t) => t.from as string))];
  const rows = ids.length ? ((await ctx.reads({ run_names: ids })) as { id: string; title: string; name: string | null }[]) : [];
  return { run: { id: run.id, title: run.title, status: run.status, open: run.is_open }, turns: shown, more: all.length - shown.length, names: Object.fromEntries(rows.map((r) => [r.id, { title: r.title, ...(r.name && { name: r.name }) }])) };
}
