// A session finds where it works through the where capability: the kernel asks the types of place that say what
// they are known by (an address, a folder), and with no such type a session is tied to no place.
import assert from 'node:assert/strict';
import { cpSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, test } from 'node:test';
import { checkCapabilities } from '../src/capabilities.ts';
import { openDb } from '../src/db.ts';
import { hostFor } from '../src/packtools.ts';
import { Archipelago, type Actor } from '../src/pelago.ts';
import { Registry } from '../src/packs.ts';
import { addressKey, sameAddress } from '../src/places.ts';
import { callTool } from '../src/tools.ts';

const human: Actor = { kind: 'human', name: 'test' };
const PACKS = join(import.meta.dirname, '..', 'packs');

const registries: Registry[] = [];
after(() => registries.forEach((r) => hostFor(r).stop()));

async function map(dir = PACKS) {
  const reg = new Registry(dir);
  registries.push(reg);
  return new Archipelago(await openDb(), reg);
}

const linksOf = async (l: Archipelago, run: string) => (await l.db.query<{ type: string; to_id: string }>(`select type, to_id from relation where from_id = $1 and valid_to is null`, [run])).rows;

test('an address is one key however it is written', () => {
  const forms = ['https://github.com/Owner/Name', 'https://github.com/owner/name.git', 'git@github.com:owner/name.git', 'ssh://git@github.com/owner/name', 'https://token@github.com/owner/name/'];
  assert.deepEqual(new Set(forms.map(addressKey)), new Set(['github.com/owner/name']));
  assert.ok(sameAddress('owner/name', 'https://github.com/owner/name'), 'a name without its host');
  assert.ok(!sameAddress('github.com/owner/name', 'github.com/owner/other'));
  assert.ok(!sameAddress('github.com/owner/name', 'github.com/other-owner/name'));
});

test('with the software pack a session lands on its repository, by its remote or its folder', async () => {
  const l = await map();
  const made = (await l.change(human, {
    reason: 'test',
    ops: [
      { op: 'create', ref: 'a', type: 'repo', title: 'A repo', props: { remote: 'https://github.com/me/a', path: 'C:\\code\\a' } },
      { op: 'create', ref: 'b', type: 'repo', title: 'B repo', props: { remote: 'https://github.com/me/b' } },
    ],
  })) as { created: Record<string, string> };
  const byRemote = (await callTool(l, human, 'session_start', { remote: 'git@github.com:me/b.git', cwd: 'C:\\code\\a' })) as { run: string; repo: { id: string } };
  assert.equal(byRemote.repo.id, made.created.b, 'the address wins over the folder: it is the same on every machine');
  assert.deepEqual(await linksOf(l, byRemote.run), [{ type: 'lives_in', to_id: made.created.b }], 'tied by the flavour of lives_in a repository is made for');
  const byFolder = (await callTool(l, human, 'session_start', { cwd: 'c:/code/a/src' })) as { run: string; repo: { id: string } };
  assert.equal(byFolder.repo.id, made.created.a);
  const nowhere = (await callTool(l, human, 'session_start', { cwd: 'D:\\elsewhere' })) as { run: string; repo?: unknown };
  assert.equal(nowhere.repo, undefined);
});

test('without a pack that knows places, a session starts tied to no place', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'pelago-places-'));
  cpSync(PACKS, dir, { recursive: true });
  rmSync(join(dir, 'software'), { recursive: true });
  const l = await map(dir);
  const started = (await callTool(l, human, 'session_start', { remote: 'https://github.com/me/a', cwd: 'C:\\code\\a', title: 'Here' })) as { run: string; repo?: unknown };
  assert.ok(started.run);
  assert.equal(started.repo, undefined);
  assert.deepEqual(await linksOf(l, started.run), []);
  const ended = (await callTool(l, human, 'session_end', { run: started.run, summary: 'done' })) as { status: string };
  assert.equal(ended.status, 'finished');
});

test('a place says what it is known by; it is not also somewhere', () => {
  const fields = { remote: { type: 'url' as const }, path: { type: 'string' as const }, n: { type: 'number' as const } };
  assert.deepEqual(checkCapabilities({ where: { address: 'remote', folder: 'path' } }, fields, new Set()), []);
  assert.match(checkCapabilities({ where: { folder: 'n' } }, fields, new Set()).join(), /where.folder reads "n", a number/);
  assert.match(checkCapabilities({ where: { address: 'remote', field: 'path' } }, fields, new Set()).join(), /a place is known by its address or folder/);
  assert.match(checkCapabilities({ where: {} }, fields, new Set()).join(), /names the address or folder/);
});
