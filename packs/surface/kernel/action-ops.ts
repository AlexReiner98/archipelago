// Step 49: the ops of some streams said under some actions, found by their index under the row policy (task
// e_p3ncqu87). Up to where the owner last looked (packreads-log.ts CONFIRMED_UPTO) asked the op policy (pelago_op_seen)
// of every op of the settings and activity streams, 1,491 on islands, before its own condition on the action, which
// is not leakproof: 340 ms of every canvas that shows the frontier, on the live server. As steps 38 and 48 do
// (pelago_op_about, pelago_session_ops), the ops are found here by log_op_action as the table's owner, and the
// reader's own read takes them by position through its policy as before: it is given only what it may see. The
// reader keeps its condition on the stream and the action, as a position is only unique within its stream.

export const ACTION_OPS = `
create or replace function pelago_action_ops(actions text[], streams text[]) returns setof bigint language sql stable security definer set search_path = public rows 20 as $fn$
  select pos from log_op where seq is not null and facts->0->>2 = any(actions) and stream = any(streams) -- index log_op_action
$fn$;
revoke execute on function pelago_action_ops(text[], text[]) from public;
grant execute on function pelago_action_ops(text[], text[]) to pelago_member;
`;
