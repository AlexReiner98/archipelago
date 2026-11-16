// Step 50: where a read of the work stands, as the table's owner (task e_unbw4gtp). A kept answer (packs/loader/kernel/kept.ts)
// is asked again once anything it may depend on moves: the sessions' and claims' streams, the settings and what each
// session touched (packs/log/kernel/position.ts, `work`). A reader may see few of those rows, and none of the transient
// store, yet the answer moves with all of them; so they are counted here past the row policies, and only counted: the
// heads of two streams and two hashes, which say that something moved, never what. It crosses the privacy line by
// a function of its own, narrow, as CLAUDE.md asks, rather than by reading the whole map.

export const WORK_STANDS = `
create or replace function pelago_work_stands() returns text language sql stable security definer set search_path = public as $fn$
  select concat_ws(':',
    coalesce((select max(pos)::text from log_op where stream = 'sessions'), '0'), -- index log_op_pos
    coalesce((select max(pos)::text from log_op where stream = 'claims'), '0'), -- index log_op_pos
    left((select md5(coalesce(string_agg(key || '=' || value::text, ',' order by key), '')) from setting), 12),
    left((select md5(coalesce(string_agg(key || '@' || until::text, ',' order by key), '')) from transient where key like 'touched:%'), 12))
$fn$;
revoke execute on function pelago_work_stands() from public;
grant execute on function pelago_work_stands() to pelago_member;
`;
