// A pack requires names, never packs (decision e_f9ybsuce): a capability, a type or an event kind, provided by
// whichever active pack declares it. Swapping the provider leaves its consumers active.
import assert from 'node:assert/strict';
import { cpSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { readManifest } from '../src/manifest.ts';
import { dependentsOf, orderPacks, providersOf } from '../src/packorder.ts';
import { Registry, type PackFile } from '../src/packs.ts';
import { reachOf } from '../src/reach.ts';
import { PACKS } from './map.ts';

/** A pack that provides a gathering: a type with when, and an event its handler records. Two of them, either will do. */
const calendar = (id: string): PackFile => ({
  id, version: '0.1.0', title: id,
  types: [{ id: 'gathering', title: 'Gathering', description: 'People met at a time.', extends: 'record', capabilities: { when: { at: 'on' } }, fields: { on: { type: 'date' } } }],
});
/** What builds on a gathering without naming who provides it. */
const MINUTES: PackFile = {
  id: 'minutes', version: '0.1.0', title: 'Minutes', requires: ['type:gathering', 'has:when'],
  types: [{ id: 'minute', title: 'Minute', description: 'What was said at one.', extends: 'gathering' }],
};

function packsDir(...packs: PackFile[]) {
  const dir = mkdtempSync(join(tmpdir(), 'pelago-requires-'));
  cpSync(join(PACKS, 'core'), join(dir, 'core'), { recursive: true });
  for (const p of packs) mkdirSync(join(dir, p.id)), writeFileSync(join(dir, p.id, 'pack.json'), JSON.stringify(p));
  return dir;
}

test('a name is provided by whichever pack declares it, the kernel for its own events', () => {
  const core = new Registry(PACKS).found.find((p) => p.id === 'core')!;
  const heard: PackFile = { id: 'heard', version: '0.1.0', title: 'Heard', handlers: [{ webhook: 'in', records: ['door.opened'] }] };
  const all = [core, calendar('cal_a'), heard];
  assert.deepEqual(providersOf('type:gathering', all), ['cal_a']);
  assert.ok(providersOf('has:when', all).includes('cal_a'));
  assert.deepEqual(providersOf('event:item.due', all), ['core']);
  assert.deepEqual(providersOf('event:door.opened', all), ['heard']);
  assert.deepEqual(providersOf('cal_a', all), ['cal_a'], 'a bare id is a pack: the old form');
  assert.deepEqual(providersOf('type:nowhere', all), []);
});

test('swapping the provider of a type leaves its consumer active', () => {
  const reg = new Registry(packsDir(calendar('cal_a'), calendar('cal_b'), MINUTES));
  assert.deepEqual(reg.states.get('cal_b'), { state: 'waiting', why: "gathering is cal_a's: one pack owns a name" });
  assert.equal(reg.states.get('minutes')!.state, 'active');
  assert.equal(reg.type('minute')!.lineage[1], 'gathering');
  assert.equal(reg.type('gathering')!.pack, 'cal_a');
  assert.ok(reachOf(reg, 'minutes').has('cal_a'), 'a type it requires is in its reach');
  assert.deepEqual(dependentsOf(reg.packs, 'cal_a'), ['minutes']);

  reg.turnOff(['cal_a']);
  assert.equal(reg.states.get('minutes')!.state, 'active', 'the other provider stands in');
  assert.equal(reg.type('gathering')!.pack, 'cal_b');
  assert.ok(reachOf(reg, 'minutes').has('cal_b') && !reachOf(reg, 'minutes').has('cal_a'));

  reg.turnOff(['cal_a', 'cal_b']);
  assert.deepEqual(reg.states.get('minutes'), { state: 'waiting', why: 'needs type:gathering, which cal_a is off, cal_b is off' });
});

test('a name nobody provides leaves the pack waiting, saying so', () => {
  const core = new Registry(PACKS).found.find((p) => p.id === 'core')!;
  const found = new Map([core, MINUTES].map((p) => [p.id, p]));
  const { states } = orderPacks(found, new Map(), 'local');
  assert.deepEqual(states.get('minutes'), { state: 'waiting', why: 'needs type:gathering: no pack here provides it' });
});

test('a name is has:, type:, event: or a pack id', () => {
  const read = (requires: unknown) => readManifest(JSON.stringify({ id: 'p', version: '0.1.0', title: 'P', requires }), 'test');
  assert.doesNotThrow(() => read(['has:when', 'type:event', 'event:item.due', 'work']));
  assert.throws(() => read(['needs:when']), /a name is has:<capability>/);
});

test('the public packs require names, and are active with core alone beside them', () => {
  const reg = new Registry(PACKS);
  for (const id of ['automations', 'email', 'refine', 'replays']) assert.equal(reg.states.get(id)!.state, 'active', id);
  for (const p of reg.found) for (const r of p.requires ?? []) assert.match(r, /^(has|type|event):/, `${p.id} requires ${r}: a name, not a pack`);
  assert.ok(reachOf(reg, 'refine').has('replays'), 'what refine uses by type is in its reach');
});
