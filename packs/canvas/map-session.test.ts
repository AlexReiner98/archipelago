// A run's session on the flow (layouts/flow/session.js, the wired shape in docs/sessions.md): a run in each state draws
// its state's mark and its name as its one line, its line whole in its title; what the style lights (waiting, your_move in core's
// preset) is drawn as what waits on you and laid out first; a state the style names no mark for keeps the dot. Fixtures
// stand in for the server's wiring: each run carries `session` as the flat answer gives it.

import assert from 'node:assert/strict';
import { copyFileSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { pathToFileURL } from 'node:url';

// The house style is canvas's (moved from core with its id); the marks of a session's state, the sessions pack's (split out of core with its id).
const read = (folder: string) => JSON.parse(readFileSync(join(import.meta.dirname, '..', folder, 'pack.json'), 'utf8'));
const canvas = read('canvas');
const styles = [...canvas.styles, ...read('sessions').styles];
const preset = (id: string) => styles.find((s: any) => s.id === id);
// Merged as styles are, a field that names things (sizes, numbers) name by name (packs/styles/kernel/styles.ts).
const [base, look] = [preset('core.house').props, preset('core.sessions_look').props];
const house = { ...base, ...look, sizes: { ...base.sizes, ...look.sizes }, numbers: { ...base.numbers, ...look.numbers }, shape: 'flow' };
// The drawing's modules laid out by name in one folder, as the sandbox has them.
const laid = mkdtempSync(join(tmpdir(), 'pelago-flow-session-'));
for (const [name, file] of Object.entries(canvas.layouts.find((d: any) => d.id === 'core.map').modules)) copyFileSync(join(import.meta.dirname, file as string), join(laid, name));
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

test('a run in each state draws its mark and its name, its line in its title', () => {
  const { scene } = picture({ answer, style: house }, tools);
  for (const r of runs) {
    const step = stepOf(scene.svg, r.id);
    assert.ok(step, `${r.session.state} is drawn`);
    const mark = marks(step).find((x) => String(x[1].class ?? '').includes('lf-ss '));
    assert.ok(mark, `${r.session.state} has a state mark`);
    assert.ok(mark[1].class.includes(`lf-ss-${r.session.state}`) && mark[1].class.includes(house.session_marks[r.session.state].shape), `${r.session.state}'s mark is its own shape`);
    assert.ok(!marks(step).some((x) => String(x[1].class ?? '').includes('lf-dot')), `${r.session.state} has no phase dot`);
    // Its name is its one line (never its last beat), and its title is its line whole.
    const shown = text(marks(step).find((x) => x[0] === 'text'));
    assert.ok(!marks(step).some((x) => x[0] === 'tspan'), 'one line, never two');
    assert.equal(marks(step).find((x) => x[0] === 'title').slice(2).join(''), r.session.line);
    assert.equal(shown, r.title, 'the step says which session, not what it last said');
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

test('a run asking you to decide a held change is where it is decided', () => {
  const asking = { ...run('your_move', 7), id: 'e_runasks1', session: { state: 'your_move', line: 'Approve p_a4knhcvf on the map, then have me check Field and Lines live?', since: '2026-11-03T07:00:00Z' } };
  const naming = { ...run('idle', 8), id: 'e_runidle1', session: { state: 'idle', line: 'Proposed p_a4knhcvf for Alex', since: '2026-11-03T08:00:00Z' } };
  const { scene } = picture({ answer: { items: [...answer.items, asking, naming], links: answer.links }, style: house }, tools);
  const all = marks(scene.svg);
  // Its click is keyed for the change, as a ghost's is, and it is no link to the run's page.
  const keyed = all.find((x) => x[1]?.key === 'held:p_a4knhcvf:e_runasks1');
  assert.ok(keyed && keyed[1].on.includes('click'), 'its click puts the change to you');
  assert.ok(!stepOf(scene.svg, 'e_runasks1'), 'it does not lead to the run');
  assert.ok(marks(keyed).some((x) => String(x[1].class ?? '').split(' ').includes('lf-step')), 'it is drawn as its step');
  assert.match(marks(keyed).find((x) => x[0] === 'title').slice(2).join(''), /Yours to decide/);
  // A run that is not waiting on you, though its line names a change, stays a link to its page; so does one that names none.
  assert.ok(stepOf(scene.svg, 'e_runidle1'), 'an idle run leads to its page');
  assert.ok(!all.some((x) => String(x[1]?.key ?? '').startsWith('held:p_a4knhcvf:e_runidle1')));
  assert.ok(stepOf(scene.svg, runs[1].id), 'a run whose question names no change leads to its page');
});

test('only a held change named as a word of its own is what a run asks', async () => {
  const { askedOf } = await import(pathToFileURL(join(laid, 'session.js')).href);
  assert.equal(askedOf({ state: 'waiting', line: 'Approve p_a4knhcvf?' }), 'p_a4knhcvf');
  assert.equal(askedOf({ state: 'your_move', line: '(p_abcd1234) then merge' }), 'p_abcd1234');
  assert.equal(askedOf({ state: 'your_move', line: 'Merge top_abcd1234?' }), null);
  assert.equal(askedOf({ state: 'your_move', line: 'Approve p_abcd1234x_y?' }), null);
  assert.equal(askedOf({ state: 'working', line: 'Approve p_a4knhcvf?' }), null);
  assert.equal(askedOf(null), null);
});
