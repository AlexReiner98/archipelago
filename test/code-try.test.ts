// A try of code (packs/surface/kernel/tool-preview.ts): kept off the log, for its sender's pages alone, dropped by
// discard; a page waiting for one is answered the moment it is sent.
import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { configureOutbox } from '../packs/identity/kernel/outbox.ts';
import { hostFor } from '../packs/loader/kernel/packtools.ts';
import { callTool } from '../packs/surface/kernel/tools.ts';
import { agent, fresh, human, make } from './map.ts';

const maps: Awaited<ReturnType<typeof fresh>>[] = [];
after(() => maps.forEach((l) => hostFor(l.registry).stop()));

async function setUp() {
  const l = await fresh();
  maps.push(l);
  configureOutbox(async () => l);
  const { code, mine } = await make(l, [
    { op: 'create', ref: 'code', type: 'layout', title: 'Plain fill', visibility: 'shared', props: { code: 'export default function draw() {}' } },
    { op: 'create', ref: 'mine', type: 'layout', title: 'My map', visibility: 'shared', props: { preset: 'core.map', modules: {} } },
  ]);
  return { l, code, mine };
}
type Kept = { at: number; previews: { item: string; field: string; value: unknown; drawing?: { id: string; hash: string; modules: Record<string, string> } }[] };
const tries = async (l: Awaited<ReturnType<typeof fresh>>, after = 0, wait?: number) => ((await callTool(l, human, 'tail', { tries: after, ...(wait && { wait }) })) as { tries: Kept }).tries;
const entries = async (l: Awaited<ReturnType<typeof fresh>>) => (await l.db.query<{ n: number }>(`select count(*)::int as n from log_entry`)).rows[0].n;

test("a try reaches its sender's pages alone, off the log, until it is discarded", async () => {
  const { l, code } = await setUp();
  const [ada, bo] = [l.as('e_ada00001'), l.as('e_bo000001')];
  const before = await entries(l);
  await callTool(ada, agent, 'preview', { item: code, field: 'code', value: 'export default function draw() { /* tried */ }' });
  assert.equal(await entries(l), before, 'nothing is logged');
  const seen = await tries(ada);
  assert.deepEqual(seen.previews.map((p) => [p.item, p.field, p.value]), [[code, 'code', 'export default function draw() { /* tried */ }']]);
  assert.deepEqual((await tries(bo)).previews, [], 'another person sees none of it');
  await callTool(ada, agent, 'preview', { item: code, field: 'code', discard: true });
  assert.deepEqual((await tries(ada)).previews, []);
});

test("a try of a pack drawing's modules comes with the drawing it makes", async () => {
  const { l, mine } = await setUp();
  await callTool(l, agent, 'preview', { item: mine, field: 'modules', value: { 'look.js': 'export const css = ``;' } });
  const [p] = (await tries(l)).previews;
  assert.equal(p.drawing?.id, 'core.map');
  assert.equal(p.drawing?.modules['look.js'], 'export const css = ``;', 'the try stands in for its module');
  assert.ok(p.drawing?.modules['index.js'], 'the rest are the pack’s');
  assert.match(p.drawing!.hash, /^[0-9a-f]{64}$/);
});

test('a try is of a code field its type declares, in the shape change would send', async () => {
  const { l, code, mine } = await setUp();
  await assert.rejects(callTool(l, agent, 'preview', { item: code, field: 'settings', value: {} }), /no code field "settings"/);
  await assert.rejects(callTool(l, agent, 'preview', { item: code, field: 'code', value: { 'index.js': '' } }), /its text/);
  await assert.rejects(callTool(l, agent, 'preview', { item: mine, field: 'modules', value: 'text' }), /modules by name/);
  await assert.rejects(callTool(l, agent, 'preview', { item: 'e_nothing0', field: 'code', value: '' }), /No item/);
});

test('a page waiting for tries is answered when one is sent', async () => {
  const { l, code } = await setUp();
  const { at } = await tries(l);
  const began = Date.now();
  const waiting = tries(l, at, 10);
  setTimeout(() => void callTool(l, agent, 'preview', { item: code, field: 'code', value: 'export default function draw() {}' }), 50);
  const heard = await waiting;
  assert.equal(heard.previews.length, 1);
  assert.ok(Date.now() - began < 1500, `answered at once, not when the wait ran out (${Date.now() - began} ms)`);
});
