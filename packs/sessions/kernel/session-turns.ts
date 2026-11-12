// A run's turns as a read (docs/sessions.md, "Wired"): its events (src/session-events.ts) worked out by the core pack's
// turnsOf, newest first, with the names of the sessions that started any of them. A run's page draws them along time
// (ui/turns.js), its beats among them.

import type { Archipelago } from '../../../src/pelago.ts';
import { sessionEvents } from './session-events.ts';
import { resolveRun } from './sessions.ts';
import { VIEWS } from '../../../src/views.ts';
// @ts-expect-error: a plain module of the pack, with no types of its own.
import { turnsOf } from '../../core/sessions/turns.js';

const LIMIT = 50;
const MOST = 200;

/** A run's turns, newest first, as "A turn" has them; `more` counts the older ones left out. */
export async function turns(l: Archipelago, input: Record<string, unknown>) {
  const key = String(input.run ?? '');
  const run = key ? await resolveRun(l, key) : undefined;
  if (!run) throw new Error(`No session "${key}": give run, a run id or a session id.`);
  const limit = Math.max(1, Math.min(MOST, Math.floor(Number(input.limit ?? LIMIT)) || LIMIT));
  const all = (turnsOf(await sessionEvents(l, run.id)) as { by: string | null; from: string | null }[]).reverse();
  const shown = all.slice(0, limit);
  // A turn another session started names that run: its title and name, read by the ids, so a page says who and not an id.
  const ids = [...new Set(shown.filter((t) => t.by === 'session' && t.from).map((t) => t.from as string))];
  const { rows } = ids.length ? await l.db.query<{ id: string; title: string; name: string | null }>(`select id, title, props->>'name' as name from entity where id = any($1::text[])`, [ids]) : { rows: [] };
  return { run: { id: run.id, title: run.title, status: run.status, open: run.is_open }, turns: shown, more: all.length - shown.length, names: Object.fromEntries(rows.map((r) => [r.id, { title: r.title, ...(r.name && { name: r.name }) }])) };
}

VIEWS.turns = {
  description:
    'A session’s turns, newest first, worked out from the events its adapter sent (docs/sessions.md, "A turn"): each with who started it (by, from), the prompt’s gist, its tools by kind, files and items, tests, commits, waits, how it ended (end, question, reply) and its tokens; an open turn has no end. names gives the title and name of each session that started one; more counts the older turns left out. Params: run (required): a run id or session id; limit (50, at most 200).',
  run: turns,
};
