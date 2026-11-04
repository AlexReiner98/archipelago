// A signup or a day's visits counted onto the post that brought them, or the source with their tag, tested without a
// database: fixtures stand where the kernel answers its reads.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import handler from './handler.js';

type Post = { id: string; type: string; props: Record<string, unknown> };

/** What the kernel answers: the items of a type whose fields hold what a read asks for, and what each is part of. */
function ctxOver(items: Post[], trails: Record<string, { id: string; is: string[] }[]> = {}) {
  const reads: Record<string, any>[] = [];
  return {
    reads,
    read: async (q: Record<string, any>) => {
      reads.push(q);
      if (q.trail !== undefined) return trails[q.trail] ?? [];
      const where = q.items?.where ?? {};
      return items.filter((p) => q.items?.type === p.type && Object.entries(where).every(([k, v]) => p.props[k] === v));
    },
  };
}

const post = (id: string, tag: string, props: Record<string, unknown> = {}) => ({ id, type: 'post', props: { tag, ...props } });
const source = (id: string, tag: string, props: Record<string, unknown> = {}) => ({ id, type: 'traffic_source', props: { tag, ...props } });
const deliver = (payload: unknown, ctx: ReturnType<typeof ctxOver>) => handler['social.count']({ payload, headers: {} }, ctx);

test('a trial begun under a post’s tag counts one more on that post, and says so in the log', async () => {
  const ctx = ctxOver([post('e_post0001', 'linkedin-26w46-1', { begun: 2 }), post('e_post0002', 'x-26w46-1')]);
  const done = await deliver({ tag: 'LinkedIn-26w46-1', what: 'begun' }, ctx);
  assert.deepEqual(ctx.reads[0].items, { type: 'post', where: { tag: 'linkedin-26w46-1' } });
  assert.deepEqual(done.changes[0].ops, [{ op: 'update', id: 'e_post0001', props: { begun: 3 } }]);
  assert.equal(done.changes[0].authority.of, 'agent');
  assert.deepEqual(done.log[0], { action: 'signup.counted', target: 'e_post0001', reason: 'begun under linkedin-26w46-1', detail: { tag: 'linkedin-26w46-1', what: 'begun' } });
  assert.deepEqual(done.answer, { recorded: true, post: 'e_post0001', begun: 3 });
});

test('a workspace bought with no trial counts as paid, from nothing', async () => {
  const done = await deliver({ tag: 'x-26w46-1', what: 'bought' }, ctxOver([post('e_post0002', 'x-26w46-1')]));
  assert.deepEqual(done.changes[0].ops[0].props, { paid: 1 });
});

test('a count that is not one changes nothing and reads nothing', async () => {
  const ctx = ctxOver([post('e_post0001', 'linkedin-26w46-1')]);
  for (const payload of [{ tag: 'linkedin-26w46-1', what: 'deleted' }, { tag: 'not a tag!', what: 'asked' }, { what: 'asked' }, 'text', null]) {
    const refused = await deliver(payload, ctx);
    assert.equal(refused.answer.recorded, false, JSON.stringify(payload));
    assert.equal(refused.changes, undefined);
  }
  assert.equal(ctx.reads.length, 0, 'only a well-formed count reads the map');
});

test('a day’s visits add their number to the post and move its last day of visits', async () => {
  const ctx = ctxOver([post('e_post0001', 'linkedin-26w46-1', { visits: 2, first_visit: '2026-11-10', last_visit: '2026-11-11' })]);
  const done = await deliver({ tag: 'linkedin-26w46-1', n: 3, day: '2026-11-12' }, ctx);
  assert.deepEqual(ctx.reads[0], { items: { type: 'post', where: { tag: 'linkedin-26w46-1' } }, fields: ['visits', 'first_visit', 'last_visit'] });
  assert.deepEqual(done.changes[0].ops, [{ op: 'update', id: 'e_post0001', props: { visits: 5, last_visit: '2026-11-12' } }]);
  assert.deepEqual(done.log[0], { action: 'visit.counted', target: 'e_post0001', reason: '3 visits under linkedin-26w46-1 on 2026-11-12', detail: { tag: 'linkedin-26w46-1', n: 3, day: '2026-11-12' } });
  assert.deepEqual(done.answer, { recorded: true, post: 'e_post0001', visits: 5, last_visit: '2026-11-12' });
});

test('the first visits to a post set both its days, and a late count moves only the first', async () => {
  const first = await deliver({ tag: 'x-26w46-1', n: 1, day: '2026-11-12' }, ctxOver([post('e_post0002', 'x-26w46-1')]));
  assert.deepEqual(first.changes[0].ops[0].props, { visits: 1, first_visit: '2026-11-12', last_visit: '2026-11-12' });
  const late = await deliver({ tag: 'x-26w46-1', n: 4, day: '2026-11-09' }, ctxOver([post('e_post0002', 'x-26w46-1', { visits: 1, first_visit: '2026-11-12', last_visit: '2026-11-12' })]));
  assert.deepEqual(late.changes[0].ops[0].props, { visits: 5, first_visit: '2026-11-09' });
});

test('visits that are not a count change nothing', async () => {
  const ctx = ctxOver([post('e_post0001', 'linkedin-26w46-1')]);
  for (const payload of [
    { tag: 'linkedin-26w46-1', n: 0, day: '2026-11-12' },
    { tag: 'linkedin-26w46-1', n: 1.5, day: '2026-11-12' },
    { tag: 'linkedin-26w46-1', n: '3', day: '2026-11-12' },
    { tag: 'linkedin-26w46-1', n: 3 },
    { tag: 'linkedin-26w46-1', n: 3, day: '2026-02-31' },
    { tag: 'linkedin-26w46-1', n: 3, day: '12/11/2026' },
    { tag: 'not a tag!', n: 3, day: '2026-11-12' },
  ]) {
    const refused = await deliver(payload, ctx);
    assert.equal(refused.answer.recorded, false, JSON.stringify(payload));
    assert.equal(refused.changes, undefined);
  }
  assert.equal(ctx.reads.length, 0, 'a count that is not one reads nothing');
});

test('the pack declares the visit fields, a source, and hears both counts', async () => {
  const { readFileSync } = await import('node:fs');
  const pack = JSON.parse(readFileSync(new URL('./pack.json', import.meta.url), 'utf8'));
  const fields = pack.types.find((t: { id: string }) => t.id === 'post').fields;
  assert.deepEqual(fields.visits, { ...fields.visits, type: 'number', shown: true, system: true });
  for (const f of ['first_visit', 'last_visit']) assert.deepEqual([fields[f].type, fields[f].system], ['date', true]);
  assert.equal(fields.posted.shown, true);
  const kept = pack.types.find((t: { id: string }) => t.id === 'traffic_source').fields;
  for (const f of ['tag', 'visits', 'first_visit', 'last_visit', 'asked', 'begun', 'paid', 'ended']) assert.deepEqual(kept[f], f === 'tag' ? { ...fields.tag, description: kept.tag.description } : fields[f], f);
  assert.deepEqual(pack.handlers.find((h: { webhook: string }) => h.webhook === 'social.count').records, ['signup.counted', 'visit.counted']);
});

const TRAIL = { e_post0001: [{ id: 'e_biz00001', is: ['project', 'work'] }, { id: 'e_social01', is: ['project', 'work'] }, { id: 'e_launch01', is: ['task', 'work'] }] };

test('a tag no post has makes one source, part of the project the posts are in', async () => {
  const ctx = ctxOver([post('e_post0001', 'linkedin-26w46-1')], TRAIL);
  const done = await deliver({ tag: 'chatgpt.com', n: 1, day: '2026-11-12' }, ctxOver([], {}));
  assert.equal(done.answer.recorded, false, 'a dot is not in a tag: the seller reads chatgpt.com as chatgpt');
  const made = await deliver({ tag: 'chatgpt', n: 1, day: '2026-11-12' }, ctx);
  assert.deepEqual(ctx.reads.slice(0, 2).map((q) => q.items), [{ type: 'post', where: { tag: 'chatgpt' } }, { type: 'traffic_source', where: { tag: 'chatgpt' } }]);
  assert.deepEqual(made.changes[0].ops, [
    { op: 'create', ref: 'source', type: 'traffic_source', title: 'chatgpt', status: 'counting', props: { tag: 'chatgpt', visits: 1, first_visit: '2026-11-12', last_visit: '2026-11-12' } },
    { op: 'link', type: 'part_of', from: 'source', to: 'e_social01' },
  ]);
  assert.deepEqual(made.changes[0].authority, { of: 'agent', basis: 'The seller counted it under the tag chatgpt' });
  assert.deepEqual(made.log, [{ action: 'visit.counted', reason: '1 visit under chatgpt on 2026-11-12', detail: { tag: 'chatgpt', n: 1, day: '2026-11-12' } }]);
  assert.equal(made.answer.recorded, true);
});

test('a second count under a source’s tag adds to that source, a signup too', async () => {
  const ctx = ctxOver([post('e_post0001', 'linkedin-26w46-1'), source('e_src00001', 'chatgpt', { visits: 1, first_visit: '2026-11-12', last_visit: '2026-11-12' })], TRAIL);
  const again = await deliver({ tag: 'chatgpt', n: 2, day: '2026-11-13' }, ctx);
  assert.deepEqual(again.changes[0].ops, [{ op: 'update', id: 'e_src00001', props: { visits: 3, last_visit: '2026-11-13' } }]);
  assert.deepEqual(again.answer, { recorded: true, source: 'e_src00001', visits: 3, last_visit: '2026-11-13' });
  const asked = await deliver({ tag: 'chatgpt', what: 'asked' }, ctx);
  assert.deepEqual(asked.changes[0].ops, [{ op: 'update', id: 'e_src00001', props: { asked: 1 } }]);
});

test('a post’s tag still goes to the post, and a source with no post to stand by is made on its own', async () => {
  const ctx = ctxOver([post('e_post0001', 'linkedin-26w46-1'), source('e_src00002', 'linkedin-26w46-1')], TRAIL);
  const onto = await deliver({ tag: 'linkedin-26w46-1', n: 1, day: '2026-11-12' }, ctx);
  assert.equal(onto.changes[0].ops[0].id, 'e_post0001');
  assert.equal(ctx.reads.length, 1, 'a post with the tag is the end of it');
  const alone = await deliver({ tag: 'google', what: 'begun' }, ctxOver([]));
  assert.deepEqual(alone.changes[0].ops, [{ op: 'create', ref: 'source', type: 'traffic_source', title: 'google', status: 'counting', props: { tag: 'google', begun: 1 } }]);
});
