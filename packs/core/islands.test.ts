// The islands look of a story (draw/architecture/islands.js) and the steps that bring it in: a step's look holds from
// that step on, a step's fields may give the status work had then, a quick step goes by at a fast-forward pace, and
// the last step shows the work the map has finished. Checked on a small build plan, as the landing page tells it.

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
// @ts-expect-error: a plain module of the drawing, with no types of its own.
import { picture } from './draw/architecture/index.js';
// @ts-expect-error: a plain module of the drawing, with no types of its own.
import { along, boxPath, islandPath, islands, routeSpots } from './draw/architecture/islands.js';
// @ts-expect-error: a plain module of the drawing, with no types of its own.
import { layout } from './draw/architecture/layout.js';
// @ts-expect-error: a plain module of the drawing, with no types of its own.
import { statesOf } from './draw/architecture/story.js';

const house = { ...JSON.parse(readFileSync(join(import.meta.dirname, 'pack.json'), 'utf8')).styles.find((s: any) => s.id === 'core.house').props, shape: 'architecture', still: true };
const measure = (t: string, px: number) => t.length * px * 0.56;
const z = (n: string) => house.sizes[`arch_${n}`];
const num = (n: string) => house.numbers[n];

const ROOT = 'e_rootzzzz';
const item = (id: string, title: string, extra: Record<string, unknown> = {}) => ({ id, type: 'work.task', kind: 'work', title, status: 'done', open: false, inside: ROOT, place: 0, fields: {}, size: { work: 0 }, state: { blocked: false, waits_on: [], sessions: 0, needs_you: false }, within: { items: 0 }, ...extra });
const [SKETCH, WRITE, MARKS, TRY, SHIP, OLD] = ['e_sketchzz', 'e_writezzz', 'e_markszzz', 'e_tryzzzzz', 'e_shipzzzz', 'e_oldzzzzz'];
const plan = [SKETCH, WRITE, MARKS, TRY, SHIP];
const status = (o: Record<string, string>) => Object.fromEntries(Object.entries(o).map(([id, s]) => [id, { status: s }]));
const answer = {
  lens: { from: ROOT },
  items: [
    { ...item(ROOT, 'The whole system', { type: 'work.project', open: true, status: 'active', inside: undefined }) },
    item(SKETCH, 'Sketch the look'),
    item(WRITE, 'Write the drawing'),
    item(MARKS, 'Draw progress'),
    item(TRY, 'Try it in the sandbox'),
    item(SHIP, 'Ship it'),
    item(OLD, 'An old part', { type: 'software.component', status: 'retired' }),
  ],
  links: [
    { kind: 'depends_on', from: WRITE, to: SKETCH, n: 1, says: 'the sketch' },
    { kind: 'depends_on', from: MARKS, to: SKETCH, n: 1, says: 'its colours' },
    { kind: 'depends_on', from: TRY, to: WRITE, n: 1, says: 'the code' },
    { kind: 'depends_on', from: TRY, to: MARKS, n: 1, says: 'progress marks' },
    { kind: 'depends_on', from: SHIP, to: TRY, n: 1, says: 'your yes' },
    { kind: 'depends_on', from: OLD, to: SKETCH, n: 1 },
  ],
  steps: [
    { chapter: { name: 'Your style' }, add: [...plan, OLD], fields: status(Object.fromEntries(plan.map((id) => [id, 'todo']))), lines: [{ by: 'Alex', text: 'Show me it in a new style.' }] },
    { look: 'islands', remove: [OLD], lines: [{ by: 'Agent', text: 'Islands.' }] },
    { quick: true, fields: status({ [SKETCH]: 'done', [WRITE]: 'doing' }), lit: [[WRITE, SKETCH]] },
    { quick: true, fields: status({ [WRITE]: 'done' }) },
    { lines: [{ by: 'Agent', text: 'All done.' }] },
  ],
};
const frames = () => {
  let prior: any;
  return statesOf(answer).map((s: any) => {
    const g = layout({ items: s.items, links: s.links, rootId: ROOT, measure, sizes: house.sizes, prior, steady: true });
    prior = g.memo;
    return { s, g: s.look === 'islands' ? islands(g, { z, n: num, done: (n: any) => n.item.status === 'done' }) : g };
  });
};

test('a box and an island are outlines of the same shape, so one moves into the other point by point', () => {
  const shape = (d: string) => d.replace(/-?\d*\.?\d+/g, '#');
  assert.equal(shape(boxPath(10, 20, 120, 34, 6)), shape(islandPath(70, 37, 80, 40, 'e_sketchzz', 0.12)));
  assert.match(boxPath(10, 20, 120, 34, 6), /^M16 20C/);
  // The same island every time, and each its own.
  assert.equal(islandPath(0, 0, 50, 30, 'a', 0.12), islandPath(0, 0, 50, 30, 'a', 0.12));
  assert.notEqual(islandPath(0, 0, 50, 30, 'a', 0.12), islandPath(0, 0, 50, 30, 'b', 0.12));
});

test('a look holds from its step on; the status work had is the step’s; the last step shows what the map finished, not what it retired', () => {
  const states = statesOf(answer);
  assert.deepEqual(states.map((s: any) => s.look), [null, 'islands', 'islands', 'islands', 'islands']);
  const at = (k: number, id: string) => states[k].items.find((i: any) => i.id === id);
  assert.equal(at(0, SKETCH).status, 'todo');
  assert.equal(at(2, SKETCH).status, 'done');
  assert.equal(at(2, WRITE).status, 'doing');
  assert.equal(at(3, TRY).status, 'todo');
  // The map as it is: all of the plan done, and open so it is drawn; the retired part gone.
  const last = states.at(-1);
  for (const id of plan) assert.ok(last.items.some((i: any) => i.id === id && i.open && i.status === 'done'), id);
  assert.ok(!last.ids.has(OLD));
});

test('islands lie apart, each route runs from the edge of what is needed to the edge of what needs it, and its words keep clear', () => {
  for (const { g } of frames().filter(({ s }: any) => s.look === 'islands')) {
    const ids = [...g.radii.keys()];
    for (let i = 0; i < ids.length; i++)
      for (let j = i + 1; j < ids.length; j++) {
        const [a, b] = [g.radii.get(ids[i]), g.radii.get(ids[j])];
        const apart = Math.abs(g.x.get(ids[i]) - g.x.get(ids[j])) >= a.rx + b.rx || Math.abs(g.y.get(ids[i]) - g.y.get(ids[j])) >= a.ry + b.ry;
        assert.ok(apart, `${ids[i]} and ${ids[j]} overlap`);
      }
    // Inside the frame.
    for (const id of ids) assert.ok(g.x.get(id) - g.radii.get(id).rx >= 0 && g.x.get(id) + g.radii.get(id).rx <= g.width && g.y.get(id) + g.radii.get(id).ry <= g.height, `${id} is in the frame`);
    for (const c of g.chains) {
      assert.ok(c.curve && c.points.length === 4);
      // From what is needed (the link's end) to what needs it (its start), outside both islands.
      const link = answer.links.find((l) => l.from === c.b && l.to === c.a);
      assert.ok(link, `${c.key} runs from what is needed to what needs it`);
      const out = (p: number[], id: string) => ((p[0] - g.x.get(id)) / g.radii.get(id).rx) ** 2 + ((p[1] - g.y.get(id)) / g.radii.get(id).ry) ** 2 >= 1;
      assert.ok(out(c.points[0], c.a) && out(c.points[3], c.b), `${c.key} starts and ends at the shore`);
    }
    const labels = g.chains.filter((c: any) => c.says).map((c: any) => ({ c, text: c.says }));
    const spots = routeSpots({ labels, chains: g.chains, radii: g.radii, x: g.x, y: g.y, measure, z });
    assert.equal(spots.length, labels.length, 'every route says what it carries');
    const HIGH = z('says_height');
    for (const s of spots) {
      for (const o of g.chains.filter((c: any) => c !== s.c))
        for (let k = 0; k <= 48; k++) {
          const [px, py] = along(o.points, k / 48);
          assert.ok(!(Math.abs(px - s.x) <= s.w / 2 && Math.abs(py - s.y) <= HIGH / 2), `"${s.text}" is over the route ${o.key}`);
        }
      for (const id of g.radii.keys()) {
        const r = g.radii.get(id);
        assert.ok(!(Math.abs(s.x - g.x.get(id)) < s.w / 2 && Math.abs(s.y - g.y.get(id)) < HIGH / 2 + r.ry - 2), `"${s.text}" is on the island ${id}`);
      }
      for (const o of spots) if (o !== s) assert.ok(Math.abs(o.x - s.x) >= (o.w + s.w) / 2 || Math.abs(o.y - s.y) >= HIGH, `"${s.text}" and "${o.text}" overlap`);
    }
  }
});

test('played, a quick step goes by at the fast-forward pace, and the key is the look’s once the story is in it', async () => {
  const sent: any[] = [];
  const timers: [number, () => void][] = [];
  const realSet = globalThis.setTimeout;
  (globalThis as any).setTimeout = (fn: () => void, ms: number) => (timers.push([ms, fn]), timers.length);
  try {
    const drawn = picture({ answer, style: house, reduced: false }, { measure, patch: (l: any[]) => sent.push(...l), frame: () => Promise.resolve(0), open: () => {} });
    const { scene } = drawn;
    // It starts once its conversation is scrolled into sight.
    drawn.on({ name: 'seen', key: 'chat' });
    const keys = JSON.stringify(scene.before);
    assert.match(keys, /"key:islands","class":"sp-key sp-islands sp-hide"/);
    assert.match(keys, /To do.*Doing.*Done/);
    // Run the timers in order of when they fall due, as the page would.
    let now = 0;
    const due: [number, () => void][] = [];
    const take = () => (due.push(...timers.splice(0).map(([ms, fn]) => [now + ms, fn] as [number, () => void])), due.sort((a, b) => a[0] - b[0]));
    take();
    const moves: number[] = [];
    while (due.length) {
      const [at, fn] = due.shift()!;
      now = at;
      const before = sent.length;
      fn();
      // A move of every part's outline: when it happens, and over how long.
      const outline = sent.slice(before).find((p) => p.key === `p:${SKETCH}:r` && p.set?.d && p.over);
      if (outline) moves.push(outline.over);
      take();
    }
    assert.ok(moves.includes(house.numbers.arch_story_quick_move), `a quick step moves at its pace: ${moves}`);
    assert.ok(sent.some((p) => p.key === 'key:islands' && p.toggle?.['sp-hide'] === false), 'the islands key is shown');
    assert.ok(sent.some((p) => p.key === `p:${SKETCH}` && p.toggle?.['sp-islands'] === true), 'the parts are drawn as islands');
  } finally {
    globalThis.setTimeout = realSet;
  }
});

test('in relief, the islands are still islands: the scene asks for a surface, and with none given the flat islands stay', async () => {
  const steps = [answer.steps[0], { look: 'islands' }, { look: 'islands_3d', remove: [OLD] }, ...answer.steps.slice(2)];
  const relief = { ...answer, steps };
  assert.deepEqual(statesOf(relief).map((s: any) => s.look), [null, 'islands', 'islands_3d', 'islands_3d', 'islands_3d', 'islands_3d']);
  const sent: any[] = [];
  let asked = 0;
  const { scene } = picture({ answer: relief, style: house, reduced: true }, { measure, patch: (l: any[]) => sent.push(...l), frame: () => Promise.resolve(0), open: () => {}, surface: () => (asked++, Promise.resolve(null)) });
  assert.deepEqual(scene.surface, { key: 'deep' });
  // Played to the end at once (less motion): the last frame is in relief, laid out and keyed as islands.
  await new Promise((r) => setTimeout(r, 20));
  assert.ok(sent.some((p) => p.key === `p:${SKETCH}` && p.toggle?.['sp-islands'] === true && p.toggle?.['sp-islands_3d'] === true));
  assert.ok(sent.some((p) => p.key === 'key:islands' && p.toggle?.['sp-hide'] === false));
  assert.equal(asked, 1, 'the surface is asked for once');
  assert.ok(!sent.some((p) => p.key === 'deep' || p.toggle?.['sp-deep']), 'with no surface, nothing covers the flat islands');
  // A story with no step in relief asks for no surface.
  assert.equal(picture({ answer, style: house, reduced: true }, { measure, patch: () => {}, frame: () => Promise.resolve(0), open: () => {} }).scene.surface, undefined);
});

test('a boat moors off the shore facing the harbour, and keeps off the land on its way', async () => {
  // @ts-expect-error: a plain module of the drawing, with no types of its own.
  const { along3, berth, course } = await import('./draw/architecture/boats.js');
  const isle = { cx: 0, cy: 0, rx: 60, ry: 30 }, toward = [0, 200];
  const [x, y] = berth(isle, 0, 1, toward, 10);
  assert.ok(y > 30 && Math.abs(x) < 1, `moored below the island, at ${x}, ${y}`);
  const two = [berth(isle, 0, 2, toward, 10), berth(isle, 1, 2, toward, 10)];
  assert.ok(Math.hypot(two[0][0] - two[1][0], two[0][1] - two[1][1]) > 20, 'two boats moor side by side');
  // From one side of an island to the other, the course bends round it.
  const p = course([-120, 0], [120, 0], [isle]);
  for (let k = 1; k < 24; k++) {
    const [px, py] = along3(p, k / 24);
    assert.ok((px / 60) ** 2 + (py / 30) ** 2 >= 1, `on land at ${px}, ${py}`);
  }
});

test('whoever a step names as the owner of work is a boat, never an island of its own', () => {
  const AGENT = 'e_agentzzz';
  const steps = [
    { add: [...plan, AGENT], fields: status(Object.fromEntries(plan.map((id) => [id, 'todo']))) },
    { look: 'islands', fields: { [WRITE]: { status: 'doing', owner: AGENT } } },
    { fields: { [WRITE]: { status: 'done' } } },
  ];
  const sailing = { ...answer, items: [...answer.items, item(AGENT, 'Your agent', { type: 'agent', kind: 'actor', status: 'active', open: true, inside: ROOT })], steps };
  const sent: any[] = [];
  picture({ answer: sailing, style: house, reduced: true }, { measure, patch: (l: any[]) => sent.push(...l), frame: () => Promise.resolve(0), open: () => {} });
  // Never drawn as an island or a box of its own, in the islands look.
  const states = statesOf(sailing);
  assert.equal(states[1].look, 'islands');
  const layoutOf = (s: any) => layout({ items: s.items.filter((i: any) => i.id !== AGENT), links: s.links, rootId: ROOT, measure, sizes: house.sizes, steady: true });
  assert.ok(layoutOf(states[1]).nodes.has(WRITE));
  assert.ok(!sent.some((p) => p.key === `p:${AGENT}` && p.set?.opacity === 1), 'the agent is not a part');
});

test('as a plan, each part is a row and its work runs done, under way, to do; as a board, each piece sits in its status column', async () => {
  // @ts-expect-error: a plain module of the drawing, with no types of its own.
  const { board } = await import('./draw/architecture/boards.js');
  const PROJECT = 'e_projectz', [A, B, C] = ['e_taskaaaa', 'e_taskbbbb', 'e_taskcccc'];
  const work = { ...answer, items: [item(ROOT, 'Root', { open: true, status: 'active', inside: undefined }), item(PROJECT, 'Website', { type: 'work.project', open: true, status: 'active' }), ...[A, B, C].map((id, k) => item(id, `Task ${k}`, { inside: PROJECT, place: k }))], links: [] };
  const statuses = { [A]: 'todo', [B]: 'done', [C]: 'doing' };
  const items = work.items.map((i: any) => (statuses[i.id] ? { ...i, status: statuses[i.id], open: true } : i));
  const g = layout({ items, links: [], rootId: ROOT, measure, sizes: house.sizes });
  const order = house.dots.islands.order, names = house.dots.islands.names;
  const plan = board('gantt', g, { z, order, names });
  const along = [A, B, C].sort((a, b) => plan.tasks.get(a).x - plan.tasks.get(b).x);
  assert.deepEqual(along, [B, C, A], 'done, then under way, then to do');
  for (const id of [A, B, C]) assert.equal(plan.tasks.get(id).y, plan.y.get(PROJECT), 'on its part\'s row');
  const kanban = board('kanban', g, { z, order, names });
  assert.deepEqual(kanban.heads.map((h: any) => h.text), ['To do', 'Doing', 'Done']);
  for (const [id, v] of Object.entries(statuses)) assert.equal(kanban.tasks.get(id).x, kanban.heads.find((h: any) => h.key === v).x, `${id} in ${v}`);
});

test('choosing a chapter plays it, even when the story was paused', () => {
  const sent: any[] = [];
  const timers: [number, () => void][] = [];
  const realSet = globalThis.setTimeout;
  (globalThis as any).setTimeout = (fn: () => void, ms: number) => (timers.push([ms, fn]), timers.length);
  try {
    const drawn = picture({ answer, style: house, reduced: true }, { measure, patch: (l: any[]) => sent.push(...l), frame: () => Promise.resolve(0), open: () => {} });
    timers.splice(0).forEach(([, fn]) => fn());
    assert.ok(sent.some((p) => p.key === 'play' && p.text === 'Replay'), 'with less motion, it starts at the end');
    sent.length = 0;
    drawn.on({ name: 'click', key: 'c:0' });
    assert.ok(sent.some((p) => p.key === 'play' && p.text === 'Pause'), 'and plays once a chapter is chosen');
    assert.ok(timers.length > 0, 'its next step is on its way');
  } finally {
    globalThis.setTimeout = realSet;
  }
});

test('paused before its first step is drawn, a story stops and plays on from there', () => {
  const sent: any[] = [];
  const timers: [number, () => void][] = [];
  const realSet = globalThis.setTimeout, realClear = globalThis.clearTimeout;
  (globalThis as any).setTimeout = (fn: () => void, ms: number) => (timers.push([ms, fn]), timers.length);
  (globalThis as any).clearTimeout = () => {};
  try {
    const drawn = picture({ answer, style: house, reduced: false }, { measure, patch: (l: any[]) => sent.push(...l), frame: () => Promise.resolve(0), open: () => {} });
    drawn.on({ name: 'seen', key: 'chat' });
    timers.splice(0, 1)[0][1]();
    assert.doesNotThrow(() => drawn.on({ name: 'click', key: 'play' }));
    assert.ok(sent.some((p) => p.key === 'play' && p.text === 'Play'));
    timers.length = 0;
    drawn.on({ name: 'click', key: 'play' });
    assert.ok(sent.some((p) => p.key === 'play' && p.text === 'Pause') && timers.length > 0, 'and plays on');
  } finally {
    ((globalThis.setTimeout = realSet), (globalThis.clearTimeout = realClear));
  }
});

test('the last step shows what the steps leave in, as it is now: not what they took out, nor what they never name', () => {
  const STRAY = 'e_strayzzz', GONE = 'e_gonezzzz';
  const ending = {
    ...answer,
    items: [...answer.items, item(STRAY, 'Never named', { open: true, status: 'todo' }), item(GONE, 'Taken out', { open: true, status: 'todo' })],
    steps: [{ add: [...plan, GONE] }, { remove: [GONE] }, { titles: { [SKETCH]: 'Then' } }],
  };
  const last = statesOf(ending).at(-1);
  for (const id of plan) assert.ok(last.ids.has(id), `${id} is left in`);
  assert.ok(!last.ids.has(GONE), 'what the steps took out stays out');
  assert.ok(!last.ids.has(STRAY), 'what no step names is not drawn');
  assert.equal(last.items.find((i: any) => i.id === SKETCH).title, 'Sketch the look', 'titles are their own at the end');
});
