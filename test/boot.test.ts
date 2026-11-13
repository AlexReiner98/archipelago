// The boot stub (src/boot.ts): it starts only on the root packs roots.json pins, starts them in order with only the
// roots above each in reach, fills what they open, opens a workspace in phases, and stops them in reverse.

import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, test } from 'node:test';
import { boot, BootRefused, checkRoots, hashPack, HOME, OPEN_PHASES, pinRoots, type RootModule, type RootStarted } from '../src/boot.ts';

const homes: string[] = [];
after(() => { for (const h of homes) rmSync(h, { recursive: true, force: true }); });

/** A repository with these packs, each { id: manifest extras, files under kernel/ }, and roots.json listing `roots`. */
function home(packs: Record<string, { kernel?: object; files?: Record<string, string>; json?: string }>, roots: string[]): string {
  const h = mkdtempSync(join(tmpdir(), 'pelago-boot-')); homes.push(h);
  for (const [id, p] of Object.entries(packs)) {
    mkdirSync(join(h, 'packs', id, 'kernel'), { recursive: true });
    writeFileSync(join(h, 'packs', id, 'pack.json'), p.json ?? JSON.stringify({ id, version: '1.0.0', ...(p.kernel ? { kernel: p.kernel } : {}) }));
    for (const [f, text] of Object.entries(p.files ?? {})) writeFileSync(join(h, 'packs', id, 'kernel', f), text);
  }
  writeFileSync(join(h, 'packs', 'roots.json'), JSON.stringify({ roots: roots.map((id) => ({ id, hash: '' })) }));
  pinRoots(h);
  return h;
}

const root = { trust: 'root', internal: true, modules: 'kernel/' };

test('the repository starts on the root packs it pins', () => {
  assert.deepEqual(checkRoots(HOME), [], 'packs/roots.json pins every root pack as its folder is: npm run roots');
});

test("a root pack's hash is its folder's, whatever the line endings and the manifest's spacing", () => {
  const a = home({ x: { kernel: root, files: { 'index.ts': 'export const a = 1;\nexport const b = 2;\n' } } }, ['x']);
  const b = home({ x: { kernel: root, files: { 'index.ts': 'export const a = 1;\r\nexport const b = 2;\r\n' }, json: `{\n  "version": "1.0.0",\n  "id": "x",\n  "kernel": ${JSON.stringify(root)}\n}` } }, ['x']);
  assert.equal(hashPack(join(a, 'packs', 'x')), hashPack(join(b, 'packs', 'x')));
  writeFileSync(join(a, 'packs', 'x', 'kernel', 'index.ts'), 'export const a = 2;\n');
  assert.notEqual(hashPack(join(a, 'packs', 'x')), hashPack(join(b, 'packs', 'x')));
  // A root's walled parts are its own as much as its kernel: a changed part is a changed root.
  const before = hashPack(join(b, 'packs', 'x'));
  mkdirSync(join(b, 'packs', 'x', 'parts', 'row'), { recursive: true });
  writeFileSync(join(b, 'packs', 'x', 'parts', 'row', 'index.js'), 'export default () => ({ marks: [] });\n');
  assert.notEqual(hashPack(join(b, 'packs', 'x')), before, 'parts/** is in the hash');
});

test('a changed root pack stops the start, naming it and both hashes', async () => {
  const h = home({ core: {}, db: { kernel: root, files: { 'index.ts': '' } } }, ['core', 'db']);
  const pinned = JSON.parse(readFileSync(join(h, 'packs', 'roots.json'), 'utf8')).roots[1].hash;
  writeFileSync(join(h, 'packs', 'db', 'kernel', 'more.ts'), 'export {};\n');
  const now = hashPack(join(h, 'packs', 'db'));
  await assert.rejects(boot({ home: h, load: async () => ({ start: () => ({}) }) }), (err: Error) => err instanceof BootRefused && err.message.includes('db:') && err.message.includes(pinned) && err.message.includes(now));
});

test('a root pack the list leaves out, or a listed pack that is no root, stops the start', () => {
  const h = home({ core: {}, db: { kernel: root }, svc: { kernel: { trust: 'service', internal: true } } }, ['core', 'svc']);
  const wrong = checkRoots(h).join('\n');
  assert.match(wrong, /db: its manifest says it is a root pack/);
  assert.match(wrong, /svc: listed as a root, but its manifest's kernel.trust is service/);
});

test('roots start in order, each reaching only those above it, and stop in reverse', async () => {
  const h = home({ core: {}, db: { kernel: root }, log: { kernel: root } }, ['core', 'db', 'log']);
  const seen: string[] = [];
  const mods: Record<string, RootModule> = {
    db: { start: (ctx) => { seen.push(`start ${ctx.pack.id}`); return { query: () => 'rows', stop: () => void seen.push('stop db') }; } },
    log: { start: (ctx) => { seen.push(`start log, db answers ${ctx.root<{ query(): string }>('db').query()}`); return { stop: () => void seen.push('stop log') }; } },
  };
  const booted = await boot({ home: h, load: async (_path, id) => mods[id] });
  assert.deepEqual(Object.keys(booted.hashes), ['core', 'db', 'log']);
  await booted.stop();
  assert.deepEqual(seen, ['start db', 'start log, db answers rows', 'stop log', 'stop db']);
});

test('a root that asks for one after it stops the start, and those started are stopped', async () => {
  const h = home({ db: { kernel: root }, log: { kernel: root } }, ['db', 'log']);
  const seen: string[] = [];
  const mods: Record<string, RootModule> = {
    db: { start: (ctx) => { ctx.root('log'); return {}; } },
    log: { start: () => ({}) },
  };
  await assert.rejects(boot({ home: h, load: async (_p, id) => mods[id] }), /db root pack asks for log, which starts after it/);
  mods.db = { start: () => ({ stop: () => void seen.push('stop db') }) };
  mods.log = { start: () => { throw new Error('no disk'); } };
  await assert.rejects(boot({ home: h, load: async (_p, id) => mods[id] }), /the log root pack failed to start: no disk/);
  assert.deepEqual(seen, ['stop db']);
});

test('the loader fills what each root opens, and a workspace opens root by root, then phase by phase, then its timers', async (t) => {
  t.mock.timers.enable({ apis: ['setInterval'] });
  const h = home({ write: { kernel: root }, loader: { kernel: root } }, ['write', 'loader']);
  const seen: string[] = [];
  const filled: Record<string, number> = {};
  const fill = (name: string) => (ws: string) => void seen.push(`${name} ${ws}`);
  const loader: RootStarted = {
    fillings: (point) => (point.startsWith('open.') ? [fill(point)] : point === 'write.follow' ? [() => [], () => []] : []),
    timers: () => [{ pack: 'clocks', every_ms: 1000, leading: true, run: (ws) => void seen.push(`tick ${ws}`) }],
    open: (ws) => void seen.push(`loader opens ${ws}`),
  };
  const mods: Record<string, RootModule> = {
    write: { start: () => ({ opens: ['write.follow'], fill: (point, fns) => void (filled[point] = fns.length), open: (ws) => void seen.push(`write opens ${ws}`) }) },
    loader: { start: () => loader },
  };
  const booted = await boot({ home: h, load: async (_p, id) => mods[id] });
  assert.deepEqual(filled, { 'write.follow': 2 });
  await booted.open('w1');
  assert.deepEqual(seen, ['write opens w1', 'loader opens w1', ...OPEN_PHASES.map((p) => `open.${p} w1`), 'tick w1']);
  t.mock.timers.tick(1000);
  assert.equal(seen.at(-1), 'tick w1');
  seen.length = 0;
  await booted.open('w2', false); // a server that follows runs no timers
  assert.ok(!seen.includes('tick w2'));
  await booted.close('w1');
  t.mock.timers.tick(5000);
  assert.ok(!seen.includes('tick w1'), 'a closed workspace runs no timers');
  await booted.stop();
});
