// Questions and decisions are one type (decision e_5yrdf8aq, the owner, 18 Nov 2026; lane e_qerzwpsh): core's starter
// question carries the choices, the answer (outcome) and why, and settles by the owner's word. A decision made before
// becomes a question once, by a system change set (moved_from; docs/log.md section 6): its entries are not rewritten,
// and an old name in a change or a read reads as the new one. Once settled, the band shows the answer.
import assert from 'node:assert/strict';
import { cpSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { openDb } from '../packs/database/kernel/db.ts';
import { Registry } from '../packs/loader/kernel/packs.ts';
import { syncTypes } from '../packs/loader/kernel/typetable.ts';
import { callTool } from '../packs/surface/kernel/tools.ts';
import { Archipelago } from '../packs/write/kernel/pelago.ts';
// @ts-expect-error a page's module, plain JavaScript with no types
import { answerOf, leadFields, leadMarks } from '../packs/sheet/parts/page/lead.js';
// @ts-expect-error a page's module, plain JavaScript with no types
import { choicesOf } from '../packs/sheet/parts/page/sections.js';
import { fresh, human, make, PACKS } from './map.ts';

/** The repository's packs with core as it was before the fold: decision a flavour of question, which names no move. */
const before = () => {
  const dir = mkdtempSync(join(tmpdir(), 'pelago-decision-'));
  cpSync(PACKS, dir, { recursive: true });
  const core = JSON.parse(readFileSync(join(dir, 'core', 'pack.json'), 'utf8'));
  const q = core.types.find((t: { id: string }) => t.id === 'question');
  delete q.moved_from;
  core.types.push({ id: 'decision', moved_from: ['work.decision'], extends: 'question', title: 'Decision', description: 'Something decided.', statuses: { open: ['open'], closed: ['decided', 'reversed'] }, fields: { note_only: { type: 'string' } } });
  writeFileSync(join(dir, 'core', 'pack.json'), JSON.stringify(core));
  return dir;
};

const flat = (marks: unknown): string => JSON.stringify(marks);

test('core has one type for questions and decisions, with its choices, its answer and why', async () => {
  const l = await fresh();
  const q = l.registry.type('question')!;
  assert.equal(l.registry.types.has('decision'), false, 'decision is no type of its own');
  assert.equal(l.registry.canonical('decision'), 'question', 'its old name reads as the new');
  assert.deepEqual(q.capabilities.settles, { by: 'word', whose: 'owner', choices: 'options', chosen: 'outcome', why: 'rationale', on: 'decided_on' });
  for (const f of ['options', 'outcome', 'rationale', 'decided_on', 'due']) assert.ok(q.fields[f], `question declares ${f}`);
  for (const s of ['decided', 'settled', 'reversed', 'dropped']) assert.ok(q.statuses.closed.includes(s), `a question may close as ${s}`);

  // A change that names the old type makes a question, and a read by the old name finds it.
  const { d } = await make(l, [{ op: 'create', ref: 'd', type: 'decision', title: 'Host it ourselves?', status: 'decided', props: { outcome: 'No: hosted', rationale: 'Cheaper' } }]);
  const it = (await l.entity(d))!;
  assert.deepEqual([it.type, it.status, it.props.outcome], ['question', 'decided', 'No: hosted']);
  const found = (await callTool(l, human, 'search', { type: 'decision' })) as { id: string }[];
  assert.ok(found.some((x) => x.id === d));
});

test('a decision made before the fold is a question after it, once, with nothing it had rewritten', async () => {
  const db = await openDb();
  const old = new Archipelago(db, new Registry([before()]));
  await syncTypes(old);
  const made = (await old.change(human, { reason: 'test', ops: [
    { op: 'create', ref: 'd', type: 'decision', title: 'Which engine?', status: 'decided', props: { outcome: 'Postgres' } },
    { op: 'create', ref: 'q', type: 'question', title: 'Is it fast enough?', status: 'settled' },
  ] })) as { created: Record<string, string> };
  const entries = async () => (await db.query<{ pos: string; hash: string }>(`select pos::text, encode(hash, 'hex') as hash from log_entry where stream = 'facts' order by pos`)).rows;
  const was = await entries();

  const now = new Archipelago(db, new Registry([PACKS]));
  const synced = await syncTypes(now);
  assert.deepEqual(synced.moved, { decision: 1 });
  const d = (await now.entity(made.created.d))!;
  assert.deepEqual([d.type, d.kind, d.status, d.title], ['question', 'question', 'decided', 'Which engine?']);
  assert.equal((await now.entity(made.created.q))!.status, 'settled', 'a question settled before is as it was');
  // The entries before are as they were; the move is one entry after them, saying the new type.
  const after = await entries();
  assert.deepEqual(after.slice(0, was.length), was);
  const { rows } = await db.query<{ action: string }>(`select head->>'action' as action from log_entry where stream = 'facts' and pos > $1::bigint order by pos`, [was.at(-1)!.pos]);
  assert.ok(rows.some((r) => r.action === 'type.moved'));
  assert.deepEqual((await syncTypes(now)).moved, {}, 'once moved, nothing moves again');
});

test('a settled question opens on its answer, with or without choices; an open one on its choices', async () => {
  const l = await fresh();
  const type = l.registry.type('question')!;
  const settled = { id: 'e_1', is_open: false, status: 'decided', props: { outcome: 'Yes: each option carries a consequence', rationale: 'Thin reasoning draws a warning', decided_on: '2026-11-18' } };
  // No choices: the answer still leads.
  assert.equal(choicesOf(settled, type), null);
  const a = answerOf(settled, type)!;
  assert.equal(a.picked, 'Yes: each option carries a consequence');
  const band = flat(leadMarks(settled, type, null));
  assert.ok(band.includes('✓') && band.includes('Yes: each option carries a consequence') && band.includes('Thin reasoning draws a warning'));
  assert.ok(!band.includes('2026-11-18'), 'when it was settled is a mark, not the band');
  assert.deepEqual(leadFields(settled, type, null), ['outcome', 'rationale'], 'what the band says, the fields do not say again');

  // With choices: the answer, and the choices not taken are not listed again.
  const picked = { ...settled, props: { ...settled.props, options: ['Yes: each option carries a consequence', 'No'] } };
  const withChoices = flat(leadMarks(picked, type, choicesOf(picked, type)));
  assert.ok(withChoices.includes('Yes: each option carries a consequence') && !withChoices.includes('"No"'));

  // Open, with choices: each a press to settle it by.
  const open = { id: 'e_2', is_open: true, status: 'open', props: { options: ['Named arrangements', 'An island module'] } };
  const choices = flat(leadMarks(open, type, choicesOf(open, type), { writes: true }));
  assert.ok(choices.includes('choice:0') && choices.includes('An island module'));
  assert.equal(answerOf(open, type), null);

  // Closed with no answer kept: no band said from nothing.
  assert.equal(leadMarks({ id: 'e_3', is_open: false, status: 'dropped', props: {} }, type, null), null);
});
