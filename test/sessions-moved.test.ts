// The sessions pack, moved out of core with its ids (decision e_3v6x2u2m; src/pack-moved.ts): a map that had core
// while core declared a session's screens, view and instructions is given the pack, once, and a session there is
// still told to report in; a view or preset keeps its core id (keptFromKernel), so what names it still finds it.
import assert from 'node:assert/strict';
import { readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { after, test } from 'node:test';
import { openDb } from '../src/db.ts';
import { instructionsFor } from '../src/instructions.ts';
import { keptFromKernel } from '../src/packorder.ts';
import { hostFor } from '../src/packtools.ts';
import { Registry } from '../src/packs.ts';
import { packsOff, syncPacks } from '../src/packstate.ts';
import { Archipelago } from '../src/pelago.ts';
import { syncTypes } from '../src/typetable.ts';
import { human, packsWith } from './map.ts';

const registries: Registry[] = [];
after(() => registries.forEach((r) => hostFor(r).stop()));

const read = (dir: string, pack: string) => JSON.parse(readFileSync(join(dir, pack, 'pack.json'), 'utf8')) as Record<string, unknown[]>;

/** The packs as they were before the move: the sessions pack's views and styles back in core, and no sessions folder. */
function before(): string {
  const dir = packsWith();
  const core = read(dir, 'core'), sessions = read(dir, 'sessions');
  for (const key of ['views', 'styles'] as const) core[key] = [...core[key], ...(sessions[key] ?? [])];
  writeFileSync(join(dir, 'core', 'pack.json'), JSON.stringify(core));
  rmSync(join(dir, 'sessions'), { recursive: true });
  return dir;
}

async function mapOn(dir: string, db?: Archipelago['db']) {
  const reg = new Registry(dir);
  registries.push(reg);
  const l = new Archipelago(db ?? (await openDb()), reg);
  return (await syncTypes(l), l);
}

test('a kernel id is kept by the pack it moved to, and no other prefix is', () => {
  assert.ok(keptFromKernel('core.report_in'));
  assert.ok(!keptFromKernel('corey.x') && !keptFromKernel('work.x'));
});

test('a map that had core before the move is given sessions, and a session there is still told to report in', async () => {
  const old = await mapOn(before());
  await old.change(human, { reason: 'test', ops: [{ op: 'create', type: 'task', title: 'Made before the move' }] });
  await syncPacks(old);
  const now = await mapOn(packsWith(), old.db);
  assert.deepEqual((await syncPacks(now)).filter((f) => /pack:sessions$/.test(f[1])).map((f) => f[0]), ['+']);
  assert.ok(!(await packsOff(now)).includes('sessions'));
  const said = (await instructionsFor(now, 'session_start', { fill: { run: 'r' } })).map((s) => s.preset);
  assert.ok(said.includes('core.report_in') && said.includes('core.estimate'), said.join(', '));
});
