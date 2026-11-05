// A run's session on the flow (layouts/flow/session.js, the wired shape in docs/sessions.md): a run in each state draws
// its state's mark and its line as its one line, whole in its title; what the style lights (waiting, your_move in core's
// preset) is drawn as what waits on you and laid out first; a state the style names no mark for keeps the dot. Fixtures
// stand in for the server's wiring: each run carries `session` as the flat answer gives it.

import assert from 'node:assert/strict';
import { copyFileSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { pathToFileURL } from 'node:url';

const pack = JSON.parse(readFileSync(join(import.meta.dirname, 'pack.json'), 'utf8'));
const preset = (id: string) => pack.styles.find((s: any) => s.id === id);
const house = { ...preset('core.house').props, ...preset('core.sessions_look').props, shape: 'flow' };
// The drawing's modules laid out by name in one folder, as the sandbox has them.
const laid = mkdtempSync(join(tmpdir(), 'flow-session-'));
for (const [name, file] of Object.entries(pack.layouts.find((d: any) => d.id === 'core.flow').modules)) copyFileSync(join(import.meta.dirname, file as string), join(laid, name));
const { picture } = await import(pathToFileURL(join(laid, 'index.js')).href);
const { sessionItems, sessionMarks } = await import(pathToFileURL(join(laid, 'session.js')).href);
const measure = (t: string, px: number) => t.length * px * 0.55;
const tools = { measure, patch: () => {}, frame: () => Promise.resolve(0), open: () => {} };

const STATES = ['waiting', 'your_move', 'blocked', 'working', 'quiet', 'idle'];
const LONG = 'Should the sessions view keep a run beside its parent, or beside the task it works on, when the two differ?';
/** A run in `state`, its line said, working on its task. */
const run = (state: string, k: number) => ({
  id: `e_run${k}zzzz`, type: 'run', is: ['occurrence'], title: `Run ${state}`, open: true, status: 'running',
  session: { state, line: state === 'waiting' ? LONG : `Line of ${state}`, since: `2026-11-03T0${k}:00:00Z`, ...(state === 'waiting' && { for: 'input' }) },
});
const task = (k: number) => ({ id: `e_task${k}zzz`, type: 'task', is: ['work'], title: `Task ${k}`, open: true, status: 'todo' });
const runs = STATES.map(run);
const answer = {
  // Given in the reverse of the order of attention, so the order drawn is the drawing's own.
  items: [...runs.map((_, k) => task(k)), ...runs].reverse(),
  links: runs.map((r, k) => ({ id: `l_${k}`, type: 'works_on', from: r.id, to: task(k).id })),
};

/** Every mark in a scene, flattened. */
const marks = (node: any): any[] => (Array.isArray(node) && typeof node[0] === 'string' ? [node, ...node.slice(2).flatMap(marks)] : Array.isArray(node) ? node.flatMap(marks) : []);
const text = (mark: any): string => mark.slice(2).map((k: any) => (typeof k === 'string' ? k : Array.isArray(k) && k[0] !== 'title' ? text(k) : '')).join('');
const stepOf = (svg: any, id: string) => marks(svg).find((x) => x[0] === 'a' && x[1].href === `#/e/${id}`);

test('a run in each state draws its mark and its line', () => {
  const { scene } = picture({ answer, style: house }, tools);
  for (const r of runs) {
    const step = stepOf(scene.svg, r.id);
    assert.ok(step, `${r.session.state} is drawn`);
    const mark = marks(step).find((x) => String(x[1].class ?? '').includes('lf-ss '));
    assert.ok(mark, `${r.session.state} has a state mark`);
    assert.ok(mark[1].class.includes(`lf-ss-${r.session.state}`) && mark[1].class.includes(house.session_marks[r.session.state].shape), `${r.session.state}'s mark is its own shape`);
    assert.ok(!marks(step).some((x) => String(x[1].class ?? '').includes('lf-dot')), `${r.session.state} has no phase dot`);
    // Its line is its one line, and its title is the line whole.
    const shown = text(marks(step).find((x) => x[0] === 'text'));
    assert.ok(!marks(step).some((x) => x[0] === 'tspan'), 'one line, never two');
    assert.equal(marks(step).find((x) => x[0] === 'title').slice(2).join(''), r.session.line);
    if (r.session.line === LONG) assert.ok(shown.endsWith('…') && LONG.startsWith(shown.slice(0, -1)), 'a long line is cut');
    else assert.equal(shown, r.session.line);
  }
  // Each state's colour is a rule of the scene, and the key names every state drawn.
  for (const s of STATES) assert.ok(scene.css.includes(`.lf-ss-${s} {`), `${s} has its colour`);
  for (const word of ['Waiting', 'Your move', 'Blocked', 'Working', 'Quiet', 'Idle']) assert.ok(scene.key.some((row: any) => row.label === word), `the key says ${word}`);
});

test('waiting and your_move are lit, and nothing else is', () => {
  const { scene } = picture({ answer, style: house }, tools);
  for (const r of runs) {
    const lit = stepOf(scene.svg, r.id)[1].class.split(' ').includes('you');
    assert.equal(lit, ['waiting', 'your_move'].includes(r.session.state), `${r.session.state} ${lit ? 'is' : 'is not'} lit`);
  }
  for (let k = 0; k < runs.length; k++) assert.ok(!stepOf(scene.svg, task(k).id)[1].class.split(' ').includes('you'), 'what a run works on is not lit');
});

test('runs are laid out lit first, in the order of attention, each oldest first', () => {
  const marked = sessionMarks(house);
  const older = { ...run('waiting', 9), id: 'e_runolder', session: { state: 'waiting', line: 'Older', since: '2026-11-02T00:00:00Z' } };
  const placed = sessionItems([...answer.items, older], marked, (t: string) => t).filter((i: any) => i.session).sort((a: any, b: any) => a.place - b.place);
  assert.deepEqual(placed.map((i: any) => i.session.state), ['waiting', 'waiting', 'your_move', 'blocked', 'working', 'quiet', 'idle']);
  assert.equal(placed[0].id, 'e_runolder');
  assert.ok(placed.every((i: any) => i.place < 0), 'before every other item');
});

test('a state the style names no mark for keeps its title and dot', () => {
  const { session_marks, ...plain } = house;
  const { scene } = picture({ answer, style: plain }, tools);
  const step = stepOf(scene.svg, runs[0].id);
  assert.ok(marks(step).some((x) => String(x[1].class ?? '').includes('lf-dot')));
  assert.equal(marks(step).find((x) => x[0] === 'title').slice(2).join(''), runs[0].title);
  assert.ok(!step[1].class.split(' ').includes('you'));
});
