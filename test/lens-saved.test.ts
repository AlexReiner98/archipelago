// Views kept before the flat lens (task e_vtvhebut): each is translated once into the flat lens its fields say, its old
// fields taken off and what did not translate said in the log; one with nothing a filter can include is retired.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { moveLenses, oldLens, termLenses } from '../src/lens-saved.ts';
import { renamedLens } from '../src/lens-names.ts';
import { fresh, make } from './map.ts';

test('a view kept before the flat lens is translated once into the flat lens its fields say', async () => {
  const l = await fresh();
  const made = await make(l, [
    { op: 'create', ref: 'p', type: 'project', title: 'P' },
    { op: 'create', ref: 'q', type: 'project', title: 'Q' },
    { op: 'create', ref: 'f', type: 'feature', title: 'F' },
    { op: 'create', ref: 't', type: 'task', title: 'T' },
    { op: 'create', ref: 'd', type: 'task', title: 'Done', status: 'done' },
    { op: 'create', ref: 'x', type: 'task', title: 'Elsewhere' },
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
      ['+', made.about, 'controls', ['lit', 'far']], ['+', made.about, 'place', 1], ['+', made.about, 'kinds', ['task']], ['+', made.about, 'lanes', 'stage'],
      ['+', made.cut, 'from', made.q], ['+', made.cut, 'far', 0], ['+', made.cut, 'over', []],
      ['+', made.whole, 'kinds', ['feature', '-task', 'work', 'nothing.like_it']], ['+', made.whole, 'fold', ['closed', 'system', 'unlinked']],
      ['+', made.none, 'far', 2],
    ]),
  );
  const moved = await moveLenses(l);
  assert.deepEqual([moved.moved, moved.retired], [3, [made.none]]);
  const props = async (id: string) => (await l.entity(id))!.props;
  // About P, keeping tasks: the tasks within P, at any depth, not walked; closed and system left out, as it left them.
  assert.deepEqual(await props(made.about), { place: 1, filter: { find: ['type task'], only: [`in ${made.p}`], not: ['done', 'kind system'] }, walk: { over: [], steps: 0 }, style: { style: made.st } });
  assert.deepEqual(moved.lost[made.about], ['what its links reach of the types it kept (task)', 'what the person may change on the page', 'lanes']);
  // A shortcut starts where it said; far 0 is the start alone.
  assert.deepEqual(await props(made.cut), { filter: { find: [`id ${made.q}`], only: [], not: ['done', 'kind system'] }, walk: { over: [], steps: 0 } });
  // Of the whole map: the types it kept (work, the kind, is a type with every work type its flavour); one with a "-" left out.
  assert.deepEqual(await props(made.whole), { filter: { find: ['type feature', 'type work'], only: [], not: ['done', 'kind system', 'type task'] }, walk: { over: ['depends_on', 'waits_on'], steps: 1 } });
  assert.deepEqual(moved.lost[made.whole], ['kinds nothing.like_it', 'leaving out what is linked to nothing']);
  assert.equal((await l.entity(made.none))!.status, 'retired', 'nothing a filter can include: retired');
  assert.deepEqual(await props(made.none), {});
  // What it draws now: the open task within P, two steps down, in P as its frame; not what is finished.
  const { keptPicture } = await import('../src/lens-saved.ts');
  const about = await keptPicture(l, made.about);
  assert.deepEqual([about.items.map((i) => i.title), about.lens.from], [['T'], made.p]);
  // Once: nothing is left to move, and the log says what did not translate.
  assert.deepEqual((await moveLenses(l)).moved, 0);
  const said = (await l.events({ action: 'lens.moved' })) as unknown as { detail: { lost: Record<string, string[]> } }[];
  assert.deepEqual(said[0].detail.lost[made.whole], ['kinds nothing.like_it', 'leaving out what is linked to nothing']);
});

test('a translation keeps the start a view names, and a type it renames follows a pack that took it over', () => {
  const l = { registry: { types: new Map([['task', {}]]), relations: new Map([['part_of', {}], ['depends_on', {}], ['waits_on', {}]]) } } as never;
  assert.equal(oldLens(l, { from: '{env}' }, []).lens, null, 'a start that is no id, and nothing it is about');
  assert.deepEqual(renamedLens({ filter: { find: ['type hypothesis', 'assumes me', 'assumes< e_x'] }, walk: { over: ['assumes'], steps: 1 } }, 'assumes', 'presumes', 'relation'), {
    walk: { over: ['presumes'], steps: 1 },
    filter: { find: ['type hypothesis', 'presumes me', 'presumes< e_x'] },
  });
  assert.deepEqual(renamedLens({ walk: { over: ['part_of'] } }, 'hypothesis', 'hypothesis', 'entity'), {});
  assert.deepEqual(renamedLens({ walk: { over: ['assumes>', 'part_of<'], steps: 2 } }, 'assumes', 'presumes', 'relation'), { walk: { over: ['presumes>', 'part_of<'], steps: 2 } }, 'a way said is kept');
});

// What the old lens drew of each, read on this fixture from the old lens itself (src/lens.ts at 84433ae, the last
// commit that had it): the start as the frame, the types kept within it, and what its links reach of those types.
test('views that kept types inside an item draw only what they drew under the old lens', async () => {
  const l = await fresh();
  const m = await make(l, [
    { op: 'create', ref: 'p', type: 'project', title: 'P' },
    { op: 'create', ref: 'f1', type: 'feature', title: 'F1' },
    { op: 'create', ref: 'f2', type: 'feature', title: 'F2 nested' },
    { op: 'create', ref: 'f3', type: 'feature', title: 'F3 outside' },
    { op: 'create', ref: 't1', type: 'task', title: 'T1' },
    { op: 'create', ref: 't2', type: 'task', title: 'T2 direct' },
    { op: 'create', ref: 't3', type: 'task', title: 'T3 done', status: 'done' },
    { op: 'create', ref: 't4', type: 'task', title: 'T4 outside' },
    { op: 'create', ref: 'i', type: 'issue', title: 'I deep' },
    { op: 'create', ref: 'd', type: 'decision', title: 'D open' },
    { op: 'create', ref: 'd2', type: 'decision', title: 'D2 decided', status: 'decided', props: { outcome: 'x', rationale: 'y' } },
    { op: 'create', ref: 'h', type: 'hypothesis', title: 'H deep' },
    { op: 'create', ref: 'q', type: 'decision', title: 'Q outside' },
    { op: 'link', type: 'part_of', from: 'f1', to: 'p' },
    { op: 'link', type: 'part_of', from: 'f2', to: 'f1' },
    { op: 'link', type: 'depends_on', from: 'f1', to: 'f3' },
    { op: 'link', type: 'part_of', from: 't1', to: 'f1' },
    { op: 'link', type: 'part_of', from: 't2', to: 'p' },
    { op: 'link', type: 'part_of', from: 't3', to: 'f1' },
    { op: 'link', type: 'depends_on', from: 't1', to: 't4' },
    { op: 'link', type: 'depends_on', from: 't2', to: 'f1' },
    { op: 'link', type: 'part_of', from: 'i', to: 'f2' },
    { op: 'link', type: 'part_of', from: 'd', to: 'f1' },
    { op: 'link', type: 'part_of', from: 'd2', to: 'p' },
    { op: 'link', type: 'part_of', from: 'h', to: 'f2' },
    { op: 'link', type: 'depends_on', from: 'd', to: 't1' },
    { op: 'create', ref: 'oq', type: 'lens', title: 'Open questions' },
    { op: 'create', ref: 'fe', type: 'lens', title: 'Features' },
    { op: 'create', ref: 'td', type: 'lens', title: 'To do' },
    { op: 'link', type: 'about', from: 'oq', to: 'p' },
    { op: 'link', type: 'about', from: 'fe', to: 'p' },
    { op: 'link', type: 'about', from: 'td', to: 'p' },
  ]);
  await l.db.transaction((tx) =>
    l.moved(tx, 'test', 'test: views as they were kept', [
      ['+', m.oq, 'kinds', ['decision', 'hypothesis']], ['+', m.oq, 'over', []],
      ['+', m.fe, 'kinds', ['feature']], ['+', m.fe, 'far', 1], ['+', m.fe, 'over', ['depends_on']],
      ['+', m.td, 'kinds', ['task', 'issue']], ['+', m.td, 'over', ['depends_on']],
    ]),
  );
  const moved = await moveLenses(l);
  const { keptPicture } = await import('../src/lens-saved.ts');
  const old: Record<string, string[]> = {
    oq: ['D open', 'H deep', 'P'],
    fe: ['F1', 'F3 outside', 'P'],
    td: ['I deep', 'P', 'T1', 'T2 direct', 'T4 outside'],
  };
  const now: Record<string, string[]> = {};
  for (const view of Object.keys(old)) {
    const picture = await keptPicture(l, m[view]);
    assert.equal(picture.lens.from, m.p, `${view}: drawn in P, its frame, as the old lens drew it`);
    now[view] = [...picture.items.map((i) => i.title), 'P'].sort();
    for (const title of now[view]) assert.ok(old[view].includes(title), `${view} draws ${title}, which the old lens did not`);
  }
  // The same, but for what its links reached of the types it kept, which a walk cannot narrow: said in the log.
  assert.deepEqual(now, { oq: old.oq, fe: ['F1', 'P'], td: ['I deep', 'P', 'T1', 'T2 direct'] });
  assert.deepEqual([moved.lost[m.oq], moved.lost[m.fe], moved.lost[m.td]], [undefined, ['what its links reach of the types it kept (feature)'], ['what its links reach of the types it kept (task, issue)']]);
  assert.deepEqual((await l.entity(m.fe))!.props.filter, { find: [`part_of ${m.p}`], only: ['feature'], not: ['done', 'kind system'] }, 'one step down: only those types of what is part of it');
  assert.deepEqual((await l.entity(m.oq))!.props.filter, { find: ['type decision', 'type hypothesis'], only: [`in ${m.p}`], not: ['done', 'kind system'] }, 'every step down: those types within it');
});

test('a view kept in the old words is said in terms once, and the log keeps what it said', async () => {
  const l = await fresh();
  const { p, v, q } = await make(l, [
    { op: 'create', ref: 'p', type: 'project', title: 'P' },
    { op: 'create', ref: 'v', type: 'lens', title: 'Tasks in P', props: { filter: { types: ['task'], within: ['e_aaaaaaaa'], exclude: ['closed'] } } },
    { op: 'create', ref: 'q', type: 'lens', title: 'Already', props: { filter: { find: ['type task'] } } },
  ]);
  assert.ok(p);
  assert.equal(await termLenses(l), 1);
  assert.equal(await termLenses(l), 0, 'it runs once');
  assert.deepEqual((await l.entity(v))!.props.filter, { find: ['type task'], only: ['in e_aaaaaaaa'], not: ['done'] });
  assert.deepEqual((await l.entity(q))!.props.filter, { find: ['type task'] });
});
