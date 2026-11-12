// The practice pack, moved out of core (decision e_2ane3hh4; src/pack-moved.ts): a map that had core while core
// declared the working habits is given the pack, once, and is still held to them; and the rules file a project is
// handed says the words of every pack the server turns on, not core's alone (src/working-rules.ts).
import assert from 'node:assert/strict';
import { readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { after, test } from 'node:test';
import { openDb } from '../packs/database/kernel/db.ts';
import * as instructionsPack from '../packs/agents/kernel/instructions.ts';
import { hostFor } from '../packs/loader/kernel/packtools.ts';
import { Registry } from '../packs/loader/kernel/packs.ts';
import { packsOff, syncPacks } from '../packs/loader/kernel/packstate.ts';
import { Archipelago } from '../packs/write/kernel/pelago.ts';
import { syncTypes } from '../packs/loader/kernel/typetable.ts';
import { checkoutPacks, serverPacks, shippedRules, workingRules } from '../packs/loader/kernel/working-rules.ts';
import { human, packsWith } from './map.ts';
import { kernelContext } from '../packs/loader/kernel/kernel-context.ts';

const registries: Registry[] = [];
after(() => registries.forEach((r) => hostFor(r).stop()));

const read = (dir: string, pack: string) => JSON.parse(readFileSync(join(dir, pack, 'pack.json'), 'utf8')) as Record<string, unknown[]>;

/** The packs as they were before the move: practice's rules and styles back in core under core's ids, and no practice folder. */
function before(): string {
  const dir = packsWith();
  const core = read(dir, 'core'), practice = read(dir, 'practice');
  const back = (d: unknown) => ({ ...(d as object), id: (d as { id: string }).id.replace(/^practice\./, 'core.') });
  for (const key of ['rules', 'styles'] as const) core[key] = [...core[key], ...(practice[key] ?? []).map(back)];
  writeFileSync(join(dir, 'core', 'pack.json'), JSON.stringify(core));
  rmSync(join(dir, 'practice'), { recursive: true });
  return dir;
}

async function mapOn(dir: string, db?: Archipelago['db']) {
  const reg = new Registry(dir);
  registries.push(reg);
  const l = new Archipelago(db ?? (await openDb()), reg);
  return (await syncTypes(l), l);
}

test('a map that had core before the move is given practice, once, and is still held to its habits', async () => {
  const old = await mapOn(before());
  await old.change(human, { reason: 'test', ops: [{ op: 'create', type: 'task', title: 'Made before the move' }] });
  await syncPacks(old);
  const now = await mapOn(packsWith(), old.db);
  assert.deepEqual((await syncPacks(now)).filter((f) => /pack:practice$/.test(f[1])).map((f) => f[0]), ['+']);
  assert.ok(!(await packsOff(now)).includes('practice'));
  assert.deepEqual((await syncPacks(now)).filter((f) => /pack:practice$/.test(f[1])), [], 'once');
  const said = (await instructionsPack.instructionsFor(kernelContext(now, 'agents'), 'session_start', ({ fill: { run: 'r' } }))).map((s) => s.preset);
  assert.ok(said.includes('practice.draw_answers'), said.join(', '));
  assert.ok(said.includes('core.bumps'), 'a habit moved keeping core’s id is said under it');
  const rules = now.registry.rules.filter((r) => r.pack === 'practice').map((r) => r.id);
  assert.deepEqual(rules, ['settle_why', 'views_said', 'draw_answers', 'record_findings']);
  assert.ok(!now.registry.rules.some((r) => r.pack === 'core' && rules.includes(r.id ?? '')), 'core declares none of them now');
});

test('the rules file says every turned-on pack’s working rules: practice’s and the findings line, beside core’s', () => {
  const file = workingRules();
  for (const title of ['Keep the map true', 'Say on whose authority', 'A name is a few words', 'Search before you create', 'A result is items and a view', 'A finding is what an island stands by, in one line', 'Say who is waited on with a link'])
    assert.equal(file.split(`- **${title}.**`).length, 2, `"${title}" once`);
  assert.ok(file.indexOf('A result is items and a view') < file.indexOf('A finding is what an island stands by'), 'in the order the packs give');
  assert.match(shippedRules(), /Keep the map true/, 'and the plugin ships them');
  const only = serverPacks(checkoutPacks(), ['findings']).map((p) => p.id);
  assert.deepEqual(only, ['core', 'findings'], 'a server that names its packs: the kernel and those');
  assert.doesNotMatch(workingRules(serverPacks(checkoutPacks(), ['findings'])), /Keep the map true/, 'a pack the server does not turn on says nothing');
});
