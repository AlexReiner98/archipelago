// The sessions on a step (layouts/flow/session-ring.js, task e_7csnapar): a task the answer says a session is on
// (`sessions`, as the runs pack's answer.sessions_on gives it) is ringed in that session's hue, one ring outside another
// for two; an old session's ring fades, a dormant one's is dashed; a step nobody is on has none; the tip says who; the
// key has a row for it. The mark itself is test/session-mark.test.ts.

import assert from 'node:assert/strict';
import { copyFileSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { pathToFileURL } from 'node:url';

const read = (folder: string) => JSON.parse(readFileSync(join(import.meta.dirname, '..', folder, 'pack.json'), 'utf8'));
const canvas = read('canvas');
const house = { ...canvas.styles.find((s: any) => s.id === 'core.house').props, shape: 'flow' };
const laid = mkdtempSync(join(tmpdir(), 'pelago-flow-ring-'));
for (const [name, file] of Object.entries(canvas.layouts.find((d: any) => d.id === 'core.map').modules)) copyFileSync(join(import.meta.dirname, file as string), join(laid, name));
const { picture } = await import(pathToFileURL(join(laid, 'index.js')).href);
const tools = { measure: (t: string, px: number) => t.length * px * 0.55, patch: () => {}, frame: () => Promise.resolve(0), open: () => {} };

const on = (k: number, extra = {}) => ({ run: `e_run${k}zzzz`, title: `Chat ${k}`, name: 'Sark', hue: k ? '#2f5fb3' : '#b23a48', state: 'working', since: null, age: 2, fresh: 1, dormant: false, ...extra });
const task = (k: number, sessions?: unknown[]) => ({ id: `e_task${k}zzz`, type: 'task', is: ['work'], title: `Task ${k}`, open: true, status: 'doing', ...(sessions && { sessions }) });
const answer = { items: [task(0, [on(0)]), task(1, [on(0), on(1)]), task(2, [on(0, { fresh: 0, age: 2000, dormant: true, state: 'idle' })]), task(3)], links: [] };

const marks = (node: any): any[] => (Array.isArray(node) && typeof node[0] === 'string' ? [node, ...node.slice(2).flatMap(marks)] : Array.isArray(node) ? node.flatMap(marks) : []);
const stepOf = (svg: any, id: string) => marks(svg).find((x) => x[0] === 'a' && x[1].href === `#/e/${id}`);
const ringsOf = (step: any) => marks(step).filter((x) => String(x[1]?.class ?? '').split(' ').includes('lf-sr'));

test('a task a session is on is ringed in its hue; two sessions, two rings; nobody, none', () => {
  const { scene } = picture({ answer, style: house }, tools);
  const one = ringsOf(stepOf(scene.svg, 'e_task0zzz'));
  assert.equal(one.length, 1);
  assert.ok(one[0][1].class.includes('lf-sr-b23a48'), 'in the session hue');
  assert.match(scene.css, /\.lf-sr-b23a48 \{ --lf-sr: #b23a48; \}/, 'the hue is a rule of its own');
  assert.equal(one[0][1].opacity, undefined, 'a fresh session is not faded');
  assert.equal(ringsOf(stepOf(scene.svg, 'e_task1zzz')).length, 2);
  assert.equal(ringsOf(stepOf(scene.svg, 'e_task3zzz')).length, 0, 'nobody on it, no ring');
});

test('an old session fades to the style\'s least, a dormant one is dashed', () => {
  const { scene } = picture({ answer, style: house }, tools);
  const [ring] = ringsOf(stepOf(scene.svg, 'e_task2zzz'));
  assert.equal(Number(ring[1].opacity), house.numbers.session_faded);
  assert.ok(ring[1].class.includes('dormant'));
  assert.match(scene.css, /\.lf-sr\.dormant/);
});

test('the key has a row for a session on a step', () => {
  const { scene } = picture({ answer, style: house }, tools);
  assert.ok(scene.key.some((row: any) => row.label === 'A session on it'));
  const none = picture({ answer: { items: [task(3)], links: [] }, style: house }, tools).scene;
  assert.ok(!none.key.some((row: any) => row.label === 'A session on it'));
});

test('on a painted island each ring has its tag, moved out with the radius the look hands', async () => {
  const { paintedBody, itemPatches } = await import(pathToFileURL(join(laid, 'painted.js')).href);
  const look = read('sessions').styles.find((s: any) => s.id === 'core.sessions_look').props;
  const style = { ...house, ...look, sizes: { ...house.sizes, ...look.sizes }, numbers: { ...house.numbers, ...look.numbers } };
  const item = task(1, [on(0), on(1)]);
  const m = (tag: string, attrs: any, ...kids: any[]) => [tag, attrs, ...kids.filter((k) => k != null && k !== false)];
  const body = paintedBody({ item, x: 0, y: 0, gap: 4, style, m });
  const tags = marks(body).filter((x) => x[0] === 'text' && String(x[1].class).includes('lf-sr-tag'));
  assert.deepEqual(tags.map((t) => t[2]), ['Working · Chat 0', 'Working · Chat 1'], 'what and who, on each ring');
  assert.ok(tags.every((t) => t[1].class.includes('mid')), 'centred over a round item');
  const patches = itemPatches(new Map([[item.id, [10, 20, 9]]]), new Map([[item.id, item]]), 4);
  assert.deepEqual(patches.find((p: any) => p.key === `tag:${item.id}:1`).set, { transform: 'translate(0 -17)' }, 'over the outermost ring');
  const none = paintedBody({ item, x: 0, y: 0, gap: 4, style: house, m });
  assert.ok(!marks(none).some((x) => x[0] === 'text'), 'a style that names no tag size draws none');
});

test('a look that writes the rings\' tags itself has the map\'s hidden', async () => {
  const { itemPatches } = await import(pathToFileURL(join(laid, 'painted.js')).href);
  const item = task(1, [on(0)]), places = new Map([[item.id, [10, 20, 9]]]), items = new Map([[item.id, item]]);
  const tagOfPatch = (own?: boolean) => itemPatches(places, items, 4, 0, own).find((p: any) => p.key === `tag:${item.id}:0`);
  assert.deepEqual(tagOfPatch(true).toggle, { written: true }, 'hidden where the look says it writes them');
  assert.deepEqual(tagOfPatch().toggle, { written: false }, 'drawn by the map otherwise');
});
