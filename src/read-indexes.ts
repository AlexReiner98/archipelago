// The indexes that bound the reads a page or an agent makes at millions of items (the task "Refuse unscoped reads"):
// each read that is not from an item or a set of ids names the index it goes by, so it costs what it answers.

export const READ_INDEXES = `
create index if not exists relation_open_type on relation (type, valid_from desc) where valid_to is null;
create index if not exists entity_type_created on entity (type, created_at desc) where archived_at is null;
create index if not exists entity_updated on entity (updated_at desc) where archived_at is null;
create index if not exists entity_open_owner on entity (owner) where is_open and archived_at is null;
create index if not exists entity_type_title on entity (type, lower(title)) where archived_at is null;
create index if not exists entity_source_uri on entity ((props->>'uri')) where type = 'sys.source';
create index if not exists proposal_status on proposal (status, ts);
create index if not exists event_marks on event (seq) where action in ('changes.seen', 'questions.confirmed');
create index if not exists event_imports on event (seq) where action = 'workspace.import';
create index if not exists event_pushes on event (target_id, seq desc) where action = 'repo.push';
create index if not exists log_fact_kept on log_fact (field, id, pos desc) where field in ('pack', 'segment', 'forgotten');
`;

// Row-level security that asks of each row whether the reader may see its ends, by the key, as rows are read: the
// policies before this (src/schema.ts, migration 1) read every visible item into a set first, on every query of
// links or events, which at a million items is half a second before the query starts.
export const ROW_POLICIES = `
drop policy if exists member_relation on relation;
create policy member_relation on relation for all to pelago_member
  using (exists (select 1 from entity e where e.id = from_id) and exists (select 1 from entity e where e.id = to_id))
  with check (exists (select 1 from entity e where e.id = from_id) and exists (select 1 from entity e where e.id = to_id));
drop policy if exists member_picture on picture;
create policy member_picture on picture for all to pelago_member
  using (exists (select 1 from entity e where e.id = entity_id))
  with check (exists (select 1 from entity e where e.id = entity_id));
drop policy if exists member_event on event;
create policy member_event on event for all to pelago_member
  using ((private_to is null or private_to = current_setting('pelago.viewer', true))
         and (target_id is null or exists (select 1 from entity e where e.id = target_id)))
  with check (true);
`;

// Who holds what: the holder's title looked up for each hold, by the key. Joined instead, a planner that takes the
// open holds for many (the ended ones count in its statistics) reads every item to join them.
export const ACTIVE_HOLDS_BY_KEY = `
create or replace function pelago_active_holds(is_member boolean, viewer text)
returns table (id text, from_id text, to_id text, props jsonb, valid_from timestamptz, holder_title text)
language sql stable security definer set search_path = public as $fn$
  select h.id, h.from_id, h.to_id, h.props, h.valid_from,
         (select case when not is_member or s.private_to is null or s.private_to = viewer then s.title else 'someone''s private session' end from entity s where s.id = h.from_id)
  from relation h
  where h.type = 'holds' and h.valid_to is null
$fn$;
`;
