import assert from 'node:assert/strict';
import { test } from 'node:test';
import { answerHook } from '../src/hook-answers.ts';
import type { Archipelago } from '../src/pelago.ts';
import { sessionStart } from '../src/sessions.ts';
import { standsOf } from '../src/stands.ts';
import { agent, fresh } from './map.ts';

const hook = (l: Archipelago, event: string, body: Record<string, unknown>) => answerHook(event, { whole: l.db, pelago: l, within: [], body, running: { started: new Date().toISOString() }, origin: 'http://127.0.0.1' });

test('where a session stands is kept as said, a small flat object, and read by no key but branch', () => {
  assert.deepEqual(standsOf({ unpushed: 2, branch: 'side', clean: false }), { branch: 'side', clean: false, unpushed: 2 });
  for (const no of [undefined, 'side', [], {}, { branch: { nested: 1 } }, { Branch: 'x' }, { note: 'x'.repeat(1001) }, { n: Infinity }, Object.fromEntries(Array.from({ length: 17 }, (_, i) => [`k${i}`, i]))]) {
    assert.equal(standsOf(no), undefined, JSON.stringify(no));
  }
});

test('a turn end keeps where the session stands on its run, under its old name too', async () => {
  const l = await fresh();
  const { run } = await sessionStart(l, agent, { session_id: 's1' });
  const stands = { branch: 'claude/probe', head: 'b'.repeat(40), worktree: 'C:/code/site', unpushed: 2, dirty: 0 };
  await hook(l, 'stop', { session_id: 's1', stands });
  assert.deepEqual((await l.entity(run))!.props.stands, standsOf(stands));
  await hook(l, 'stop', { session_id: 's1', git: { ...stands, unpushed: 3 } });
  assert.equal(((await l.entity(run))!.props.stands as { unpushed: number }).unpushed, 3, 'a hook set up before 10 Nov 2026 says it as git');
  await hook(l, 'stop', { session_id: 's1', stands: 'not an object' });
  assert.equal(((await l.entity(run))!.props.stands as { unpushed: number }).unpushed, 3, 'what is not one leaves it as it was');
});
