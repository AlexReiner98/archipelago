// Pushed commits nobody accounts for reach the owner (the owner, 26 Oct 2026: commits are held to account in the loop,
// with nothing to set up on GitHub). Each push the app hears is recorded with its commits (push.js); once a commit has
// gone a while with no commit item for it, this schedule makes one, accounted false, and the software pack's attention
// reason puts it before the owner, whether a person or a session made it. Accounting for it (accounted true, with its
// settles links) takes it out again.
//
// The grace period is an hour. A session that commits is asked to account for its commits when its reply ends, and
// usually does in that reply; it often pushes partway through, so the reply can run on well after the push. An hour
// lets that reply end and account first, so the owner hears only of what nobody did, the same working session.
// Made before then, the item would also stand beside the one the session makes, the same commit twice.

/** How long a pushed commit may go unaccounted for before an item is made for it. */
export const GRACE_MINUTES = 60;
/** How far back pushes are read: a schedule that missed runs (the server was down) catches up within it. */
export const LOOK_BACK_DAYS = 3;
/** The most commits one run makes items for; the rest wait for the next. */
const MOST = 100;
// A merge GitHub or git wrote: what it brings in is each accounted for on its own, and it settles nothing itself.
const MERGE = /^Merge (?:pull request #\d+ from |branch '|remote-tracking branch ')/;
const TITLE = 60;

const subject = (message) => (message ?? '').split('\n')[0].trim();
const titled = (message, sha) => {
  const s = subject(message) || sha.slice(0, 7);
  return s.length > TITLE ? `${s.slice(0, TITLE - 1)}…` : s;
};

/**
 * The commits pushed before the grace period ended, from the pushes heard (newest first, as the log gives them), each
 * once, oldest first: those a push named in full (its detail.commits with id), and not a merge.
 */
export function pushedBefore(heard, cutoff) {
  const seen = new Map();
  for (const e of [...heard].reverse()) {
    if (Date.parse(e.ts) > cutoff || e.detail?.deleted || e.detail?.tag) continue;
    for (const c of e.detail?.commits ?? []) {
      if (!/^[0-9a-f]{40}$/.test(c.id ?? '') || seen.has(c.id) || MERGE.test(c.subject ?? '')) continue;
      seen.set(c.id, { ...c, repo: e.target_id, branch: e.detail.branch, pusher: e.detail.pusher, pushed: e.ts });
    }
  }
  return [...seen.values()];
}

/** The create and link that make a commit nobody has accounted for an item, by its ref. */
function made(c, ref) {
  const by = [c.author && `by ${c.author}`, c.run && `in run ${c.run}`].filter(Boolean).join(', ');
  return [
    {
      op: 'create',
      ref,
      type: 'software.commit',
      title: titled(c.subject, c.id),
      body: `Pushed to ${c.branch} ${by ? `${by} ` : ''}on ${c.pushed.slice(0, 10)}, and nobody said what it settles within ${GRACE_MINUTES} minutes. Account for it: a software.settles link to each item it settles, or none, and accounted true.`,
      props: { sha: c.id, accounted: false },
      ...(c.url && { source: { uri: c.url, kind: 'commit', title: subject(c.subject) } }),
    },
    ...(c.repo ? [{ op: 'link', type: 'software.lives_in', from: ref, to: c.repo }] : []),
  ];
}

/**
 * The schedule. Makes an item, accounted false, for each commit pushed more than the grace period ago that the map
 * holds no item for, nor waits to (a change held for a person). And tidies those it made: one someone has since given
 * settles links is accounted true, and one that stands beside an item someone made for the same commit is merged into
 * it, so each commit is one item.
 */
export async function commits(_input, ctx) {
  const now = Date.parse(ctx.now ?? new Date().toISOString());
  const since = new Date(now - LOOK_BACK_DAYS * 86_400_000).toISOString();
  const heard = await ctx.read({ events: { action: 'repo.push', since, limit: 500 } });
  const changes = [];

  const owed = [];
  for (const c of pushedBefore(heard, now - GRACE_MINUTES * 60_000)) {
    if (owed.length >= MOST) break;
    const found = await ctx.read({ items: { type: 'software.commit', where: { sha: c.id } }, fields: ['sha'] });
    if (found.length || (await ctx.read({ proposed: { op: 'create', type: 'software.commit', props: { sha: c.id } } }))) continue;
    owed.push(c);
  }
  if (owed.length)
    changes.push({
      ops: owed.flatMap((c, i) => made(c, `c${i}`)),
      reason: `${owed.length} pushed commit${owed.length === 1 ? '' : 's'} nobody accounted for within ${GRACE_MINUTES} minutes`,
      authority: { of: 'agent', basis: 'Pushes GitHub delivered, and no commit item for these commits after the grace period' },
    });

  for (const e of await ctx.read({ items: { type: 'software.commit', where: { accounted: false } }, fields: ['sha'] })) {
    const same = (await ctx.read({ items: { type: 'software.commit', where: { sha: e.props?.sha } }, fields: ['sha', 'accounted'] })).filter((o) => o.id !== e.id && o.props?.accounted !== false);
    if (same.length) {
      changes.push({ ops: [{ op: 'merge', keep: same[0].id, drop: e.id }], reason: `Commit ${String(e.props?.sha).slice(0, 7)} is accounted for by another item: one item for it`, authority: { of: 'agent', basis: `${same[0].id} accounts for the same sha` } });
      continue;
    }
    const settles = await ctx.read({ related: e.id, relation: 'software.settles', direction: 'out' });
    if (settles.length) changes.push({ ops: [{ op: 'update', id: e.id, props: { accounted: true } }], reason: `Commit ${String(e.props?.sha).slice(0, 7)} names what it settles: accounted for`, authority: { of: 'agent', basis: `It has ${settles.length} settles link${settles.length === 1 ? '' : 's'}` } });
  }
  return { changes, answer: { made: owed.length, tidied: changes.length - (owed.length ? 1 : 0) } };
}
