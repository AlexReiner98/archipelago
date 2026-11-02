// A process told as it happens (layouts/flow/story.js over layouts/flow/index.js): every mark is drawn hidden, a step shows
// what it brings in, a wire comes in once both its ends have, and the last step leaves what the steps leave in.

import assert from 'node:assert/strict';
import { copyFileSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { pathToFileURL } from 'node:url';

const pack = JSON.parse(readFileSync(join(import.meta.dirname, 'pack.json'), 'utf8'));
const house = { ...pack.styles.find((s: any) => s.id === 'core.house').props, shape: 'flow' };
// The drawing shares modules with the architecture's: laid out by name in one folder, as the sandbox has them.
const laid = mkdtempSync(join(tmpdir(), 'flow-story-'));
for (const [name, file] of Object.entries(pack.layouts.find((d: any) => d.id === 'core.flow').modules)) copyFileSync(join(import.meta.dirname, file as string), join(laid, name));
const { picture } = await import(pathToFileURL(join(laid, 'index.js')).href);
const measure = (t: string, px: number) => t.length * px * 0.55;
const state = { blocked: false, waits_on: [], sessions: 0, needs_you: false };
const ROOT = 'e_rootzzzz';
const [ASK, PLAN, BUILD, OLD] = ['e_askzzzzz', 'e_planzzzz', 'e_buildzzz', 'e_oldzzzzz'];
const item = (id: string, title: string) => ({ id, kind: 'work', type: 'task', inside: ROOT, title, place: 0, open: true, status: 'todo', state, within: { items: 0 }, fields: {} });
const answer = {
  lens: { from: ROOT },
  items: [{ ...item(ROOT, 'A process'), kind: 'aim', inside: null }, item(ASK, 'Ask'), item(PLAN, 'Plan'), item(BUILD, 'Build'), item(OLD, 'Old way'), item('e_unnamedz', 'Never named')],
  links: [
    { kind: 'depends_on', from: PLAN, to: ASK, says: 'the ask' },
    { kind: 'depends_on', from: BUILD, to: PLAN },
    { kind: 'depends_on', from: OLD, to: ASK },
  ],
  steps: [
    { chapter: { name: 'How' }, add: [ASK, OLD], lines: [{ by: 'Alex', text: 'How does it go?' }] },
    { add: [PLAN], remove: [OLD], flag: { [ASK]: 'decided' }, lines: [{ by: 'Agent', text: 'A plan.' }] },
    { add: [BUILD], lit: [[BUILD, PLAN]] },
  ],
};

/** Plays the story through, timers in the order they fall due; the last patch of each key is what the page shows. */
function played() {
  const sent: any[] = [];
  const timers: [number, () => void][] = [];
  const realSet = globalThis.setTimeout;
  (globalThis as any).setTimeout = (fn: () => void, ms: number) => (timers.push([ms, fn]), timers.length);
  try {
    const out = picture({ answer, style: house, reduced: false }, { measure, patch: (l: any[]) => sent.push(...l), frame: () => Promise.resolve(0), open: () => {} });
    // It starts once its conversation is scrolled into sight.
    out.on({ name: 'seen', key: 'chat' });
    let now = 0;
    const due: [number, () => void][] = [];
    const take = () => (due.push(...timers.splice(0).map(([ms, fn]) => [now + ms, fn] as [number, () => void])), due.sort((a, b) => a[0] - b[0]));
    take();
    while (due.length) {
      const [at, fn] = due.shift()!;
      now = at;
      fn();
      take();
    }
    return { out, sent };
  } finally {
    globalThis.setTimeout = realSet;
  }
}

const last = (sent: any[], key: string, prop: string) => sent.filter((p) => p.key === key && p.set && prop in p.set).at(-1)?.set[prop];

test('a story draws only what its steps name, every mark hidden, the conversation beside it', () => {
  const { out } = played();
  const svg = JSON.stringify(out.scene.svg);
  assert.ok(!svg.includes('Never named'), 'what no step names is not laid out');
  assert.match(svg, new RegExp(`"key":"s:${ASK}"[^}]*"opacity":"0"`));
  assert.ok(out.scene.before && out.scene.aside, 'the chapters and the conversation');
});

test('played through, it ends on what the steps leave in, with each wire drawn in once both its ends are there', () => {
  const { out, sent } = played();
  for (const id of [ASK, PLAN, BUILD]) assert.equal(last(sent, `s:${id}`, 'opacity'), 1, `${id} is shown`);
  assert.equal(last(sent, `s:${OLD}`, 'opacity'), 0, 'what a step takes out stays out');
  const wires = JSON.stringify(out.scene.svg).match(/"key":"w:\d+"/g)!.map((k) => k.slice(7, -1));
  const shown = wires.filter((k) => last(sent, k, 'opacity') === 1);
  assert.equal(shown.length, 2, 'the two wires whose ends are both in');
  for (const k of shown) assert.equal(last(sent, k, 'stroke-dashoffset'), 0, `${k} is drawn in whole`);
});

test('without steps the picture is the flow as it always was: nothing hidden, no conversation', () => {
  const { steps, ...still } = answer;
  const out = picture({ answer: still, style: house }, { measure, patch: () => {}, frame: () => Promise.resolve(0), open: () => {} });
  assert.ok(!JSON.stringify(out.scene.svg).includes('"opacity":"0"'));
  assert.equal(out.scene.before, undefined);
});

test('a story waits until its conversation is scrolled into sight, and starts once', () => {
  const timers: (() => void)[] = [];
  const realSet = globalThis.setTimeout;
  (globalThis as any).setTimeout = (fn: () => void) => (timers.push(fn), timers.length);
  try {
    const sent: any[] = [];
    const out = picture({ answer, style: house, reduced: false }, { measure, patch: (l: any[]) => sent.push(...l), frame: () => Promise.resolve(0), open: () => {} });
    assert.equal(timers.length, 0, 'nothing plays before it is seen');
    assert.match(JSON.stringify(out.scene.aside), /"key":"chat","on":\["seen"\]/);
    out.on({ name: 'seen', key: 'chat' });
    out.on({ name: 'seen', key: 'chat' });
    assert.equal(timers.length, 1, 'seen, it starts, and only once');
    assert.ok(sent.some((p) => p.key === 'play' && p.text === 'Pause'));
  } finally {
    globalThis.setTimeout = realSet;
  }
});

/** Drawn with the page's timers held: `flush` runs what is due, in order, until nothing is left. */
function held(style: any) {
  const sent: any[] = [];
  let timers: [number, () => void][] = [];
  const realSet = globalThis.setTimeout, realClear = globalThis.clearTimeout;
  (globalThis as any).setTimeout = (fn: () => void, ms: number) => (timers.push([ms, fn]), timers.length);
  (globalThis as any).clearTimeout = () => {};
  const out = picture({ answer, style, reduced: false }, { measure, patch: (l: any[]) => sent.push(...l), frame: () => Promise.resolve(0), open: () => {} });
  const flush = () => {
    while (timers.length) {
      const due = timers.sort((a, b) => a[0] - b[0]);
      timers = [];
      for (const [, fn] of due) fn();
    }
  };
  const done = () => ((globalThis.setTimeout = realSet), (globalThis.clearTimeout = realClear));
  return { out, sent, flush, done };
}
const text = (sent: any[], key: string) => sent.filter((p) => p.key === key && 'text' in p).at(-1)?.text;

test('played where asked (a view up on the canvas), it opens on the map as it is and waits for Play', () => {
  const { out, sent, flush, done } = held({ ...house, play: 'asked' });
  try {
    flush();
    assert.equal(text(sent, 'at'), '3 of 3', 'the last step');
    assert.equal(text(sent, 'play'), 'Play');
    for (const id of [ASK, PLAN, BUILD]) assert.equal(last(sent, `s:${id}`, 'opacity'), 1);
    const before = sent.length;
    out.on({ name: 'seen', key: 'chat' });
    flush();
    assert.equal(text(sent.slice(before), 'play'), undefined, 'seen, it does not start');
  } finally {
    done();
  }
});

test('a step back and a step on, held there, with the word a step flags on a thing beside it', () => {
  const { out, sent, flush, done } = held({ ...house, play: 'asked' });
  try {
    flush();
    assert.equal(text(sent, `f:${ASK}`), '', 'the last step is the map as it is: no flag');
    out.on({ name: 'click', key: 'back' });
    flush();
    assert.equal(text(sent, 'at'), '2 of 3');
    assert.equal(text(sent, 'play'), 'Play', 'held there');
    assert.equal(last(sent, `s:${BUILD}`, 'opacity'), 0, 'what the next step brings is not in yet');
    assert.equal(text(sent, `f:${ASK}`), 'decided');
    out.on({ name: 'click', key: 'back' });
    out.on({ name: 'click', key: 'back' });
    flush();
    assert.equal(text(sent, 'at'), '1 of 3', 'no step before the first');
    out.on({ name: 'click', key: 'next' });
    flush();
    assert.equal(text(sent, 'at'), '2 of 3');
  } finally {
    done();
  }
});
