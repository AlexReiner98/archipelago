// The event table as it stood until schema step 34 dropped it: what a test of an older database makes again, so the
// steps before 34 that name it run as they did.

/** The event table as it stood until step 34, numbered from the sequence the log's facts are. */
export const OLD_EVENT = `create table event (seq bigint primary key default nextval('event_seq_seq'), workspace text not null default 'default',
  ts timestamptz not null default now(), origin text not null default 'pelago', actor text not null, action text not null, target_id text,
  changeset text, reason text not null default '', detail jsonb not null default '{}', private_to text);`;
