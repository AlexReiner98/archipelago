// What becomes of a change, as a table: who makes it, which op on which type, at which visibility, under which
// workspace setting and server policy, and whether it applies, waits for a person or is refused. The table was taken
// from the code before every approval was decided by a rule (main at 85b9d84) and is kept in
// test/fixtures/approvals.json: the rules must come to the same answer on every row. APPROVALS_WRITE=1 writes it again.
// The table is about 4000 changes, minutes of one process: each server policy's rows are checked by PARTS files
// (approvals-<policy>-<part>.test.ts), its settings dealt among them, so they all run side by side.
import assert from 'node:assert/strict';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { Archipelago, type Actor, type ChangeInput, type Op, type Policy } from '../src/pelago.ts';
import { Registry } from '../src/packs.ts';
import { freshWith, human, PACKS } from './map.ts';

const FILE = join(import.meta.dirname, 'fixtures', 'approvals.json');
const agent: Actor = { kind: 'agent', name: 'table' };
const OPS = ['create', 'update', 'link', 'unlink', 'archive', 'restore', 'merge', 'define_type'] as const;
const all = (level: 'auto' | 'propose'): Policy => Object.fromEntries(OPS.map((op) => [op, level])) as Policy;

/** The server's policy: as shipped, in dev mode, and loosened per op with one op forbidden. */
export const POLICIES: Record<string, Partial<Policy>> = {
  review: {},
  dev: all('auto'),
  mixed: { create: 'auto', update: 'auto', link: 'auto', merge: 'forbidden' },
};

/** The workspace's own settings: none is one that never chose (it follows the server), apply is where a new one begins. */
export const SETTINGS: Record<string, Record<string, unknown>> = {
  none: {},
  apply: { agent_changes: 'apply' },
  hold: { agent_changes: 'hold' },
  code: { agent_code: true },
  'apply+code': { agent_changes: 'apply', agent_code: true },
  // Holds off (the owner, 3 Nov 2026, e_66mwta3w): whatever a rule holds applies; asked and propose-only still wait.
  off: { holds_off: true },
  'hold+off': { agent_changes: 'hold', holds_off: true },
};

/** How many files check each policy's rows: its settings dealt among them, the first to part 1, the next to part 2, ... */
export const PARTS = 2;

/** The settings one part of a policy's rows is checked under. */
export const settingsOf = (part: number) => Object.keys(SETTINGS).filter((_, i) => i % PARTS === part - 1);

/** Who sends it: a person, an agent, an agent asking for a look, an agent whose token only proposes, a report's reading. */
const ACTORS: Record<string, { actor: Actor; hold?: boolean; measured?: boolean }> = {
  human: { actor: human },
  agent: { actor: agent },
  asking: { actor: agent, hold: true },
  proposer: { actor: { ...agent, may: 'propose' } },
  reading: { actor: agent, measured: true },
};

type Ids = Record<string, string>;
interface Case {
  /** What a person makes first, for the case to act on. */
  given?: Op[];
  ops: (ids: Ids) => Op[];
  authority?: ChangeInput['authority'];
}

const said = { of: 'agent' as const, basis: 'the table' };
const task = (ref = 't', extra: Partial<Op> = {}): Op => ({ op: 'create', ref, type: 'task', title: `Task ${ref}`, ...extra }) as Op;
const decision: Op = { op: 'create', ref: 'd', type: 'decision', title: 'Which way?' };
// A question settled by evidence and a type that can be public, from test packs (test/packs/claims, test/fixtures/packs/pages)
// now that science's hypothesis and work's document are the hosted service's.
const hypothesis: Op = { op: 'create', ref: 'h', type: 'conjecture', title: 'It is faster' };
const style = (ref = 's'): Op => ({ op: 'create', ref, type: 'style', title: `Style ${ref}` });
const layout = (ref = 's'): Op => ({ op: 'create', ref, type: 'layout', title: `Layout ${ref}` });
const doc: Op = { op: 'create', ref: 'doc', type: 'page', title: 'Guide' };
const automation: Op = { op: 'create', ref: 'a', type: 'automation', title: 'Nightly', status: 'paused', props: { trigger: 'daily', at: '03:00', action: 'notify', message: 'hi' } };

const CASES: Record<string, Case> = {
  'create task': { ops: () => [task()] },
  'create task private': { ops: () => [task('t', { visibility: 'private' })] },
  'create task shared': { ops: () => [task('t', { visibility: 'shared' })] },
  'create task public': { ops: () => [task('t', { visibility: 'public' })] },
  'create document public': { ops: () => [{ ...doc, visibility: 'public' }] },
  'create document shared': { ops: () => [{ ...doc, visibility: 'shared' }] },
  'create decision open': { ops: () => [decision] },
  'create decision decided': { ops: () => [{ ...decision, status: 'decided', props: { outcome: 'this', rationale: 'that' } }] },
  'create style': { ops: () => [style()] },
  'create layout with code': { ops: () => [{ ...layout(), props: { code: 'export default () => []' } }] },
  'create screen': { ops: () => [{ op: 'create', type: 'screen', title: 'Board' }] },
  'create automation': { ops: () => [automation] },
  'update task title': { given: [task()], ops: (i) => [{ op: 'update', id: i.t, title: 'Renamed' }] },
  'update task done': { given: [task()], ops: (i) => [{ op: 'update', id: i.t, status: 'done' }] },
  'update task shared': { given: [task('t', { visibility: 'private' })], ops: (i) => [{ op: 'update', id: i.t, visibility: 'shared' }] },
  'update document public': { given: [doc], ops: (i) => [{ op: 'update', id: i.doc, visibility: 'public' }] },
  'update decision note': { given: [decision], ops: (i) => [{ op: 'update', id: i.d, append: 'More.' }] },
  'settle decision bare': { given: [decision], ops: (i) => [{ op: 'update', id: i.d, status: 'decided' }] },
  'settle decision bare, said': { given: [decision], authority: said, ops: (i) => [{ op: 'update', id: i.d, status: 'decided' }] },
  'settle decision why': { given: [decision], ops: (i) => [{ op: 'update', id: i.d, status: 'decided', props: { outcome: 'this', rationale: 'that' } }] },
  'settle decision why, said': { given: [decision], authority: said, ops: (i) => [{ op: 'update', id: i.d, status: 'decided', props: { outcome: 'this', rationale: 'that' } }] },
  'settle decision with a task': { given: [decision, task()], authority: said, ops: (i) => [{ op: 'update', id: i.t, title: 'Renamed' }, { op: 'update', id: i.d, status: 'decided', props: { outcome: 'this', rationale: 'that' } }] },
  'reopen decision': { given: [{ ...decision, status: 'decided', props: { outcome: 'this', rationale: 'that' } }], authority: said, ops: (i) => [{ op: 'update', id: i.d, status: 'open' }] },
  'settle hypothesis': { given: [hypothesis], ops: (i) => [{ op: 'update', id: i.h, status: 'supported' }] },
  'settle hypothesis, said': { given: [hypothesis], authority: said, ops: (i) => [{ op: 'update', id: i.h, status: 'supported' }] },
  'update style title': { given: [style()], ops: (i) => [{ op: 'update', id: i.s, title: 'Calmer' }] },
  'update layout code': { given: [layout()], ops: (i) => [{ op: 'update', id: i.s, props: { code: 'export default () => []' } }] },
  'update style page_css': { given: [style()], ops: (i) => [{ op: 'update', id: i.s, props: { page_css: 'h2 { color: red }' } }] },
  'update automation': { given: [automation], ops: (i) => [{ op: 'update', id: i.a, title: 'Weekly' }] },
  'archive automation': { given: [automation], ops: (i) => [{ op: 'archive', id: i.a }] },
  'link task': { given: [task(), task('u')], ops: (i) => [{ op: 'link', type: 'depends_on', from: i.t, to: i.u }] },
  'unlink task': { given: [task(), task('u'), { op: 'link', type: 'depends_on', from: 't', to: 'u' }], ops: (i) => [{ op: 'unlink', relation: i.link }] },
  'archive task': { given: [task()], ops: (i) => [{ op: 'archive', id: i.t }] },
  'restore task': { given: [task()], ops: (i) => [{ op: 'restore', id: i.t }] },
  'merge tasks': { given: [task(), task('u')], ops: (i) => [{ op: 'merge', keep: i.t, drop: i.u }] },
  'merge styles': { given: [style(), style('z')], ops: (i) => [{ op: 'merge', keep: i.s, drop: i.z }] },
  'forget task': { given: [task()], ops: (i) => [{ op: 'forget', id: i.t }] },
  'define type': { ops: () => [{ op: 'define_type', type: { id: 'local.thing', title: 'Thing', description: 'A thing.', extends: 'work' } }] },
};

/** What becomes of one case: applied, held (proposed) or refused. */
async function outcome(l: Archipelago, who: (typeof ACTORS)[string], c: Case): Promise<string> {
  const ids: Ids = {};
  if (c.given) {
    const made = (await l.change(human, { ops: c.given, reason: 'given' })) as { created: Ids };
    Object.assign(ids, made.created);
    const linked = c.given.find((op) => op.op === 'link');
    if (linked) ids.link = (await l.db.query<{ id: string }>(`select id from relation where from_id = $1 and valid_to is null and type = 'depends_on'`, [ids.t])).rows[0].id;
    if (c.ops(ids).some((op) => op.op === 'restore')) await l.change(human, { ops: [{ op: 'archive', id: ids.t }], reason: 'given' });
  }
  try {
    const input: ChangeInput = { ops: c.ops(ids), reason: 'the table', ...(c.authority && { authority: c.authority }), ...(who.hold && { hold: true }) };
    const answer = await l.change(who.actor, input, who.measured);
    return answer.status === 'proposed' ? 'hold' : 'apply';
  } catch {
    return 'refuse';
  }
}

/** The rows of the table under one server policy and one part of its settings, checked against the fixture's rows for them. */
export function checkPolicy(policyName: string, part: number) {
  test(`every change comes to what it came to before the rules decided it all: the ${policyName} policy, part ${part} of ${PARTS}`, { timeout: 600_000 }, async () => {
    const policy = POLICIES[policyName];
    const settings = settingsOf(part);
    const table: Record<string, string> = {};
    for (const settingName of settings) {
      const setting = SETTINGS[settingName];
      const base = await freshWith(new Registry([PACKS, join(import.meta.dirname, 'packs'), join(import.meta.dirname, 'fixtures', 'packs')], ['core', 'claims', 'pages']));
      const l = new Archipelago(base.db, base.registry, policy);
      for (const [key, value] of Object.entries(setting)) await l.db.query(`insert into setting (key, value) values ($1, $2::jsonb)`, [key, JSON.stringify(value)]);
      for (const [actorName, who] of Object.entries(ACTORS))
        for (const [caseName, c] of Object.entries(CASES)) table[`${policyName} | ${settingName} | ${actorName} | ${caseName}`] = await outcome(l, who, c);
      await base.db.close();
    }
    const mine = (row: string) => {
      const [p, s] = row.split(' | ');
      return p === policyName && settings.includes(s);
    };
    const kept = existsSync(FILE) ? (JSON.parse(readFileSync(FILE, 'utf8')) as Record<string, string>) : {};
    // Written again a part at a time (run the files one after another: --test-concurrency=1): the other rows kept, every
    // row where it stood, a row no longer made dropped and a new one added at the end, so the parts in any order write
    // the same file.
    if (process.env.APPROVALS_WRITE === '1' || !existsSync(FILE)) {
      const rows = Object.fromEntries(Object.entries(kept).filter(([row]) => !mine(row) || row in table).map(([row, was]) => [row, mine(row) ? table[row] : was]));
      writeFileSync(FILE, `${JSON.stringify({ ...rows, ...table }, null, 1)}
`);
    }
    const before = Object.fromEntries(Object.entries(JSON.parse(readFileSync(FILE, 'utf8')) as Record<string, string>).filter(([row]) => mine(row)));
    const differ = Object.keys({ ...before, ...table }).filter((row) => before[row] !== table[row]).map((row) => `${row}: was ${before[row]}, now ${table[row]}`);
    assert.deepEqual(differ, [], 'rows that changed');
  });
}
