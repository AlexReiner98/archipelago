import assert from 'node:assert/strict';
import { test } from 'node:test';
import { pageLook } from '../src/styles.ts';
import { sharedView } from '../src/share-view.ts';
import { callTool } from '../src/tools.ts';
import type { Actor } from '../src/pelago.ts';
import { fresh, make } from './map.ts';

const secretOf = (path: string) => path.split('/').at(-1)!;

test('a view or an item is given as a link through a document that brings it in alone, the view drawn live', async () => {
  const l = await fresh();
  const people = await make(l, [{ op: 'create', ref: 'ann', type: 'person', title: 'Ann' }]);
  const ann = l.as(people.ann);
  const annActor: Actor = { kind: 'human', name: 'ann', person: people.ann };
  const made = ((await ann.change(annActor, {
    reason: 'test',
    ops: [
      { op: 'create', ref: 'open', type: 'note', title: 'SR&ED', body: 'Claimed after the work.', visibility: 'shared' },
      { op: 'create', ref: 'hidden', type: 'note', title: 'IRAP', body: 'Call the advisor first.', visibility: 'private' },
      { op: 'create', ref: 'lens', type: 'lens', title: 'Notes', visibility: 'shared', props: { filter: { find: ['type note'], not: [] }, walk: { over: [], steps: 0 }, style: { shape: 'list' } } },
    ],
  })) as { created: Record<string, string> }).created;

  // An agent never makes a link, to a view any more than to a document.
  await assert.rejects(callTool(ann, { kind: 'agent', name: 'a', person: people.ann }, 'share_create', { id: made.lens }), /humans only/);

  // The view: a document is made about it, holding it alone, and the link draws its answer as the workspace may see it.
  const link = (await callTool(ann, annActor, 'share_create', { id: made.lens })) as { path: string };
  const shown = (await sharedView(l, secretOf(link.path)))!;
  assert.equal(shown.title, 'Notes');
  assert.deepEqual(shown.parts.map((p) => ('section' in p ? p.section.id : 'text')), [made.lens]);
  const picture = (shown as { lenses?: Record<string, { items: { title: string }[] }> }).lenses?.[made.lens];
  assert.ok(picture, 'the view is drawn');
  assert.deepEqual(picture.items.map((i) => i.title), ['SR&ED'], 'what is private to someone is not in a view anyone with the link sees');

  // Live: what is added to the map later is in it the next time the link is opened.
  await ann.change(annActor, { reason: 'test', ops: [{ op: 'create', type: 'note', title: 'SBIR', body: 'Later.', visibility: 'shared' }] });
  const again = (await sharedView(l, secretOf(link.path))) as unknown as { lenses: Record<string, { items: { title: string }[] }> };
  assert.deepEqual(again.lenses[made.lens].items.map((i) => i.title).sort(), ['SBIR', 'SR&ED']);

  // A second link to the view uses the same document; a single item is given the same way, as its page reads it.
  await callTool(ann, annActor, 'share_create', { id: made.lens });
  const about = await l.db.query(`select from_id from relation where type = 'about' and valid_to is null and to_id = $1`, [made.lens]);
  assert.equal(about.rows.length, 1, 'one document about the view, used again');
  const item = (await callTool(ann, annActor, 'share_create', { id: made.open })) as { path: string };
  const read = (await sharedView(l, secretOf(item.path)))!;
  assert.deepEqual(read.parts.map((p) => ('section' in p ? p.section.title : 'text')), ['SR&ED']);
  assert.equal('lenses' in read, false);

  // A page read with no login carries the style's words for starting a map of one's own.
  assert.equal((await pageLook(l, { id: 'e_aaaaaaaa', type: 'document' })).start, 'Start a map of your own');
});
