// An automation lives with what it is about (src/subject.ts, task e_ehwndqcw): it is made with an about link to its
// subject, keeps one while it is live, lands on its subject's island and is as visible as it. One about an item that
// lives on no island stays map-wide.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { setIslands } from '../src/packstate.ts';
import type { Archipelago, Op } from '../src/pelago.ts';
import { fresh, human, make } from './map.ts';

const nightly = (extra: Partial<Op> = {}): Op => ({ op: 'create', ref: 'a', type: 'automation', title: 'Nightly', status: 'paused', props: { trigger: 'daily', at: '03:00', action: 'notify', message: 'hi' }, ...extra }) as Op;
const about = (to: string): Op => ({ op: 'link', type: 'about', from: 'a', to });
const refused = (l: Archipelago, ops: Op[], said: RegExp) => assert.rejects(l.change(human, { reason: 'test', ops }), said);
const linkOf = async (l: Archipelago, from: string) => (await l.db.query<{ id: string }>(`select id from relation where from_id = $1 and type = 'about' and valid_to is null`, [from])).rows[0].id;

test('an automation is made about something, and keeps a subject while it is live', async () => {
  const l = await fresh();
  const { t, u } = await make(l, [{ op: 'create', ref: 't', type: 'task', title: 'Write the post' }, { op: 'create', ref: 'u', type: 'task', title: 'Tidy' }]);
  await refused(l, [nightly()], /lives with what it is about/);
  await refused(l, [nightly({ ref: undefined } as Partial<Op>)], /give it a ref and link it/);
  const { a } = await make(l, [nightly(), about(t)]);
  assert.ok(a, 'made with its subject');
  const tie = await linkOf(l, a);
  await refused(l, [{ op: 'unlink', relation: tie }], /link it to its new subject in this change, or archive it/);
  await make(l, [{ op: 'unlink', relation: tie }, { op: 'link', type: 'about', from: a, to: u }]);
  await make(l, [{ op: 'unlink', relation: await linkOf(l, a) }, { op: 'archive', id: a }]);
  assert.ok((await l.entity(a))!.archived_at, 'an archived one may let its subject go');
});

test('an automation takes its subject’s visibility unless the change says one', async () => {
  const l = await fresh();
  const { p } = await make(l, [{ op: 'create', ref: 'p', type: 'task', title: 'Private work', visibility: 'private' }]);
  const { a } = await make(l, [nightly(), about(p)]);
  assert.equal((await l.entity(a))!.visibility, 'private');
  const { s } = await make(l, [{ op: 'create', ref: 's', type: 'task', title: 'Shared work', visibility: 'shared' }]);
  const { a: b } = await make(l, [nightly({ title: 'Kept to me', visibility: 'private' }), about(s)]);
  assert.equal((await l.entity(b))!.visibility, 'private', 'what the change says stands');
});

test('on an island map an automation lands on its subject’s island; one about what lives on none stays map-wide', async () => {
  const l = await fresh();
  await setIslands(l, human, true);
  const { x, y } = await make(l, [
    { op: 'create', ref: 'x', type: 'island', title: 'Sessions', props: { pack: 'core' } },
    { op: 'create', ref: 'y', type: 'island', title: 'Posts', props: { pack: 'core' } },
  ]);
  const { t } = await make(l, [{ op: 'create', ref: 't', type: 'task', title: 'Today’s post', props: { island: y } }]);
  const { a } = await make(l, [nightly(), about(t)]);
  assert.equal((await l.entity(a))!.props.island, y, 'on the island of what it is about');
  await refused(l, [nightly({ title: 'Elsewhere', props: { trigger: 'daily', at: '03:00', action: 'notify', island: x } } as Partial<Op>), about(t)], /lives on the island of what it is about/);
  // Its subject made in the same change, on an island named there: it follows.
  const { n, b } = await make(l, [{ op: 'create', ref: 'n', type: 'task', title: 'Refine', props: { island: x } }, nightly({ ref: 'b', title: 'Morning' } as Partial<Op>), { op: 'link', type: 'about', from: 'b', to: 'n' }]);
  assert.equal((await l.entity(b))!.props.island, x);
  assert.equal((await l.entity(n))!.props.island, x);
  // A person lives on no island: one about them is the map's.
  const { me } = await make(l, [{ op: 'create', ref: 'me', type: 'person', title: 'Alex' }]);
  const { a: w } = await make(l, [nightly({ title: 'Weekly review' }), about(me)]);
  assert.equal((await l.entity(w))!.props.island, undefined, 'map-wide');
  await refused(l, [nightly({ title: 'Pinned', props: { trigger: 'daily', at: '03:00', action: 'notify', island: x } } as Partial<Op>), about(me)], /on none\), not/);
});
