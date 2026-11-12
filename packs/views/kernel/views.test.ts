// The views pack run without a database: a context whose reads answer from a few items in memory, the graph and the
// tree's ladder out, and the plan note's count. Against a real map: test/standing-views.test.ts, test/roadmap.test.ts,
// test/island-findings.test.ts and test/plan-note.test.ts, through the shims in src/.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { KernelContext } from '#pelago/kernel';
import { graph } from './answers.ts';
import { holders } from './inside.ts';
import { sections, structureAsText } from './plan-note.ts';
import { forReader, readDocument, sectionIds } from './documents.ts';

const at = new Date('2026-11-01T00:00:00Z');
const item = (id: string, props: Record<string, unknown> = {}) => ({ id, type: 'task', title: id.toUpperCase(), status: 'open', owner: null, is_open: true, created_at: at, updated_at: at, archived_at: null, props });
const items = new Map([item('a', { tokens_estimated: 10 }), item('b', { tokens_estimated: 5 })].map((e) => [e.id, e]));
const links = [{ id: 'r1', type: 'part_of', from_id: 'b', to_id: 'a', props: {}, valid_from: at }];

function context(): KernelContext {
  const types = new Map([['task', { id: 'task', fields: { tokens_estimated: {} }, capabilities: { plannable: {} } }]]);
  const registry = {
    types, relations: new Map([['part_of', { id: 'part_of' }]]), packs: [], rules: [], trees: new Map(),
    type: (id: string) => types.get(id), isA: (t: string, k: string) => t === k, family: (t: string) => [t], relationFamily: (...r: string[]) => r,
    having: () => [], ancestry: (t: string) => ({ root: t, starter: t }), capacity: () => undefined,
  };
  const reads = async (q: Record<string, unknown>) => {
    if (q.ids) return (q.ids as string[]).flatMap((id) => (items.has(id) ? [items.get(id)] : []));
    if (q.blocks) return [];
    if (q.links) {
      const { from, to, among, types } = q.links as { from?: string[]; to?: string[]; among?: string[]; types?: string[] };
      return links.filter((r) => (!types || types.includes(r.type)) && (!from || from.includes(r.from_id)) && (!to || to.includes(r.to_id)) && (!among || (among.includes(r.from_id) && among.includes(r.to_id))));
    }
    throw new Error(`not read here: ${Object.keys(q)[0]}`);
  };
  return { pack: { id: 'views', version: '0', hash: '' }, workspace: 'w', reads, registry } as unknown as KernelContext;
}

test('the graph around a focus: what it is tied to, the links among them, tokens rolled up over the parts', async () => {
  const answer = await graph(context(), { focus: 'a', choices: { relations: { all: { over: 'all' } } } });
  assert.deepEqual(answer.nodes.map((n) => n.id), ['a', 'b']);
  assert.deepEqual(answer.edges, [{ id: 'r1', type: 'part_of', from: 'b', to: 'a' }]);
  assert.deepEqual(answer.nodes[0].tokens, { estimated: 5, used: 0 }, "a thing with parts takes what they take, its own estimate set aside");
});

test('a thing is inside the nearest kept thing that holds it', () => {
  const links = [{ type: 'part_of', from_id: 't', to_id: 'f' }, { type: 'part_of', from_id: 't', to_id: 'p' }, { type: 'part_of', from_id: 'f', to_id: 'p' }];
  const kept = new Map([['t', 1], ['f', 1], ['p', 1]]);
  const { parent, depths } = holders(links, 'part_of', new Set(['t', 'f', 'p']), kept);
  assert.equal(parent.get('t'), 'f', 'the feature, not the project it is also tied to');
  assert.equal(depths.get('t'), 2);
});

test('a note of several sections with fewer items tied is said back', () => {
  const body = '## One\n## Two\n## Three\n## Four\n';
  assert.equal(sections(body), 4);
  assert.match(structureAsText([{ at: 1, op: 'create', body, ties: 1 }])!, /4 sections, 1 items tied/);
  assert.equal(structureAsText([{ at: 1, op: 'create', body, ties: 4 }]), undefined);
});

test('a document is read whole: its text, each item it brings in where its line names it, and what is kept elsewhere', async () => {
  const doc = { id: 'e_doc00000', type: 'task', title: 'Doc', status: 'open', body: 'Intro\ne_aaaaaaaa\nMiddle\n  e_bbbbbbbb \ne_gone0000', props: { for: 'e_me', tokens_estimated: 3 }, updated_at: at, archived_at: null };
  const kept = new Map([[doc.id, doc], ['e_aaaaaaaa', { ...item('e_aaaaaaaa'), body: 'A' }], ['e_bbbbbbbb', { ...item('e_bbbbbbbb'), body: 'B' }]]);
  const asked: unknown[] = [];
  const ctx = { ...context(), reads: async (q: Record<string, unknown>) => {
    asked.push(Object.keys(q)[0]);
    if (q.ids) return (q.ids as string[]).flatMap((id) => (kept.has(id) ? [kept.get(id)] : []));
    if (q.pictures) return ['e_bbbbbbbb'];
    if (q.links) return [{ from_id: 'e_aaaaaaaa', to_id: doc.id }];
    throw new Error('not read here');
  } } as unknown as KernelContext;
  assert.deepEqual(sectionIds(doc.body), ['e_aaaaaaaa', 'e_bbbbbbbb', 'e_gone0000']);
  const read = await readDocument(ctx, doc.id);
  assert.deepEqual(read.parts.map((p) => ('text' in p ? p.text : 'section' in p ? [p.section.id, p.section.picture] : p.missing)), ['Intro', ['e_aaaaaaaa', false], 'Middle', ['e_bbbbbbbb', true], 'e_gone0000']);
  assert.equal(read.for, 'e_me');
  assert.deepEqual(read.not_inside, ['e_bbbbbbbb']);
  await assert.rejects(readDocument(ctx, 'e_nothere0'), /not on this map/);
});

test('a reader from outside is told of no item a document does not bring in', () => {
  const given = { id: 'e_doc00000', type: 'task', title: 'Doc', status: 'open', body: 'See e_aaaaaaaa and (e_secret00).\ne_aaaaaaaa', props: {}, updated_at: '2026-11-01', items: [{ id: 'e_aaaaaaaa', type: 'task', title: 'A', status: 'open', body: 'Not e_secret00', updated_at: '2026-11-01' }] };
  const out = forReader(context(), given, 'e_share000');
  assert.deepEqual(out.parts, [{ text: 'See e_aaaaaaaa and.' }, { section: { ...given.items[0], body: 'Not', via: 'e_share000' } }]);
});
