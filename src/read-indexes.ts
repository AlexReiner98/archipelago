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
