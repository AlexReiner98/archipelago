// A map pack's writes land on an island (src/island-items.ts, task e_b8k453zf): what its action makes of an island
// pack's types goes on the island of what it is tied to in the same change, else on the island the action is given,
// else on the lone island it fits; with none of these, it is refused, naming the islands it could go on.
import assert from 'node:assert/strict';
import { cpSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, test } from 'node:test';
import { PackHost } from '../src/packhost.ts';
import { Registry } from '../src/packs.ts';
import { setIslands } from '../src/packstate.ts';
import { freshWith, human, make } from './map.ts';

/** An island pack: a run and its results. */
const proof = {
  id: 'proof', version: '1', title: 'Proof', requires: ['core'],
  types: [{ id: 'proof_run', title: 'Run', extends: 'work' }, { id: 'proof_result', title: 'Result', extends: 'record' }],
  links: [{ id: 'proof_reads', extends: 'uses', crosses: true, title: 'reads', inverse: 'is read by', from: ['*'], to: ['*'], description: 'Relies on it, from any island.' }],
};

/** A map pack: an action that records a result, part of the run it is given or of a new one. */
const runner = {
  id: 'runner', version: '1', title: 'Runner', requires: ['core', 'proof'],
  actions: [{
    id: 'runner.record', title: 'Record a result', description: 'A result, part of a run.', verb: 'report', on: ['work'],
    input: { type: 'object', properties: { title: { type: 'string' }, run: { type: 'string' }, reads: { type: 'string' }, island: { type: 'string' } }, required: ['title'], additionalProperties: false },
  }],
};
const HANDLER = `export default {
  async 'runner.record'(input) {
    const ops = [{ op: 'create', ref: 'r', type: 'proof_result', title: input.title }];
    if (input.reads) ops.push({ op: 'link', type: 'proof_reads', from: 'r', to: input.reads });
    if (input.run) ops.push({ op: 'link', type: 'part_of', from: 'r', to: input.run });
    else ops.push({ op: 'create', ref: 'n', type: 'proof_run', title: 'Run of ' + input.title }, { op: 'link', type: 'part_of', from: 'r', to: 'n' });
    return { ops, answer: { result: '{r}' } };
  },
};
`;

const dir = mkdtempSync(join(tmpdir(), 'pelago-island-placing-'));
cpSync(join(import.meta.dirname, '..', 'packs'), dir, { recursive: true });
for (const m of [proof, runner]) (mkdirSync(join(dir, m.id)), writeFileSync(join(dir, m.id, 'pack.json'), JSON.stringify(m)));
writeFileSync(join(dir, 'runner', 'handler.js'), HANDLER);
const host = new PackHost((pack) => join(dir, pack));
after(() => host.stop());

test('a map pack’s action puts what it makes on the island of what it is tied to, or the one it is given', async () => {
  const l = await freshWith(new Registry(dir));
  await setIslands(l, human, true);
  assert.equal(l.registry.states.get('runner')?.state, 'active', 'a map pack is taken on an island map');
  const { a, b } = await make(l, [
    { op: 'create', ref: 'a', type: 'island', title: 'Server', props: { pack: 'proof' } },
    { op: 'create', ref: 'b', type: 'island', title: 'Client', props: { pack: 'proof' } },
  ]);
  const { ra, rb } = await make(l, [
    { op: 'create', ref: 'ra', type: 'proof_run', title: 'Server run', props: { island: a } },
    { op: 'create', ref: 'rb', type: 'proof_run', title: 'Client run', props: { island: b } },
  ]);
  const record = async (input: Record<string, string>) => {
    const done = (await host.act(l, human, 'runner', 'runner.record', input)) as { answer: { result: string }; created: Record<string, string> };
    return { result: (await l.entity(done.answer.result))!, run: done.created.n ? (await l.entity(done.created.n))! : undefined };
  };

  assert.equal((await record({ title: 'Passes', run: ra })).result.props.island, a, 'on the island of the run it is part of');
  assert.equal((await record({ title: 'Fails', run: rb })).result.props.island, b);

  // No tie: refused, with the islands it could go on named.
  await assert.rejects(record({ title: 'Nowhere' }), (err: Error) => err.message.includes(`such as ${a} (Server, proof), ${b} (Client, proof)`) && /make it part of an item on one/.test(err.message));
  // A link that crosses (reading another island's finding) does not place it.
  await assert.rejects(record({ title: 'Reads only', reads: ra }), /lives on an island here/);

  // Given an island, the new run goes there, and the result made part of it with it.
  const given = await record({ title: 'Given', island: b });
  assert.equal(given.run?.props.island, b);
  assert.equal(given.result.props.island, b);
  // A tie wins over the island given; a given island that is not one is refused as such.
  assert.equal((await record({ title: 'Tied', run: ra, island: b })).result.props.island, a);
  await assert.rejects(record({ title: 'Lost', island: 'e_nothere' }), /"e_nothere" is no island/);
});

test('with one island of its pack, what an action makes goes there untied', async () => {
  const l = await freshWith(new Registry(dir));
  await setIslands(l, human, true);
  const { a } = await make(l, [{ op: 'create', ref: 'a', type: 'island', title: 'Only', props: { pack: 'proof' } }]);
  const done = await host.act(l, human, 'runner', 'runner.record', { title: 'Alone' }) as { answer: { result: string } };
  assert.equal((await l.entity(done.answer.result))!.props.island, a);
});
