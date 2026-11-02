// A signup counted onto the post that brought it. The server that sells workspaces hands each one over as it happens
// (a trial asked for, begun, ended or paid for, or a workspace bought with no trial), with the source tag its link
// carried and nothing about the person: the post with that tag counts one more. A tag no post has is not kept here.

const TAG = /^[a-z0-9_-]{1,40}$/;
/** What the seller counts, and the field of a post each is added to. */
const FIELD = { asked: 'asked', begun: 'begun', ended: 'ended', paid: 'paid', bought: 'paid' };

export async function count(input, ctx) {
  const payload = input.payload && typeof input.payload === 'object' ? input.payload : {};
  const tag = String(payload.tag ?? '').toLowerCase();
  const field = FIELD[payload.what];
  if (!TAG.test(tag) || !field) return { answer: { recorded: false, reason: 'A count is a tag (letters, digits, - and _, up to 40) and what happened: asked, begun, ended, paid or bought.' } };
  const [post] = await ctx.read({ items: { type: 'post', where: { tag } }, fields: [field] });
  if (!post) return { answer: { recorded: false, reason: `No post here has the tag "${tag}".` } };
  const n = (Number(post.props?.[field]) || 0) + 1;
  return {
    log: [{ action: 'signup.counted', target: post.id, reason: `${payload.what} under ${tag}`, detail: { tag, what: payload.what } }],
    changes: [
      {
        ops: [{ op: 'update', id: post.id, props: { [field]: n } }],
        reason: `A trial ${payload.what} under ${tag}`,
        authority: { of: 'agent', basis: `The seller counted it under the tag ${tag}` },
      },
    ],
    answer: { recorded: true, post: post.id, [field]: n },
  };
}
