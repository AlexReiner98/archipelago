// The fact stream (docs/log.md, sections 1 to 3): every applied change set appended as facts, each entry chained to
// the one before by its hash, held changes in the pending stream until a person decides them, and nothing in either
// ever changed. The proof that the facts say all there is: the stream replayed into fresh tables gives the same rows.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { agent, fresh, human, make } from './map.ts';
import { canonical, entryHash, jcs } from '../src/jcs.ts';
import { entries, entry, stored, verify, type Entry } from '../src/log.ts';
import { project } from '../src/replay.ts';
import { KEPT_FIELDS } from '../src/operational.ts';
import { undo } from '../src/undo.ts';
import type { Archipelago } from '../src/pelago.ts';

async function all(l: Archipelago, stream: 'facts' | 'pending' = 'facts') {
  const out: Entry[] = [];
  for (let page = await entries(l.db, stream, 1); page.length; page = await entries(l.db, stream, out.at(-1)!.pos + 1)) out.push(...page);
  return out;
}

const ITEM = `id, type, title, body, status, is_open, owner, visibility, confidence, jsonb_strip_nulls(props) - $1::text[] as props, source_id,
  date_trunc('milliseconds', created_at) as created_at, date_trunc('milliseconds', updated_at) as updated_at, date_trunc('milliseconds', archived_at) as archived_at, private_to, kind`;
const LINK = `id, type, from_id, to_id, props, confidence, source_id, date_trunc('milliseconds', valid_from) as valid_from, date_trunc('milliseconds', valid_to) as valid_to`;

/** The live rows and the rows the fact stream replays into, as the same query reads them. */
async function replayed(l: Archipelago) {
  const { items, links } = project(await all(l), (type, status) => l.registry.isOpen(type, status));
  await l.db.query(`create temp table if not exists replay_entity (like entity including defaults)`);
  await l.db.query(`create temp table if not exists replay_relation (like relation including defaults)`);
  await l.db.query(`delete from replay_entity`);
  await l.db.query(`delete from replay_relation`);
  await l.db.query(`insert into replay_entity select * from jsonb_populate_recordset(null::replay_entity, $1::jsonb)`, [JSON.stringify(items.map((i) => ({ ...i, workspace: 'default' })))]);
  await l.db.query(`insert into replay_relation select * from jsonb_populate_recordset(null::replay_relation, $1::jsonb)`, [JSON.stringify(links.map((r) => ({ ...r, workspace: 'default' })))]);
  const read = async (sql: string, params: unknown[] = []) => (await l.db.query(sql, params)).rows;
  return {
    live: { items: await read(`select ${ITEM} from entity order by id`, [KEPT_FIELDS]), links: await read(`select ${LINK} from relation order by id`) },
    replay: { items: await read(`select ${ITEM} from replay_entity order by id`, [KEPT_FIELDS]), links: await read(`select ${LINK} from replay_relation order by id`) },
  };
}

test('the canonical form is RFC 8785, and a sealed value is hashed by its digest', () => {
  assert.equal(jcs({ b: [1, 'x', null, true], a: { d: 1e21, c: 0.1 }, é: ' "' }), '{"a":{"c":0.1,"d":1e+21},"b":[1,"x",null,true],"é":" \\""}');
  assert.equal(jcs({ '€': 1, '😀': 2, a: 3 }), '{"a":3,"€":1,"😀":2}', 'keys in UTF-16 code unit order');
  const sealed = { $k: 1, $n: 'AAAAAAAAAAAAAAAA', $c: 'BBBB' };
  assert.match(canonical({ facts: [['+', 'e_1', 'title', sealed]], hash: 'x' }), /^pelago-log\n\{"facts":\[\["\+","e_1","title",\{"\$h":"[0-9a-f]{64}"\}\]\]\}$/);
  assert.equal(entryHash({ a: 1, hash: 'one' }), entryHash({ a: 1, hash: 'two' }), 'the hash does not cover itself');
});

test('every change set is appended as facts, chained, in the transaction that writes it', async () => {
  const l = await fresh();
  const made = await make(l, [
    { op: 'create', ref: 'p', type: 'work.project', title: 'Log' },
    { op: 'create', ref: 't', type: 'work.task', title: 'Chain it', body: 'Part of {p}.', props: { priority: 'high' } },
    { op: 'link', type: 'part_of', from: 't', to: 'p' },
  ]);
  const [first] = await all(l);
  assert.deepEqual([first.v, first.ws, first.stream, first.pos, first.prev], [1, 'default', 'facts', 1, '0'.repeat(64)]);
  assert.deepEqual(first.rule, { outcome: 'apply', spared: [] });
  assert.deepEqual(first.actor, { id: 'human:test' });
  assert.equal(first.hash, entryHash((await stored(l.db))[0]), 'the hash of the entry as stored, its words sealed');
  const t = first.facts.filter((f) => f[1] === made.t);
  assert.deepEqual(t.map((f) => f.slice(2)), [['type', 'work.task'], ['kind', 'work'], ['title', 'Chain it'], ['body', `Part of ${made.p}.`], ['status', 'todo'], ['visibility', 'private'], ['priority', 'high']]);
  assert.deepEqual(first.facts.find((f) => f[2] === 'link')!.slice(3), [['part_of', made.t, made.p]]);

  await make(l, [{ op: 'update', id: made.t, status: 'doing', props: { priority: null } }]);
  await make(l, [{ op: 'update', id: made.t }]);
  const [, second, third] = await all(l);
  assert.deepEqual(second.facts, [['+', made.t, 'status', 'doing'], ['-', made.t, 'priority']], 'what changed, and nothing else');
  assert.deepEqual(third.facts, [['+', made.t, 'checked', true]], 'checked, still true: the moment is kept');
  assert.equal(second.prev, first.hash);
  assert.ok(second.at >= first.at);

  // A change refused writes nothing to the log either.
  await assert.rejects(l.change(human, { reason: 'test', ops: [{ op: 'update', id: 'e_none' }] }));
  assert.equal((await all(l)).length, 3);
  assert.deepEqual(await verify(l.db), { stream: 'facts', entries: 3, head: third.hash, problems: [] });
});

test('the log takes no update and no delete, from anyone', async () => {
  const l = await fresh();
  await make(l, [{ op: 'create', type: 'work.task', title: 'Kept' }]);
  for (const sql of [`update log_entry set id = 'c_x'`, `delete from log_entry`, `update log_fact set value = '"x"'`, `delete from log_fact`, `truncate log_fact`, `truncate log_entry cascade`]) {
    await assert.rejects(l.db.query(sql), /append-only/, sql);
  }
  const member = l.as('e_someone');
  await assert.rejects(member.db.query(`update log_entry set id = 'c_x'`), /permission denied/);
  await assert.rejects(member.db.query(`delete from log_fact`), /permission denied/);

  // Should the trigger be dropped by someone who owns the tables, the chain still says so.
  await l.db.query(`alter table log_fact disable trigger log_fact_append_only`);
  await l.db.query(`update log_fact set value = '"Changed"' where field = 'title'`);
  const { problems } = await verify(l.db);
  assert.deepEqual(problems.map((p) => p.replace(/\(c_\w+\)/, '(c)')), ['facts 1 (c): its hash is not that of what it holds']);
});

test('a held change waits on a known position; approving appends what it showed, rejecting appends that', async () => {
  const l = await fresh();
  const made = await make(l, [{ op: 'create', ref: 'p', type: 'work.project', title: 'Log' }]);
  const held = (await l.change(agent, { reason: 'More work', ops: [{ op: 'create', ref: 'n', type: 'work.task', title: 'New' }, { op: 'link', type: 'part_of', from: 'n', to: made.p }], source: { uri: 'docs/log.md' } })) as { proposal: string; held_by: { rule: string } };
  const record = (await entry(l.db, held.proposal))!;
  assert.deepEqual([record.stream, record.pos, record.base, (record.held_by as { rule: string }).rule], ['pending', 1, 1, held.held_by.rule]);
  assert.equal(record.facts[0][2], 'type', 'what it would do, the source first');
  assert.equal((await all(l)).length, 1, 'nothing in the fact stream yet');

  const approved = (await l.decide(human, { proposal: held.proposal, approve: true })) as { changeset: string };
  const done = (await entry(l.db, approved.changeset))!;
  assert.deepEqual(done.facts, record.facts, 'with nothing moved since, the facts it showed');
  assert.deepEqual(done.rule, { outcome: 'approved', held_by: { rule: held.held_by.rule, pack: 'core' }, proposal: held.proposal, proposal_hash: record.hash, by: 'human:test', revised: false, except: [] });
  assert.deepEqual([done.actor, done.authority, done.reason], [{ id: 'agent:test' }, { of: 'human', who: 'human:test' }, 'More work']);

  const no = (await l.change(agent, { reason: 'Rename', ops: [{ op: 'update', id: made.p, title: 'The log' }] })) as { proposal: string };
  await l.decide(human, { proposal: no.proposal, approve: false, note: 'Keep the name' });
  const declined = (await all(l)).at(-1)!;
  assert.deepEqual([declined.facts, declined.reason, (declined.rule as { outcome: string }).outcome, declined.actor], [[], 'Keep the name', 'rejected', { id: 'human:test' }]);
  assert.equal((await l.entity(made.p))!.title, 'Log');
});

test('approving after the map moved: planned again, or refused as overtaken with the three values', async () => {
  const l = await fresh();
  const made = await make(l, [{ op: 'create', ref: 't', type: 'work.task', title: 'Moving', body: 'First.' }]);
  // A note added to is planned on the note as it is now.
  const add = (await l.change(agent, { reason: 'More', ops: [{ op: 'update', id: made.t, append: 'Third.' }] })) as { proposal: string };
  await make(l, [{ op: 'update', id: made.t, append: 'Second.' }]);
  await l.decide(human, { proposal: add.proposal, approve: true });
  assert.equal((await l.entity(made.t))!.body, 'First.\n\nSecond.\n\nThird.');

  // A field set outright that someone has set since to something else is overtaken.
  const set = (await l.change(agent, { reason: 'Start', ops: [{ op: 'update', id: made.t, status: 'doing' }] })) as { proposal: string };
  await make(l, [{ op: 'update', id: made.t, status: 'waiting' }]);
  await assert.rejects(l.decide(human, { proposal: set.proposal, approve: true }), /out of date[\s\S]*"Moving": status was "todo" when this was held, is "waiting" now, and this would make it "doing"/);
  // Corrected by the reviewer, it is planned on the map as it is and approved as revised.
  const revised = (await l.decide(human, { proposal: set.proposal, approve: true, ops: [{ op: 'update', id: made.t, status: 'doing' }] })) as { changeset: string };
  assert.equal(((await entry(l.db, revised.changeset))!.rule as { revised: boolean }).revised, true);

  // One that asks only for what is now so leaves the queue as superseded, by the change that made it so.
  const moot = (await l.change(agent, { reason: 'Done', ops: [{ op: 'update', id: made.t, status: 'done' }] })) as { proposal: string };
  const by = (await make(l, [{ op: 'update', id: made.t, status: 'done' }]), (await all(l)).at(-2)!);
  const last = (await all(l)).at(-1)!;
  assert.deepEqual([last.actor, last.rule], [{ id: 'system' }, { outcome: 'superseded', held_by: { rule: 'agent_changes', pack: 'core' }, proposal: moot.proposal, proposal_hash: (await entry(l.db, moot.proposal))!.hash, by: by.id }]);
});

test('undo appends the opposite change set, and the facts replay into the rows the map has', async () => {
  const l = await fresh();
  const me = (await make(l, [{ op: 'create', ref: 'me', type: 'person', title: 'Owner' }])).me;
  const mine = l.as(me);
  const made = await make(l, [
    { op: 'create', ref: 'p', type: 'work.project', title: 'Rework' },
    { op: 'create', ref: 'a', type: 'work.task', title: 'Write the spec', owner: me, props: { priority: 'high' } },
    { op: 'create', ref: 'b', type: 'work.task', title: 'Write the spec again' },
    { op: 'create', ref: 'c', type: 'work.task', title: 'Build it', confidence: 0.6 },
    { op: 'create', ref: 'x', type: 'person', title: 'Sam' },
    { op: 'create', ref: 'y', type: 'person', title: 'Samuel' },
    { op: 'link', type: 'part_of', from: 'a', to: 'p' },
    { op: 'link', type: 'part_of', from: 'b', to: 'p' },
    { op: 'link', type: 'depends_on', from: 'b', to: 'a' },
    { op: 'link', type: 'depends_on', from: 'c', to: 'b', confidence: 0.8 },
    { op: 'link', type: 'waits_on', from: 'c', to: 'x', props: { for: 'An answer' } },
  ]);
  await l.change(human, { reason: 'Cited', source: { uri: 'docs/log.md', title: 'The spec', excerpt: 'Section 2' }, ops: [{ op: 'update', id: made.a, body: 'Sections 1 to 3.', status: 'doing' }] });
  const edit = (await l.change(human, { reason: 'Reshape', ops: [{ op: 'update', id: made.c, title: 'Build the stream', props: { priority: 'low' }, owner: made.x }, { op: 'archive', id: made.p }] })) as { changeset: string };
  const hidden = (await mine.change(human, { reason: 'Mine', ops: [{ op: 'create', ref: 'h', type: 'work.task', title: 'Private to me', visibility: 'private' }] })) as { created: Record<string, string> };
  await mine.change(human, { reason: 'Share it', ops: [{ op: 'update', id: hidden.created.h, visibility: 'shared' }] });
  const waits = (await l.get(made.c)).outgoing.find((r: any) => r.type === 'waits_on') as { relation: string };
  await make(l, [{ op: 'unlink', relation: waits.relation }, { op: 'restore', id: made.p }]);

  // A merge: b's part_of repeats a's and goes, its depends_on a would join a to itself and goes, c's depends_on moves to a.
  await make(l, [{ op: 'merge', keep: made.a, drop: made.b }]);
  await make(l, [{ op: 'merge', keep: made.y, drop: made.x }]);
  assert.equal((await l.entity(made.c))!.owner, made.y, 'what the dropped person owned is the kept one\'s');
  const merge = (await all(l)).at(-2)!;
  assert.deepEqual(merge.facts.filter((f) => f[1] === made.b), [['+', made.b, 'archived', true], ['+', made.b, 'merged_into', made.a]]);
  assert.deepEqual(merge.facts.filter((f) => f[2] === 'link').map((f) => [f[0], f.length]).sort(), [['+', 4], ['-', 3], ['-', 3]]);

  // Undo, and undo of the undo.
  const back = (await undo(l, human, { changeset: edit.changeset })) as { changeset: string; skipped: string[] };
  const opposite = (await entry(l.db, back.changeset))!;
  assert.equal(opposite.undoes, edit.changeset);
  assert.deepEqual(back.skipped, ['"Build the stream": owner has changed again since, so it was left as it is']);
  assert.deepEqual(opposite.facts.filter((f) => f[1] === made.c), [['+', made.c, 'title', 'Build it'], ['-', made.c, 'priority']]);
  await undo(l, human, { changeset: back.changeset });
  assert.equal((await l.entity(made.c))!.title, 'Build the stream');
  await assert.rejects(undo(l, human, { changeset: edit.changeset }), /already been undone/);

  // Held changes approved, overtaken, declined; one approved with an op left out; a type defined.
  const asked = (await l.change(agent, { reason: 'Next', ops: [{ op: 'create', ref: 'd', type: 'work.task', title: 'Replay it' }, { op: 'link', type: 'part_of', from: 'd', to: made.p }, { op: 'update', id: made.a, status: 'done' }] })) as { proposal: string };
  await l.decide(human, { proposal: asked.proposal, approve: true, except: ['#3'] });
  const declined = (await l.change(agent, { reason: 'No', ops: [{ op: 'archive', id: made.c }] })) as { proposal: string };
  await l.decide(human, { proposal: declined.proposal, approve: false });
  await make(l, [{ op: 'define_type', type: { id: 'local.step', title: 'Step', description: 'A step', extends: 'work' } as never }]);
  await make(l, [{ op: 'create', type: 'local.step', title: 'First step', status: 'todo' }]);

  assert.deepEqual((await verify(l.db)).problems, []);
  assert.deepEqual((await verify(l.db, 'pending')).problems, []);
  const { live, replay } = await replayed(l);
  assert.ok(live.items.length > 10 && live.links.length > 5);
  assert.deepEqual(replay.items, live.items, 'every item, row for row');
  assert.deepEqual(replay.links, live.links, 'every link, row for row');

  // What is pending is a projection too: the records no entry has decided.
  const decided = new Set((await all(l)).map((e) => (e.rule as { proposal?: string } | null)?.proposal).filter(Boolean));
  const pending = (await all(l, 'pending')).filter((p) => !decided.has(p.id)).map((p) => p.id);
  assert.deepEqual(pending, (await l.proposals()).map((p) => p.id));
});
