import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Archipelago } from '../src/pelago.ts';
import { sessionStart } from '../src/sessions.ts';
import { callTool } from '../src/tools.ts';
import { human, agent, fresh, make } from './map.ts';

test('a view kept on the map is drawn from its flat lens, with its pins, and can keep a still', async () => {
  const l = await fresh();
  const made = await make(l, [
    { op: 'create', ref: 'p', type: 'project', title: 'Research project' },
    { op: 'create', ref: 'irap', type: 'program', title: 'NRC IRAP', status: 'open', props: { kind: 'grant', phase: 'research' } },
    { op: 'create', ref: 'other', type: 'task', title: 'Elsewhere' },
    { op: 'link', type: 'part_of', from: 'irap', to: 'p' },
  ]);
  Object.assign(made, await make(l, [
    { op: 'create', ref: 'v', type: 'lens', title: 'Funding map', props: { filter: { find: [`id ${made.p}`] }, walk: { over: ['part_of'], steps: 1 }, pins: [made.other], style: { shape: 'list' } } },
    { op: 'link', type: 'about', from: 'v', to: made.p },
  ]));
  const { keptPicture } = await import('../src/query-saved.ts');
  const answer = await keptPicture(l, made.v);
  assert.deepEqual(answer.items.map((i) => i.id).sort(), [made.p, made.irap, made.other].sort());
  assert.equal(answer.style.shape, 'list', 'drawn in the shape it keeps');
  await assert.rejects(keptPicture(l, made.p), /not a view kept on the map/);
  const png = Buffer.from('89504e470d0a1a0a', 'hex').toString('base64');
  assert.equal(((await callTool(l, human, 'picture_put', { result: made.v, data: png, content_type: 'image/png' })) as { size: number }).size, 8);
});

test('an item says where it sits: what it is part of, outermost first, with the views kept about each', async () => {
  const l = await fresh();
  const made = await make(l, [
    { op: 'create', ref: 'p', type: 'project', title: 'Research project' },
    { op: 'create', ref: 'area', type: 'project', title: 'Simulation tools' },
    { op: 'create', ref: 'prog', type: 'program', title: 'Mitacs AI Advantage', status: 'upcoming' },
    { op: 'create', ref: 'map', type: 'lens', title: 'Funding map', props: { place: 1 } },
    { op: 'link', type: 'part_of', from: 'area', to: 'p' },
    { op: 'link', type: 'part_of', from: 'prog', to: 'area' },
    { op: 'link', type: 'about', from: 'map', to: 'p' },
  ]);
  const { trail } = (await callTool(l, human, 'get', { id: made.prog })) as { trail: { id: string; title: string; views: { title: string }[] }[] };
  assert.deepEqual(trail.map((t) => [t.title, t.views.map((v) => v.title)]), [['Research project', ['Funding map']], ['Simulation tools', []]]);
  assert.deepEqual(((await callTool(l, human, 'get', { id: made.p })) as { trail: unknown[] }).trail, []);
});

test('an item knows what names it in its text or fields, documents first, and only what the asker may see', async () => {
  const l = await fresh();
  const people = await make(l, [{ op: 'create', ref: 'bo', type: 'person', title: 'Bo' }]);
  const made = await make(l, [
    { op: 'create', ref: 'n', type: 'note', title: 'FedDev section', visibility: 'shared' },
    { op: 'create', ref: 't', type: 'task', title: 'Send the document', body: 'Details in {n}.', visibility: 'shared' },
    { op: 'create', ref: 'd', type: 'document', title: 'Funding document', body: 'Intro\n{n}', visibility: 'shared' },
  ]);
  Object.assign(made, await make(l, [{ op: 'create', ref: 'q', type: 'decision', title: 'Apply to RAII?', visibility: 'shared', props: { rationale: `See ${made.n}` } }]));
  const mentions = async (who: Archipelago) => ((await callTool(who, human, 'get', { id: made.n })) as { mentioned_in: { id: string }[] }).mentioned_in.map((m) => m.id);
  const all = await mentions(l);
  assert.equal(all[0], made.d, 'the document comes first');
  assert.deepEqual([...all].sort(), [made.t, made.d, made.q].sort());
  // Bo's own private note naming it is his alone to see.
  const bo = l.as(people.bo);
  await bo.change({ kind: 'human', name: 'bo', person: people.bo }, { ops: [{ op: 'create', type: 'note', title: 'Mine', body: `About ${made.n}`, visibility: 'private' }], reason: 'test' });
  assert.equal((await mentions(bo)).length, 4);
  assert.equal((await mentions(l.as('someone else'))).length, 3);
});

test('an item knows the pictures it is drawn in, and the documents that show them', async () => {
  const l = await fresh();
  const made = await make(l, [
    { op: 'create', ref: 'p', type: 'project', title: 'Research project' },
    { op: 'create', ref: 'in', type: 'program', title: 'Mitacs Accelerate', status: 'open', props: { kind: 'wage_subsidy', phase: 'research' } },
    { op: 'create', ref: 'out', type: 'task', title: 'Call IRAP' },
    { op: 'create', ref: 'map', type: 'lens', title: 'Funding map', props: { filter: { find: ['type program'] } } },
    { op: 'create', ref: 'd', type: 'document', title: 'Funding document', body: 'Intro\n{map}' },
    { op: 'link', type: 'part_of', from: 'in', to: 'p' },
    { op: 'link', type: 'part_of', from: 'out', to: 'p' },
    { op: 'link', type: 'about', from: 'map', to: 'p' },
  ]);
  const shown = async (id: string) => ((await callTool(l, human, 'get', { id })) as { shown_in: { title: string; of: { id: string }; documents: { id: string }[] }[] }).shown_in;
  assert.deepEqual(await shown(made.in), [{ id: made.map, title: 'Funding map', of: { id: made.p, title: 'Research project' }, documents: [{ id: made.d, type: 'document', title: 'Funding document' }] }]);
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

