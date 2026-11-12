// The root service family (src/root-calls.ts): a root provides root.<name>, only the packs roots.json names for it
// call it, and boot refuses a list that names a pack not here or a name no root provides.

import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, test } from 'node:test';
import { checkRoots, HOME, pinRoots } from '../src/boot.ts';
import { kernelContext } from '../src/kernel-context.ts';
import { kernelProblems } from '../src/manifest.ts';
import { callRoot, readRootTable } from '../src/root-calls.ts';
import { VAULT_BACKUP_DAYS } from '../src/vault.ts';
import { VAULT_DAYS } from '../packs/backup/kernel/backup-run.ts';
import { fresh } from './map.ts';

const homes: string[] = [];
after(() => { for (const h of homes) rmSync(h, { recursive: true, force: true }); });

const root = { trust: 'root', internal: true, modules: 'kernel/' };
const service = { trust: 'service', internal: true, modules: 'kernel/' };

/** A repository with a root `db` that provides root.count, a service `svc` and another `other`, and roots.json's calls. */
function home(calls: Record<string, unknown>): string {
  const h = mkdtempSync(join(tmpdir(), 'pelago-rootcalls-')); homes.push(h);
  const pack = (id: string, manifest: object, files: Record<string, string> = {}) => {
    mkdirSync(join(h, 'packs', id, 'kernel'), { recursive: true });
    writeFileSync(join(h, 'packs', id, 'pack.json'), JSON.stringify({ id, version: '1.0.0', ...manifest }));
    for (const [f, text] of Object.entries(files)) writeFileSync(join(h, 'packs', id, 'kernel', f), text);
  };
  pack('core', {});
  pack('db', { kernel: { ...root, provides: { 'root.count': { run: 'count.ts#count' } } } }, { 'count.ts': 'export const count = (call, input) => ({ caller: call.caller, n: input.n + 1 });\n' });
  pack('svc', { uses: ['service:root.count'], kernel: service });
  pack('other', { uses: ['service:root.count'], kernel: service });
  writeFileSync(join(h, 'packs', 'roots.json'), JSON.stringify({ roots: [{ id: 'core', hash: '' }, { id: 'db', hash: '' }], calls }));
  pinRoots(h);
  return h;
}

test('the repository lists every root service it calls, each provided, each caller a pack here', () => {
  assert.deepEqual(readRootTable(HOME).problems, []);
  assert.deepEqual(checkRoots(HOME), []);
});

test('a pack roots.json names gets the answer; any other is refused', async () => {
  const h = home({ 'root.count': ['svc'] });
  assert.deepEqual(checkRoots(h), []);
  assert.deepEqual(await callRoot('svc', 'root.count', { n: 1 }, {}, h), { caller: 'svc', n: 2 });
  await assert.rejects(callRoot('other', 'root.count', { n: 1 }, {}, h), /The other pack may not call root\.count: packs\/roots\.json lets only svc call it/);
  await assert.rejects(callRoot('svc', 'root.none', {}, {}, h), /No root pack provides root\.none/);
});

test('boot refuses a list naming a pack that is not here, or a name no root provides', () => {
  const wrong = checkRoots(home({ 'root.count': ['svc', 'ghost'], 'root.gone': ['svc'] })).join('\n');
  assert.match(wrong, /lets ghost call root\.count, but there is no pack ghost here/);
  assert.match(wrong, /lets packs call root\.gone, which no root pack provides/);
  assert.match(checkRoots(home({ 'root.count': ['db'] })).join('\n'), /lets db call root\.count, but db is no internal service pack/);
});

test('only a root provides a root service, and a root provides nothing else', () => {
  assert.deepEqual(kernelProblems({ ...root, provides: { 'root.x': { run: 'a.ts#x' } } }), []);
  assert.match(kernelProblems({ ...root, provides: { 'answer.x': { run: 'a.ts#x' } } }).join(), /a root pack provides only root/);
  assert.match(kernelProblems({ ...service, provides: { 'root.x': { run: 'a.ts#x' } } }).join(), /only a root pack provides a root service/);
});

test("through a pack's context: an unlisted pack is refused, and a kernel caller cannot ask a root service", async () => {
  const l = await fresh();
  // usage is no caller of root.dump: refused by the list, though it names the service.
  const usage = kernelContext(l, 'usage');
  await assert.rejects(usage.call('root.dump', { workspace: 'default', name: 'Default' }), /neither requires nor uses|may not call root\.dump/);
  // backup is listed for root.merge; a person's view of the map is refused by the root itself.
  await assert.rejects(kernelContext(l.as('e_nobody00'), 'backup').call('root.merge', { dump: {} }), /writes the whole map/);
});

test("the backup pack keeps a vault's backup as long as the seal says", () => assert.equal(VAULT_DAYS, VAULT_BACKUP_DAYS));
