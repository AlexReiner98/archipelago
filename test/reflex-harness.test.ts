// The reflex harness edited on the map: a session's tool sayings are kept to its run, a reflex is said only at a place
// that is said, a rule's words are reworded by an instruction kept at rule:<pack.rule>, and the thresholds are settings.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { instructionsFor, TOOLS } from '../packs/agents/kernel/instructions.ts';
import { kernelContext, ownContext } from '../packs/loader/kernel/kernel-context.ts';
import { askOnReply } from '../packs/sessions/kernel/replies.ts';
import { tick } from '../packs/reflex_said/kernel/tick.ts';
import { callTool } from '../packs/surface/kernel/tools.ts';
import { fresh, make } from './map.ts';

const owner = { kind: 'human' as const, name: 'owner', admin: true };

test("what a session's tools say is kept to its run once, each tool's place apart, a trial marked once", async () => {
  const l = await fresh();
  const made = await make(l, [
    { op: 'create', ref: 'run', type: 'run', title: 'A session' },
    { op: 'create', ref: 'change', type: 'reflex', title: 'Trial: unlink takes the id', body: 'Read it first.', status: 'trial', props: { for: ['tool:change'] } },
    { op: 'create', ref: 'query', type: 'instruction', title: 'Search first', body: 'Search before you create.', props: { for: ['tool:query'] } },
  ]);
  const ctx = kernelContext(l, 'agents');
  const told = await instructionsFor(ctx, TOOLS, { run: made.run });
  assert.deepEqual(told.map((one) => one.title).sort(), ['Search first', 'Trial: unlink takes the id'], 'marked once though its writer marked it');
  const record = (await ctx.reads({ said_record: { ids: [made.change, made.query] } })) as { said: number; places: Record<string, number> }[];
  assert.deepEqual(record.map((r) => r.places), [{ 'tool:change': 1 }, { 'tool:query': 1 }]);
});

test('a reflex is said only at a place that is said: another is refused, naming the places', async () => {
  const l = await fresh();
  await assert.rejects(make(l, [{ op: 'create', type: 'reflex', title: 'For a pack', body: 'x', status: 'trial', props: { for: ['tool:change', 'pack:build'] } }]), /session_start, working_rules, server_restarted, setup_behind, tool:<name>/);
  const made = await make(l, [{ op: 'create', ref: 'ok', type: 'reflex', title: 'For a tool and a file', body: 'x', status: 'trial', props: { for: ['tool:change', 'file:src/**/*.ts', 'rule:sessions.show_what_you_saw', 'session_start:handoff', 'prompt:seeing', 'show:landed', 'connect', 'connect:intro'] } }]);
  await assert.rejects(l.change(owner, { ops: [{ op: 'update', id: made.ok, props: { for: ['pack:ui'] } }], reason: 'test' }), /place that is said/);
});

test("a rule on a reply's end asks in the words kept for it on the map", async () => {
  const l = await fresh();
  const at = new Date().toISOString();
  const made = await make(l, [
    { op: 'create', ref: 'run', type: 'run', title: 'A session', props: { last_seen: at, story: [{ n: 1, at, said: 'Change refused (x): no such field', about: [], links: [], did: 'refused', by: 'write' }] } },
  ]);
  const asked = await askOnReply(ownContext(l, 'sessions'), { id: made.run, is_open: true }, { turn: 't1', reply: { changed: 1 } });
  assert.match(String(asked), /Search for a reflex that should cover it/, "the pack's preset words");
  await make(l, [{ op: 'create', type: 'instruction', title: 'Our words', body: 'Write it down as a trial reflex, in our words.', props: { preset: 'reflex_said.write_node_words' } }]);
  await l.change(owner, { ops: [{ op: 'update', id: made.run, props: { story: [{ n: 1, at, said: 'Change refused (x): no such field', about: [], links: [], did: 'refused', by: 'write' }, { n: 2, at, said: 'Change refused (y): unknown type', about: [], links: [], did: 'refused', by: 'write' }] } }], reason: 'test: another refusal' });
  assert.equal(await askOnReply(ownContext(l, 'sessions'), { id: made.run, is_open: true }, { turn: 't2', reply: { changed: 1 } }), 'Write it down as a trial reflex, in our words.', "the owner's over the pack's");
});

test('the thresholds are settings anyone finds, and the tick moves by them', async () => {
  const l = await fresh();
  const info = (await callTool(l, owner, 'workspace_info', {})) as { setting_defs: { key: string; pack: string; default?: unknown }[] };
  assert.deepEqual(info.setting_defs.filter((d) => d.pack === 'reflex_said').map((d) => [d.key, d.default]), [['reflex_promote_held', 3], ['reflex_retire_failed', 2], ['reflex_retire_unsaid_days', 30]]);
  const made = await make(l, [
    { op: 'create', ref: 'run', type: 'run', title: 'One' },
    { op: 'create', ref: 'node', type: 'reflex', title: 'Test first', body: 'Run the test.', status: 'trial', props: { for: ['tool:test'] } },
  ]);
  await instructionsFor(kernelContext(l, 'agents'), 'tool:test', { run: made.run });
  await l.db.query(`insert into setting (key, value) values ('holds_off', 'true'::jsonb)`);
  assert.deepEqual(await tick(kernelContext(l, 'reflex_said')), { moved: 0 }, 'held in one run of the three it takes');
  await callTool(l, owner, 'workspace_set', { settings: { reflex_promote_held: 1 } });
  assert.deepEqual(await tick(kernelContext(l, 'reflex_said')), { moved: 1 }, 'one run is enough once the owner says so');
});
