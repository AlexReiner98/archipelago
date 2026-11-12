// A run keeps the packs it ran under, each by version and manifest hash, so a change to a pack shows on the next run.
import assert from 'node:assert/strict';
import { cpSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { Registry } from '../packs/loader/kernel/packs.ts';
import { packStates, syncPacks } from '../packs/loader/kernel/packstate.ts';
import * as sessionsPack from '../packs/sessions/kernel/sessions.ts';
import { agent, freshWith, PACKS } from './map.ts';
import { ownContext } from '../packs/loader/kernel/kernel-context.ts';

const TALLY = { id: 'tally', version: '0.1.0', title: 'Tally', description: 'Counts kept by hand.', requires: ['core'], types: [] as unknown[] };

test('a run records its packs, and a changed manifest gives the next run a different set', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'pelago-runpacks-'));
  cpSync(join(PACKS, 'core'), join(dir, 'core'), { recursive: true });
  mkdirSync(join(dir, 'tally'));
  writeFileSync(join(dir, 'tally', 'pack.json'), JSON.stringify(TALLY));
  const l = await freshWith(new Registry(dir));
  await syncPacks(l);

  const runPacks = async (session_id: string) => {
    const { run } = await sessionsPack.sessionStart(ownContext(l, 'sessions'), agent as sessionsPack.Actor, ({ cwd: dir, session_id }));
    return (await l.entity(run))!.props.packs as { id: string; version: string; manifest: string }[];
  };
  const first = await runPacks('one');
  const tally = first.find((p) => p.id === 'tally');
  assert.deepEqual(tally, { id: 'tally', version: '0.1.0', manifest: l.registry.hashes.get('tally') }, 'each pack by its version and the hash of its manifest');
  assert.match(tally!.manifest, /^[0-9a-f]{64}$/);
  assert.ok(first.some((p) => p.id === 'core'), 'the kernel is among them');
  assert.equal(packStates(l).find((p) => p.id === 'tally')!.manifest, tally!.manifest, 'the Packs screen is given the same hash');

  writeFileSync(join(dir, 'tally', 'pack.json'), JSON.stringify({ ...TALLY, version: '0.2.0', description: 'Counts kept by hand, twice.' }));
  l.registry.reload();
  await syncPacks(l);
  const second = await runPacks('two');
  const after = second.find((p) => p.id === 'tally')!;
  assert.equal(after.version, '0.2.0');
  assert.notEqual(after.manifest, tally!.manifest, 'a changed manifest is a different hash on the next run');
  assert.deepEqual(second.find((p) => p.id === 'core'), first.find((p) => p.id === 'core'), 'a pack left alone is the same');
});
