// Search over titles and notes, and the indexes that make it cost what it finds.
//
// Text is matched as typed anywhere in the title, or as the same words in any form in the title or notes. Only when
// that finds nothing are titles with a word close to what was typed taken instead: a slip of the keys should find
// something, but "hosting" should not also bring up "posting".

import type { Q } from './db.ts';
import type { Entity } from './pelago.ts';

// The words of a title and its note, kept in an index on the very expression search matches with, so the index finds
// exactly what reading every row found; and the trigrams of every title, for a match anywhere in it and for the
// near-misses. Each is written as rows are, not kept in a pending list for vacuum to sort in: PGlite has no
// autovacuum, and a restored map's search read the whole list on every call (300 ms on the live copy, not 25).
//
// Row-level security keeps an index from being used for a test the database cannot prove leaks nothing (`@@`,
// `ilike`, `<%`), so a person's search read every row. The function below finds the ids through the indexes as one
// that sees everything; the query that calls it reads the items as its viewer, so it answers only with what they may
// see. It gives ids only.
export const SEARCH_INDEX = `
create index if not exists entity_text on entity using gin (to_tsvector('english', title || ' ' || body)) with (fastupdate = off);
create index if not exists entity_title_trigrams on entity using gin (title gin_trgm_ops) with (fastupdate = off);
create or replace function pelago_search_ids(q text, near boolean) returns setof text
language plpgsql stable security definer set search_path = public set pg_trgm.word_similarity_threshold = 0.5 as $fn$
begin
  if near then
    return query select e.id from entity e where q <% e.title and word_similarity(q, e.title) > 0.5;
  else
    return query select e.id from entity e
      where e.title ilike '%' || q || '%' or to_tsvector('english', e.title || ' ' || e.body) @@ websearch_to_tsquery('english', q);
  end if;
end $fn$;
grant execute on function pelago_search_ids(text, boolean) to pelago_member;
`;

export interface SearchInput {
  q?: string;
  type?: string;
  status?: string;
  owner?: string;
  open?: boolean;
  include_archived?: boolean;
  limit?: number;
}

/** How well an item (its columns unqualified, or as `e.`) matches the words in parameter `q`, the best highest: the
 * words as typed in the title, a title that is mostly the words asked for, the words in any form in the title. What
 * matches in its note alone comes after, by how near its title is, then the newest. The note is not ranked: parsing every note that matches
 * cost 1.7 s for a phrase found in 8,000 items of a 416,000-item map, and the title alone 0.12 s. The flat lens's text
 * term orders what it finds by the same. */
export const rankSql = (q: string, e = '') =>
  `(case when ${e}title ilike '%' || ${q} || '%' then 1 else 0 end) + similarity(${q}, ${e}title) + ts_rank(to_tsvector('english', ${e}title), websearch_to_tsquery('english', ${q}), 1)`;

/** Items matching the input, best match first. `family` gives a type and the types that extend it. */
export async function search(db: Q, family: (type: string) => string[], input: SearchInput) {
  const run = async (near: boolean) => {
    const where: string[] = [];
    const params: unknown[] = [];
    const add = (sql: string, value: unknown) => {
      params.push(value);
      where.push(sql.replaceAll('?', `$${params.length}`));
    };
    let rank = '';
    if (input.q) {
      add(`id in (select pelago_search_ids(?, ${near}))`, input.q);
      rank = `${rankSql(`$${params.length}`)} desc, `;
    }
    if (input.type) add(`type = any(?::text[])`, family(input.type));
    if (input.status) add(`status = ?`, input.status);
    if (input.owner) add(`owner = ?`, input.owner);
    if (input.open !== undefined) add(`is_open = ?`, input.open);
    if (!input.include_archived) where.push(`archived_at is null`);
    params.push(Math.min(input.limit ?? 25, 200));
    const { rows } = await db.query<Entity>(
      `select id, type, title, status, is_open, owner, confidence, props, updated_at from entity
       ${where.length ? 'where ' + where.join(' and ') : ''} order by ${rank}updated_at desc limit $${params.length}`,
      params,
    );
    return rows;
  };
  const rows = await run(false);
  return rows.length || !input.q ? rows : run(true);
}
