// The anatomy sync's push handler run by the real pack host, on a map in memory: the anatomy pack kept as an item and
// turned on, its island filled as a full run leaves it, and the last step of a push (the files in hand) run in the
// handler's sandboxed process. Its read of the island and the change it answers with go through the kernel as on a server.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import '../packs/identity/kernel/workspaces.ts';
import { extract } from '../packs/anatomy_sync/extract.ts';
import type { Source } from '../packs/anatomy_sync/model.ts';
import { plan } from '../packs/anatomy_sync/plan.ts';
import { setIslands, setPack } from '../packs/loader/kernel/packstate.ts';
import { hostFor } from '../packs/loader/kernel/packtools.ts';
import { fresh, human, make } from './map.ts';

const MANIFEST = JSON.parse(readFileSync(new URL('../packs/anatomy_sync/anatomy.manifest.json', import.meta.url), 'utf8'));
const CORE = 'acme/core', HOSTED = 'acme/hosted';
const OLD = 'a'.repeat(40), NEW = 'b'.repeat(40), HOSTED_AT = 'c'.repeat(40);
const src = (path: string, text: unknown): Source => ({ path, text: typeof text === 'string' ? text : JSON.stringify(text), blob: `blob-${path}`, repo: 'open_core' });
const FILES = [
  src('packs/roots.json', { roots: [{ id: 'core' }], calls: {} }),
  src('packs/core/pack.json', { id: 'core', title: 'Core' }),
  src('packs/core/kernel/a.ts', '// A.\nimport { b } from \'./b.ts\';\n'),
  src('packs/core/kernel/b.ts', '// B.\n'),
];

test('a push brings the island to the pushed commit, run by the pack host as on a server', async () => {
  const l = await fresh();
  await setIslands(l, human, true);
  await make(l, [{ op: 'create', type: 'pack', title: 'Pack anatomy', body: 'The pack architecture.', props: { name: 'anatomy', version: '0.3.1', manifest: MANIFEST } }]);
  await setPack(l, human, { pack: 'anatomy', on: true });
  await setPack(l, human, { pack: 'anatomy_sync', on: true });
  assert.equal(l.registry.states.get('anatomy_sync')?.state, 'active', 'the sync is on once the words it requires are');
  const { isl } = await make(l, [{ op: 'create', ref: 'isl', type: 'island', title: 'Pack anatomy', props: { pack: 'anatomy' } }]);
  // The island as a full run at OLD leaves it.
  const filled = plan(extract(FILES), { island: isl, byKey: new Map(), keyById: new Map(), links: [] }, { mayArchive: () => false });
  await make(l, [...filled.ops, { op: 'create', type: 'anatomy.sync', title: 'Where the island stands', props: { island: isl, commits: `${CORE}@${OLD}\n${HOSTED}@${HOSTED_AT}`, full: true } }] as never);

  // The last step of a push: a.ts no longer imports b.ts.
  // The files a push of a.ts asks for: a.ts by its blob, and roots.json by path, which every module is read with.
  const state = { repos: [{ name: CORE, sha: OLD, repo: 'open_core' }, { name: HOSTED, sha: HOSTED_AT, repo: 'hosted' }], pushed: CORE, head: NEW, changes: [{ status: 'M', path: 'packs/core/kernel/a.ts' }], files: [{ alias: 'f0', repo: 0, path: 'packs/core/kernel/a.ts', oid: 'newblob' }, { alias: 'f1', repo: 0, path: 'packs/roots.json', oid: '' }] };
  const input = { status: 200, request: { host: 'github', method: 'POST', path: '/graphql', body: { query: `# anatomy ${JSON.stringify(state)}\nquery {}` } }, body: { data: { r0: { f0: { oid: 'newblob', text: '// A, alone now.\n' }, f1: { oid: 'blob-packs/roots.json', text: FILES[0].text } } } } };
  const actor = { kind: 'agent' as const, name: 'pack:anatomy_sync' };
  const started = Date.now();
  const done = await hostFor(l.registry).call(l, actor, 'anatomy_sync', 'answer', 'anatomy_sync.fetched', input);
  const took = Date.now() - started;
  assert.deepEqual((done.answer as { counts: unknown }).counts, { make: 0, rename: 0, change: 2, archive: 0, tie: 0, untie: 1 });
  assert.ok(took < 2000, `within a chained answer's two seconds (took ${took} ms)`);
  const updated = done.ops!.find((o) => o.op === 'update' && (o as { props?: Record<string, unknown> }).props?.path === 'packs/core/kernel/a.ts') as unknown as { props: { layer: string } };
  assert.equal(updated.props.layer, 'root', 'still a root\'s module');
  // On the islands map agents' changes apply as made; on a fresh map they wait, so the owner's word applies it here.
  await l.change(human, { ops: done.ops!, reason: done.reason!, action: 'anatomy_sync.fetched' });

  const [sync] = (await l.db.query<{ props: { commits: string } }>(`select props from entity where type = 'anatomy.sync' and archived_at is null`)).rows;
  assert.equal(sync.props.commits, `${CORE}@${NEW}\n${HOSTED}@${HOSTED_AT}`, 'the island stands at the pushed commit');
  const { rows: imports } = await l.db.query(`select 1 from relation where type = 'anatomy.imports' and valid_to is null`);
  assert.equal(imports.length, 0, 'the import a.ts dropped is taken back');
});
