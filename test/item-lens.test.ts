import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Archipelago } from '../src/pelago.ts';
import { sessionStart } from '../src/sessions.ts';
import { callTool } from '../src/tools.ts';
import { human, agent, fresh, make } from './map.ts';

test('a lens files items by a field, sends the fields their pack shows, and says what a link says', async () => {
  const l = await fresh();
  const made = await make(l, [
    { op: 'create', ref: 'p', type: 'work.project', title: 'Research project' },
    { op: 'create', ref: 'ops', type: 'work.project', title: 'Business and operations' },
    { op: 'create', ref: 'irap', type: 'funding.program', title: 'NRC IRAP', status: 'open', props: { kind: 'grant', phase: 'research', amount: 'salaries ~80%', run_by: 'NRC' } },
    { op: 'create', ref: 'sred', type: 'funding.program', title: 'SR&ED', status: 'open', props: { kind: 'tax_credit', phase: 'prove', deadline: '2027-06-30', deadline_note: 'file by' } },
    { op: 'create', ref: 'lift', type: 'funding.program', title: 'BDC LIFT', status: 'open', props: { kind: 'loan', phase: 'build' } },
    { op: 'link', type: 'part_of', from: 'ops', to: 'p' },
    { op: 'link', type: 'part_of', from: 'irap', to: 'ops' },
    { op: 'link', type: 'part_of', from: 'sred', to: 'p' },
    { op: 'link', type: 'part_of', from: 'lift', to: 'ops' },
    { op: 'link', type: 'funding.reduces', from: 'sred', to: 'irap', props: { says: 'IRAP money is subtracted first' } },
  ]);
  await assert.rejects(callTool(l, human, 'view', { name: 'lens', params: { from: made.p, lanes: 'field:nothing_like_it' } }), /no type has a field "nothing_like_it"/);
  const answer = (await callTool(l, human, 'view', { name: 'lens', params: { from: made.p, lanes: 'field:phase', over: ['funding.reduces'] } })) as {
    said: string;
    lanes: string[];
    items: { id: string; lane?: string | null; fields?: Record<string, unknown>; inside: string | null }[];
    links: { kind: string; from: string; to: string; says?: string }[];
  };
  const item = (id: string) => answer.items.find((i) => i.id === id)!;
  assert.deepEqual(answer.lanes, ['set_up', 'research', 'build', 'prove']);
  assert.match(answer.said, /filed by its phase/);
  assert.deepEqual([item(made.irap).lane, item(made.lift).lane, item(made.sred).lane, item(made.ops).lane], ['research', 'build', 'prove', null]);
  assert.deepEqual(item(made.irap).fields, { kind: 'grant', phase: 'research', amount: 'salaries ~80%' }, 'run_by is not shown');
  assert.deepEqual(item(made.sred).fields, { kind: 'tax_credit', phase: 'prove', deadline: '2027-06-30', deadline_note: 'file by' });
  assert.equal(item(made.ops).fields, undefined);
  assert.equal(item(made.irap).inside, made.ops);
  assert.deepEqual(answer.links, [{ kind: 'funding.reduces', from: made.sred, to: made.irap, n: 1, says: 'IRAP money is subtracted first' }]);
});

test('a lens asked for by its id alone starts from what it is kept about, and can keep a still', async () => {
  const l = await fresh();
  const made = await make(l, [
    { op: 'create', ref: 'p', type: 'work.project', title: 'Research project' },
    { op: 'create', ref: 'q', type: 'work.project', title: 'Something else' },
    { op: 'create', ref: 'irap', type: 'funding.program', title: 'NRC IRAP', status: 'open', props: { kind: 'grant', phase: 'research' } },
    { op: 'create', ref: 'other', type: 'work.task', title: 'Elsewhere' },
    { op: 'create', ref: 'v', type: 'lens', title: 'Funding map', props: { kinds: ['work.project', 'funding.program'], lanes: 'field:phase' } },
    { op: 'link', type: 'part_of', from: 'irap', to: 'p' },
    { op: 'link', type: 'part_of', from: 'other', to: 'q' },
    { op: 'link', type: 'about', from: 'v', to: 'p' },
  ]);
  const answer = (await callTool(l, human, 'view', { name: 'lens', params: { lens: made.v } })) as { view: string; items: { id: string }[] };
  assert.equal(answer.view, made.v);
  assert.deepEqual(answer.items.map((i) => i.id).sort(), [made.p, made.irap].sort());
  const png = Buffer.from('89504e470d0a1a0a', 'hex').toString('base64');
  assert.equal(((await callTool(l, human, 'picture_put', { result: made.v, data: png, content_type: 'image/png' })) as { size: number }).size, 8);
});

test('a thing part of both a feature and the feature’s project is inside the feature', async () => {
  const l = await fresh();
  const made = await make(l, [
    { op: 'create', ref: 'top', type: 'work.project', title: 'Everything' },
    { op: 'create', ref: 'p', type: 'work.project', title: 'Business' },
    { op: 'create', ref: 'f', type: 'software.feature', title: 'A feature' },
    { op: 'create', ref: 't', type: 'work.task', title: 'A step' },
    { op: 'link', type: 'part_of', from: 'p', to: 'top' },
    { op: 'link', type: 'part_of', from: 'f', to: 'p' },
    { op: 'link', type: 'part_of', from: 't', to: 'p' },
    { op: 'link', type: 'part_of', from: 't', to: 'f' },
  ]);
  const answer = (await callTool(l, human, 'view', { name: 'lens', params: { from: made.f } })) as { items: { id: string; inside?: string }[] };
  assert.equal(answer.items.find((i) => i.id === made.t)?.inside, made.f);
});

test('an item says where it sits: what it is part of, outermost first, with the views kept about each', async () => {
  const l = await fresh();
  const made = await make(l, [
    { op: 'create', ref: 'p', type: 'work.project', title: 'Research project' },
    { op: 'create', ref: 'area', type: 'work.project', title: 'Simulation tools' },
    { op: 'create', ref: 'prog', type: 'funding.program', title: 'Mitacs AI Advantage', status: 'upcoming' },
    { op: 'create', ref: 'map', type: 'lens', title: 'Funding map', props: { place: 1 } },
    { op: 'create', ref: 'cut', type: 'lens', title: 'Shortcut', props: { from: 'e_elsewhere' } },
    { op: 'link', type: 'part_of', from: 'area', to: 'p' },
    { op: 'link', type: 'part_of', from: 'prog', to: 'area' },
    { op: 'link', type: 'about', from: 'map', to: 'p' },
    { op: 'link', type: 'about', from: 'cut', to: 'p' },
  ]);
  const { trail } = (await callTool(l, human, 'get', { id: made.prog })) as { trail: { id: string; title: string; views: { title: string }[] }[] };
  assert.deepEqual(trail.map((t) => [t.title, t.views.map((v) => v.title)]), [['Research project', ['Funding map']], ['Simulation tools', []]], 'a shortcut is not a view of it');
  assert.deepEqual(((await callTool(l, human, 'get', { id: made.p })) as { trail: unknown[] }).trail, []);
});

test('an item knows what names it in its text or fields, documents first, and only what the asker may see', async () => {
  const l = await fresh();
  const people = await make(l, [{ op: 'create', ref: 'bo', type: 'person', title: 'Bo' }]);
  const made = await make(l, [
    { op: 'create', ref: 'n', type: 'work.note', title: 'FedDev section', visibility: 'shared' },
    { op: 'create', ref: 't', type: 'work.task', title: 'Send the document', body: 'Details in {n}.', visibility: 'shared' },
    { op: 'create', ref: 'd', type: 'work.document', title: 'Funding document', body: 'Intro\n{n}', visibility: 'shared' },
  ]);
  Object.assign(made, await make(l, [{ op: 'create', ref: 'q', type: 'work.decision', title: 'Apply to RAII?', visibility: 'shared', props: { rationale: `See ${made.n}` } }]));
  const mentions = async (who: Archipelago) => ((await callTool(who, human, 'get', { id: made.n })) as { mentioned_in: { id: string }[] }).mentioned_in.map((m) => m.id);
  const all = await mentions(l);
  assert.equal(all[0], made.d, 'the document comes first');
  assert.deepEqual([...all].sort(), [made.t, made.d, made.q].sort());
  // Bo's own private note naming it is his alone to see.
  const bo = l.as(people.bo);
  await bo.change({ kind: 'human', name: 'bo', person: people.bo }, { ops: [{ op: 'create', type: 'work.note', title: 'Mine', body: `About ${made.n}`, visibility: 'private' }], reason: 'test' });
  assert.equal((await mentions(bo)).length, 4);
  assert.equal((await mentions(l.as('someone else'))).length, 3);
});

test('an item knows the pictures it is drawn in, and the documents that show them', async () => {
  const l = await fresh();
  const made = await make(l, [
    { op: 'create', ref: 'p', type: 'work.project', title: 'Research project' },
    { op: 'create', ref: 'in', type: 'funding.program', title: 'Mitacs Accelerate', status: 'open', props: { kind: 'wage_subsidy', phase: 'research' } },
    { op: 'create', ref: 'out', type: 'work.task', title: 'Call IRAP' },
    { op: 'create', ref: 'map', type: 'lens', title: 'Funding map', props: { kinds: ['work.project', 'funding.program'] } },
    { op: 'create', ref: 'd', type: 'work.document', title: 'Funding document', body: 'Intro\n{map}' },
    { op: 'link', type: 'part_of', from: 'in', to: 'p' },
    { op: 'link', type: 'part_of', from: 'out', to: 'p' },
    { op: 'link', type: 'about', from: 'map', to: 'p' },
  ]);
  const shown = async (id: string) => ((await callTool(l, human, 'get', { id })) as { shown_in: { title: string; of: { id: string }; documents: { id: string }[] }[] }).shown_in;
  assert.deepEqual(await shown(made.in), [{ id: made.map, title: 'Funding map', of: { id: made.p, title: 'Research project' }, documents: [{ id: made.d, type: 'work.document', title: 'Funding document' }] }]);
  assert.deepEqual(await shown(made.out), [], 'a task is not in a picture of programs');
});

test('a session’s turns are kept as stretches of work: a prompt begins one, a stop ends it, a long quiet starts the next', async () => {
  const { stretch, IDLE_MS } = await import('../src/sessions.ts');
  const t = (m: number) => new Date(Date.parse('2026-10-15T12:00:00Z') + m * 60_000).toISOString();
  let s = stretch([], t(0), 'at');
  s = stretch(s, t(40), 'until');
  assert.deepEqual(s, [[t(0), t(40)]], 'a turn runs from its prompt to its stop, however long');
  s = stretch(s, t(45), 'at');
  assert.deepEqual(s, [[t(0), t(45)]], 'a prompt a moment after a turn ended carries the stretch on');
  s = stretch(s, t(45 + IDLE_MS / 60_000 + 5), 'at');
  assert.equal(s.length, 2, 'after a long quiet, a new stretch');
  assert.deepEqual(stretch(s, t(600), 'close'), s, 'a session closed hours after it went quiet stopped when it went quiet');
  const l = await fresh();
  await sessionStart(l, agent, { session_id: 'turns' });
  const { sessionHeard } = await import('../src/sessions.ts');
  await sessionHeard(l, 'turns', 'begin');
  const run = (await l.db.query<{ props: Record<string, unknown> }>(`select props from entity where props->>'session_id' = 'turns'`)).rows[0];
  assert.deepEqual([(run.props.active as unknown[]).length, run.props.busy], [1, true]);
  await sessionHeard(l, 'turns', 'until');
  const after = (await l.db.query<{ props: Record<string, unknown> }>(`select props from entity where props->>'session_id' = 'turns'`)).rows[0];
  assert.equal(after.props.busy, false);
});

