// Pushed commits nobody accounts for reach the owner: an item the GitHub pack makes for one (accounted false) accounts
// for nothing, shows in attention by the reason the software pack declares, and leaves it once it is accounted for.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { unaccounted as unaccountedRun } from '../src/commits.ts';
import { checkDeclared } from '../src/declared.ts';
import { parts } from '../src/manifest.ts';
import { unaccounted } from '../src/unaccounted.ts';
import { callTool } from '../src/tools.ts';
import { attend, fresh, human, make } from './map.ts';

const A = 'a'.repeat(40);
const B = 'b'.repeat(40);

test('a commit heard only from a push is not accounted for until someone says what it settles', async () => {
  const l = await fresh();
  const made = await make(l, [
    { op: 'create', ref: 'heard', type: 'software.commit', title: 'Pushed', props: { sha: A, accounted: false } },
    { op: 'create', ref: 'own', type: 'software.commit', title: 'Made by its session', props: { sha: B } },
  ]);
  const commit = (id: string) => ({ id, message: 'x' });
  assert.deepEqual((await unaccounted(l, [commit(A), commit(B)])).map((c) => c.id), [A], 'the session that starts is told of it');
  assert.deepEqual(await unaccountedRun(l, [A, B]), [A], 'the reply and the session end are asked of it');
  await make(l, [{ op: 'update', id: made.heard, props: { accounted: true } }]);
  assert.deepEqual(await unaccounted(l, [commit(A), commit(B)]), []);
  assert.deepEqual(await unaccountedRun(l, [A, B]), []);
});

test('a pushed commit nobody accounted for is the owner’s attention, by the reason its pack declares, until it is accounted for', async () => {
  const l = await fresh();
  await callTool(l, human, 'init', { name: 'Alex' });
  const made = await make(l, [
    { op: 'create', ref: 'repo', type: 'software.repo', title: 'Shop repo' },
    { op: 'create', ref: 'heard', type: 'software.commit', title: 'Tidy the cart', props: { sha: A, accounted: false } },
    { op: 'link', type: 'software.lives_in', from: 'heard', to: 'repo' },
    { op: 'create', ref: 'own', type: 'software.commit', title: 'Made by its session', props: { sha: B } },
    { op: 'create', ref: 'task', type: 'work.task', title: 'Fix the cart' },
  ]);
  const titles = (a: { items: { title: string }[] }) => a.items.map((i) => i.title);

  const mine = await attend(l, { person: 'me' });
  const row = mine.items.find((i: { id: string }) => i.id === made.heard);
  assert.deepEqual(row.reasons, [{ why: 'unaccounted', mark: 'not accounted for', tip: row.reasons[0].tip, ask: 'Account for' }]);
  assert.match(row.reasons[0].tip, /settles links/);
  assert.equal(mine.counts.unaccounted, 1);
  assert.ok(!titles(mine).includes('Made by its session'), 'one its session made is accounted for');
  // Weighed with what waits on the owner, and ranked just after it: Home's "Your move" asks for that.
  const move = await attend(l, { person: 'me', reasons: ['waits_on', 'to_confirm', 'due', 'unsettled'] });
  assert.ok(titles(move).includes('Tidy the cart'));
  assert.ok(!titles(await attend(l, { person: 'me', reasons: ['due'] })).includes('Tidy the cart'), 'not when only what is due is asked');
  assert.deepEqual(titles(await attend(l, { person: 'me', reasons: ['unaccounted'] })), ['Tidy the cart'], 'asked by its own name');
  assert.ok(titles(await attend(l, { within: made.repo })).includes('Tidy the cart'), 'within its repository');
  await assert.rejects(attend(l, { person: 'me', reasons: ['nonsense'] }), /one of .*unaccounted/);

  // Accounted for: its links, and accounted true. It leaves attention.
  await make(l, [
    { op: 'update', id: made.heard, props: { accounted: true } },
    { op: 'link', type: 'software.settles', from: made.heard, to: made.task },
  ]);
  assert.ok(!titles(await attend(l, { person: 'me' })).includes('Tidy the cart'));
});

test('a reason a pack declares names a reason of its own, a type and its fields, and the kernel reason it joins', async () => {
  const l = await fresh();
  const software = l.registry.packs.find((p) => p.id === 'software')!;
  assert.deepEqual(parts(software).reasons.map((r) => r.reason), ['unaccounted']);
  const wrong = { ...software, views: [...(software.views ?? []), { form: 'attention' as const, id: 'software.bad', reason: 'due', description: 'x', of: 'software.nothing', where: { nope: true }, joins: 'sometimes' }] };
  const problems = checkDeclared(wrong, l.registry.types, [], true).join('\n');
  assert.match(problems, /reason is a name of its own/);
  assert.match(problems, /unknown type "software.nothing"/);
  assert.match(problems, /joins one of/);
});
