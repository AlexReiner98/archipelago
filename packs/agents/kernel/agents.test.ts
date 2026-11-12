// The agents pack run without a database: a context whose reads answer from a few instructions in memory, what is
// told where and counted, the brief a launch starts from, and the schema in brief. Against a real map:
// test/instructions.test.ts and test/pack-action-launch.test.ts, through the shims in src/.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { KernelContext } from '#pelago/kernel';
import { instructionsFor } from './instructions.ts';
import { briefFor } from './launch-brief.ts';
import { schemaBrief } from './schema-brief.ts';
import { instructions } from './reads.ts';

function context(answers: Record<string, unknown>, asked: Record<string, unknown>[] = []): KernelContext {
  const reads = async (q: Record<string, unknown>) => {
    asked.push(q);
    const key = Object.keys(q)[0];
    if (key in answers) return answers[key];
    throw new Error(`not read here: ${key}`);
  };
  return { pack: { id: 'agents', version: '0', hash: '' }, workspace: 'w', reads, registry: {} } as unknown as KernelContext;
}

test("what is said where, the owner's version over the preset, each counted once", async () => {
  const asked: Record<string, unknown>[] = [];
  const ctx = context({
    told_from: {
      presets: [{ id: 'core.start', title: 'Start', body: 'Run {run}.', props: { for: ['session_start'] } }],
      kept: [{ id: 'i1', title: 'Mine', body: 'Run {run} here.', is_open: true, props: { preset: 'core.start' }, about: [] }],
    },
    told: true,
  }, asked);
  const said = await instructionsFor(ctx, 'session_start', { fill: { run: 'r1' } });
  assert.deepEqual(said.map((s) => [s.id, s.text, s.preset]), [['i1', 'Run r1 here.', 'core.start']]);
  assert.deepEqual(asked.at(-1), { told: ['core.start'] });
});

test('a launch is a person\'s, and its brief is the brief view\'s', async () => {
  const ctx = context({ owner: 'p1', view: { task: { id: 't1', title: 'T' }, text: 'Do T' } });
  await assert.rejects(briefFor(ctx, { kind: 'agent', name: 'a' }, { task: 't1' }), /Only a human/);
  const { brief, started } = await briefFor(ctx, { kind: 'human', name: 'B', person: 'p2' }, { task: 't1' });
  assert.equal(brief.text, 'Do T');
  assert.deepEqual(started, { kind: 'person', id: 'p2', name: 'B' }, 'started for another member than the owner');
});

test('the schema in brief: statuses and the fields a writer sets', () => {
  const types = new Map([['task', { id: 'task', starter: 'task', statuses: { open: ['open'], closed: ['done'] }, columns: {}, fields: { due: { type: 'date' }, made: { type: 'string', system: true } } }]]);
  const brief = schemaBrief({ types, relations: new Map(), packs: [{ id: 'core' }] } as never);
  assert.deepEqual(brief.types, [{ id: 'task', statuses: 'open / done', fields: 'due: date' }]);
});

test('the read instructions answers what is said where, about an item', async () => {
  const ctx = context({ told_from: { presets: [{ id: 'core.start', title: 'Start', body: 'Go.', props: { for: ['session_start'] } }], kept: [] }, told: true });
  assert.deepEqual((await instructions(ctx, { instructions: { where: 'session_start', about: 'e_x' } })).map((s) => s.id), ['core.start']);
  assert.deepEqual(await instructions(ctx, { instructions: { where: 'nowhere' } }), []);
});
