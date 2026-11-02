// A signup counted onto the post that brought it, tested without a database: fixtures stand where the kernel answers
// its reads.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import handler from './handler.js';

type Post = { id: string; type: string; props: Record<string, unknown> };

/** What the kernel answers: the posts whose fields hold what a read asks for. */
function ctxOver(posts: Post[]) {
  const reads: Record<string, any>[] = [];
  return {
    reads,
    read: async (q: Record<string, any>) => {
      reads.push(q);
      const where = q.items?.where ?? {};
      return posts.filter((p) => q.items?.type === 'post' && Object.entries(where).every(([k, v]) => p.props[k] === v));
    },
  };
}

const post = (id: string, tag: string, props: Record<string, unknown> = {}) => ({ id, type: 'post', props: { tag, ...props } });
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

test('a tag no post has, or a count that is not one, changes nothing', async () => {
  const ctx = ctxOver([post('e_post0001', 'linkedin-26w46-1')]);
  const none = await deliver({ tag: 'bluesky-26w46-1', what: 'asked' }, ctx);
  assert.equal(none.answer.recorded, false);
  assert.equal(none.changes, undefined);
  for (const payload of [{ tag: 'linkedin-26w46-1', what: 'deleted' }, { tag: 'not a tag!', what: 'asked' }, { what: 'asked' }, 'text', null]) {
    const refused = await deliver(payload, ctx);
    assert.equal(refused.answer.recorded, false, JSON.stringify(payload));
    assert.equal(refused.changes, undefined);
  }
  assert.equal(ctx.reads.length, 1, 'only a well-formed count reads the map');
});
