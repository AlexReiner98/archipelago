// What agents settled that the owner has not confirmed: put to the owner by the next session they talk to.

import type { Archipelago } from './pelago.ts';
import { openSaid } from './seal.ts';

/**
 * Questions agents have settled since the owner last looked, or last answered
 * for them: each decision or hypothesis an agent closed, with what was chosen
 * and on what it rests. The owner mostly meets the map through an agent in
 * chat, so this is what the next session shows them, in one list, in place of
 * a notification for each.
 */
export async function toConfirm(l: Archipelago, input: { limit?: number } = {}) {
  const { rows: marks } = await l.db.query<{ upto: number | null }>(`select max((detail->>'upto')::int) as upto from event where action in ('changes.seen', 'questions.confirmed')`);
  const since = marks[0]?.upto ?? 0;
  const { rows } = await l.db.query<{ id: string; type: string; title: string; status: string; outcome: string | null; seq: number; ts: Date; actor: string; changeset: string; authority: { of?: string; basis?: unknown } | null }>(
    // Read from the log: each status an agent set, on its own say or a human's word it reported, that the item still has.
    `select distinct on (e.id) e.id, e.type, e.title, e.status, e.props->>'outcome' as outcome, f.seq::int as seq, le.at as ts, le.head->'actor'->>'id' as actor, le.head->'authority' as authority, le.id as changeset
     from log_fact f join log_entry le on le.stream = f.stream and le.at = f.at and le.pos = f.pos join entity e on e.id = f.id
     where f.stream = 'facts' and f.seq > $1 and f.field = 'status' and f.op = '+' and le.head->'actor'->>'id' not like 'human:%' and coalesce(le.head->'authority'->>'who', '') not like 'human:%'
       and e.type = any($2::text[]) and not e.is_open and e.archived_at is null and f.value = to_jsonb(e.status)
     order by e.id, f.seq desc`,
    [since, l.registry.having('settles')],
  );
  // The basis is the change set's words, sealed in the log with its key (src/seal.ts).
  const bases = await openSaid(l.db, rows.map((r, i) => ({ id: r.changeset, field: 'basis', value: r.authority?.basis, i })));
  for (const b of bases) if (b.value !== undefined) rows[b.i].authority = { ...rows[b.i].authority, basis: b.value };
  // What an agent settled on its own judgment is what the owner has not seen; what it settled on their word they
  // chose themselves, in chat. The first are listed first, and counted apart.
  const own = (q: { authority: { of?: string } | null }) => q.authority?.of !== 'human';
  const newest = rows.sort((a, b) => Number(own(b)) - Number(own(a)) || b.seq - a.seq);
  const short = (s: string | undefined) => (s && s.length > 240 ? `${s.slice(0, 240)}…` : s);
  return {
    count: newest.length,
    on_agents_judgment: newest.filter(own).length,
    on_owners_word: newest.filter((q) => !own(q)).length,
    upto: newest.reduce((max, q) => Math.max(max, q.seq), since),
    questions: newest.slice(0, input.limit ?? 40).map((q) => ({
      id: q.id,
      title: q.title,
      answer: q.outcome ?? q.status,
      settled: q.ts,
      seq: q.seq,
      by: q.actor,
      on: own(q) ? 'the agent\u2019s own judgment' : 'the owner\u2019s word, as the agent reports it',
      basis: short(q.authority?.basis as string | undefined),
    })),
    how: 'Show the owner, in your reply, a line for each question settled on an agent\u2019s own judgment, and ask them to confirm or correct; of those recorded on their own word, say how many there are and list them only if asked. When they have answered, call settle with action confirmed, its upto and what they said; change or reopen whatever they correct, on their authority.',
  };
}
