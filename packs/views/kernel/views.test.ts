// The views pack run without a database: a context whose reads answer from a few items in memory, the graph and the
// tree's ladder out, and the plan note's count. Against a real map: test/standing-views.test.ts, test/roadmap.test.ts,
// test/island-findings.test.ts and test/plan-note.test.ts, through the shims in src/.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { KernelContext } from '#pelago/kernel';
import { graph } from './answers.ts';
import { holders } from './inside.ts';
import { sections, structureAsText } from './plan-note.ts';

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
