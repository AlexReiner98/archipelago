// The catch-up, with GitHub and the map faked: it asks where main stands in each repository, and only a head the island
// stands behind starts the push's chain, from the island's commit.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { catchUp, head } from './catch-up.ts';

const CORE = 'acme/core', HOSTED = 'acme/hosted';
const AT = 'a'.repeat(40), NEW = 'b'.repeat(40), HOSTED_AT = 'c'.repeat(40);
const sync = { id: 's', type: 'anatomy.sync', title: '', body: '', props: { commits: `${CORE}@${AT}\n${HOSTED}@${HOSTED_AT}` } };
const read = async (q: any) => (q.items?.type === 'anatomy.sync' ? [sync] : []);
const answer = (name: string, sha: string, status = 200) => ({ status, request: { host: 'github', path: `/repos/${name}/commits/main` }, body: { sha } });

test('the catch-up asks GitHub for main\'s head in every repository the island stands on', async () => {
  const done: any = await catchUp({}, { read });
  assert.deepEqual(done.requests, [
    { host: 'github', path: `/repos/${CORE}/commits/main`, then: 'anatomy_sync.head' },
    { host: 'github', path: `/repos/${HOSTED}/commits/main`, then: 'anatomy_sync.head' },
  ]);
  assert.equal(((await catchUp({}, { read: async () => [] })) as any).answer.synced, false, 'no sync item, nothing asked');
});

test('a head the island stands behind starts the push\'s chain from the island\'s commit', async () => {
  const done: any = await head(answer(CORE, NEW), { read });
  assert.deepEqual(done.requests, [{ host: 'github', path: `/repos/${CORE}/compare/${AT}...${NEW}`, then: 'anatomy_sync.compared' }]);
});

test('a head the island stands at, a repository it does not stand on, or an error asks nothing more', async () => {
  for (const a of [answer(HOSTED, HOSTED_AT), answer('acme/other', NEW), answer(CORE, NEW, 404), { status: 200, request: { path: `/repos/${CORE}/commits/main` }, body: {} }]) {
    const done: any = await head(a, { read });
    assert.equal(done.requests, undefined, JSON.stringify(a.request));
  }
});
