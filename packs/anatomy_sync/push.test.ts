// The push handler's chain, with GitHub and the map faked: a push asks for the comparison, the comparison asks for the
// files (listing the manifests first when they are redone), and the files bring the island to the pushed commit.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extract } from './extract.ts';
import { changesOf, compared, fetched, listed, push, reposOf } from './push.ts';
import type { Source } from './model.ts';

const CORE = 'acme/core', HOSTED = 'acme/hosted';
const OLD = 'a'.repeat(40), NEW = 'b'.repeat(40), HOSTED_AT = 'c'.repeat(40);
const src = (path: string, text: unknown): Source => ({ path, text: typeof text === 'string' ? text : JSON.stringify(text), blob: `blob-${path}`, repo: 'open_core' });
const BEFORE = [
  src('packs/roots.json', { roots: [{ id: 'core' }], calls: {} }),
  src('packs/core/pack.json', { id: 'core', title: 'Core' }),
  src('packs/core/kernel/a.ts', '// A.\nimport { b } from \'./b.ts\';\n'),
  src('packs/core/kernel/b.ts', '// B.\n'),
];

/** A map holding the island as a full run at OLD left it, read the way the handler reads it. */
function mapAt(files: Source[]) {
  const { items, links } = extract(files);
  const rows = items.map((w, i) => ({ id: `e${i}`, type: w.type, title: w.title, body: w.body, props: { island: 'isl', ...w.props } }));
  rows.push({ id: 'esync', type: 'anatomy.sync', title: 'Where the island stands', body: '', props: { island: 'isl', commits: `${CORE}@${OLD}\n${HOSTED}@${HOSTED_AT}`, full: true } });
  const id = new Map(items.map((w, i) => [w.key, `e${i}`]));
  const flatLinks = links.map((l, i) => ({ id: `r${i}`, type: l.type, from_id: id.get(l.from), to_id: id.get(l.to) }));
  const read = async (q: any) => (q.items ? rows.filter((r) => r.type === q.items.type) : q.flat ? { items: rows, links: flatLinks } : undefined);
  return { read, rows };
}

const pushed = { payload: { ref: 'refs/heads/main', after: NEW, repository: { full_name: CORE } }, headers: { 'x-github-event': 'push' } };

test('a push to main asks GitHub for what changed since the island\'s commit, and nothing else does', async () => {
  const { read } = mapAt(BEFORE);
  const done: any = await push(pushed, { read });
  assert.deepEqual(done.requests, [{ host: 'github', path: `/repos/${CORE}/compare/${OLD}...${NEW}`, then: 'anatomy_sync.compared' }]);
  assert.equal(((await push({ ...pushed, payload: { ...pushed.payload, ref: 'refs/heads/x' } }, { read })) as any).answer.synced, false);
  assert.equal(((await push({ ...pushed, payload: { ...pushed.payload, repository: { full_name: 'acme/other' } } }, { read })) as any).answer.synced, false);
  assert.equal(((await push({ ...pushed, headers: { 'x-github-event': 'ping' } }, { read })) as any).answer.synced, false);
});

test('a module edited is fetched by its blob and brought onto the island, with the sync item moved on', async () => {
  const { read } = mapAt(BEFORE);
  const comparison = { status: 200, request: { path: `/repos/${CORE}/compare/${OLD}...${NEW}` }, body: { files: [{ filename: 'packs/core/kernel/a.ts', status: 'modified', sha: 'newblob' }] } };
  const asked: any = await compared(comparison, { read });
  const [req] = asked.requests;
  assert.equal(req.then, 'anatomy_sync.fetched', 'no manifest changed: no listing');
  assert.match(req.body.query, /f0: object\(oid: "newblob"\)/);
  assert.match(req.body.query, /f1: object\(expression: "b{40}:packs\/roots.json"\)/, 'roots.json at the pushed commit, which every module is read with');
  const answer = { status: 200, request: req, body: { data: { r0: { f0: { oid: 'newblob', text: '// A, alone now.\n' }, f1: { oid: 'blob-packs/roots.json', text: BEFORE[0].text } } } } };
  const done: any = await fetched(answer, { read });
  const change = done;
  assert.equal(change.ops.find((o: any) => o.props?.path === 'packs/core/kernel/a.ts').props.layer, 'root', 'still a root\'s module');
  assert.deepEqual(done.answer.counts, { make: 0, rename: 0, change: 2, archive: 0, tie: 0, untie: 1 }, 'the module and the sync item changed; its import of b taken back');
  assert.ok(change.ops.some((o: any) => o.op === 'update' && o.props?.commits === `${CORE}@${NEW}\n${HOSTED}@${HOSTED_AT}`));
});

test('a manifest changed lists the pack folders, then fetches every manifest, of both repositories', async () => {
  const { read } = mapAt(BEFORE);
  const comparison = { status: 200, request: { path: `/repos/${CORE}/compare/${OLD}...${NEW}` }, body: { files: [{ filename: 'packs/core/pack.json', status: 'modified', sha: 'p2' }] } };
  const asked: any = await compared(comparison, { read });
  assert.equal(asked.requests[0].then, 'anatomy_sync.listed');
  assert.match(asked.requests[0].body.query, /r1: repository\(owner: "acme", name: "hosted"\)/);
  const listing = { status: 200, request: asked.requests[0], body: { data: { r0: { packs: { entries: [{ name: 'core', object: { entries: [{ name: 'pack.json', oid: 'p2' }, { name: 'handler.js', oid: 'h' }] } }] }, workspace_packs: null }, r1: { packs: null, workspace_packs: { entries: [{ name: 'time', object: { entries: [{ name: 'pack.json', oid: 't1' }] } }] } } } } };
  const fetch: any = await listed(listing);
  const query = fetch.requests[0].body.query;
  assert.match(query, /object\(oid: "p2"\)/);
  assert.match(query, /object\(oid: "t1"\)/);
  assert.match(query, /expression: "a{40}:packs\/roots.json"|expression: "b{40}:packs\/roots.json"/, 'roots.json by path, for the root order');
  assert.doesNotMatch(query, /oid: "h"/, 'only manifests');
});

test('a push that changes what every module is read with is left to the full check', async () => {
  const { read } = mapAt(BEFORE);
  const done: any = await compared({ status: 200, request: { path: `/repos/${CORE}/compare/${OLD}...${NEW}` }, body: { files: [{ filename: 'packs/roots.json', status: 'modified', sha: 'x' }] } }, { read });
  assert.equal(done.answer.synced, false);
  assert.match(done.answer.reason, /--full/);
});

test('the sync item and GitHub\'s statuses are read as the plan reads them', () => {
  assert.deepEqual(reposOf(`${CORE}@${OLD}\n${HOSTED}@${HOSTED_AT}`).map((r) => r.repo), ['open_core', 'hosted']);
  assert.deepEqual(changesOf([{ filename: 'b', status: 'renamed', previous_filename: 'a' }, { filename: 'c', status: 'removed' }, { filename: 'd', status: 'added' }]), [{ status: 'R', path: 'b', from: 'a' }, { status: 'D', path: 'c' }, { status: 'A', path: 'd' }]);
});
