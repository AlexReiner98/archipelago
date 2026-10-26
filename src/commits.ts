// The commits a session made, and which of them the map does not yet account for. A commit is accounted for once the
// map holds the record a rule on a reply's end names (its record: a type, and the field holding the commit's full
// sha), as the check on the main branch reads it. The session's hook reads its commits from its transcript (what git
// answered each commit with, and the checkout's HEAD log while it ran) and says them at each turn's end; the server keeps them with the run, in the transient
// store (src/transient.ts), as it keeps what the run touched (src/touched.ts), so report, action session_end, lists
// those still unaccounted for.

import type { Q } from './db.ts';
import { wholeMap } from './outbox.ts';
import type { Archipelago, Op } from './pelago.ts';
import { onReply } from './reply-rules.ts';
import { keep, kept } from './transient.ts';
import { TOUCHED_MS } from './touched.ts';

/** The most commits a run's list holds: past it, the first are let go. */
const COMMITS_KEPT = 200;
const SHA = /^[0-9a-f]{40}$/;
const key = (run: string) => `commits:${run}`;

/** Full shas, and nothing else, from what a hook said. */
export const shas = (said: unknown): string[] => (Array.isArray(said) ? [...new Set(said.filter((v): v is string => typeof v === 'string' && SHA.test(v)))] : []);

/** Add the commits the hook says a run made to its list, kept as long as what it touched. */
export async function addCommits(db: Q, run: string, said: unknown): Promise<void> {
  const made = shas(said);
  if (!made.length) return;
  const had = (await kept<string[]>(db, key(run))) ?? [];
  await keep(db, key(run), [...new Set([...had, ...made])].slice(-COMMITS_KEPT), TOUCHED_MS);
}

/** What accounts for a commit here: the record the first rule on a reply's end names, its type with its flavours. */
export function commitRecord(l: Archipelago): { types: string[]; field: string; accounted?: string } | undefined {
  const record = l.registry.rules.find((r) => onReply(r) && r.record)?.record;
  const type = record && l.registry.type(record.type);
  return type ? { types: l.registry.family(record.type), field: record.field, accounted: type.capabilities.accounts?.accounted } : undefined;
}

/**
 * Those of these commits no record accounts for, in their order; none when nothing here says what accounts for one.
 * A record waiting for the owner counts: the session has said it, and the check on main waits for it to apply.
 */
export async function unaccounted(l: Archipelago, commits: string[]): Promise<string[]> {
  const record = commitRecord(l);
  if (!record || !commits.length) return [];
  // A record only heard of from a push (its accounted field false) accounts for nothing yet, made or proposed.
  const flag = record.accounted ?? null;
  const { rows } = await l.db.query<{ sha: string }>(
    `select props ->> $2 as sha from entity where type = any($1::text[]) and archived_at is null and props ->> $2 = any($3::text[]) and ($4::text is null or coalesce(props ->> $4, 'true') <> 'false') -- index entity_type`,
    [record.types, record.field, commits, flag],
  );
  const { rows: held } = await l.db.query<{ ops: Op[] }>(`select ops from proposal where status = 'pending' -- index proposal_status`);
  const proposed = held.flatMap((p) => p.ops.flatMap((o) => (o.op === 'create' && record.types.includes(o.type) && !(flag && o.props?.[flag] === false) ? [o.props?.[record.field]] : [])));
  const found = new Set([...rows.map((r) => r.sha), ...proposed]);
  return commits.filter((c) => !found.has(c));
}

/** A run's commits that no record accounts for yet. */
export async function unaccountedBy(l: Archipelago, run: string): Promise<string[]> {
  return unaccounted(l, (await kept<string[]>((await wholeMap(l)).db, key(run))) ?? []);
}
