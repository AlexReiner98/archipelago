// Search over titles and notes, and the indexes that make it cost what it finds.
//
// Text is matched as typed anywhere in the title, or as the same words in any form in the title or notes. Only when
// that finds nothing are titles with a word close to what was typed taken instead: a slip of the keys should find
// something, but "hosting" should not also bring up "posting". Two letters swapped ("qurey") share too few trigrams
// with the word meant to be close to it, so the near match also tries what was typed with each pair side by side
// swapped back (issue e_3m3nt2e3). Only when neither finds anything is an item with any one of the words taken,
// the most words first: "stale map unpushed commits" should still find the issue that "stale" finds (issue e_vb4ykndy).

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

// Any of the words: each word of q, in the form the index keeps, looked up in the index on its own, and each item
// found counted once for every word it has. Like pelago_search_ids, it finds through the index as one that sees
// everything and gives ids (with their counts) only. Step 30 of src/migrate.ts.
export const SEARCH_ANY = `
create or replace function pelago_search_any(q text) returns table (id text, hits int)
language sql stable security definer set search_path = public as $fn$
  select e.id, count(*)::int from unnest(tsvector_to_array(to_tsvector('english', q))) w(word)
    join entity e on to_tsvector('english', e.title || ' ' || e.body) @@ quote_literal(w.word)::tsquery
  group by e.id
$fn$;
grant execute on function pelago_search_any(text) to pelago_member;
`;

/**
 * What was typed (`q`, a parameter or a column) and each way of it with two letters side by side swapped, as a table
 * of one column, when `when` holds; else only as typed. The swaps are tried in the first 64 characters.
 */
export const slipsOf = (q: string, when = 'true') =>
  `(select ${q}::text union select overlay(${q}::text placing substr(${q}::text, i + 1, 1) || substr(${q}::text, i, 1) from i for 2) from generate_series(1, least(length(${q}::text), 64) - 1) i where ${when})`;

/** The ids the search finds for `q` (a parameter): as typed, or (near) titles close to it, a slip of two letters undone. */
export const searchIds = (q: string, near: boolean) =>
  near ? `select pelago_search_ids(v, true) from ${slipsOf(q)} slips(v)` : `select pelago_search_ids(${q}, false)`;

export interface SearchInput {
  q?: string;
  type?: string;
  status?: string;
  owner?: string;
  open?: boolean;
  include_archived?: boolean;
  limit?: number;
  /** Types left out, each with the types that extend it. */
  except?: string[];
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
  // all: every word (or the text as typed in a title); near: titles close to it; any: an item with any of the words.
  const run = async (how: 'all' | 'near' | 'any') => {
    const where: string[] = [];
    const params: unknown[] = [];
    const add = (sql: string, value: unknown) => {
      params.push(value);
      where.push(sql.replaceAll('?', `$${params.length}`));
    };
    let rank = '';
    let hits = '';
    if (input.q && how === 'any') {
      params.push(input.q);
      hits = `join pelago_search_any($${params.length}) h using (id)`;
      rank = `h.hits desc, ${rankSql(`$${params.length}`)} desc, `;
    } else if (input.q) {
      add(`id in (${searchIds('?', how === 'near')})`, input.q);
      rank = `${rankSql(`$${params.length}`)} desc, `;
    }
    if (input.type) add(`type = any(?::text[])`, family(input.type));
    if (input.except?.length) add(`not (type = any(?::text[]))`, input.except.flatMap(family));
    if (input.status) add(`status = ?`, input.status);
    if (input.owner) add(`owner = ?`, input.owner);
    if (input.open !== undefined) add(`is_open = ?`, input.open);
    if (!input.include_archived) where.push(`archived_at is null`);
    params.push(Math.min(input.limit ?? 25, 200));
    const { rows } = await db.query<Entity>(
      `select id, type, title, status, is_open, owner, confidence, props, updated_at from entity ${hits}
       ${where.length ? 'where ' + where.join(' and ') : ''} order by ${rank}updated_at desc limit $${params.length}`,
      params,
    );
    return rows;
  };
  if (!input.q) return run('all');
  for (const how of ['all', 'near'] as const) {
    const rows = await run(how);
    if (rows.length) return rows;
  }
  return run('any');
}
