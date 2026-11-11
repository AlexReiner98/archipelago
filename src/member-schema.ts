// The member table's later steps (src/migrate.ts). A member who only reads (the owner, 10-11 Nov 2026, decision
// e_nwdn7ce6) sees what any member sees, and their requests run in a read-only transaction (src/db.ts scoped), so the
// database refuses every write of theirs whatever the page draws. Guests, who read one shared view through a reader
// role and a reach table, went the same day: none was ever given out.

/**
 * Step 36, as a new database makes it now: the vault's keys under a row policy, a member reading and adding every
 * one. The step also made guests (a reader role, its policies, `reach`, and a function for their feed of the log);
 * step 43 takes those away where it ran whole.
 */
export const VAULT_KEY_POLICY = `
alter table vault_key enable row level security;
drop policy if exists member_vault_key on vault_key;
create policy member_vault_key on vault_key for all to pelago_member using (true) with check (true);
`;

/** Step 42: a member may be one who only reads. */
export const MEMBER_READ_ONLY = `alter table member add column if not exists read_only boolean not null default false;`;

/** Step 43: guests gone. Their shares and memberships first, then what let them read. Safe to run again. */
export const GUESTS_GONE = `
do $step$ begin
  if exists (select 1 from information_schema.columns where table_name = 'share' and column_name = 'guest') then
    delete from share where guest is not null;
  end if;
  if exists (select 1 from information_schema.columns where table_name = 'member' and column_name = 'reads') then
    delete from member where reads is not null;
  end if;
end $step$;
alter table share drop column if exists guest;
alter table member drop column if exists reads;
drop function if exists pelago_reader_facts(bigint, int);
drop function if exists pelago_reader_head();
drop policy if exists reader_entity on entity;
drop policy if exists reader_relation on relation;
drop policy if exists reader_picture on picture;
drop policy if exists reader_setting on setting;
drop policy if exists reader_vault_key on vault_key;
drop table if exists reach;
-- The role is the server's, not one database's: on a server where another workspace still grants it something, it
-- stays, granted nothing here, until the last of them has taken this step.
do $step$ begin
  if exists (select 1 from pg_roles where rolname = 'pelago_reader') then
    revoke all on entity, relation, picture, type_def, setting, vault_key from pelago_reader;
    begin
      drop role pelago_reader;
    exception when others then null;
    end;
  end if;
end $step$;
`;
