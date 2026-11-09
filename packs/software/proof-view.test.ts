// The proof view and test_report: a proof question is answered on a build when every test of it passed there. Through the tools alone (#pelago/test), so it runs wherever the pack lives.
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { test } from 'node:test';
import { call, human, make, mapWith } from '#pelago/test';

/** A map with this pack and the packs beside it. */
const fresh = () => mapWith(join(import.meta.dirname, '..'));

test('a proof question is answered on a build when every test of it passed there', async () => {
  const l = await fresh();
  const made = await make(l, [
    { op: 'create', ref: 'app', type: 'project', title: 'App' },
    { op: 'create', ref: 'solver', type: 'feature', title: 'Solver' },
    { op: 'create', ref: 'sun', type: 'proof', title: 'How do we know the sun is correct?' },
    { op: 'create', ref: 'areas', type: 'proof', title: 'How do we know the areas are correct?' },
    { op: 'create', ref: 'noaa', type: 'test', title: 'Sun position against NOAA', status: 'current', props: { entrypoint: 'Sun.MatchesNoaa', tolerance: 'within 0.01 degrees' } },
    { op: 'create', ref: 'pole', type: 'test', title: 'Shadow of a pole', status: 'current', props: { entrypoint: 'Sun.PoleShadow' } },
    { op: 'create', ref: 'square', type: 'test', title: 'Area of a square' },
    { op: 'link', type: 'part_of', from: 'solver', to: 'app' },
    { op: 'link', type: 'part_of', from: 'sun', to: 'solver' },
    { op: 'link', type: 'about', from: 'areas', to: 'app' },
    { op: 'link', type: 'answers', from: 'noaa', to: 'sun' },
    { op: 'link', type: 'answers', from: 'pole', to: 'sun' },
    { op: 'link', type: 'answers', from: 'square', to: 'areas' },
  ]);
  type Proof = {
    build: string | null;
    builds: string[];
    counts: Record<string, number>;
    proofs: { id: string; answered: boolean; passed: number; failed: number; not_run: number; tests: { id: string; result: { id: string; passed: boolean; value: string | null; picture: string | null } | null; before: { build: string } | null }[] }[];
  };
  const view = async (build?: string) => (await call(l, human, 'view', { name: 'proof', params: { of: made.app, build } })) as Proof;
  const none = await view();
  assert.equal(none.build, null);
  assert.deepEqual(none.counts, { questions: 2, answered: 0, tests: 3, passed: 0, failed: 0, not_run: 3 });

  // A harness knows its tests by name. One it names that the map does not know is said back, and nothing is made for it.
  const first = (await call(l, human, 'test_report', {
    build: '1.0.0',
    results: [
      { test: 'Sun.MatchesNoaa', passed: true, value: '0.004 degrees', picture: '.proof/1.0.0/noaa.png' },
      { test: made.pole, passed: false, value: '3 mm out' },
      { test: 'Sun.Nobody', passed: true },
    ],
  })) as { answer: { recorded: number; passed: number; failed: number; unknown: string[] } };
  assert.deepEqual({ recorded: first.answer.recorded, passed: first.answer.passed, failed: first.answer.failed, unknown: first.answer.unknown }, { recorded: 2, passed: 1, failed: 1, unknown: ['Sun.Nobody'] });
  const one = await view();
  assert.equal(one.build, '1.0.0');
  const sun = one.proofs.find((p) => p.id === made.sun)!;
  assert.deepEqual({ answered: sun.answered, passed: sun.passed, failed: sun.failed }, { answered: false, passed: 1, failed: 1 });
  assert.equal(sun.tests[0].id, made.pole, 'what failed comes first');
  assert.equal(sun.tests[1].result!.picture, '.proof/1.0.0/noaa.png');

  // Reported again on the same build, a result is replaced, not added to; what the new run does not say is cleared.
  await call(l, human, 'test_report', { build: '1.0.0', results: [{ test: made.pole, passed: true }] });
  const two = await view();
  const again = two.proofs.find((p) => p.id === made.sun)!;
  assert.equal(again.answered, true);
  assert.equal(again.tests.find((t) => t.id === made.pole)!.result!.id, sun.tests[0].result!.id);
  assert.equal(again.tests.find((t) => t.id === made.pole)!.result!.value, null);
  // A test that is wanted and not written leaves its question unanswered.
  assert.equal(two.proofs.find((p) => p.id === made.areas)!.answered, false);
  assert.deepEqual(two.counts, { questions: 2, answered: 1, tests: 3, passed: 2, failed: 0, not_run: 1 });

  // A new build starts from nothing: what was proven on the last one is not proven on this one.
  await call(l, human, 'test_report', { build: '1.0.1', results: [{ test: made.noaa, passed: true }] });
  const next = await view();
  assert.equal(next.build, '1.0.1');
  assert.deepEqual(next.builds, ['1.0.1', '1.0.0']);
  const later = next.proofs.find((p) => p.id === made.sun)!;
  assert.equal(later.answered, false);
  assert.equal(later.tests.find((t) => t.id === made.pole)!.before!.build, '1.0.0');
  assert.equal((await view('1.0.0')).proofs.find((p) => p.id === made.sun)!.answered, true);

  const listed = (await call(l, human, 'view', { name: 'proof', params: {} })) as { products: { id: string; questions: number }[] };
  assert.deepEqual(listed.products.map((p) => [p.id, p.questions]), [[made.app, 2]]);
  await assert.rejects(call(l, human, 'test_report', { build: '1.0.1', results: [{ test: made.noaa, passed: true }, { test: 'Sun.MatchesNoaa', passed: true }] }), /reported twice/);
});

