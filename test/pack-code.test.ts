// A pack's code on the log (src/pack-code.ts, task e_7vezatrt): a pack fact names its code by the hashes of its files,
// the log keeps each file's text once, a read as of before a handler changed runs the old handler, and a version of a
// map pack with code of its own runs it on the islands that run the version alone, after the owner allowed it.

import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { codeOf, codePath, layOut, versionCodeProblems } from '../src/pack-code.ts';
import { headOf } from '../src/log.ts';
import { Registry } from '../src/packs.ts';
import { setIslands, setPack, syncPacks } from '../src/packstate.ts';
import { hostFor, packTool } from '../src/packtools.ts';
import type { Archipelago } from '../src/pelago.ts';
import { registryAt } from '../src/registry-at.ts';
import { callTool } from '../src/tools.ts';
import { agent, freshWith, human, make, packsWith } from './map.ts';

/** A map pack with one view its handler answers. */
const echo = {
  id: 'echo', version: '1.0.0', title: 'Echo', description: 'A map pack whose one view says which code ran.', requires: ['core'],
  views: [{ id: 'echo.say', description: 'Which code answered.', shape: 'data', input: { type: 'object', properties: { island: { type: 'string' } }, additionalProperties: false } }],
};
const handler = (said: string) => `export default { async 'echo.say'() { return { answer: ${JSON.stringify(said)} }; } };\n`;

async function map(): Promise<{ l: Archipelago; dir: string }> {
  const dir = packsWith(echo as never);
  writeFileSync(join(dir, 'echo', 'handler.js'), handler('one'));
  writeFileSync(join(dir, 'echo', 'words.js'), 'export const words = 1;\n');
  const l = await freshWith(new Registry(dir));
  await setIslands(l, human, true);
  await setPack(l, human, { pack: 'echo', on: true });
  return { l, dir };
}

/** What the echo view answers under a registry. */
const say = async (l: Archipelago, reg: Registry) => (await hostFor(reg).call(l, human, 'echo', 'view', 'echo.say', {})).answer;
const sayTool = (l: Archipelago, input: Record<string, unknown> = {}) => packTool(l.registry, [...l.registry.tools.keys()].find((k) => k.includes('say'))!)!.run(l, human, input);

test('a path is plain and relative, and code laid out reads back as its hash', () => {
  assert.ok(codePath('handler.js') && codePath('layouts/map/index.js'));
  for (const bad of ['../x.js', '/abs.js', 'a/../b.js', 'pack.json', 'x.test.js', 'C:/x.js', 'a\\b.js', 'notes.md']) assert.ok(!codePath(bad), bad);
  const texts = { 'handler.js': 'export default {};\n', 'layouts/a.js': 'export const a = 1;\n' };
  const where = layOut('p', texts);
  assert.equal(readFileSync(join(where, 'p', 'layouts', 'a.js'), 'utf8'), texts['layouts/a.js']);
  assert.equal(layOut('p', texts), where, 'the same code is laid out once, by its hash');
  assert.throws(() => layOut('p', { '../out.js': 'x' }), /plain relative paths/);
  assert.notEqual(codeOf(texts)!.code, codeOf({ ...texts, 'handler.js': 'export default { a: 1 };\n' })!.code);
  assert.deepEqual(versionCodeProblems({ 'handler.js': 'x' }, 'made', false).length, 1, 'a pack kept as an item has no code to stand over');
  assert.match(versionCodeProblems({ '../h.js': 'x' }, 'echo', true)[0], /plain relative paths/);
});

test('a read as of before a handler changed runs the old handler', async () => {
  const { l, dir } = await map();
  const before = (await headOf(l.db, 'facts')).pos;
  writeFileSync(join(dir, 'echo', 'handler.js'), handler('two'));
  const said = await syncPacks(l);
  const fact = said.find((f) => f[1] === 'pack:echo')?.[3] as { code?: string; files?: Record<string, string>; texts?: Record<string, string> } | undefined;
  assert.ok(fact?.code, 'the changed code is said again');
  assert.deepEqual(Object.keys(fact.texts ?? {}), [fact.files!['handler.js']], 'only the file the log had not met is kept anew');
  assert.deepEqual(await syncPacks(l), [], 'the same code is not said twice');
  const after = (await headOf(l.db, 'facts')).pos;

  const then = (await registryAt(l.db, l.registry, before))!;
  const now = (await registryAt(l.db, l.registry, after))!;
  try {
    assert.equal(then.packs.find((p) => p.id === 'echo')?.code, 'log');
    assert.equal(now.packs.find((p) => p.id === 'echo')?.code, 'today');
    assert.equal(await say(l, then.registry), 'one', 'before: the old handler, read back from the log');
    assert.equal(await say(l, now.registry), 'two');
    assert.equal(await say(l, l.registry), 'two', 'today: the handler as it is');
  } finally {
    for (const r of [then.registry, now.registry, l.registry]) hostFor(r).stop();
  }
});

test('a version with its own code runs it on its island alone, once the owner allowed it', async () => {
  const { l } = await map();
  const { trial, rest } = await make(l, [
    { op: 'create', ref: 'trial', type: 'island', title: 'Trial', props: { pack: 'core' } },
    { op: 'create', ref: 'rest', type: 'island', title: 'Rest', props: { pack: 'core' } },
  ]);
  const version = { op: 'create' as const, ref: 'v', type: 'pack', title: 'Echo, from the island', props: { version_of: 'echo', manifest: {}, code: { 'handler.js': handler('island') } } };

  // An agent's word for code is held, even where agents' changes and their layouts' code apply as made.
  await callTool(l, { ...human, admin: true }, 'workspace_set', { agent_changes: 'apply', agent_code: true });
  const held = (await l.change(agent, { reason: 'test', ops: [version] })) as { status: string; held_by?: string[] };
  assert.equal(held.status, 'proposed');
  assert.ok(JSON.stringify(held).includes('pack_code'), JSON.stringify(held));
  await assert.rejects(l.change(human, { reason: 'test', ops: [{ ...version, props: { ...version.props, version_of: undefined, name: 'loose' } }] }), /runs no code/);

  // The owner's applies; the island that names it runs its code, every other place the map's.
  const { v } = await make(l, [version]);
  await make(l, [{ op: 'update', id: trial, props: { pack_version: v } }]);
  try {
    assert.equal(await sayTool(l, { island: trial }), 'island');
    assert.equal(await sayTool(l, { island: rest }), 'one');
    assert.equal(await sayTool(l), 'one');
    const viewed = await callTool(l, human, 'query', { name: 'say', params: { island: trial } });
    assert.equal(viewed, 'island', 'a read that names the island runs it too');
    await make(l, [{ op: 'update', id: trial, props: { pack_version: null } }]);
    assert.equal(await sayTool(l, { island: trial }), 'one', 'unset, the island runs the map’s code again');
  } finally {
    hostFor(l.registry).stop();
  }
});
