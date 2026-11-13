// The catch_up pack's parts (packs/catch_up/parts), run as their worker runs them, with no page and no database. The
// runtime projects the log (it holds the store and the projector, packs/log/kernel/project.ts) and hands the parts the
// rows each beat touched as they were and are; here the projector stands in for it (`rowsOf`). catch_up.changes tells
// what came, left and changed and traces it until seen; catch_up.replay offers what was missed and plays it, chapters
// by who made them, island by island.

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { project } from '../packs/log/kernel/project.ts';
// @ts-ignore: a module of the page, plain JavaScript
import { checkMarks as checkAny, MARKS } from '../packs/walls/page/part-check.js';
// @ts-expect-error: plain modules of the pack, with no types of their own.
import { changeSet, said, touched } from '../packs/catch_up/parts/changes.js';
// @ts-expect-error: plain modules of the pack, with no types of their own.
import { stepsOf } from '../packs/catch_up/parts/steps.js';
// @ts-expect-error: plain modules of the pack, with no types of their own.
import traced from '../packs/catch_up/parts/traced.js';
// @ts-expect-error: plain modules of the pack, with no types of their own.
import replay from '../packs/catch_up/parts/replay.js';

const manifest = JSON.parse(readFileSync(new URL('../packs/catch_up/pack.json', import.meta.url), 'utf8'));
/**
 * The marks a part names, checked as the host checks them. The overlay's own marks (trace, replay) and a text's
 * `word` (a session's, drawn in its hue) are the runtime's to add, so only that the part names them is looked at here.
 */
function checkMarks(id: string, marks: unknown) {
  const kinds = manifest.parts.find((p: any) => p.id === id).marks as string[];
  const bare = (a: any) => (a && typeof a === 'object' && !Array.isArray(a) && 'word' in a && !('word' in MARKS.text.attrs) ? (({ word, ...rest }) => rest)(a) : a);
  const theirs = (m: any): any => (Array.isArray(m) && !(m[0] in MARKS) ? (assert.ok(kinds.includes(m[0]), `${id} names ${m[0]}`), null) : Array.isArray(m) ? [m[0], ...(m.slice(1).map((x: any) => (Array.isArray(x) ? theirs(x) : bare(x))).filter((x: any) => x !== null))] : m);
  checkAny(theirs(marks), { kinds });
  return marks as any;
}

const kinds = { isOpen: (_t: string, s: string) => s !== 'done', starterOf: (t: string) => t, relationFamily: (...r: string[]) => r };
const item = (id: string, title: string, status = 'todo', props: Record<string, unknown> = {}) => ({ id, type: 'task', title, body: '', status, visibility: 'workspace', owner: null, is_open: true, props, archived_at: null });
const link = (id: string, type: string, from: string, to: string) => ({ id, type, from_id: from, to_id: to, props: {}, valid_to: null });
const agentBy = { actor: 'e_agent001', name: 'Claude', run: 'e_run00001', word: 'Coll', of: 'agent', reason: 'Finished the projector. And more.' };
type Held = { items: Map<string, any>; links: Map<string, any> };
type Entry = { pos: number; at: string; by?: any; facts: any[]; moved?: boolean };

/**
 * What the runtime hands for a beat: each row the entries touch, as it stood before the first and after the last, with
 * its latest maker; what the reader may no longer see (`gone`) left. Projected on a copy of `held`.
 */
function rowsOf(held: Held, entries: Entry[], gone: string[] = []) {
  const now = { items: new Map(held.items), links: new Map(held.links) } as any;
  const first = new Map<string, any>();
  const last = new Map<string, any>();
  const note = (id: string) => first.has(id) || first.set(id, (id.startsWith('r_') ? now.links : now.items).get(id) ?? null);
  for (const e of entries) {
    for (const f of e.facts) {
      note(f[1]);
      if (f[2] === 'forgotten') for (const [rid, r] of now.links) if (r.from_id === f[1] || r.to_id === f[1]) note(rid);
    }
    const moved = project(now, kinds as any, e.at, e.facts, Boolean(e.moved));
    for (const id of [...moved.items, ...moved.links, ...moved.gone]) last.set(id, { ...(e.by && { by: e.by }), at: e.at, pos: e.pos });
  }
  for (const id of gone) for (const key of ['items', 'links']) if (now[key].has(id)) (note(id), now[key].delete(id));
  const to = Math.max(...entries.map((e) => e.pos));
  return { rows: [...first].map(([id, was]) => ({ id, was, now: (id.startsWith('r_') ? now.links : now.items).get(id) ?? null, ...(last.get(id) ?? { pos: to }) })), to, now };
}
/** What was missed, as the runtime hands it: each entry with the rows it touched before and after it. */
function missedOf(held: Held, entries: Entry[]) {
  let at = held;
  return entries.map((e) => {
    const { rows, now } = rowsOf(at, [e]);
    at = now;
    return { ...e, rows: rows.map(({ id, was, now }) => ({ id, was, now })) };
  });
}

const held = (): Held => ({
  items: new Map([['e_aaaaaaaa', item('e_aaaaaaaa', 'Tail the log')], ['e_bbbbbbbb', item('e_bbbbbbbb', 'Old one')], ['e_cccccccc', item('e_cccccccc', 'Left alone')]]),
  links: new Map([['r_aaaaaaaa', link('r_aaaaaaaa', 'part_of', 'e_aaaaaaaa', 'e_cccccccc')]]),
});
const entries: Entry[] = [
  {
    pos: 5, at: '2026-11-05T10:01:00.000Z', by: agentBy,
    facts: [
      ['+', 'e_aaaaaaaa', 'status', 'doing'], ['+', 'e_aaaaaaaa', 'tokens_estimated', 40],
      ['+', 'e_dddddddd', 'type', 'task'], ['+', 'e_dddddddd', 'title', 'New one'], ['+', 'e_dddddddd', 'status', 'todo'],
      ['+', 'r_bbbbbbbb', 'link', ['depends_on', 'e_dddddddd', 'e_aaaaaaaa']],
      ['+', 'e_bbbbbbbb', 'archived', true],
      ['-', 'r_aaaaaaaa', 'link'],
    ],
  },
  { pos: 6, at: '2026-11-05T10:02:00.000Z', by: { actor: 'e_owner001', of: 'human', reason: 'Said again' }, facts: [['+', 'e_cccccccc', 'title', 'Left alone']] },
  { pos: 7, at: '2026-11-05T10:03:00.000Z', by: agentBy, facts: [['+', 'e_eeeeeeee', 'type', 'task'], ['+', 'e_eeeeeeee', 'title', 'Brief'], ['+', 'e_eeeeeeee', 'archived', true]] },
];

test('a change set says what came, left and changed, and who did it, from the rows as they were and are', () => {
  const { rows } = rowsOf(held(), entries);
  const set = changeSet({ from: 4, to: 7, rows });
  assert.deepEqual([set.from, set.to], [4, 7]);
  const by = Object.fromEntries(set.items.map((c: any) => [c.id, c]));
  assert.deepEqual(Object.keys(by).sort(), ['e_aaaaaaaa', 'e_bbbbbbbb', 'e_dddddddd'], 'what was said again as it was, and what came and left in the set, are no change');
  assert.deepEqual(by.e_aaaaaaaa.fields, [{ field: 'status', was: 'todo', now: 'doing' }, { field: 'tokens_estimated', was: null, now: 40 }]);
  assert.deepEqual([by.e_dddddddd.did, by.e_bbbbbbbb.did], ['came', 'left']);
  assert.deepEqual(by.e_aaaaaaaa.by, agentBy, 'who, on whose word and why');
  assert.equal(by.e_aaaaaaaa.pos, 5);
  const links = Object.fromEntries(set.links.map((c: any) => [c.id, c]));
  assert.deepEqual([links.r_bbbbbbbb.did, links.r_bbbbbbbb.type, links.r_bbbbbbbb.from, links.r_bbbbbbbb.to], ['linked', 'depends_on', 'e_dddddddd', 'e_aaaaaaaa']);
  assert.equal(links.r_aaaaaaaa.did, 'unlinked');
  const marks = touched(set);
  assert.deepEqual([...marks.keys()].sort(), ['e_aaaaaaaa', 'e_bbbbbbbb', 'e_cccccccc', 'e_dddddddd']);
  assert.equal(marks.get('e_cccccccc').did, 'unlinked');
  assert.equal(said(by.e_aaaaaaaa), 'doing, tokens_estimated');
  assert.equal(said(links.r_bbbbbbbb), 'linked depends on');

  // A forget takes its links with it; what the reader can no longer see left.
  const forgot = changeSet({ from: 7, to: 8, rows: rowsOf(held(), [{ pos: 8, at: '2026-11-05T10:04:00.000Z', facts: [['+', 'e_aaaaaaaa', 'forgotten', true]] }], ['e_bbbbbbbb']).rows });
  assert.deepEqual(forgot.items.map((c: any) => [c.id, c.did]).sort(), [['e_aaaaaaaa', 'left'], ['e_bbbbbbbb', 'left']]);
  assert.deepEqual(forgot.links.map((c: any) => [c.id, c.did]), [['r_aaaaaaaa', 'unlinked']]);
  assert.deepEqual(changeSet({ from: 8, to: 8, rows: [] }), { from: 8, to: 8, items: [], links: [] }, 'nothing between, nothing changed');
});

test('catch_up.changes traces what another changed until it is seen, and keeps it between pages', () => {
  const kept: Record<string, any> = {};
  const tools = { keep: (name: string, value: unknown) => (kept[name] = JSON.parse(JSON.stringify(value))) };
  const part = traced({ me: 'e_owner001', style: { numbers: { trace_kept_days: 30 } } }, tools);
  assert.deepEqual(checkMarks('catch_up.changes', part.marks), ['box', { key: 'traces' }]);
  const { rows } = rowsOf(held(), entries);
  const drawn = checkMarks('catch_up.changes', part.on({ name: 'beat', from: 4, to: 7, rows }));
  const lines = Object.fromEntries(drawn.slice(2).map((m: any) => [m[1].item, m[1]]));
  assert.deepEqual(Object.keys(lines).sort(), ['e_aaaaaaaa', 'e_bbbbbbbb', 'e_cccccccc', 'e_dddddddd']);
  assert.deepEqual(lines.e_aaaaaaaa, { item: 'e_aaaaaaaa', tip: 'Session Coll, doing, tokens_estimated: Finished the projector', word: 'Coll' }, 'who, what and why, in the session\'s word');
  // The person's own change is not traced: they saw it made.
  assert.equal(part.on({ name: 'beat', from: 7, to: 9, rows: rowsOf(held(), [{ pos: 9, at: 'x', by: { actor: 'e_owner001' }, facts: [['+', 'e_cccccccc', 'status', 'done']] }]).rows }), undefined);
  // Seen, it waits no more; a page opened later does not bring it back, and keeps what still waits.
  const after = checkMarks('catch_up.changes', part.on({ name: 'seen', item: 'e_aaaaaaaa' }));
  assert.equal(after.slice(2).some((m: any) => m[1].item === 'e_aaaaaaaa'), false);
  assert.equal(part.on({ name: 'seen', item: 'e_aaaaaaaa' }), undefined);
  const again = traced({ me: 'e_owner001', kept }, tools);
  assert.deepEqual(again.marks.slice(2).map((m: any) => m[1].item).sort(), ['e_bbbbbbbb', 'e_cccccccc', 'e_dddddddd']);
  again.on({ name: 'beat', from: 4, to: 7, rows });
  assert.equal(again.marks.slice(2).some((m: any) => m[1].item === 'e_aaaaaaaa'), false, 'what was seen is not traced again');
});

test('catch_up.replay plays chapters by who made them, island by island', () => {
  const island = (id: string, i: string) => item(id, id, 'todo', { island: i });
  const was: Held = { items: new Map([['e_aaaaaaaa', island('e_aaaaaaaa', 'e_islanda1')], ['e_bbbbbbbb', island('e_bbbbbbbb', 'e_islandb1')]]), links: new Map() };
  const one = { actor: 'e_agent001', run: 'e_run00001', word: 'Coll' };
  const two = { actor: 'e_agent001', run: 'e_run00002', word: 'Herm' };
  const missed = missedOf(was, [
    { pos: 2, at: '2026-11-05T10:00:00.000Z', by: one, facts: [['+', 'e_aaaaaaaa', 'status', 'doing'], ['+', 'e_bbbbbbbb', 'status', 'doing']] },
    // The same session again: the same chapter, its own step. A new item says its island; its link lives where its first end does.
    { pos: 3, at: '2026-11-05T10:01:00.000Z', by: one, facts: [['+', 'e_cccccccc', 'type', 'task'], ['+', 'e_cccccccc', 'title', 'New'], ['+', 'e_cccccccc', 'island', 'e_islandb1'], ['+', 'r_cccccccc', 'link', ['depends_on', 'e_cccccccc', 'e_aaaaaaaa']]] },
    { pos: 4, at: '2026-11-05T10:02:00.000Z', by: two, facts: [['+', 'e_aaaaaaaa', 'title', 'Renamed']] },
    // Said again as it was: nothing to play.
    { pos: 5, at: '2026-11-05T10:03:00.000Z', by: two, facts: [['+', 'e_bbbbbbbb', 'status', 'doing']] },
  ]);
  const islands = { e_aaaaaaaa: 'e_islanda1', e_bbbbbbbb: 'e_islandb1' };
  const steps = stepsOf(missed, { islands });
  assert.deepEqual(steps.map((s: any) => [s.chapter, s.island, s.pos]), [[0, 'e_islanda1', 2], [0, 'e_islandb1', 2], [0, 'e_islandb1', 3], [1, 'e_islanda1', 4]]);
  assert.deepEqual(steps[2].set.items.map((c: any) => [c.id, c.did]), [['e_cccccccc', 'came']]);
  assert.deepEqual(steps[2].set.links.map((c: any) => c.id), ['r_cccccccc'], 'the link plays with the island of its first end');
  assert.deepEqual(steps[2].ids.sort(), ['e_cccccccc', 'r_cccccccc']);
  assert.equal(steps[3].by.word, 'Herm');
  assert.equal(stepsOf(missed, { islands, me: 'e_agent001' }).length, 0, 'what the reader made is not played to them');
});

test('catch_up.replay offers what was missed in a band, plays it step by step and ends as the map is', async () => {
  const shown: unknown[] = [];
  // Played out when the part says the band is gone: waited for, not timed, so a busy machine does not cut it short.
  let ended: () => void = () => {};
  const playedOut = new Promise<void>((r) => (ended = r));
  const marks = (m: any) => (shown.push(checkMarks('catch_up.replay', m)), m?.[1]?.key === 'catch-up-none' && ended());
  const part = replay({ me: 'e_owner001', style: { numbers: { catch_up_start: 1, catch_up_step: 1 } } }, { marks });
  assert.deepEqual(part.marks, ['box', { key: 'catch-up-none' }], 'nothing missed, nothing offered');
  const by = { actor: 'e_agent001', run: 'e_run00001', word: 'Coll' };
  const missed = missedOf(held(), [entries[0], { ...entries[2], by: { ...by, run: 'e_run00009', word: 'Herm' } }]);
  const band = JSON.stringify(checkMarks('catch_up.replay', part.on({ name: 'missed', entries: missed, islands: {} })));
  assert.match(band, /"4 changed"/);
  assert.match(band, /"key":"play"/);
  const started = checkMarks('catch_up.replay', part.on({ key: 'play', name: 'press' }));
  // One step: what came and left in the one entry (pos 7) changes nothing drawn.
  const mark = started.at(-1);
  assert.deepEqual([mark[0], mark[1].at, mark[1].steps.map((s: any) => s.pos)], ['replay', 0, [5]], 'rewound: the canvas as the person left it');
  assert.deepEqual([...mark[1].steps[0].ids].sort(), ['e_aaaaaaaa', 'e_bbbbbbbb', 'e_dddddddd', 'r_aaaaaaaa', 'r_bbbbbbbb'], 'each step names what of its entry it plays');
  assert.equal(part.on({ key: 'play', name: 'press' }), undefined, 'playing, Play is not pressed again');
  await playedOut;
  const said = shown.map((m) => JSON.stringify(m));
  assert.ok(said.some((s) => /"1 of 1"/.test(s) && /Session Coll/.test(s) && /"replay",\{"at":1/.test(s)), 'each step who made it, in their word');
  assert.deepEqual(shown.at(-1), ['box', { key: 'catch-up-none' }], 'played out: the band gone, the map as it is');
  // Skip ends it at once; leave it does too, and what changed stays traced (catch_up.changes).
  const other = replay({}, { marks: () => {} });
  other.on({ name: 'missed', entries: missed });
  assert.deepEqual(other.on({ key: 'skip', name: 'press' }), ['box', { key: 'catch-up-none' }]);
  assert.equal(other.on({ key: 'shut', name: 'press' }), undefined);
});
