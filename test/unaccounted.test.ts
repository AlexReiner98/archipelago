// The commits in a checkout that no one has accounted for are put to the session that starts there, a handful named
// and the rest counted, worded by the instruction preset core.unaccounted.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { hookSessionStart } from '../src/sessions.ts';
import { commitLine, sentCommits, unaccounted } from '../src/unaccounted.ts';
import { fresh, laneSetup, make } from './map.ts';

const sha = (n: number) => n.toString(16).padStart(40, 'a');
const commit = (n: number, message = `Change ${n}`) => ({ id: sha(n), message });

test('a commit is read as its short id, its subject and the run its trailer names', () => {
  assert.equal(commitLine(commit(1, 'Do a thing\n\nbody\n\nArchipelago-Run: e_abc12345')), '- aaaaaaa Do a thing (run e_abc12345)');
  assert.equal(commitLine(commit(2, 'Plain')), '- aaaaaaa Plain');
  assert.deepEqual(sentCommits([commit(1), { id: 'short', message: 'x' }, null, { id: sha(2) }]).map((c) => c.id), [sha(1)]);
  assert.deepEqual(sentCommits('nope'), []);
});

test('a session starting in a repository is asked to account for the commits the map holds no item for', async () => {
  const l = await fresh();
  await laneSetup(l);
  const start = (commits: unknown, id: string) => hookSessionStart(l, { session_id: id, cwd: 'C:\\code\\Apex', commits });
  const quiet = await start([commit(1)], 's0');
  assert.match(quiet, /1 commits here are not accounted for/, 'a commit nothing holds is named');
  assert.match(quiet, /- aaaaaaa Change 1/);
  // Accounted for once a commit item holds its sha.
  await make(l, [{ op: 'create', type: 'software.commit', title: 'Change 1', props: { sha: sha(1) } }]);
  assert.deepEqual(await unaccounted(l, [commit(1), commit(2)]), [commit(2)]);
  assert.doesNotMatch(await start([commit(1)], 's1'), /not accounted for/, 'all accounted for: nothing said');
  assert.doesNotMatch(await start(undefined, 's2'), /not accounted for/, 'no commits sent: nothing said');
  // A handful is named, the rest counted.
  const many = await start(Array.from({ length: 12 }, (_, i) => commit(i + 1, `Change ${i + 1}\n\nArchipelago-Run: e_run${i}`)), 's3');
  assert.match(many, /11 commits here are not accounted for/);
  assert.equal((many.match(/^- [0-9a-f]{7} /gm) ?? []).length, 5);
  assert.match(many, /- and 6 more/);
  assert.match(many, /\(run e_run1\)/);
  // Not in a repository the map knows: nothing to ask.
  assert.doesNotMatch(await hookSessionStart(l, { session_id: 's4', cwd: 'C:\\elsewhere', commits: [commit(1)] }), /not accounted for/);
});
