// Step 48: the reads every hook call of every session makes (packreads-runs.ts run_of and run_events, and the
// sessions root's bookkeeping, packs/write/kernel/root-bookkeep.ts), each by an index (task e_8dhwaja8).
//
// An agent reads as pelago_member, so the row policies come before any condition that is not leakproof, and
// `props->>'session_id'`, `facts->0->>1` and `facts @>` are not: an index on them goes unused under the policy. A run
// found by its session read every run's props; a run's events read every op of the sessions stream since the run
// began and asked the policy (pelago_op_seen) of each, 125 ms for one busy run on a copy of islands. As step 38 did for
// what the streams say about an item (pelago_op_about), each is found here by its index as the table's owner, and the
// reader's own read takes what that answers by a key (`id = any`, `pos = any`, both leakproof) through its policy as
// before: it is given only what it may see.
//
// A run's events are the entries of the sessions stream whose first fact is about the run and kept under the event
// field: the bookkeeping records one run's events, and nothing else, to an entry (root-bookkeep.ts `events`).

export const SESSION_READS = `
create index if not exists entity_session_id on entity ((props->>'session_id')) where props ? 'session_id';
create or replace function pelago_run_of(session_id text) returns setof text language sql stable security definer set search_path = public rows 2 as $fn$
  select id from entity where props ? 'session_id' and props->>'session_id' = session_id -- index entity_session_id
$fn$;
revoke execute on function pelago_run_of(text) from public;
grant execute on function pelago_run_of(text) to pelago_member;

create index if not exists log_op_session_run on log_op ((facts->0->>1), (facts->0->>2), at) where stream = 'sessions';
create or replace function pelago_session_ops(runs text[], field text, since timestamptz) returns setof bigint language sql stable security definer set search_path = public rows 50 as $fn$
  select pos from log_op where stream = 'sessions' and facts->0->>1 = any(runs) and facts->0->>2 = field and at >= since -- index log_op_session_run
$fn$;
revoke execute on function pelago_session_ops(text[], text, timestamptz) from public;
grant execute on function pelago_session_ops(text[], text, timestamptz) to pelago_member;
`;
