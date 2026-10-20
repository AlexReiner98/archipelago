// Search: items found by their words, best first, and how many there are of each type. Reads only, under the
// viewer's row level security like every read.

import type { Archipelago, Entity } from './pelago.ts';

/** The system's own records that are looked for like work: the rest (sources, notifications) are found from what they are about. */
export const FOUND_SYSTEM = ['sys.automation', 'sys.run', 'sys.connection'];

export interface SearchInput {
  q?: string;
  type?: string;
  status?: string;
  owner?: string;
  open?: boolean;
  include_archived?: boolean;
  /** false leaves out the system's own records but those looked for like work (FOUND_SYSTEM). */
  system?: boolean;
  limit?: number;
}

/** The conditions every read here shares, numbered from the first parameter. */
function filters(l: Archipelago, input: Omit<SearchInput, 'q' | 'limit'>) {
  if (input.type && !l.registry.type(input.type)) throw new Error(`Unknown type "${input.type}"`);
  const where: string[] = [];
  const params: unknown[] = [];
  const add = (sql: string, value: unknown) => {
    params.push(value);
    where.push(sql.replaceAll('?', `$${params.length}`));
  };
  if (input.type) add(`type = any(?::text[])`, l.registry.family(input.type));
  if (input.status) add(`status = ?`, input.status);
  if (input.owner) add(`owner = ?`, input.owner);
  if (input.open !== undefined) add(`is_open = ?`, input.open);
  if (input.system === false) add(`(type not like 'sys.%' or type = any(?::text[]))`, FOUND_SYSTEM);
  if (!input.include_archived) where.push(`archived_at is null`);
  return { where, params, add };
}

export async function search(l: Archipelago, input: SearchInput): Promise<Entity[]> {
  // Text is matched as typed anywhere in the title, or as the same words in
  // any form in the title or notes. Only when that finds nothing are titles
  // with a word close to what was typed taken instead: a slip of the keys
  // should find something, but "hosting" should not also bring up "posting".
  const run = async (near: boolean) => {
    const { where, params, add } = filters(l, input);
    let rank = '';
    if (input.q) {
      const TEXT = `to_tsvector('english', title || ' ' || body)`;
      add(near ? `word_similarity(?, title) > 0.5` : `(title ilike '%' || ? || '%' or ${TEXT} @@ websearch_to_tsquery('english', ?))`, input.q);
      const q = `$${params.length}`;
      // Best first: the words in the title count for more than in the notes,
      // and a title that is mostly the words asked for beats a long one that mentions them.
      const WEIGHTED = `setweight(to_tsvector('english', title), 'A') || setweight(to_tsvector('english', body), 'D')`;
      rank = `(case when title ilike '%' || ${q} || '%' then 1 else 0 end) + similarity(${q}, title) + ts_rank(${WEIGHTED}, websearch_to_tsquery('english', ${q}), 1) desc, `;
    }
    params.push(Math.min(input.limit ?? 25, 200));
    const { rows } = await l.db.query<Entity>(
      `select id, type, title, status, is_open, owner, confidence, props, updated_at from entity
       ${where.length ? 'where ' + where.join(' and ') : ''} order by ${rank}updated_at desc limit $${params.length}`,
      params,
    );
    return rows;
  };
  const rows = await run(false);
  return rows.length || !input.q ? rows : run(true);
}

/** How many items there are of each type, the most first, however many that is. */
export async function kinds(l: Archipelago, input: Omit<SearchInput, 'q' | 'limit'>): Promise<{ type: string; count: number }[]> {
  const { where, params } = filters(l, input);
  const { rows } = await l.db.query<{ type: string; count: number }>(
    `select type, count(*)::int as count from entity ${where.length ? 'where ' + where.join(' and ') : ''} group by type order by count desc, type`,
    params,
  );
  return rows;
}
