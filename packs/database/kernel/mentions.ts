// What names an item in its text or fields: the table step 25 made (packs/database/kernel/migrate.ts), kept here as it was released,
// since a step is never edited and the schema's name is a hash of the steps' SQL. The rows are the mentions pack's,
// projected as each entry is appended (log.project, packs/mentions/kernel/mentions.ts) and made again whole after a
// restore, a merge or a rebuild's swap by the log root re-running its projectors (projectAgain, packs/log/kernel/log-project.ts).
// The function step 25 made, pelago_mentioned, is kept for the app before: nothing here calls it.

/** An item's id as it is written in a note: e_ and eight letters or digits (packs/database/kernel/db.ts newId). */
const ID = `'[[:<:]](e_[a-z0-9]{8})[[:>:]]'`;
const FROM = (where: string) => `insert into mention (from_id, to_id)
  select distinct e.id, m[1] from entity e, regexp_matches(coalesce(e.body, '') || ' ' || e.props::text, ${ID}, 'g') m where ${where} and m[1] <> e.id
  on conflict do nothing`;

// Written as the one who made the change, it is a function that reads that one item whole and does nothing else.
export const MENTIONS = `
create table if not exists mention (from_id text not null, to_id text not null, primary key (to_id, from_id));
create index if not exists mention_from on mention (from_id);
grant select on mention to pelago_member;
create or replace function pelago_mentioned(i text) returns void
language plpgsql security definer set search_path = public as $fn$
begin
  delete from mention where from_id = i;
  ${FROM('e.id = i')};
end $fn$;
grant execute on function pelago_mentioned(text) to pelago_member;
${FROM('true')};
`;
