// The schema steps of the activity log (src/migrate.ts), apart from the code that reads it, so the steps import
// nothing: the log read from the fact stream (19), the activity from before the log gone (27), and every entry of the
// compacted streams numbered in the same order (33). A released step is never edited.

/** The actions a change set's events can have. */
export const FACT_ACTIONS = ['entity.create', 'entity.update', 'entity.archive', 'entity.restore', 'entity.merge', 'relation.link', 'relation.unlink', 'type.define'];

/**
 * Step 19. Each fact numbered from the event table's sequence, so the activity log is in one order across both;
 * found by that number, by what a link starts from and what an item was merged into, and its entries by their time. The number is not hashed: it is
 * where the row sits in this database, not part of what was said.
 */
export const ACTIVITY = `
alter table log_fact add column if not exists seq bigint default nextval('event_seq_seq');
create index if not exists log_fact_seq on log_fact(seq);
create index if not exists log_fact_link_from on log_fact((value->>1)) where field = 'link';
create index if not exists log_fact_merged_into on log_fact(value) where field = 'merged_into';
create index if not exists log_entry_at on log_entry(at);
`;

/**
 * Step 27. The activity from before the log began, gone: what change sets did is read from the log, and the event
 * rows a map wrote of them before it had one were history of a legacy state that no read needs (the owner, 29 Oct
 * 2026, question e_cgctyctz). They were two thirds of each backup. Only rows numbered before the log's first fact go;
 * a merged backup's change sets, brought in since as events, stay.
 */
export const PRE_LOG_ACTIVITY = `
delete from event ev
 where ev.action in (${FACT_ACTIONS.map((a) => `'${a}'`).join(', ')})
   and ev.seq < (select coalesce(min(f.seq), 0) from log_fact f) -- index log_fact_seq
;
`;

/**
 * Step 33. Every entry of log_op numbered from the activity log's sequence (the event table's, which numbers the fact
 * stream's facts since step 19), and found by that number, by what its first fact is about and by its field. Entries
 * from before have no number: none of them was ever in the activity log. The event table stays, written no more, while
 * the app before still reads it.
 */
export const ACTIVITY_STREAM = `
alter table log_op add column if not exists seq bigint;
alter table log_op alter column seq set default nextval('event_seq_seq');
create index if not exists log_op_seq on log_op (seq) where seq is not null;
create index if not exists log_op_about on log_op ((facts->0->>1), seq) where seq is not null;
create index if not exists log_op_action on log_op ((facts->0->>2), seq) where seq is not null;
`;

/**
 * Step 34. The event table, gone: its rows are in the activity stream (carried as the step began: carryEventTable in
 * src/activity.ts), so it and where the carrying reached go. Its sequence stays, under its name: it numbers the fact
 * stream's facts and log_op's entries, and the app before draws from it by that name while the new one takes over.
 * The app before also still read the table, to back it up and to carry from it; for that minute a backup it takes
 * fails and is taken again, and its carrying says it found no table.
 */
export const EVENT_GONE = `
alter sequence event_seq_seq owned by none;
drop table if exists event;
delete from setting where key = 'activity.carried';
`;
