// The Design pack (packs/design, task e_hvmg2ag9): a vocabulary for design and research work, taken on an island map
// and beside every other pack. Read from its file and the registry alone, without a database: each type stands on the
// shared set, each link takes the ends the work needs and refuses the others, and its views and instructions are there.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { presetsOf } from '../src/declared.ts';
import { islandProblems, sharedOf } from '../src/islands.ts';
import { readManifest } from '../src/manifest.ts';
import { Registry } from '../src/packs.ts';

const PACKS = join(import.meta.dirname, '..', 'packs');
const manifest = (id: string) => readManifest(readFileSync(join(PACKS, id, 'pack.json'), 'utf8'), id);

/** What each type stands on: the starter it is a flavour of, through the shared set. */
const STANDS_ON: Record<string, string> = {
  study: 'work', concept: 'question', tenet: 'aim', research: 'record', element: 'work', writeup: 'record',
};

const islands = () => {
  const reg = new Registry(PACKS);
  reg.turnOff([], true);
  return reg;
};

test('the design pack breaks none of the island rules', () => {
  assert.deepEqual(islandProblems(manifest('design'), sharedOf([manifest('core')])), []);
  const reg = islands();
  assert.equal(reg.states.get('design')?.state, 'active');
  assert.equal(reg.states.get('work')?.state, 'off', 'without Work: note and idea are not what a design island speaks');
});

test('it is taken beside every other pack too: no id it declares is another pack’s', () => {
  const reg = new Registry(PACKS);
  assert.equal(reg.states.get('design')?.state, 'active');
  for (const id of Object.keys(STANDS_ON)) assert.equal(reg.type(id)?.pack, 'design', id);
});

test('each type is a flavour of the starter it stands on, with statuses that open and close', () => {
  const reg = islands();
  for (const [id, starter] of Object.entries(STANDS_ON)) {
    assert.equal(reg.ancestry(id).starter, starter, id);
    const t = reg.type(id)!;
    assert.ok(t.statuses.open.length && t.statuses.closed.length, `${id} opens and closes`);
    assert.ok(reg.isOpen(id, t.statuses.open[0]) && !reg.isOpen(id, t.statuses.closed[0]), id);
    assert.ok((t.description ?? '').length > 40, `${id} says what it is`);
  }
  assert.ok(reg.having('plannable').includes('element') && reg.having('plannable').includes('study'), 'an element and a study are work to plan');
  assert.ok(!reg.having('plannable').includes('concept'), 'a concept is weighed, not done');
});

test('its fields are checked on write', () => {
  const reg = islands();
  assert.deepEqual(reg.check('research', 'current', { kind: 'shift', assumed: 'one graph', now: 'islands (e_a7zuqqhz)' }), []);
  assert.deepEqual(reg.check('research', 'current', { kind: 'fundamental', cites: 'Misue et al., 1995' }), []);
  assert.deepEqual(reg.check('research', 'current', { kind: 'observation', measured_on: '2026-11-05' }), []);
  assert.ok(reg.check('research', 'current', { kind: 'rumour' }).length, 'a kind is one of the five');
  assert.ok(reg.check('research', 'current', { measured_on: 'last week' }).length, 'a date is a date');
  assert.ok(reg.check('research', 'current', { value: 3 }).length, 'an undeclared field is refused');
  assert.ok(reg.check('concept', 'chosen', {}).length, 'a concept is adopted or dropped, not chosen');
});

test('its links take the ends the work needs, and refuse the others', () => {
  const reg = islands();
  const fine = (rel: string, from: string, to: string) => assert.equal(reg.checkRelation(rel, from, to), undefined, `${from} ${rel} ${to}`);
  const refused = (rel: string, from: string, to: string) => assert.ok(reg.checkRelation(rel, from, to), `${from} ${rel} ${to} is refused`);
  fine('rests_on', 'element', 'research');
  fine('rests_on', 'concept', 'decision');
  fine('rests_on', 'writeup', 'study');
  refused('rests_on', 'task', 'concept');
  fine('alternative_for', 'concept', 'decision');
  fine('alternative_for', 'concept', 'question');
  refused('alternative_for', 'element', 'decision');
  refused('alternative_for', 'concept', 'element');
  fine('goes_against', 'concept', 'decision');
  refused('goes_against', 'concept', 'tenet');
  fine('bears_on', 'research', 'concept');
  fine('part_of', 'research', 'study');
  fine('depends_on', 'element', 'element');
  fine('serves', 'element', 'tenet');
  assert.ok(reg.relationFamily('about').includes('rests_on') && reg.relationFamily('bears_on').includes('alternative_for'));
});

test('its views and instructions come with it', () => {
  const reg = islands();
  assert.ok(reg.drawnWith('document').includes('writeup'), 'a write-up is read whole on its page');
  const design = reg.packs.filter((p) => p.id === 'design');
  const of = (type: string) => presetsOf(design, type).map((s) => s.id).sort();
  assert.deepEqual(of('lens'), ['design.grounds', 'design.open']);
  assert.deepEqual(of('instruction'), ['design.tending']);
  assert.deepEqual(of('style'), [], 'no looks');
  const tending = presetsOf(design, 'instruction')[0];
  for (const type of ['research', 'fundamental', 'precedent', 'shift', 'observation', 'sketch', 'concept', 'alternative_for', 'element', 'finding']) {
    assert.match(tending.body ?? '', new RegExp(`\\b${type}\\b`), `the instruction names ${type}`);
  }
});
