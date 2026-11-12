// An island stands by what it marks published (task e_qzdadqpa, the owner's pick, 9 Nov 2026): a finding's
// published mark (core's promised.published) decides whether another island may read it; the rest are its working
// findings, read on their own island only.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { checkCapabilities } from '../packs/loader/kernel/capabilities.ts';
import { setIslands } from '../packs/loader/kernel/packstate.ts';
import { fresh, human, make } from './map.ts';

async function twoIslands() {
  const l = await fresh();
  await setIslands(l, human, true);
  const { a, b } = await make(l, [
    { op: 'create', ref: 'a', type: 'island', title: 'Costs', props: { pack: 'core' } },
    { op: 'create', ref: 'b', type: 'island', title: 'Plans', props: { pack: 'core' } },
  ]);
  const { f, home, away } = await make(l, [
    { op: 'create', ref: 'f', type: 'finding', title: 'Hosting costs 400 EUR a month', props: { value: 400, value_type: 'number', unit: 'EUR', island: a } },
    { op: 'create', ref: 'home', type: 'task', title: 'Price the plan', props: { island: a } },
    { op: 'create', ref: 'away', type: 'task', title: 'Set the budget', props: { island: b } },
  ]);
  return { l, f: f!, home: home!, away: away! };
}

test('a working finding is read on its own island, and from another only once published', async () => {
  const { l, f, home, away } = await twoIslands();
  await make(l, [{ op: 'link', type: 'reads', from: home, to: f }]);
  await assert.rejects(make(l, [{ op: 'link', type: 'reads', from: away, to: f }]), /working finding of its island: another island reads only what it marks published/);
  await make(l, [{ op: 'update', id: f, props: { published: true } }, { op: 'link', type: 'reads', from: away, to: f }]);
});

test('a published finding read from another island is not taken back while it is read', async () => {
  const { l, f, away } = await twoIslands();
  await make(l, [{ op: 'update', id: f, props: { published: true } }, { op: 'link', type: 'reads', from: away, to: f }]);
  await assert.rejects(make(l, [{ op: 'update', id: f, props: { published: false } }]), /is read from the island .* unlink that reading before taking it back/);
});

test('promised.published names a boolean field', () => {
  assert.deepEqual(checkCapabilities({ promised: { fields: ['value'], published: 'published' } }, { value: { type: 'json' }, published: { type: 'boolean' } } as never, new Set()), []);
  assert.match(checkCapabilities({ promised: { fields: ['value'], published: 'value' } }, { value: { type: 'json' } } as never, new Set()).join(), /no boolean field/);
});
