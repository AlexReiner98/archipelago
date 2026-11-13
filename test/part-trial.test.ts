// A part's new version runs on a trial island (task e_g4jpb7ps, decision e_6f2kje39): an agent's version of a map pack
// whose code is its parts' modules alone applies at once while one island at most pins it, and that island draws it;
// pinning it on another island, code beside the parts, or the map's own version of the part waits for the owner
// (core's rules part_trial and version_spread, read from packs/loader/kernel/part-trial.ts by decide).

import assert from 'node:assert/strict';
import { rmSync } from 'node:fs';
import { test } from 'node:test';
import { islandRegistry } from '../packs/loader/kernel/island-pin.ts';
import { Registry } from '../packs/loader/kernel/packs.ts';
import { setIslands, setPack } from '../packs/loader/kernel/packstate.ts';
import { hostFor } from '../packs/loader/kernel/packtools.ts';
import { partsFor } from '../packs/loader/kernel/ui-parts.ts';
import { checkRules } from '../packs/rules/kernel/rules.ts';
import type { Actor, Op } from '../packs/write/kernel/pelago.ts';
import { freshWith, human, make, packsWith } from './map.ts';

const agent: Actor = { kind: 'agent', name: 'refiner' };

/** The repository's packs and test/packs/shelf: a map pack with a handler and one part of two modules. */
const folder = () => packsWith('shelf');

const look = (word: string) => ({ 'parts/row/look.js': `export const look = '${word}';\n` });

test('a part-only version runs on its one trial island at once; spreading it, or more than part code, waits', async () => {
  const dir = folder();
  const l = await freshWith(new Registry(dir));
  try {
    await l.db.query(`insert into setting (key, value) values ('agent_changes', '"apply"'::jsonb) on conflict (key) do update set value = excluded.value`);
    await setIslands(l, human, true);
    await setPack(l, human, { pack: 'shelf', on: true });
    const { trial, rest } = await make(l, [
      { op: 'create', ref: 'trial', type: 'island', title: 'Trial', props: { pack: 'core' } },
      { op: 'create', ref: 'rest', type: 'island', title: 'Rest', props: { pack: 'core' } },
    ]);
    const by = async (ops: Op[], who: Actor = agent) => (await l.change(who, { ops, reason: 'the test' })) as { status: string; created: Record<string, string>; held_by?: { rule: string }; let_through?: { rule: string; by: string }[] };

    // An agent's version whose code is the part's modules alone applies, core's code rules spared by part_trial.
    const made = await by([{ op: 'create', ref: 'v', type: 'pack', title: 'Shelf, bolder', props: { version_of: 'shelf', manifest: {}, code: look('bold') } }]);
    assert.equal(made.status, 'applied');
    assert.ok(made.let_through?.some((r) => r.rule === 'pack_code' && r.by === 'core.part_trial'), JSON.stringify(made.let_through));
    const v = made.created.v;

    // Pinned on one island, it draws there at once, and only there.
    assert.equal((await by([{ op: 'update', id: trial, props: { pack_version: v } }])).status, 'applied');
    assert.match(partsFor(await islandRegistry(l, trial)).find((p) => p.id === 'shelf.row')!.modules!['look.js'], /bold/);
    assert.match(partsFor(await islandRegistry(l, rest)).find((p) => p.id === 'shelf.row')!.modules!['look.js'], /plain/);

    // Refined again on its one island, it still applies.
    assert.equal((await by([{ op: 'update', id: v, props: { code: look('bolder') } }])).status, 'applied');

    // Spread to another island, it waits for the owner.
    const spread = await by([{ op: 'update', id: rest, props: { pack_version: v } }]);
    assert.equal(spread.status, 'proposed');
    assert.equal(spread.held_by?.rule, 'version_spread');

    // The map's own version of the part (core's part item) with the same code waits: code_runs.
    const map = await by([{ op: 'create', type: 'part', title: 'Row, bolder', props: { preset: 'shelf.row', pack: 'shelf', slot: 'sheet', code: { 'look.js': "export const look = 'bolder';\n" } } }]);
    assert.equal(map.status, 'proposed');

    // Server code beside the part's, or a file no part names, waits as before: pack_code.
    for (const code of [{ ...look('x'), 'handler.js': 'export default {};\n' }, { 'parts/row/other.js': 'export default 1;\n' }]) {
      const held = await by([{ op: 'create', type: 'pack', title: 'Shelf, more', props: { version_of: 'shelf', manifest: {}, code } }]);
      assert.equal(held.status, 'proposed', Object.keys(code).join());
    }

    // A person spreads it at once; then pinned on two islands, an agent's refinement waits.
    assert.equal((await by([{ op: 'update', id: rest, props: { pack_version: v } }], human)).status, 'applied');
    assert.equal((await by([{ op: 'update', id: v, props: { code: look('boldest') } }])).status, 'proposed');

    // Where agents' changes wait, a trial waits too: part_trial spares the code rules alone.
    await l.db.query(`update setting set value = '"hold"'::jsonb where key = 'agent_changes'`);
    const held = await by([{ op: 'create', type: 'pack', title: 'Shelf, held', props: { version_of: 'shelf', manifest: {}, code: look('held') } }]);
    assert.equal(held.status, 'proposed');
    assert.equal(held.held_by?.rule, 'agent_changes');
  } finally {
    hostFor(l.registry).stop();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a rule spares only rules of its own pack it names', () => {
  const base = { when: { actor: 'agent' as const }, then: 'hold' as const };
  const ok = checkRules([{ id: 'a', ...base }, { id: 'b', when: { actor: 'agent' }, then: 'spare', spares: ['a'] }], { types: new Map() });
  assert.deepEqual(ok, []);
  assert.match(checkRules([{ id: 'b', when: { actor: 'agent' }, then: 'spare', spares: ['elsewhere'] }], { types: new Map() }).join(), /spares names rules of its own pack/);
  assert.match(checkRules([{ id: 'b', when: { actor: 'agent' }, then: 'spare' }], { types: new Map() }).join(), /bookkeeping/);
  assert.match(checkRules([{ id: 'a', ...base, spares: ['a'] }], { types: new Map() }).join(), /spares names/);
});
