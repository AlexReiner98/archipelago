// Views kept before the flat lens (task e_vtvhebut): each is translated once into the flat lens its fields say, its old
// fields taken off and what did not translate said in the log; one with nothing a filter can include is retired.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { moveLenses, oldLens } from '../src/lens-saved.ts';
import { renamedLens } from '../src/lens-names.ts';
import { fresh, make } from './map.ts';

test('a view kept before the flat lens is translated once into the flat lens its fields say', async () => {
  const l = await fresh();
  const made = await make(l, [
    { op: 'create', ref: 'p', type: 'work.project', title: 'P' },
    { op: 'create', ref: 'q', type: 'work.project', title: 'Q' },
    { op: 'create', ref: 'f', type: 'software.feature', title: 'F' },
    { op: 'create', ref: 't', type: 'work.task', title: 'T' },
    { op: 'create', ref: 'd', type: 'work.task', title: 'Done', status: 'done' },
    { op: 'create', ref: 'x', type: 'work.task', title: 'Elsewhere' },
    { op: 'link', type: 'part_of', from: 'f', to: 'p' },
    { op: 'link', type: 'part_of', from: 't', to: 'f' },
    { op: 'link', type: 'part_of', from: 'd', to: 'p' },
    { op: 'link', type: 'part_of', from: 'p', to: 'q' },
    { op: 'link', type: 'depends_on', from: 'f', to: 'x' },
    { op: 'create', ref: 'about', type: 'lens', title: 'Everything in P' },
    { op: 'create', ref: 'cut', type: 'lens', title: 'Shortcut to Q' },
    { op: 'create', ref: 'whole', type: 'lens', title: 'Features' },
    { op: 'create', ref: 'none', type: 'lens', title: 'The whole map' },
    { op: 'create', ref: 'st', type: 'style', title: 'As architecture', props: { shape: 'architecture' } },
    { op: 'link', type: 'about', from: 'about', to: 'p' },
    { op: 'link', type: 'about', from: 'cut', to: 'p' },
    { op: 'link', type: 'about', from: 'st', to: 'about' },
  ]);
  // The old fields, as the map kept them before the flat lens: written as a migration writes, past the type's check.
  await l.db.transaction((tx) =>
    l.moved(tx, 'test', 'test: views as they were kept', [
      ['+', made.about, 'controls', ['lit', 'far']], ['+', made.about, 'place', 1], ['+', made.about, 'kinds', ['work.task']], ['+', made.about, 'lanes', 'stage'],
      ['+', made.cut, 'from', made.q], ['+', made.cut, 'far', 0], ['+', made.cut, 'over', []],
      ['+', made.whole, 'kinds', ['software.feature', '-work.task', 'work', 'nothing.like_it']], ['+', made.whole, 'fold', ['closed', 'system', 'unlinked']],
      ['+', made.none, 'far', 2],
    ]),
  );
  const moved = await moveLenses(l);
  assert.deepEqual([moved.moved, moved.retired], [3, [made.none]]);
  const props = async (id: string) => (await l.entity(id))!.props;
  // About P: from P and what is part of it, walking what it sent along one step; closed and system left out, as it left them.
  assert.deepEqual(await props(made.about), { place: 1, filter: { ids: [made.p], links: [`part_of ${made.p}`], exclude: ['closed', 'system'] }, walk: { over: ['depends_on', 'waits_on'], steps: 1 }, style: { style: made.st } });
  assert.deepEqual(moved.lost[made.about], ['kinds kept of what is in it (work.task)', 'every step down (one is kept)', 'what the person may change on the page', 'lanes']);
  // A shortcut starts where it said; far 0 is the start alone.
  assert.deepEqual(await props(made.cut), { filter: { ids: [made.q], exclude: ['closed', 'system'] }, walk: { over: [], steps: 0 } });
  // Of the whole map: the types it kept (work, the kind, is a type with every work type its flavour); one with a "-" left out.
  assert.deepEqual(await props(made.whole), { filter: { types: ['software.feature', 'work'], exclude: ['closed', 'system', 'work.task'] }, walk: { over: ['depends_on', 'waits_on'], steps: 1 } });
  assert.deepEqual(moved.lost[made.whole], ['kinds nothing.like_it', 'leaving out what is linked to nothing']);
  assert.equal((await l.entity(made.none))!.status, 'retired', 'nothing a filter can include: retired');
  assert.deepEqual(await props(made.none), {});
  // What it draws now: P, what is part of it, and what that depends on; not what is finished.
  const { keptPicture } = await import('../src/lens-saved.ts');
  assert.deepEqual((await keptPicture(l, made.about)).items.map((i) => i.title).sort(), ['Elsewhere', 'F', 'P']);
  // Once: nothing is left to move, and the log says what did not translate.
  assert.deepEqual((await moveLenses(l)).moved, 0);
  const said = (await l.events({ action: 'lens.moved' })) as unknown as { detail: { lost: Record<string, string[]> } }[];
  assert.deepEqual(said[0].detail.lost[made.whole], ['kinds nothing.like_it', 'leaving out what is linked to nothing']);
});

test('a translation keeps the start a view names, and a type it renames follows a pack that took it over', () => {
  const l = { registry: { types: new Map([['work.task', {}]]), relations: new Map([['part_of', {}], ['depends_on', {}], ['waits_on', {}]]) } } as never;
  assert.equal(oldLens(l, { from: '{env}' }, []).lens, null, 'a start that is no id, and nothing it is about');
  assert.deepEqual(renamedLens({ filter: { types: ['hypothesis'], links: ['assumes me', { link: 'assumes', from: 'e_x' }] }, walk: { over: ['assumes'], steps: 1 } }, 'assumes', 'inquiry.assumes', 'relation'), {
    walk: { over: ['inquiry.assumes'], steps: 1 },
    filter: { types: ['hypothesis'], links: ['inquiry.assumes me', { link: 'inquiry.assumes', from: 'e_x' }] },
  });
  assert.deepEqual(renamedLens({ walk: { over: ['part_of'] } }, 'hypothesis', 'inquiry.hypothesis', 'entity'), {});
});
