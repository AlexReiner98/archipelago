// The page's modules import one another by name across packs' page/ folders (packs/surface/kernel/ui-files.ts serves
// each from whichever holds it); test/page-loader.ts resolves those names the same way under node, so a test can
// import a module as it is, with what it imports from other packs.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { pageModule } from './page-loader.ts';

test("a page module imports another pack's module by name, and runs", async () => {
  // packs/surface/page/part-away.js imports ./part-slots.js, which is in packs/walls/page/ (and imports ./lens-terms.js there).
  const { tellAway } = await pageModule('part-away.js');
  const told: string[] = [];
  const mount = (slot: string, connected = true) => ({ m: { part: { slot }, node: { isConnected: connected } }, tell: (e: { name: string }) => told.push(`${slot}:${e.name}`) });
  tellAway(() => [mount('find'), mount('bar.find.rows'), mount('tabs'), mount('bar.find', false)]);
  assert.deepEqual(told, ['find:away', 'bar.find.rows:away']);
});

test('the module a page module imports by name is the one the server serves, not a second copy', async () => {
  const { AWAY_SLOTS } = await pageModule('part-slots.js');
  const slots = await import('../packs/walls/page/part-slots.js' as string);
  assert.equal(AWAY_SLOTS, slots.AWAY_SLOTS);
});

test('a name no page folder holds is refused, not guessed', async () => {
  await assert.rejects(pageModule('no-such-module.js'), /not a module of the page/);
});
