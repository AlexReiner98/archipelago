// How often each reply rule asked lately, for the owner's settings page (./workspace-tools.ts): read as the whole
// workspace from the beats the sessions kept on their runs. It was the sessions pack's (src/replies.ts); a read of the
// whole workspace is a root's.

import type { Q } from '../../../src/db.ts';
import type { Archipelago } from '../../../src/pelago.ts';

/** How far back a rule's askings are counted for the owner: a week. */
const LATELY_MS = 7 * 86_400_000;
/** The newest sessions whose stories are read for them: one that asked this week is among these. */
const RUNS_READ = 500;

/** How often each reply rule asked in the last week, by pack.id, read from the steps the sessions kept (the workspace's settings page, as the whole workspace: it was src/replies.ts's). */
export async function askedLately(whole: Q, l: Pick<Archipelago, 'registry'>): Promise<Map<string, number>> {
  const { rows } = await whole.query<{ rule: string; n: number }>(
    `select b->>'asked' as rule, count(*)::int as n
     from (select props from entity where type = any($1::text[]) and archived_at is null order by created_at desc limit ${RUNS_READ}) e
     cross join lateral jsonb_array_elements(case when jsonb_typeof(e.props->'story') = 'array' then e.props->'story' else '[]'::jsonb end) b
     where b ? 'asked' and b->>'at' > $2 group by 1`,
    [l.registry.family('run'), new Date(Date.now() - LATELY_MS).toISOString()],
  );
  return new Map(rows.map((r) => [r.rule, r.n]));
}
