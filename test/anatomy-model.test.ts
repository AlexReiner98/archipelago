// The pack anatomy model (scripts/anatomy-model.ts): manifests in, the island's items and links out, keyed so a refresh
// reads back what it made.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { keyOf, kindOf, model, type PackFile } from '../scripts/anatomy-model.ts';

const pack = (m: Record<string, unknown>, extra: Partial<PackFile> = {}): PackFile => ({ m, home: 'open_core', path: `packs/${m.id}`, root: false, ...extra });
const CORE = pack({ id: 'core', title: 'Core', types: [{ id: 'work', title: 'Work', capabilities: { owned: true } }], links: [{ id: 'part_of', root: true, from: ['*'], to: ['*'] }] });
const CAL = pack({ id: 'calendar', title: 'Calendar', requires: ['has:owned'], types: [{ id: 'event', title: 'Event', extends: 'work' }] });
const WEEK = pack({ id: 'week', title: 'Week', requires: ['type:event', 'service:answer.flat'], views: [{ id: 'week.view', title: 'Week', shape: 'flow' }], kernel: { modules: 'kernel/', provides: { 'answer.week': { run: 'week.ts#week' } } } });

test('each pack, what it declares and the names it asks for and offers are items, tied as the manifests say', () => {
  const { items, links } = model([CORE, CAL, WEEK], [], {});
  const has = (type: string, from: string, to: string) => links.some((l) => l.type === type && l.from === from && l.to === to);
  assert.ok(items.some((i) => i.key === 'pack:week' && i.props.kind === 'map'), 'a pack with a view that computes is a map pack');
  assert.equal(items.find((i) => i.key === 'pack:calendar')!.props.kind, 'island', 'words alone make an island pack');
  assert.ok(has('part_of', 'type:event', 'pack:calendar') && has('anatomy.extends', 'type:event', 'type:work'));
  assert.ok(has('anatomy.requires', 'pack:week', 'name:type:event') && has('anatomy.provides', 'pack:calendar', 'name:type:event'), 'a name is asked of whoever declares it');
  assert.ok(has('anatomy.grants', 'type:work', 'name:has:owned') && has('anatomy.provides', 'pack:core', 'name:has:owned'));
  assert.ok(has('anatomy.kept_in', 'name:service:answer.week', 'module:packs/week/kernel/week.ts') && has('part_of', 'module:packs/week/kernel/week.ts', 'pack:week'), 'a service is kept in the module that runs it');
  assert.ok(!links.some((l) => l.to === 'name:service:answer.flat' && l.type === 'anatomy.provides'), 'a name nobody here provides has no provider');
  assert.ok(items.every((i) => i.title.length <= 60), 'every title is a name');
});

test('every item is found again by its type, its fields and its pack', () => {
  const { items, links } = model([CORE, CAL, WEEK], [], {});
  const packOf = new Map(links.filter((l) => l.type === 'part_of' && l.to.startsWith('pack:')).map((l) => [l.from, l.to.slice(5)]));
  for (const i of items) assert.equal(keyOf(i.type, i.props, packOf.get(i.key)), i.key);
});

test('a root, core and a server pack are their own kinds', () => {
  assert.equal(kindOf(CORE), 'kernel');
  assert.equal(kindOf(pack({ id: 'loader' }, { root: true })), 'root');
  assert.equal(kindOf(pack({ id: 'billing', reach: { server: { gates: {} } } })), 'server');
});
