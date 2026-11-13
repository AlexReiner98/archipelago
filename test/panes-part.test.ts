// The panes pack's one part (packs/panes/parts/index.js), mounted in the strip of tabs and in the panes as the runtime
// mounts it: every answer is marks the host draws (packs/walls/page/part-check.js), and both mounts read one model.

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
// @ts-expect-error: a module of the page, plain JavaScript.
import { checkMarks } from '../packs/walls/page/part-check.js';
// @ts-expect-error: a plain module of the pack, with no types of its own.
import part, { reset } from '../packs/panes/parts/index.js';

const kinds = JSON.parse(readFileSync('packs/panes/pack.json', 'utf8')).parts[0].marks as string[];
type Said = { marks: unknown; on: (e: unknown) => unknown; update: (i: unknown) => unknown };

function mountBoth() {
  reset();
  const kept: Record<string, unknown> = {};
  const drawn: Record<string, unknown> = {};
  const tools = (slot: string) => ({ marks: (m: unknown) => (checkMarks(m, { kinds }), (drawn[slot] = m)), keep: (v: unknown, n: string) => (kept[n] = v), state: () => {} });
  const strip = part({ slot: 'tabs', address: { hash: '#/v?f=a' } }, tools('tabs')) as Said;
  const panes = part({ piece: { slot: 'panes' } }, tools('panes')) as Said;
  checkMarks(strip.marks, { kinds });
  checkMarks(panes.marks, { kinds });
  return { strip, panes, kept, drawn };
}
const keys = (m: unknown): string[] => (Array.isArray(m) ? [...(m[1]?.key ? [m[1].key] : []), ...m.slice(1).flatMap(keys)] : []);

test('a new tab from the strip is drawn in the strip and its pane in the panes, and kept', () => {
  const { strip, kept, drawn } = mountBoth();
  const after = strip.on({ key: 'new', name: 'press' });
  checkMarks(after, { kinds });
  assert.equal(keys(after).filter((k) => k.startsWith('tab:')).length, 2);
  assert.equal((kept.tabs as { list: unknown[] }).list.length, 2);
  assert.ok(keys(drawn.panes).some((k) => k.startsWith('pane:')), 'the panes mount is drawn again');
});

test('a pane dragged onto the strip goes to a tab of its own; the line between two shares the room', () => {
  const { strip, panes } = mountBoth();
  const tab = keys(strip.marks).find((k) => k.startsWith('tab:'))!;
  assert.equal(strip.on({ key: `front:${tab.slice(4)}`, name: 'press' }), undefined, 'the tab in sight: nothing to do');
  const first = keys(panes.marks).find((k) => k.startsWith('pane:'))!;
  assert.equal(panes.on({ key: first, name: 'drop', value: { onto: null, zone: 'tabs' } }), undefined, 'the last pane stays');
  panes.on({ key: first, name: 'open', value: { at: 'v?f=b' } });
  const two = panes.on({ key: 'panes', name: 'share', value: { index: 0, at: 0.5 } });
  assert.equal(two, undefined, 'one pane has no line');
  assert.equal(panes.on({ key: first, name: 'named', value: 'Tasks' }) !== undefined, true);
  assert.match(JSON.stringify(strip.on({ key: 'new', name: 'press' })), /Tasks/, 'a tab is named by what its pane draws');
});

test("a chat's first show opens its tab out of sight; its next lands there; its end closes it", () => {
  const { strip, kept } = mountBoth();
  const gone: string[] = [];
  const step = (n: number) => ({ hash: `#/v?f=${n}`, run: 'e_run00001', actor: 'agent:Ada', title: 'Port the panes', at: n });
  strip.on({ name: 'land', step: step(1) });
  const tabs = () => (kept.tabs as { list: { chat?: string; groups: string[]; panes: Record<string, { at: string }> }[]; front: string }).list;
  assert.equal(tabs().length, 2, 'a tab of its own');
  const chat = tabs().find((t) => t.chat === 'e_run00001')!;
  assert.ok(chat, 'the chat’s tab');
  assert.notEqual((kept.tabs as { front: string }).front, (chat as unknown as { id: string }).id, 'out of sight');
  strip.on({ name: 'land', step: step(2) });
  assert.equal(tabs().length, 2, 'no second tab');
  assert.equal(Object.values(tabs().find((t) => t.chat === 'e_run00001')!.panes)[0].at, 'v?f=2');
  assert.match(JSON.stringify(strip.marks), /./);
  strip.on({ name: 'ended', run: 'e_run00001' });
  for (const t of tabs()) gone.push(t.chat ?? 'owner');
  assert.deepEqual(gone, ['owner'], 'its tab goes, the owner’s stays');
});

test('a step back takes the pane in focus back, and the page moving takes the pane there', () => {
  reset();
  const went: { hash: string; push: boolean }[] = [];
  const kept: Record<string, unknown> = {};
  const tools = { marks: () => {}, keep: (v: unknown, n: string) => (kept[n] = v), state: () => {}, go: (g: { hash: string; push: boolean }) => went.push(g) };
  const strip = part({ slot: 'tabs', page: { hash: '#/v?f=a' } }, tools) as Said;
  strip.update({ page: { hash: '#/v?f=b' } });
  strip.on({ name: 'step', step: -1, hash: '#/v?f=a' });
  assert.equal(went.at(-1)?.hash, '#/v?f=a');
  assert.equal(went.at(-1)?.push, false);
});

test('a show passes by a pane the reader is busy in, and lands once they leave it', () => {
  const { strip, panes, kept } = mountBoth();
  const first = keys(panes.marks).find((k) => k.startsWith('pane:'))!.slice(5);
  const step = { hash: '#/v?f=x', run: 'e_run00002', actor: 'agent:Bo', at: 1 };
  strip.on({ name: 'follow', key: 'none', value: null });
  const tab = (kept.tabs as { list: { id: string }[] } | undefined)?.list?.[0]?.id ?? keys(strip.marks).find((k) => k.startsWith('tab:'))!.slice(4);
  strip.on({ key: `follow:${tab}:e_run00002`, name: 'press' });
  strip.on({ name: 'busy', pane: first });
  strip.on({ name: 'land', step });
  const panesOf = () => (kept.tabs as { list: { panes: Record<string, { at: string }> }[] }).list[0].panes;
  assert.notEqual(panesOf()[first].at, 'v?f=x', 'it waits while the reader works there');
});

test('a tab that watches what it draws takes the shows of a session working inside it, in one pane beside', () => {
  const { strip, panes, kept } = mountBoth();
  const first = keys(panes.marks).find((k) => k.startsWith('pane:'))!.slice(5);
  const tab = keys(strip.marks).find((k) => k.startsWith('tab:'))!.slice(4);
  panes.on({ key: `pane:${first}`, name: 'drawn', value: ['e_plan0001'] });
  strip.on({ key: `follow:${tab}:watch`, name: 'press' });
  strip.on({ name: 'land', step: { hash: '#/v?f=y', run: 'e_run00003', actor: 'agent:Cy', within: ['e_plan0001'], at: 1 } });
  const t = (kept.tabs as { list: { follows: string; groups: string[]; panes: Record<string, { slot?: string }> }[] }).list;
  assert.equal(t.length, 1, 'no tab of its own');
  assert.equal(t[0].follows, 'watch');
  assert.ok(Object.values(t[0].panes).some((p) => p.slot === 'shown'), 'the one pane its sessions share');
});

test('a popped window keeps its one tab apart, and docked back it comes into the main page in sight', () => {
  reset();
  const kept: Record<string, unknown> = {};
  const tools = { marks: () => {}, keep: (v: unknown, n: string) => (v === null ? delete kept[n] : (kept[n] = v)), state: () => {}, go: () => {} };
  const win = part({ slot: 'tabs', page: { hash: '#/v?f=w', popped: 'tpop1' } }, tools) as Said;
  win.on({ name: 'dock' });
  assert.equal((kept['out:tpop1'] as { id: string; docked: boolean }).docked, true);
  reset();
  const main = part({ slot: 'tabs', page: { hash: '#/' }, kept: { ...kept } }, tools) as Said;
  assert.ok(keys(main.marks).includes('tab:tpop1'), 'the docked tab is the main page’s');
  assert.equal(kept['out:tpop1'], undefined, 'and no window keeps it');
});
