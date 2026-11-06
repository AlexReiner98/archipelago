// What a post brought, counted onto it. The server that sells workspaces hands each count over as it happens, with the
// source tag its link carried and nothing about the person: a signup (a trial asked for, begun, ended or paid for, or a
// workspace bought with no trial) counts one more, and a day's visits (every tagged page load) add their number and
// move the post's first and last day of visits. A tag no post has is counted onto the source with that tag (an agent,
// a search engine, a site, a tag mistyped), made the first time it is seen.

const TAG = /^[a-z0-9_-]{1,40}$/;
const DAY = /^\d{4}-\d{2}-\d{2}$/;
/** What the seller counts, and the field of a post each is added to. */
const FIELD = { asked: 'asked', begun: 'begun', ended: 'ended', paid: 'paid', bought: 'paid' };
const VISITS = ['visits', 'first_visit', 'last_visit'];
const REFUSED = 'A count is a tag (letters, digits, - and _, up to 40) and either what happened (asked, begun, ended, paid or bought) or a number of visits n (a whole number above 0) on a day (YYYY-MM-DD).';

/** A delivery read as one count, or null: `signup.counted` is { tag, what }, `visit.counted` is { tag, n, day }. */
export function readCount(payload) {
  const p = payload && typeof payload === 'object' ? payload : {};
  const tag = String(p.tag ?? '').toLowerCase();
  if (!TAG.test(tag)) return null;
  if (p.what !== undefined) return FIELD[p.what] ? { event: 'signup.counted', tag, what: p.what, fields: [FIELD[p.what]] } : null;
  const { n, day } = p;
  if (!Number.isSafeInteger(n) || n < 1 || typeof day !== 'string' || !DAY.test(day)) return null;
  if (Number.isNaN(Date.parse(day)) || new Date(day).toISOString().slice(0, 10) !== day) return null;
  return { event: 'visit.counted', tag, n, day, fields: VISITS };
}

/** The fields a count changes on an item that has these. */
export function added(c, props = {}) {
  if (c.event === 'signup.counted') return { [c.fields[0]]: (Number(props[c.fields[0]]) || 0) + 1 };
  const first = props.first_visit;
  const last = props.last_visit;
  return {
    visits: (Number(props.visits) || 0) + c.n,
    ...(!(typeof first === 'string' && first <= c.day) && { first_visit: c.day }),
    ...(!(typeof last === 'string' && last >= c.day) && { last_visit: c.day }),
  };
}

const said = (c) => (c.event === 'signup.counted' ? `${c.what} under ${c.tag}` : `${c.n} visit${c.n === 1 ? '' : 's'} under ${c.tag} on ${c.day}`);
const detail = (c) => (c.event === 'signup.counted' ? { tag: c.tag, what: c.what } : { tag: c.tag, n: c.n, day: c.day });
const authority = (c) => ({ of: 'agent', basis: `The seller counted it under the tag ${c.tag}` });

const reasonOf = (c) => (c.event === 'signup.counted' ? `A trial ${said(c)}` : `Counted ${said(c)}`);

/** The project the posts are in, for a new source: the nearest project above the first post. None without a post. */
export async function projectOfPosts(ctx) {
  const [first] = await ctx.read({ items: { type: 'post' }, fields: ['tag'] });
  if (!first) return null;
  const trail = (await ctx.read({ trail: first.id })) ?? [];
  return [...trail].reverse().find((e) => e.is?.includes('project'))?.id ?? null;
}

export async function count(input, ctx) {
  const c = readCount(input.payload);
  if (!c) return { answer: { recorded: false, reason: REFUSED } };
  const [post] = await ctx.read({ items: { type: 'post', where: { tag: c.tag } }, fields: c.fields });
  // A tag no post has is a source's: an agent, a search engine, a site, or a tag mistyped.
  const [item] = post ? [post] : await ctx.read({ items: { type: 'channel', where: { tag: c.tag } }, fields: c.fields });
  if (item) {
    const props = added(c, item.props);
    return {
      log: [{ action: c.event, target: item.id, reason: said(c), detail: detail(c) }],
      changes: [{ ops: [{ op: 'update', id: item.id, props }], reason: reasonOf(c), authority: authority(c) }],
      answer: { recorded: true, [post ? 'post' : 'source']: item.id, ...props },
    };
  }
  const props = { tag: c.tag, ...added(c) };
  const project = await projectOfPosts(ctx);
  return {
    log: [{ action: c.event, reason: said(c), detail: detail(c) }],
    changes: [
      {
        ops: [
          { op: 'create', ref: 'source', type: 'channel', title: c.tag, status: 'available', props },
          ...(project ? [{ op: 'link', type: 'part_of', from: 'source', to: project }] : []),
        ],
        reason: `${reasonOf(c)}: a source no post has`,
        authority: authority(c),
      },
    ],
    answer: { recorded: true, source: 'made', ...props },
  };
}
