// The check on the main branch, tested without a database: fixtures stand where the kernel answers the GitHub pack's
// reads, the commit items on the map and what GitHub gives through the app.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import handler from './handler.js';
import { kept, runOf } from './account.js';

const sha = (c: string) => c.repeat(40);
const repo = { id: 'e_repo0001', type: 'repo', title: 'Shop', props: { remote: 'https://github.com/Acme/Shop' } };

/** The map holds these commit items (by sha); GitHub answers `github` by path through the app, or the app is not connected. */
function ctxOver(accounted: string[], github?: Record<string, unknown>, heard: string[] = []) {
  const reads: Record<string, any>[] = [];
  return {
    reads,
    read: async (q: Record<string, any>) => {
      reads.push(q);
      if (q.items?.type === 'repo') return [repo];
      if (q.items?.type === 'commit') {
        const s = q.items.where.sha;
        return [...(accounted.includes(s) ? [{ id: `e_c${s.slice(0, 7)}`, type: 'commit', props: { sha: s } }] : []), ...(heard.includes(s) ? [{ id: `e_h${s.slice(0, 7)}`, type: 'commit', props: { sha: s, accounted: false } }] : [])];
      }
      if (q.events) return [];
      if (q.request) {
        if (!github) throw new Error('This workspace has not connected GitHub App.');
        const body = github[q.request.path];
        return body === undefined ? { status: 404, body: { message: 'Not Found' } } : { status: 200, body };
      }
      throw new Error(`unexpected read ${JSON.stringify(q)}`);
    },
  };
}

const commit = (c: string, message = `Change ${c}`) => ({ id: sha(c), message, author: { name: 'Ann' } });
const push = (commits: unknown[], over: Record<string, unknown> = {}) => ({
  payload: { ref: 'refs/heads/main', before: sha('0').replace(/^0/, 'a'), after: sha('f'), repository: { full_name: 'Acme/Shop', default_branch: 'main' }, pusher: { name: 'ann' }, commits, ...over },
  headers: { 'x-github-event': 'push' },
});

test('a push to main is checked: red while a commit has no commit item on the map, and says which, with its run', async () => {
  const done = await handler['github.push'](push([commit('1'), commit('2', 'Tidy the cart\n\nArchipelago-Run: e_run00001')]), ctxOver([sha('1')]));
  const check = done.answer.check;
  assert.equal(check.name, 'Every commit accounted for');
  assert.equal(check.head_sha, sha('f'));
  assert.equal(check.conclusion, 'failure');
  assert.equal(check.title, '1 of 2 commits not accounted for');
  assert.deepEqual(check.open, [{ sha: sha('2'), subject: 'Tidy the cart', run: 'e_run00001' }]);
  assert.match(check.summary, /`2222222` Tidy the cart \(run e_run00001\)/);
  assert.match(check.summary, /`commit`/);
  assert.deepEqual(check.commits, [{ id: sha('1'), message: 'Change 1' }, { id: sha('2'), message: 'Tidy the cart\n\nArchipelago-Run: e_run00001' }], 'kept short, to be asked again');

  const green = await handler['github.push'](push([commit('1'), commit('2')]), ctxOver([sha('1'), sha('2')]));
  assert.deepEqual([green.answer.check.conclusion, green.answer.check.title], ['success', 'All 2 commits accounted for']);

  // An item made only because the commit was pushed and nobody accounted for it (accounted false) accounts for nothing.
  const heard = await handler['github.push'](push([commit('1'), commit('2')]), ctxOver([sha('1')], undefined, [sha('2')]));
  assert.equal(heard.answer.check.title, '1 of 2 commits not accounted for');
  assert.match(heard.answer.check.summary, /accounted` true/);
});

test('only the main branch is checked; a longer push than GitHub lists is read whole through the app', async () => {
  const other = await handler['github.push'](push([commit('1')], { ref: 'refs/heads/wip' }), ctxOver([]));
  assert.equal(other.answer.check, undefined);

  const twenty = Array.from({ length: 20 }, (_, i) => commit((i % 9 + 1).toString()));
  const all = [...twenty, commit('a')].map((c) => ({ sha: c.id, commit: { message: c.message } }));
  const path = `/repos/Acme/Shop/compare/${push([]).payload.before}...${sha('f')}`;
  const long = await handler['github.push'](push(twenty), ctxOver([], { [path]: { total_commits: 21, commits: all } }));
  assert.equal(long.answer.check.title, '21 of 21 commits not accounted for');
  // Not connected through the app: what GitHub listed is read, and the check says it is not all.
  const cut = await handler['github.push'](push(twenty), ctxOver([]));
  assert.match(cut.answer.check.summary, /GitHub gave only 20 of the commits/);
});

test('a pull request into main is checked by its commits; one elsewhere, or closed, is not', async () => {
  const pr = (over: Record<string, unknown> = {}) => ({
    payload: { action: 'synchronize', repository: { full_name: 'Acme/Shop', default_branch: 'main' }, pull_request: { number: 7, base: { ref: 'main' }, head: { sha: sha('e') } }, ...over },
    headers: { 'x-github-event': 'pull_request' },
  });
  const github = { '/repos/Acme/Shop/pulls/7/commits?per_page=100&page=1': [{ sha: sha('3'), commit: { message: 'One' } }, { sha: sha('4'), commit: { message: 'Two' } }] };
  const ctx = ctxOver([sha('3')], github);
  const done = await handler['github.push'](pr(), ctx);
  assert.deepEqual([done.answer.recorded, done.answer.check.head_sha, done.answer.check.title], [false, sha('e'), '1 of 2 commits not accounted for']);
  assert.equal(done.log, undefined, 'a pull request is not a push: nothing is recorded');
  assert.match((await handler['github.push'](pr({ action: 'closed' }), ctx)).answer.reason, /opened or moved/);
  assert.match((await handler['github.push'](pr({ pull_request: { number: 7, base: { ref: 'wip' }, head: { sha: sha('e') } } }), ctx)).answer.reason, /into main/);
  assert.match((await handler['github.push'](pr(), ctxOver([]))).answer.reason, /not connected/);
});

test('asked again by the app, the same commits are read against the map as it is now', async () => {
  const ask = { payload: { repository: { full_name: 'Acme/Shop' }, head_sha: sha('f'), commits: [kept(commit('5'))] }, headers: { 'x-github-event': 'accounting' } };
  assert.equal((await handler['github.push'](ask, ctxOver([]))).answer.check.conclusion, 'failure');
  const now = await handler['github.push'](ask, ctxOver([sha('5')]));
  assert.deepEqual([now.answer.check.conclusion, now.answer.check.title, now.log, now.changes], ['success', 'All one commit accounted for', undefined, undefined]);
});

test('the run a commit names is read from its trailer only', () => {
  assert.equal(runOf('Fix it\n\nArchipelago-Run: e_abc12345\nCo-Authored-By: X'), 'e_abc12345');
  assert.equal(runOf('Fix it, see Archipelago-Run: e_abc12345 above'), undefined);
});
