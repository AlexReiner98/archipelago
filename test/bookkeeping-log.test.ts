// A session's bookkeeping on the log (docs/kernel-packs.md, "System authority"): what the sessions pack writes of a run
// as it goes is made as the actor it is for, with no authority claimed, and applies as it is made, never held, on a map
// where every agent's change waits. Pinned before root.bookkeep sent it through the rules and after: the rule
// sessions.bookkeeping lets it through, and the log names it.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { sessionEnd, sessionStart, sessionUpdate } from '../src/sessions.ts';
import { HOOK_ACTOR, hookSessionEnd, hookSessionStart } from '../src/session-hook.ts';
import { agent, fresh, make } from './map.ts';
import { checkRules, judge } from '../src/rules.ts';

type Head = { actor: { id: string }; authority: unknown; rule: { outcome: string; spared?: { rule: string; pack: string }[] } };

/** The facts entries since a position, as the log keeps them, and how many changes wait. */
async function since(l: Awaited<ReturnType<typeof fresh>>, pos: number) {
  const { rows } = await l.db.query<{ head: Head }>(`select head from log_entry where stream = 'facts' and pos > $1 order by pos`, [pos]);
  const waiting = (await l.db.query<{ n: number }>(`select count(*)::int as n from proposal where status = 'pending'`)).rows[0].n;
  return { entries: rows.map((r) => r.head), waiting };
}
const head = async (l: Awaited<ReturnType<typeof fresh>>) => (await l.db.query<{ pos: number }>(`select coalesce(max(pos), 0)::int as pos from log_entry where stream = 'facts'`)).rows[0].pos;

test("a session's bookkeeping keeps its actor and authority on the log and is never held, where agents' changes wait", async () => {
  const l = await fresh();
  await l.db.query(`insert into setting (key, value) values ('agent_changes', '"hold"') on conflict (key) do update set value = excluded.value`);
  const made = await make(l, [{ op: 'create', ref: 't', type: 'task', title: 'Tune the solver' }]);
  const from = await head(l);

  // A hook registers a run, names it, and ends it; an agent's own session takes a task, waits and ends.
  await hookSessionStart(l, { session_id: 'hooked', cwd: '/tmp/x', title: 'Hooked chat' });
  await hookSessionEnd(l, { session_id: 'hooked', reason: 'exit' });
  const mine = await sessionStart(l, agent, { session_id: 'mine', task: made.t });
  await sessionUpdate(l, agent, { run: mine.run, status: 'waiting', note: 'Waiting on the owner' });
  await sessionEnd(l, agent, { run: mine.run, outcome: 'finished', summary: 'Done' });

  const { entries, waiting } = await since(l, from);
  assert.equal(waiting, 0, 'nothing a session writes of itself waits');
  assert.ok(entries.length >= 5, `each step is on the log (${entries.length})`);
  const actors = new Set(entries.map((e) => e.actor.id));
  assert.deepEqual([...actors].sort(), [`agent:${HOOK_ACTOR.name}`, `agent:${agent.name}`].sort(), 'made as the hook and as the agent, never as system:sessions');
  for (const [i, e] of entries.entries()) {
    assert.equal(e.authority, null, `entry ${i + 1} claims no authority`);
    assert.equal(e.rule.outcome, 'apply', `entry ${i + 1} applied`);
    // What let it through is the sessions pack's rule, by name; what it was spared is the rest of what it would be under.
    assert.equal(e.rule.spared?.[0]?.rule, 'bookkeeping', `entry ${i + 1} is let through by sessions.bookkeeping`);
    assert.equal(e.rule.spared?.[0]?.pack, 'sessions');
    assert.ok(e.rule.spared?.some((r) => r.pack === 'core' && r.rule === 'agent_changes'), `entry ${i + 1} spared core's agent_changes`);
  }
});

test('a spare rule lets through only its own pack\'s bookkeeping, and is checked as one', async () => {
  const l = await fresh();
  const spare = { id: 'bookkeeping', pack: 'sessions', when: { bookkeeping: true }, then: 'spare' as const };
  const hold = { id: 'agent_changes', pack: 'core', when: { actor: 'agent' as const }, then: 'hold' as const };
  const w = { op: 'create', type: 'task' };
  const mine = judge([spare, hold], l.registry, { human: false, bookkeeping: 'sessions' }, w, []);
  assert.deepEqual([mine.held, mine.refused], [[], []]);
  assert.deepEqual(mine.spared.map((r) => [r.pack, r.rule, r.lifted_by]), [['sessions', 'bookkeeping', 'sessions.bookkeeping'], ['core', 'agent_changes', 'sessions.bookkeeping']]);
  for (const who of [{ human: false }, { human: false, bookkeeping: 'other' }]) assert.deepEqual(judge([spare, hold], l.registry, who, w, []).held.map((r) => r.rule), ['agent_changes'], 'another pack\'s, or a change that is no bookkeeping, is held');
  assert.equal(checkRules([spare], l.registry).length, 0);
  assert.equal(checkRules([{ id: 'x', when: { actor: 'agent' }, then: 'spare' }], l.registry).length, 1, 'a spare rule names bookkeeping');
  assert.equal(checkRules([{ ...spare, lifted: 'agent_changes' }], l.registry).length, 1, 'and nothing lifts it');
});
