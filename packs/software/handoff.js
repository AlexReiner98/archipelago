// Where a repository's work stands, for whoever picks it up next. Nearly all of it is read off the map, so it
// cannot go stale: the last push, what is open, and what has happened since the note was written (pushes, what was
// settled or opened, the sessions that ended and what each said). The note is the one part an agent writes, and
// holds only what the map cannot know.

import { findRepo, pushes, repoWork } from './repo.js';

/** The kinds of thing that are true or not of the world, and so go stale: work, questions and problems. */
export const GOES_STALE = ['task', 'decision', 'issue', 'inquiry.hypothesis', 'software.feature'];
/** How long a handoff note may be: the type says so too (note_max), and the kernel holds agents to it. */
export const HANDOFF_MAX = 3000;
/** How far back a handoff looks when nobody has written a note to count from. */
const HANDOFF_DAYS = 7;

const HUBS_HOW =
  'Each of these holds enough to be the hub of its problem and has no view of its own. Give it its views: for each, a lens item (change, type lens) linked about it, named for the question it answers, with place for its order, controls for what the person may change (lit, far, closed), and a style about it if it should look its own way. A lens with from set to another item is a shortcut to there. The view named hubs lists every hub.';

/** What a session said when it ended is the last thing it was heard to say: the line that opens with the time. */
const said = (body) => (String(body ?? '').split('\n').findLast((line) => /^\[\d{4}-/.test(line)) ?? '').replace(/^\[[^\]]*\]\s*/, '').slice(0, 400);
const slim = ({ id, type, title, status }) => ({ id, type, title, status });

export async function handoff(input, ctx) {
  const repo = await findRepo(ctx, input.repo, 'handoff');
  if (input.since && Number.isNaN(Date.parse(input.since))) throw new Error('handoff: "since" must be an ISO date or date-time');
  const work = await repoWork({ repo: repo.id }, ctx);
  const [newest] = await ctx.read({ scope: repo.id, types: ['software.handoff'], open: true, fields: [] });
  const note = newest ? await ctx.read({ get: newest.id }) : null;
  const since = input.since ? new Date(input.since) : note ? new Date(note.updated_at) : new Date(Date.parse(ctx.now) - HANDOFF_DAYS * 86_400_000);
  const after = (t) => Date.parse(t) > since.getTime();
  // Everything that goes stale and is the repository's, open or not, newest first.
  const stale = (await ctx.read({ scope: repo.id, types: GOES_STALE, fields: [] })).sort((a, b) => String(b.updated_at).localeCompare(String(a.updated_at)) || a.id.localeCompare(b.id));
  const ran = (await ctx.read({ related: repo.id, relation: 'lives_in', direction: 'in', types: ['sys.run'], newest: 'updated', fields: [] })).filter((r) => !r.is_open && after(r.updated_at)).slice(0, 10);
  const ended = [];
  for (const r of ran) ended.push({ id: r.id, title: r.title, status: r.status, ended: r.updated_at, said: said((await ctx.read({ get: r.id }))?.body) });
  // What agents settled and the owner has not confirmed, as attention gives it to the owner.
  const asked = await ctx.read({ view: 'attention', params: { reasons: ['to_confirm'], limit: 15 } });
  const unconfirmed = asked.to_confirm ? { ...asked.to_confirm, questions: asked.items.map((i) => ({ id: i.id, title: i.title, ...Object.fromEntries(Object.entries(i.reasons[0]).filter(([k]) => k !== 'why')) })) } : { count: 0 };
  const inRepo = new Set([repo.id, ...(await ctx.read({ scope: repo.id, fields: [] })).map((e) => e.id)]);
  const unshaped = (await ctx.read({ view: 'hubs' })).hubs.filter((h) => h.views === 0 && inRepo.has(h.id));
  const length = note?.body.length ?? 0;
  return {
    repo: work.repo,
    last_push: work.last_push,
    note: note ? { id: note.id, title: note.title, written: note.updated_at, characters: length, body: note.body } : null,
    // The owner is met in chat: what agents settled and they have not answered for comes with where things stand.
    ...(unconfirmed.count > 0 && { for_owner: unconfirmed }),
    since: since.toISOString(),
    since_then: {
      pushes: (await pushes(ctx, repo.id, since.toISOString(), 20)).map((p) => ({ at: p.ts, branch: p.detail?.branch, head: p.detail?.after?.slice(0, 7), subject: p.reason })),
      settled: stale.filter((e) => !e.is_open && after(e.updated_at)).slice(0, 40).map(slim),
      opened: stale.filter((e) => e.is_open && after(e.created_at)).slice(0, 40).map(slim),
      sessions: ended,
    },
    open: { ready: work.ready.map(slim), blocked: work.blocked.map((b) => ({ ...slim(b), waiting_on: b.waiting_on })) },
    // Work that is owed though nobody wrote it down: an item here that has grown into a hub and has no view of its own.
    ...(unshaped.length > 0 && { to_shape: { hubs: unshaped.slice(0, 15), how: HUBS_HOW } }),
    how:
      (note ? '' : `Nobody has written a handoff note for this repository. To write the first, create a software.handoff and link it software.lives_in to ${repo.id} in the same change; this view finds it from then on. `) +
      (note && length > HANDOFF_MAX
        ? `The note is ${length} characters, and may be ${HANDOFF_MAX} at most: sessions have added to it and none has taken away. Before you finish, rewrite it whole (body), with one of each part. `
        : note && length > HANDOFF_MAX * 0.8
          ? `The note is ${length} of the ${HANDOFF_MAX} characters it may be: there is no room to add to it, so replace its parts. `
          : '') +
      `Everything but the note is read off the map as it is now: where the note and the lists disagree, the lists are right. When you finish, put in the note only what the map cannot know (what nobody has seen working, what bites when working here, what you would do next and why): one of each part, a few lines under a short title. Replace a part that is there (replace, or the whole note with body) rather than adding another beside it, and take out what is no longer so; the note may be ${HANDOFF_MAX} characters at most. What is true of one item goes in that item's note. Do not repeat the open work, the last push or what was settled: they are here.`,
  };
}
