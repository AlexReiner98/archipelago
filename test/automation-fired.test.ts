// Each firing is a kept fact (packs/automations/firing.js): the clock tells the automations pack an automation came
// due, the pack notifies, and the log keeps automation.fired naming the occurrence, the item.due it heard, the
// automation's version and the notification the kernel made for it, under the pack's rule that keeps them forever.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { doneEvents } from '../src/activity.ts';
import { duePass } from '../src/due.ts';
import { packVersions, type PackVersion } from '../src/pack-versions.ts';
import { dayStart } from '../src/timeaxis.ts';
import { fresh, make } from './map.ts';

const at = (day: string, h: number, m = 0) => dayStart(day, 'America/Toronto') + (h * 60 + m) * 60_000;
type Fired = { seq: number; action: string; target_id: string; reason: string; detail: { at: string; due_seq: number; version: number; ok: boolean; result: string; made: string[]; packs: PackVersion[]; pack: string } };

test('a firing is kept: what it answered, as which version, and the notification it made', async () => {
  const l = await fresh();
  const made = await make(l, [
    { op: 'create', ref: 'loop', type: 'task', title: 'The refinement loop' },
    { op: 'create', ref: 'w', type: 'automation', title: 'Weekly posting', status: 'enabled', props: { trigger: 'weekly', days: [1], at: '09:00', action: 'notify', message: 'Post today' } },
    { op: 'link', type: 'about', from: 'w', to: 'loop' },
  ]);
  await duePass(l, at('2030-01-07', 8));
  await duePass(l, at('2030-01-07', 9));

  let fired: Fired[] = [];
  for (let i = 0; i < 100 && !fired.length; i++) {
    await new Promise((r) => setTimeout(r, 100));
    fired = (await doneEvents(l.db, { action: 'automation.fired' }, 10)) as unknown as Fired[];
  }
  assert.equal(fired.length, 1, 'fired once');
  const [f] = fired;
  const [heard] = (await doneEvents(l.db, { action: 'item.due', target: made.w }, 10)) as unknown as Fired[];
  const { rows: [{ pos }] } = await l.db.query<{ pos: number }>(`select max(pos)::int as pos from log_fact where stream = 'facts' and id = $1`, [made.w]);
  const { rows: notes } = await l.db.query<{ id: string }>(`select id from entity where type = 'notification' and title = 'Post today'`);
  assert.equal(f.target_id, made.w);
  assert.equal(f.reason, 'Weekly posting: notified');
  assert.deepEqual(f.detail, { at: new Date(at('2030-01-07', 9)).toISOString(), due_seq: heard.seq, version: pos, ok: true, result: 'notified', made: [notes[0].id], packs: packVersions(l.registry), pack: 'automations' });
  assert.ok(f.detail.packs.some((p) => p.id === 'automations' && p.manifest), 'the packs it fired under, each with the hash of its manifest (step 0)');

  const { rows: [kept] } = await l.db.query<{ rule: string }>(`select head->>'rule' as rule from log_op where stream = 'activity' and seq = $1`, [f.seq]);
  assert.equal(kept.rule, 'automation_fired', 'kept by the pack\'s rule, forever');
});
