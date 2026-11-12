// Where the server runs a drawing for a first frame (src/drawing-box.ts): in a process of its own, never its own. A
// hostile drawing reads no file, reaches no network, starts no process, sees no environment and makes no code from
// strings; one that never answers is stopped; one that is the pack's own still draws.

import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { drawOnce } from '../src/drawing-box.ts';
import { packLayout } from '../src/layouts.ts';

const HOSTILE = `
const tried = {};
const attempt = async (name, fn) => { try { tried[name] = 'open: ' + String(await fn()); } catch (e) { tried[name] = 'shut'; } };
await attempt('fs', async () => (await import('node:fs')).readFileSync(${JSON.stringify(join(import.meta.dirname, 'drawing-box.test.ts'))}, 'utf8'));
await attempt('fs bare', async () => (await import('fs')).readdirSync('.'));
await attempt('net', async () => (await import('node:net')).connect(80, '127.0.0.1') && 'socket');
await attempt('http', async () => (await import('node:http')).get('http://127.0.0.1') && 'request');
await attempt('child process', async () => (await import('node:child_process')).execSync('echo hi'));
await attempt('worker', async () => new (await import('node:worker_threads')).Worker('1', { eval: true }) && 'worker');
await attempt('fetch', async () => (await fetch('http://127.0.0.1')).status);
await attempt('WebSocket', async () => new WebSocket('ws://127.0.0.1') && 'socket');
await attempt('env', async () => JSON.stringify(process.env));
await attempt('builtin', async () => process.getBuiltinModule('node:net') && 'net');
await attempt('data url', async () => (await import('data:text/javascript,export default 1')).default);
await attempt('outside', async () => (await import('../outside.js')).default);
await attempt('Function', async () => Function('return 1')());
await attempt('eval', async () => (0, eval)('1'));
export function picture() { return { scene: { svg: ['svg', {}], tried } }; }
`;

test('a hostile drawing is shut in, and its scene still comes back', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'pelago-drawing-'));
  try {
    writeFileSync(join(dir, 'outside.js'), 'export default "read"');
    const own = join(dir, 'own');
    mkdirSync(own);
    writeFileSync(join(own, 'index.js'), HOSTILE);
    const scene = (await drawOnce(join(own, 'index.js'), {})) as { svg: unknown; tried: Record<string, string> };
    assert.deepEqual(scene.svg, ['svg', {}]);
    assert.equal(Object.keys(scene.tried).length, 14);
    for (const [name, what] of Object.entries(scene.tried)) assert.equal(what, 'shut', name);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a drawing that never answers is stopped, and one that throws says so', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'pelago-drawing-'));
  try {
    writeFileSync(join(dir, 'hang.js'), 'export function picture() { for (;;) {} }');
    writeFileSync(join(dir, 'throw.js'), 'export function picture() { throw new Error("no picture"); }');
    await assert.rejects(drawOnce(join(dir, 'hang.js'), {}, 1500), /longer than 1500 ms/);
    await assert.rejects(drawOnce(join(dir, 'throw.js'), {}), /no picture/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('each drawing the canvas pack ships draws its scene in the box, its imports and all', async () => {
  const folder = join(import.meta.dirname, '..', 'packs', 'canvas');
  const file = JSON.parse(readFileSync(join(folder, 'pack.json'), 'utf8'));
  const packs = { folderOf: () => folder, packs: [file] };
  const house = file.styles.find((s: { id: string }) => s.id === 'core.house').props;
  const answer = { items: [{ id: 'e_a', type: 'task', title: 'A' }, { id: 'e_b', type: 'task', title: 'B' }], links: [{ id: 'r_1', kind: 'depends_on', from: 'e_a', to: 'e_b' }] };
  for (const { id } of file.layouts as { id: string }[]) {
    const entry = packLayout(packs, id)?.entry;
    assert.ok(entry, id);
    const scene = await drawOnce(entry, { answer, style: { ...house, noLit: true, still: true }, types: {}, fields: {}, relations: {}, reduced: false });
    assert.ok(scene && 'svg' in scene, id);
  }
});
