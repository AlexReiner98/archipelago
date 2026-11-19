// Each instruction said to a run is kept as said there (the reflex_said pack's stream), and read back as its record:
// how often, where, and whether a refusal it answers came back in the run after it was said. A trial reflex is said
// only where its for names the place exactly, marked; one that names a map action asks the agent to take it.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { instructionsFor } from '../packs/agents/kernel/instructions.ts';
import { kernelContext } from '../packs/loader/kernel/kernel-context.ts';
import { fresh, make } from './map.ts';
import { VIEWS } from '../packs/query/kernel/views.ts';

test('what is said to a run is kept, and its record says whether its miss came back', async () => {
  const l = await fresh();
  const made = await make(l, [
    { op: 'create', ref: 'run', type: 'run', title: 'A session' },
    { op: 'create', ref: 'quiet', type: 'run', title: 'Another' },
    { op: 'create', ref: 'bump', type: 'finding', title: 'Titles too long' },
    { op: 'create', ref: 'trial', type: 'reflex', title: 'Short titles', body: 'Name it in a few words.', status: 'trial', props: { for: ['tool:change'], misses: ['title is too long'], action: 'report.tell', input: { said: 'named it' } } },
    { op: 'create', ref: 'kept', type: 'instruction', title: 'Check files', body: 'Read before you write.', props: { for: ['file:src/**/*.ts'] } },
    { op: 'link', type: 'answers', from: 'trial', to: 'bump' },
  ]);
  const ctx = kernelContext(l, 'agents');
  // A trial is said only on its exact place, marked, with the action it names; a glob place is not exact.
  const told = await instructionsFor(ctx, 'tool:change', { run: made.run });
  const trial = told.find((one) => one.id === made.trial)!;
  assert.equal(trial.title, 'Trial: Short titles');
  assert.equal(trial.trial, true);
  assert.match(trial.text, /Name it in a few words\.\nTake it with your own tools: report\.tell \{"said":"named it"\}\./);
  await instructionsFor(ctx, 'file:src/a.ts', { run: made.quiet });
  await instructionsFor(ctx, 'tool:change', { run: made.quiet });
  // A refusal of the phrase it answers, after it was said, in the first run only.
  await new Promise((r) => setTimeout(r, 5));
  await l.change(human(), { ops: [{ op: 'update', id: made.run, props: { story: [{ n: 1, at: new Date().toISOString(), said: 'Change refused (x): the title is too long', about: [], links: [], did: 'refused', by: 'write' }] } }], reason: 'test: a refusal befell it' });
  const [rec, file] = (await ctx.reads({ said_record: { ids: [made.trial, made.kept] } })) as { said: number; runs: number; places: Record<string, number>; came_back: number; quiet: number }[];
  assert.equal(rec.said, 2);
  assert.equal(rec.runs, 2);
  assert.deepEqual(rec.places, { 'tool:change': 2 });
  assert.equal(rec.came_back, 1);
  assert.equal(rec.quiet, 1);
  assert.deepEqual({ said: file.said, places: file.places }, { said: 1, places: { 'file:src/a.ts': 1 } });
  // Said with no run, nothing is kept.
  await instructionsFor(ctx, 'tool:change');
  const [again] = (await ctx.reads({ said_record: { ids: [made.trial] } })) as { said: number }[];
  assert.equal(again.said, 2);
});

test('asked through the instructions view by a run, what is said is kept as said to it', async () => {
  const l = await fresh();
  const made = await make(l, [
    { op: 'create', ref: 'run', type: 'run', title: 'A session' },
    { op: 'create', ref: 'node', type: 'reflex', title: 'Test first', body: 'Run the test.', status: 'current', props: { for: ['tool:test'] } },
    { op: 'create', ref: 'other', type: 'reflex', title: 'Then commit', body: 'Commit it.', status: 'current', props: { for: ['tool:test'] } },
  ]);
  const answer = (await VIEWS.instructions.run(kernelContext(l, 'query'), { for: 'tool:test', run: made.run })) as { said: { id: string }[] };
  assert.deepEqual(answer.said.map((one) => one.id), [made.node, made.other]);
  await VIEWS.instructions.run(kernelContext(l, 'query'), { for: 'tool:test' });
  const [rec, other] = (await kernelContext(l, 'agents').reads({ said_record: { ids: [made.node, made.other] } })) as { said: number; runs: number }[];
  assert.deepEqual({ said: rec.said, runs: rec.runs }, { said: 1, runs: 1 }, 'asked with no run, nothing is kept; said together, each counted once');
  assert.equal(other.said, 1);
});

const human = () => ({ kind: 'human' as const, name: 'owner' });
