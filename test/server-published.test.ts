// The published acts a server pack may ask for (src/server-published.ts): a document as it was last published, the
// one at a site's path, a section's picture, a drawing's code by its hash and a site's pages, each read as anyone
// reads it. What is not published, or no longer public, is not there to be found.

import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { openDb } from '../src/db.ts';
import { hostFor } from '../src/packtools.ts';
import { Archipelago, type Actor } from '../src/pelago.ts';
import { Registry } from '../src/packs.ts';
import { publish, unpublish } from '../src/published.ts';
import type { ActPlaces } from '../src/server-acts.ts';
import type { ServerPackFile } from '../src/server-packs.ts';
import { publishedAct } from '../src/server-published.ts';
import { packsWith } from './map.ts';

const owner: Actor = { kind: 'human', name: 'owner', admin: true };
const ACTS = ['public.read', 'public.at', 'public.picture', 'public.drawing', 'public.list'] as const;
const pack = (acts: readonly string[] = ACTS) => ({ id: 'reader', reach: { server: { acts } } }) as unknown as ServerPackFile;
const registries: Registry[] = [];
after(() => registries.forEach((r) => hostFor(r).stop()));

async function site() {
  const reg = new Registry(packsWith('reader'));
  registries.push(reg);
  const l = new Archipelago(await openDb(), reg);
  const at = { has: async (id: string) => id === 'default', get: async () => ({ pelago: l }) } as unknown as ActPlaces;
  const made = (
    (await l.change(owner, {
      reason: 'test',
      ops: [
        { op: 'create', ref: 'd', type: 'writing', title: 'How it works', visibility: 'shared', body: 'The point.\n\n{s}\n\n{l}', props: { path: 'how-it-works', menu: 1 } },
        { op: 'create', ref: 's', type: 'writing', title: 'A section', visibility: 'shared', body: 'Its text.' },
        { op: 'link', type: 'part_of', from: 's', to: 'd' },
        { op: 'create', ref: 'p', type: 'aim', title: 'A system', visibility: 'shared' },
        { op: 'create', ref: 'l', type: 'lens', title: 'What talks to what', visibility: 'shared', props: { filter: { find: ['type aim'] }, style: { shape: 'map' } } },
        { op: 'link', type: 'about', from: 'l', to: 'p' },
        { op: 'link', type: 'part_of', from: 'l', to: 'd' },
        { op: 'create', ref: 'u', type: 'writing', title: 'A draft', visibility: 'shared', body: 'Not out yet.', props: { path: 'draft' } },
      ],
    })) as { created: Record<string, string> }
  ).created;
  // A figure on the section and one on the unpublished draft, kept as the figure store keeps them.
  for (const id of [made.s, made.u]) await l.db.query(`insert into picture (entity_id, content_type, bytes, size) values ($1, 'image/png', $2, 3)`, [id, Buffer.from([1, 2, 3])]);
  await publish(l, owner, made.d);
  const act = (name: (typeof ACTS)[number], input: Record<string, unknown>) => publishedAct(at, pack(), name, { workspace: 'default', ...input });
  return { l, at, made, act };
}

test('a pack reads a published document, its picture, its drawing and the site’s pages, all as JSON', async () => {
  const { made, act } = await site();
  const doc = (await act('public.read', { id: made.d })) as any;
  assert.equal(doc.id, made.d);
  assert.equal(doc.title, 'How it works');
  assert.ok(doc.theme !== undefined, 'with its page look beside it');
  assert.deepEqual(JSON.parse(JSON.stringify(doc)), doc, 'JSON-safe');

  const byPath = (await act('public.at', { path: 'how-it-works' })) as any;
  assert.equal(byPath.id, made.d);

  assert.deepEqual(await act('public.picture', { id: made.d, section: made.s }), { content_type: 'image/png', base64: Buffer.from([1, 2, 3]).toString('base64') });

  const drawing = doc.lenses[made.l].style.drawing;
  assert.equal(drawing.modules, undefined, 'a drawing’s code is not in the document');
  assert.equal(drawing.src, `/p/default/${made.d}/drawing/${drawing.hash}`);
  const code = (await act('public.drawing', { id: made.d, hash: drawing.hash })) as Record<string, string>;
  assert.ok(Object.keys(code).includes('index.js'));
  assert.equal(await act('public.drawing', { id: made.d, hash: '0'.repeat(64) }), null);

  const pages = (await act('public.list', {})) as any[];
  assert.deepEqual(pages.map((p) => [p.id, p.path]), [[made.d, 'how-it-works']]);
});

test('what is not public, or taken down, is not reachable', async () => {
  const { l, made, act } = await site();
  // A draft never published, and a part that is not a section of a published document.
  assert.equal(await act('public.read', { id: made.u }), null);
  assert.equal(await act('public.at', { path: 'draft' }), null);
  assert.equal(await act('public.picture', { id: made.u, section: made.u }), null);
  assert.equal(await act('public.picture', { id: made.d, section: made.u }), null, 'a figure the document does not hold');
  assert.equal(await act('public.read', { id: made.s }), null, 'a section is not a document of its own');
  // Another workspace, or none.
  assert.equal(await act('public.read', { id: made.d, workspace: 'elsewhere' }), null);
  assert.deepEqual(await act('public.list', { workspace: 'elsewhere' }), []);

  // A public view stands as it was frozen, whatever the map says since, until it is taken down (or archived).
  await l.change(owner, { reason: 'test', ops: [{ op: 'update', id: made.d, visibility: 'private' }] });
  assert.ok(await act('public.read', { id: made.d }));
  await unpublish(l, owner, made.d);
  assert.equal(await act('public.read', { id: made.d }), null);
  assert.equal(await act('public.at', { path: 'how-it-works' }), null);
  assert.equal(await act('public.picture', { id: made.d, section: made.s }), null);
  assert.deepEqual(await act('public.list', {}), []);
});

test('inputs are checked, and only a declared act is done', async () => {
  const { at, made, act } = await site();
  await assert.rejects(act('public.read', { id: 'nope' }), /An id is needed/);
  await assert.rejects(act('public.at', { path: '../etc' }), /A path is needed/);
  await assert.rejects(act('public.drawing', { id: made.d, hash: 'x' }), /A hash is needed/);
  await assert.rejects(act('public.list', { workspace: { $ne: 1 } }), /A workspace is needed/);
  await assert.rejects(publishedAct(at, pack(['public.list']), 'public.read', { workspace: 'default', id: made.d }), /did not declare the act "public.read"/);
});
