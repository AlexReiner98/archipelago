// A moved finding tells its readers (src/moved.ts, task e_svdkhdey): what reads a finding by a link that crosses is
// in attention as `moved` once the finding's value or as of changes after the reader last changed or was said still
// true, with what moved, from what to what, and when; until whoever tends it changes it or says it still holds.
// Read from the log and the links: nothing runs when the finding moves.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { checkCapabilities } from '../src/capabilities.ts';
import { setIslands } from '../src/packstate.ts';
import { attend, fresh, human, make } from './map.ts';

async function twoIslands() {
  const l = await fresh();
  await setIslands(l, human, true);
  const { a, b, ann } = await make(l, [
    { op: 'create', ref: 'a', type: 'island', title: 'Costs', props: { pack: 'core' } },
    { op: 'create', ref: 'b', type: 'island', title: 'Plans', props: { pack: 'core' } },
    { op: 'create', ref: 'ann', type: 'person', title: 'Ann' },
  ]);
  const { f, budget } = await make(l, [
    { op: 'create', ref: 'f', type: 'finding', title: 'Hosting a month', props: { value: 400, value_type: 'number', as_of: '2026-11-04', island: a } },
    { op: 'create', ref: 'budget', type: 'task', title: 'Set the budget', owner: ann, props: { island: b } },
    { op: 'link', type: 'reads', from: 'budget', to: 'f' },
  ]);
  return { l, f, budget, ann };
}

const movedOf = (answer: { items: { id: string; reasons: { why: string }[] }[] }, id: string) =>
  (answer.items.find((i) => i.id === id)?.reasons.filter((r) => r.why === 'moved') ?? []) as unknown as { finding: string; title: string; moved: { field: string; from: unknown; to: unknown }[]; on: string }[];

test('a moved finding is in its reader’s attention, across islands, until the reader says it still holds', async () => {
  const { l, f, budget, ann } = await twoIslands();
  assert.deepEqual(movedOf(await attend(l, { person: ann, reasons: ['moved'] }), budget), [], 'nothing moved since it was read');
  await make(l, [{ op: 'update', id: f, props: { value: 450, as_of: '2026-11-05' } }]);
  const [m] = movedOf(await attend(l, { person: ann, reasons: ['moved'] }), budget);
  assert.equal(m.finding, f);
  assert.equal(m.title, 'Hosting a month');
  assert.deepEqual(m.moved, [{ field: 'value', from: 400, to: 450 }, { field: 'as_of', from: '2026-11-04', to: '2026-11-05' }]);
  assert.ok(Date.parse(m.on) > 0, 'when it moved');
  assert.ok(movedOf(await attend(l, { within: budget, reasons: ['moved'] }), budget).length, 'within the reader too');
  // A second move before the reader looks: from what it last saw to what it is now.
  await make(l, [{ op: 'update', id: f, props: { value: 500 } }]);
  assert.deepEqual(movedOf(await attend(l, { person: ann, reasons: ['moved'] }), budget)[0].moved[0], { field: 'value', from: 400, to: 500 });
  // An update of only its id: still true. The reason goes.
  await make(l, [{ op: 'update', id: budget }]);
  assert.deepEqual(movedOf(await attend(l, { person: ann }), budget), [], 'cleared by a word that it still holds');
  // Moved again, then the reader changed: that clears it too.
  await make(l, [{ op: 'update', id: f, props: { value: 520 } }]);
  assert.deepEqual(movedOf(await attend(l, { person: ann, reasons: ['moved'] }), budget)[0].moved, [{ field: 'value', from: 500, to: 520 }]);
  await make(l, [{ op: 'update', id: budget, title: 'Set the budget at 520' }]);
  assert.deepEqual(movedOf(await attend(l, { person: ann, reasons: ['moved'] }), budget), [], 'cleared by a change');
});

test('what does not move a reading: other fields, a value put back, a reading begun after, a reading ended', async () => {
  const { l, f, budget, ann } = await twoIslands();
  await make(l, [{ op: 'update', id: f, body: 'In US dollars.', confidence: 0.5 }]);
  assert.deepEqual(movedOf(await attend(l, { person: ann, reasons: ['moved'] }), budget), [], 'only the fields it promises');
  await make(l, [{ op: 'update', id: f, props: { value: 450 } }]);
  await make(l, [{ op: 'update', id: f, props: { value: 400 } }]);
  assert.deepEqual(movedOf(await attend(l, { person: ann, reasons: ['moved'] }), budget), [], 'put back as it was read');
  const { late } = await make(l, [{ op: 'create', ref: 'late', type: 'task', title: 'Plan hosting', owner: ann, props: { island: (await l.entity(budget))!.props.island } }]);
  await make(l, [{ op: 'update', id: f, props: { value: 410 } }]);
  await make(l, [{ op: 'update', id: late }]);
  await make(l, [{ op: 'link', type: 'reads', from: late, to: f }]);
  assert.deepEqual(movedOf(await attend(l, { person: ann, reasons: ['moved'] }), late), [], 'it read the value as it is now');
  assert.ok(movedOf(await attend(l, { person: ann, reasons: ['moved'] }), budget).length, 'the earlier reader is told');
  const { rows: [r] } = await l.db.query<{ id: string }>(`select id from relation where from_id = $1 and to_id = $2 and valid_to is null`, [budget, f]);
  await make(l, [{ op: 'unlink', relation: r.id }]);
  // Unlinking leaves the reader unchanged, but it no longer reads the finding.
  assert.deepEqual(movedOf(await attend(l, { person: ann, reasons: ['moved'] }), budget), [], 'a reading ended tells nothing');
});

test('promised names fields the type has', () => {
  const fields = { value: { type: 'json' }, as_of: { type: 'date' } } as never;
  assert.deepEqual(checkCapabilities({ promised: { fields: ['value', 'as_of'] } }, fields, new Set()), []);
  assert.match(checkCapabilities({ promised: { fields: ['worth'] } }, fields, new Set()).join(), /promised reads "worth"/);
  assert.match(checkCapabilities({ promised: { fields: [] } }, fields, new Set()).join(), /promised names the fields/);
});
