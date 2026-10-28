// Only's plain words (decision e_xe5dx55e): what must hold of a seed beyond its type, written as short words read like
// a link term, the same in the bar, the address and an agent's lens. done · blocked · status <s> · owner me|<person> ·
// no owner · over estimate · changed since <7d|date> · made since <7d|date> · by owner · by agent.
//
// Most are a condition on the item's row. Blocked is what attention means by it (src/blocking.ts: depends on
// something open, waits on someone, needs a resource unavailable or held); by owner and by agent read the authority
// the log keeps on the change that last set the item's status (docs/log.md). Those two are checked on the ids a read
// found, never over the map.

import { blockGraph } from './blocking.ts';
import type { Archipelago } from './pelago.ts';

export type Word =
  | { word: 'done' | 'blocked' | 'no owner' | 'over estimate' | 'by owner' | 'by agent' }
  | { word: 'status'; status: string }
  | { word: 'owner'; who: string }
  | { word: 'changed since' | 'made since'; since: Date };

const DAY = 86_400_000;
const PLAIN = ['done', 'blocked', 'no owner', 'over estimate', 'by owner', 'by agent'] as const;
/** The words that take something after them. */
const TAKES = /^(status|owner|changed since|made since)(?:\s+(.*))?$/i;

/** A time a word says: so many days ago (7d), or a date. */
function since(said: string, now: number): Date | null {
  const days = /^(\d+)\s*d$/i.exec(said);
  if (days) return new Date(now - Number(days[1]) * DAY);
  return /^\d{4}-\d{2}-\d{2}/.test(said) && !Number.isNaN(Date.parse(said)) ? new Date(said) : null;
}

/** An Only term read as a word; undefined when it is no word (a type, then). A word written wrong is refused. */
export function readWord(term: string, now = Date.now()): Word | undefined {
  const s = term.trim().replace(/\s+/g, ' ');
  const plain = PLAIN.find((w) => w === s.toLowerCase());
  if (plain) return { word: plain };
  const [, head, rest = ''] = TAKES.exec(s) ?? [];
  if (!head) return undefined;
  const word = head.toLowerCase() as 'status' | 'owner' | 'changed since' | 'made since';
  if (!rest.trim()) throw new Error(`filter.only: "${word}" needs what follows it (${word === 'status' ? 'status todo' : word === 'owner' ? 'owner me, or a person' : `${word} 7d, or a date`})`);
  if (word === 'status') return { word, status: rest.trim() };
  if (word === 'owner') return { word, who: rest.trim() };
  const at = since(rest.trim(), now);
  if (!at) throw new Error(`filter.only: "${s}": a time is so many days (7d) or a date (2026-10-01)`);
  return { word, since: at };
}

/** A narrowing condition on an item (as e), with its parameter when it takes one (`$?` in the condition). */
export type Narrowing = { cond: string; param?: unknown };

/** The words that are a condition on the row, each with what it reads; `me` is who is asking. */
export async function wordConditions(l: Archipelago, words: Word[], me: string | null): Promise<Narrowing[]> {
  const out: Narrowing[] = [];
  for (const w of words) {
    if (w.word === 'done') out.push({ cond: 'not e.is_open' });
    else if (w.word === 'no owner') out.push({ cond: 'e.owner is null' });
    else if (w.word === 'over estimate')
      out.push({ cond: "case when jsonb_typeof(e.props->'tokens_used') = 'number' and jsonb_typeof(e.props->'tokens_estimated') = 'number' then (e.props->>'tokens_used')::numeric > (e.props->>'tokens_estimated')::numeric else false end" });
    else if (w.word === 'status') out.push({ cond: 'e.status = $?', param: w.status });
    else if (w.word === 'changed since') out.push({ cond: 'e.updated_at >= $?::timestamptz', param: w.since.toISOString() });
    else if (w.word === 'made since') out.push({ cond: 'e.created_at >= $?::timestamptz', param: w.since.toISOString() });
    else if (w.word === 'owner') out.push({ cond: 'e.owner = any($?::text[])', param: await people(l, w.who, me) });
  }
  return out;
}

/** Who a word names: me, a person's id, or the people and agents so titled (any case), as the viewer may see them. */
async function people(l: Archipelago, who: string, me: string | null): Promise<string[]> {
  if (who.toLowerCase() === 'me') return me ? [me] : [];
  if ((await l.db.query('select 1 from entity where id = $1', [who])).rows.length) return [who];
  const { rows } = await l.db.query<{ id: string }>(`select id from entity where lower(title) = lower($1) and kind = 'actor' and archived_at is null order by id limit $2`, [who, 50]);
  return rows.map((r) => r.id);
}

/** Whether any word is checked on what a read found rather than in it: then a read finds more, for these to keep. */
export const checkedAfter = (words: Word[]) => words.some((w) => w.word === 'blocked' || w.word === 'by owner' || w.word === 'by agent');

/** Of the ids found, those the checked words hold of: blocked, as attention says it; by owner or by agent, as the log says. */
export async function holding(l: Archipelago, words: Word[], ids: string[]): Promise<string[]> {
  let kept = ids;
  if (kept.length && words.some((w) => w.word === 'blocked')) {
    const graph = await blockGraph(l, kept);
    kept = kept.filter((id) => graph.isBlocked(id));
  }
  const by = words.filter((w) => w.word === 'by owner' || w.word === 'by agent').map((w) => (w.word === 'by owner' ? 'human' : 'agent'));
  if (kept.length && by.length) {
    // The change that last set each one's status, and on whose authority (none, for the system's own).
    const { rows } = await l.db.query<{ id: string; of: string | null }>(
      `select distinct on (f.id) f.id, le.head->'authority'->>'of' as of
         from log_fact f join log_entry le on le.stream = f.stream and le.at = f.at and le.pos = f.pos
        where f.stream = 'facts' and f.id = any($1::text[]) and f.field = 'status' and f.op = '+'
        order by f.id, f.pos desc`,
      [kept],
    );
    const of = new Map(rows.map((r) => [r.id, r.of]));
    kept = kept.filter((id) => by.every((b) => of.get(id) === b));
  }
  return kept;
}
