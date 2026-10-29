// Where a repository's work stands, for whoever picks it up next. Nearly all of it is read off the map, so it
// cannot go stale: the last push, what is open, and what has happened since the note was written (pushes, what was
// settled or opened, the sessions that ended and what each said). The note is the one part an agent writes, and
// holds only what the map cannot know.

import { findRepo, pushes, repoWork } from './repo.js';

/** The kinds of thing that are true or not of the world, and so go stale: work, questions and problems. */
export const GOES_STALE = ['task', 'decision', 'issue', 'hypothesis', 'feature'];
/** How long a handoff note may be: the type says so too (note_max), and the kernel holds agents to it. */
export const HANDOFF_MAX = 3000;
/** How far back a handoff looks when nobody has written a note to count from. */
const HANDOFF_DAYS = 7;

const HUBS_HOW =
  'Each of these holds enough to be the hub of its problem and has no view of its own. Give it its views: for each, a lens item (change, type lens) linked about it, named for the question it answers, with place for its order, controls for what the person may change (lit, far, closed), and a style about it if it should look its own way. A lens with from set to another item is a shortcut to there. The view named hubs lists every hub.';

/** What a session said when it ended is the last thing it was heard to say: the line that opens with the time. */
const said = (body) => (String(body ?? '').split('\n').findLast((line) => /^\[\d{4}-/.test(line)) ?? '').replace(/^\[[^\]]*\]\s*/, '').slice(0, 400);
/** How many of the newest of each kind of change are given whole: the rest are counted. */
const NEWEST = 5;
const slim = ({ id, type, title, status }) => ({ id, type, title, status });

/** How many checkouts left behind a handoff names. */
const LEFT = 10;

/**
 * What sessions left where nobody else can see it: of each checkout (branch and folder), the newest word a run gave of
 * it (git, said by the hook), when that run has ended with commits on no remote or files not committed, and no push to
 * its branch has come since.
 */
async function leftBehind(ctx, repo) {
  const runs = await ctx.read({ related: repo, relation: 'lives_in', direction: 'in', types: ['run'], newest: 'updated', fields: ['git'] });
  const heard = new Set();
  const left = [];
  for (const r of runs) {
    const git = r.props?.git;
    if (!git?.branch || !git.worktree) continue;
    const at = `${git.branch}\n${git.worktree}`;
    if (heard.has(at)) continue;
    heard.add(at);
    if (!r.is_open && (git.unpushed > 0 || git.dirty > 0)) left.push({ r, git });
  }
  if (!left.length) return [];
  const since = left.map(({ r }) => r.updated_at).sort()[0];
  const pushed = await pushes(ctx, repo, since, 100);
  return left
    .filter(({ r, git }) => !pushed.some((p) => p.detail?.branch === git.branch && Date.parse(p.ts) > Date.parse(r.updated_at)))
    .slice(0, LEFT)
    .map(({ r, git }) => ({ id: r.id, title: r.title, ended: r.updated_at, branch: git.branch, worktree: git.worktree, head: git.head.slice(0, 7), unpushed: git.unpushed, dirty: git.dirty }));
}

export async function handoff(input, ctx) {
  const repo = await findRepo(ctx, input.repo, 'handoff');
  if (input.since && Number.isNaN(Date.parse(input.since))) throw new Error('handoff: "since" must be an ISO date or date-time');
  const work = await repoWork({ repo: repo.id }, ctx);
  const [newest] = await ctx.read({ scope: repo.id, types: ['handoff'], open: true, fields: [] });
  const note = newest ? await ctx.read({ get: newest.id }) : null;
  const since = input.since ? new Date(input.since) : note ? new Date(note.updated_at) : new Date(Date.parse(ctx.now) - HANDOFF_DAYS * 86_400_000);
  const after = (t) => Date.parse(t) > since.getTime();
  // What goes stale and is the repository's, open or not, changed since then, newest first.
  const stale = (await ctx.read({ scope: repo.id, types: GOES_STALE, fields: [], since: since.toISOString() })).sort((a, b) => String(b.updated_at).localeCompare(String(a.updated_at)) || a.id.localeCompare(b.id));
  const ran = (await ctx.read({ related: repo.id, relation: 'lives_in', direction: 'in', types: ['run'], newest: 'updated', fields: [] })).filter((r) => !r.is_open && after(r.updated_at)).slice(0, 10);
  const ended = [];
  for (const r of ran) ended.push({ id: r.id, title: r.title, status: r.status, ended: r.updated_at, said: said((await ctx.read({ get: r.id }))?.body) });
  // What agents settled and the owner has not confirmed, as attention gives it to the owner.
  const asked = await ctx.read({ view: 'attention', params: { reasons: ['to_confirm'], limit: 15 } });
  const unconfirmed = asked.to_confirm ? { ...asked.to_confirm, questions: asked.items.map((i) => ({ id: i.id, title: i.title, ...Object.fromEntries(Object.entries(i.reasons[0]).filter(([k]) => k !== 'why')) })) } : { count: 0 };
  const inRepo = new Set([repo.id, ...(await ctx.read({ scope: repo.id, fields: [] })).map((e) => e.id)]);
  const unshaped = (await ctx.read({ view: 'hubs', params: { within: repo.id } })).hubs.filter((h) => h.views === 0 && inRepo.has(h.id));
  // Built or done, and nobody has seen it work where it is used: said on the item itself, not in the note.
  const unseen = (await ctx.read({ items: { type: 'work', where: { seen_working: false } }, fields: ['to_see'] })).filter((e) => inRepo.has(e.id));
  const left = await leftBehind(ctx, repo.id);
  const length = note?.body.length ?? 0;
  const pushed = await pushes(ctx, repo.id, since.toISOString(), 20);
  const settled = stale.filter((e) => !e.is_open && after(e.updated_at));
  const opened = stale.filter((e) => e.is_open && after(e.created_at));
  return {
    repo: work.repo,
    last_push: work.last_push,
    note: note ? { id: note.id, title: note.title, written: note.updated_at, characters: length, body: note.body } : null,
    // What ended sessions left on no remote or not committed, by branch and folder: read off their checkouts, never written down.
    ...(left.length > 0 && { left }),
    ...(unseen.length > 0 && { unseen: unseen.slice(0, 15).map((e) => ({ ...slim(e), ...(e.props?.to_see && { to_see: e.props.to_see }) })) }),
    // The owner is met in chat: what agents settled and they have not answered for comes with where things stand.
    ...(unconfirmed.count > 0 && { for_owner: unconfirmed }),
    since: since.toISOString(),
    // How many of each, and the newest few of each: what changed, not every item it touched.
    since_then: {
      counts: { pushes: pushed.length, settled: settled.length, opened: opened.length, sessions: ended.length },
      pushes: pushed.slice(0, NEWEST).map((p) => ({ at: p.ts, branch: p.detail?.branch, head: p.detail?.after?.slice(0, 7), subject: p.reason })),
      settled: settled.slice(0, NEWEST).map(slim),
      opened: opened.slice(0, NEWEST).map(slim),
      sessions: ended.slice(0, NEWEST),
    },
    open: { ready: work.ready.map(slim), blocked: work.blocked.map((b) => ({ ...slim(b), waiting_on: b.waiting_on })) },
    // Work that is owed though nobody wrote it down: an item here that has grown into a hub and has no view of its own.
    ...(unshaped.length > 0 && { to_shape: { hubs: unshaped.slice(0, 15), how: HUBS_HOW } }),
    how:
      (note ? '' : `Nobody has written a handoff note for this repository. To write the first, create a handoff and link it lives_in to ${repo.id} in the same change; this view finds it from then on. `) +
      (note && length > HANDOFF_MAX
        ? `The note is ${length} characters, and may be ${HANDOFF_MAX} at most: sessions have added to it and none has taken away. Before you finish, rewrite it whole (body), with one of each part. `
        : note && length > HANDOFF_MAX * 0.8
          ? `The note is ${length} of the ${HANDOFF_MAX} characters it may be: there is no room to add to it, so replace its parts. `
          : '') +
      `Everything but the note is read off the map as it is now: where the note and the lists disagree, the lists are right. What nobody has seen working is said on the item itself (seen_working false, and what would show it in to_see) and listed here as unseen; set seen_working true once it has been seen. What sessions left unpushed or not committed is read off their checkouts and listed as left: do not write branches into the note. When you finish, put in the note only what the map cannot know (what bites when working here, what you would do next and why): one of each part, a few lines under a short title. Replace a part that is there (replace, or the whole note with body) rather than adding another beside it, and take out what is no longer so; the note may be ${HANDOFF_MAX} characters at most. What is true of one item goes in that item's note. Do not repeat the open work, the last push or what was settled: they are here.`,
  };
}
