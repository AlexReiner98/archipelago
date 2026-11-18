// What the orchestration does to a session is told on its story (packs/sessions/kernel/beats.ts): a task taken up, a
// resource claimed or given back, a claim or a change refused. Marked apart from the session's own words (did, by),
// given as its line by the sessions view, and never what its page opens on while it has said something itself.
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { test } from 'node:test';
import * as sessionsPack from '../packs/sessions/kernel/sessions.ts';
import { callTool } from '../packs/surface/kernel/tools.ts';
import { VIEWS } from '../packs/query/kernel/views.ts';
import { Registry } from '../packs/loader/kernel/packs.ts';
import { kernelContext, ownContext } from '../packs/loader/kernel/kernel-context.ts';
import type { Archipelago } from '../packs/write/kernel/pelago.ts';
import { agent, freshWith, make, PACKS } from './map.ts';

const map = () => freshWith(new Registry([PACKS, join(import.meta.dirname, 'packs')], ['core', 'checkout']));
const ctx = (l: Archipelago) => ownContext(l, 'sessions');
const beats = async (l: Archipelago, run: string) => (await sessionsPack.story(ctx(l), { run })).beats as sessionsPack.Beat[];
const lineOf = async (l: Archipelago, run: string) => ((await VIEWS.sessions.run(kernelContext(l, 'query'), {})) as any).open.find((r: any) => r.id === run)?.session;

async function setup(l: Archipelago) {
  return make(l, [
    { op: 'create', ref: 'lane', type: 'place', props: { exclusive: true }, title: 'Live lane' },
    { op: 'create', ref: 'rig', type: 'place', props: { exclusive: true }, title: 'Test rig' },
    { op: 'create', ref: 'live', type: 'task', title: 'Capture probe' },
    { op: 'link', type: 'needs', from: 'live', to: 'lane' },
  ]);
}

test('taking up a task and claiming what it needs are beats; a claim refused names who holds it', async () => {
  const l = await map();
  const made = await setup(l);
  const one = await sessionsPack.sessionStart(ctx(l), agent as sessionsPack.Actor, { task: made.live, session_id: 'b1' });
  assert.deepEqual(
    (await beats(l, one.run)).map((b) => [b.did, b.by, b.about]),
    [
      ['took', 'sessions', [made.live]],
      ['claimed', 'sessions', [made.lane, made.live]],
    ],
  );
  const two = await sessionsPack.sessionStart(ctx(l), agent as sessionsPack.Actor, { task: made.live, session_id: 'b2' });
  const refused = (await beats(l, two.run)).find((b) => b.did === 'refused')!;
  assert.match(refused.said, /Could not claim Live lane: .*held by/);

  // Taking up the same task again is no new beat; a new one is.
  await sessionsPack.sessionUpdate(ctx(l), agent as sessionsPack.Actor, { run: one.run, task: made.live });
  assert.equal((await beats(l, one.run)).length, 2);
});

test('the claim and release tools tell the holding session, and the line is the latest of them, marked', async () => {
  const l = await map();
  const made = await setup(l);
  const { run } = (await callTool(l, agent, 'session_start', { session_id: 'b3' })) as { run: string };
  await callTool(l, agent, 'claim', { resource: made.rig, holder: run, reason: 'Running the probe' });
  assert.deepEqual(await lineOf(l, run).then((s) => [s.line, s.did]), ['Claimed Test rig: Running the probe', 'claimed']);
  await callTool(l, agent, 'release', { resource: made.rig, reason: 'Probe done' });
  const told = await beats(l, run);
  assert.deepEqual(told.map((b) => b.did), ['claimed', 'released']);
  assert.equal(told[1].said, 'Gave back Test rig: Probe done');
  assert.equal((await lineOf(l, run)).did, 'released');

  // The session's own words are its line again once it says something, unmarked.
  await sessionsPack.tell(ctx(l), agent as sessionsPack.Actor, { run, said: 'The probe holds at 2 px.' });
  assert.deepEqual(await lineOf(l, run).then((s) => [s.line, s.did]), ['The probe holds at 2 px.', undefined]);
  // A beat of what befell it is never what its page opens on while it has said something.
  await callTool(l, agent, 'claim', { resource: made.rig, holder: run, reason: 'Again' });
  assert.equal((await sessionsPack.story(ctx(l), { run })).finding, 3);
});

test('a refused change is told on the session it names, with why, and the line says refused', async () => {
  const l = await map();
  const { run } = (await callTool(l, agent, 'session_start', { session_id: 'b4' })) as { run: string };
  await assert.rejects(callTool(l, agent, 'change', { run, reason: 'Name the plan', ops: [{ op: 'create', type: 'task', title: 'x'.repeat(61) }] }), /Change rejected/);
  const [beat] = await beats(l, run);
  assert.equal(beat.did, 'refused');
  assert.equal(beat.by, 'write');
  assert.match(beat.said, /^Change refused \(Name the plan\): op 1 \(create\): the title is 61 characters/);
  assert.equal((await lineOf(l, run)).did, 'refused');
});

test('what a session held is given back as it ends, told on its story though it has ended', async () => {
  const l = await map();
  const made = await setup(l);
  const one = await sessionsPack.sessionStart(ctx(l), agent as sessionsPack.Actor, { task: made.live, session_id: 'b5' });
  await sessionsPack.sessionEnd(ctx(l), agent as sessionsPack.Actor, { run: one.run, summary: 'Done' });
  const last = (await beats(l, one.run)).at(-1)!;
  assert.deepEqual([last.did, last.said], ['released', 'Gave back Live lane: session finished']);
  // A run that is not a session has no story: befell lets it go.
  assert.equal(await sessionsPack.befell(ctx(l), { run: made.lane, did: 'claimed', said: 'x', by: 'test' }), undefined);
});
