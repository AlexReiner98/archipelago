// The Design pack (task e_hvmg2ag9): a vocabulary for design and research work, taken beside every other pack. Read
// through the tools as an agent reads it: each type stands on the shared set, each field and link is checked on write,
// taking the ends the work needs and refusing the others, and its views and instructions come with it.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { call, human, make, mapWith, type Archipelago } from '#pelago/test';

const fresh = () => mapWith(dirname(import.meta.dirname));
const file = JSON.parse(readFileSync(join(import.meta.dirname, 'pack.json'), 'utf8')) as { styles?: { id: string; type: string; body?: string }[] };

/** What each type stands on: the starter it is a flavour of, through the shared set. */
const STANDS_ON: Record<string, string> = {
  study: 'work', concept: 'question', tenet: 'aim', research: 'record', element: 'work', writeup: 'record',
};

type Type = { id: string; pack: string; starter: string; description?: string; statuses: { open: string[]; closed: string[] }; capabilities?: Record<string, unknown> };
type Relation = { id: string; root?: string; extends?: string };
const schema = (l: Archipelago, type: string) => call<{ types: Type[]; relations: Relation[] }>(l, human, 'schema', { type });

/** Whether a change applies, or the reason it was refused. */
async function tried(l: Archipelago, ops: Parameters<typeof make>[1]): Promise<true | string> {
  try {
    await make(l, ops);
    return true;
  } catch (e) {
    return String(e);
  }
}

test('it is taken beside every other pack: active, and no id it declares is another pack’s', async () => {
  const l = await fresh();
  const packs = await call<{ id: string; state: string }[]>(l, human, 'packs', {});
  assert.equal(packs.find((p) => p.id === 'design')?.state, 'active');
  for (const id of Object.keys(STANDS_ON)) assert.equal((await schema(l, id)).types[0]?.pack, 'design', id);
});

test('each type is a flavour of the starter it stands on, with statuses that open and close', async () => {
  const l = await fresh();
  const plannable: string[] = [];
  for (const [id, starter] of Object.entries(STANDS_ON)) {
    const t = (await schema(l, id)).types[0];
    assert.equal(t.starter, starter, id);
    assert.ok(t.statuses.open.length && t.statuses.closed.length, `${id} opens and closes`);
    assert.ok((t.description ?? '').length > 40, `${id} says what it is`);
    if (t.capabilities?.plannable) plannable.push(id);
  }
  assert.ok(plannable.includes('element') && plannable.includes('study'), 'an element and a study are work to plan');
  assert.ok(!plannable.includes('concept'), 'a concept is weighed, not done');
});

test('its fields are checked on write', async () => {
  const l = await fresh();
  const research = (props: Record<string, unknown>) => tried(l, [{ op: 'create', type: 'research', title: 'Research', props }]);
  assert.equal(await research({ kind: 'shift', assumed: 'one graph', now: 'islands (e_a7zuqqhz)' }), true);
  assert.equal(await research({ kind: 'fundamental', cites: 'Misue et al., 1995' }), true);
  assert.equal(await research({ kind: 'observation', measured_on: '2026-11-05' }), true);
  assert.match(String(await research({ kind: 'rumour' })), /kind must be one of/, 'a kind is one of the five');
  assert.notEqual(await research({ measured_on: 'last week' }), true, 'a date is a date');
  assert.notEqual(await research({ value: 3 }), true, 'an undeclared field is refused');
  assert.notEqual(await tried(l, [{ op: 'create', type: 'concept', title: 'A concept', status: 'chosen' }]), true, 'a concept is adopted or dropped, not chosen');
});

test('its links take the ends the work needs, and refuse the others', async () => {
  const l = await fresh();
  const kinds = ['element', 'research', 'concept', 'decision', 'writeup', 'study', 'task', 'question', 'tenet'];
  const made = await make(l, kinds.map((type) => ({ op: 'create' as const, ref: type, type, title: `A ${type}` })));
  const link = (type: string, from: string, to: string) => tried(l, [{ op: 'link', type, from: made[from], to: made[to] }]);
  const fine = async (rel: string, from: string, to: string) => assert.equal(await link(rel, from, to), true, `${from} ${rel} ${to}`);
  const refused = async (rel: string, from: string, to: string) => assert.notEqual(await link(rel, from, to), true, `${from} ${rel} ${to} is refused`);
  await fine('rests_on', 'element', 'research');
  await fine('rests_on', 'concept', 'decision');
  await fine('rests_on', 'writeup', 'study');
  await refused('rests_on', 'task', 'concept');
  await fine('alternative_for', 'concept', 'decision');
  await fine('alternative_for', 'concept', 'question');
  await refused('alternative_for', 'element', 'decision');
  await refused('alternative_for', 'concept', 'element');
  await fine('goes_against', 'concept', 'decision');
  await refused('goes_against', 'concept', 'tenet');
  await fine('bears_on', 'research', 'concept');
  await fine('part_of', 'research', 'study');
  await fine('serves', 'element', 'tenet');
  const made2 = await make(l, [{ op: 'create', ref: 'e', type: 'element', title: 'Another element' }]);
  assert.equal(await tried(l, [{ op: 'link', type: 'depends_on', from: made2.e, to: made.element }]), true, 'element depends_on element');
  assert.equal((await schema(l, 'rests_on')).relations[0].root, 'about');
  assert.equal((await schema(l, 'alternative_for')).relations[0].root, 'bears_on');
});

test('its views and instructions come with it', async () => {
  const l = await fresh();
  const { screens } = await call<{ screens: { pack: string; on?: string[]; pieces: { piece: string }[] }[] }>(l, human, 'schema', { full: true });
  assert.ok(screens.some((s) => s.on?.includes('writeup') && s.pieces.some((p) => p.piece === 'document')), 'a write-up is read whole on its page');
  const of = (type: string) => (file.styles ?? []).filter((s) => s.type === type).map((s) => s.id).sort();
  assert.deepEqual(of('lens'), ['design.grounds', 'design.open']);
  assert.deepEqual(of('instruction'), ['design.tending']);
  assert.deepEqual(of('style'), [], 'no looks');
  const tending = (file.styles ?? []).find((s) => s.id === 'design.tending')!;
  for (const type of ['research', 'fundamental', 'precedent', 'shift', 'observation', 'sketch', 'concept', 'alternative_for', 'element', 'finding']) {
    assert.match(tending.body ?? '', new RegExp(`\\b${type}\\b`), `the instruction names ${type}`);
  }
  const packs = await call<{ id: string; touches: { key: string; n: number }[] }[]>(l, human, 'packs', {});
  const touches = Object.fromEntries(packs.find((p) => p.id === 'design')!.touches.map((t) => [t.key, t.n]));
  assert.equal(touches.instructions, 1, 'the server reads its instruction too');
});
