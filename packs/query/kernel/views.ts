// The kernel's own views that are not lenses: each reads what is kept to run the map (runs, notifications, the log,
// the styles and views kept) rather than a picture of the work, and src/operational.ts names each with its rule.
// Every picture of the work is a lens: a lens preset a pack declares (src/query-presets.ts), asked by the same name.

import type { KernelContext } from '#pelago/kernel';

/** Who asks a view: a person or an agent, an admin among them. */
export interface Actor { kind: string; name: string; admin?: boolean; [key: string]: unknown }

/** The most change sets' events changed_since counts: past that, its counts are of the newest. */
const COUNTED = 20_000;

/** How kernel code asks a view a pack answers (a pack's read of another view): askview's, loaded when asked. */
export const askPackView = async (ctx: KernelContext, name: string, params: Record<string, unknown>): Promise<unknown> =>
  (await import('./askview.ts')).askView(ctx, { kind: 'agent', name: 'kernel' }, name, params);

async function changedSince(ctx: KernelContext, input: { since?: string; limit?: number }) {
  if (!input.since || Number.isNaN(Date.parse(input.since))) throw new Error('changed_since needs "since" as an ISO date or date-time');
  // The counts are of everything since; the events are the newest of them, few enough to read.
  const { events, counts } = (await ctx.reads({ changed: { since: input.since, ...(input.limit !== undefined && { limit: input.limit }), counted: COUNTED } })) as { events: unknown[]; counts: Record<string, number> };
  const rows = Object.entries(counts).map(([action, n]) => ({ action, n })).sort((a, b) => b.n - a.n);
  const total = rows.reduce((sum, r) => sum + r.n, 0);
  return {
    since: input.since,
    counts: Object.fromEntries(rows.map((r) => [r.action, r.n])),
    events,
    ...(total > events.length && { more: `The newest ${events.length} of ${total} events. Ask with a higher limit (500 at most) or a later since for the rest.` }),
  };
}

/** Minutes without a report before an open session is shown as stale. */
const STALE_MINUTES = 30;

/** A run's state as the runs pack answers it (answer.session_states), and the mark the sessions view carries of it. */
interface State { state: string; for?: string; line: string; since: string | null; turn?: unknown; turns: number }
/** The states in the order they ask for attention: what waits on a person first (the runs pack's order, copied). */
const ATTENTION = ['waiting', 'your_move', 'blocked', 'quiet', 'working', 'idle', 'done'];
const markOf = ({ state, for: f, line, since }: State) => ({ state, ...(f && { for: f }), line, since });
function byAttention(a: State, b: State): number {
  const rank = (s: State) => (ATTENTION.includes(s.state) ? ATTENTION.indexOf(s.state) : ATTENTION.length);
  const when = (s: State) => (s.since ? Date.parse(s.since) : Infinity);
  return rank(a) - rank(b) || when(a) - when(b);
}

type Run = { id: string; title: string; status: string; props: Record<string, unknown>; created_at: Date };

async function sessions(ctx: KernelContext) {
  const homes = (await ctx.call<unknown, { kinds: string[] }>('answer.lives_in', {})).kinds, parents = ctx.registry.relationFamily('started_from');
  const { open, links, ended } = (await ctx.reads({ open_runs: { links: ['works_on', 'holds', ...homes, ...parents] } })) as { open: Run[]; links: { run: string; type: string; id: string; title: string; entity_type: string }[]; ended: unknown[] };
  const of = (run: string, ...types: string[]) => links.filter((x) => x.run === run && types.includes(x.type)).map(({ id, title, entity_type }) => ({ id, title, type: entity_type }));
  // Each open run's state and latest turn (the runs pack's), and the open ones in the order they ask for attention.
  const states = open.length ? (await ctx.call<unknown, { states: Record<string, State> }>('answer.session_states', { runs: open.map((r) => r.id) })).states : {};
  const at = (id: string): State => (Object.hasOwn(states, id) ? states[id] : { state: 'idle', line: '', since: null, turns: 0 });
  open.sort((a, b) => byAttention(at(a.id), at(b.id)));
  return {
    stale_after_minutes: STALE_MINUTES,
    open: open.map((r) => {
      const seen = (r.props.last_seen as string | undefined) ?? r.created_at.toISOString();
      return {
        id: r.id,
        title: r.title,
        name: r.props.name,
        label: r.props.label,
        status: r.status,
        surface: r.props.surface,
        cwd: r.props.cwd,
        started: r.created_at,
        last_seen: seen,
        stale: Date.now() - Date.parse(seen) > STALE_MINUTES * 60_000,
        busy: r.props.busy === true,
        working_on: of(r.id, 'works_on'),
        holds: of(r.id, 'holds'),
        repo: of(r.id, ...homes)[0],
        parent: of(r.id, ...parents)[0],
        session: markOf(at(r.id)),
        turn: at(r.id).turn,
      };
    }),
    recently_ended: ended,
  };
}

/** The unread notifications for the human, newest first. */
const notifications = (ctx: KernelContext) => ctx.reads({ notifications: true });

export interface View {
  description: string;
  /** `actor`: who asks, when the view answers some of it to an admin alone. */
  run(ctx: KernelContext, input: Record<string, unknown>, actor?: Actor): Promise<unknown>;
}

export const VIEWS: Record<string, View> = {
  changed_since: {
    description: 'What changed since a moment in time: how many events of each kind, and the newest of them. Long notes are cut to their start, and a change set says its reason once. Params: since (ISO date-time, required), limit (events listed, default 50; an agent is given the newest five unless it asks), full (true for everything whole).',
    run: changedSince,
  },
  spent: {
    description: 'What agents spent over the last days, read from their runs: dollars where a run says what it cost, tokens where it does not, by where they ran. The time pack\u2019s costs view adds what is paid regularly. Params: days (default 30).',
    run: (ctx, input) => ctx.call('answer.spent', input),
  },
  usage: {
    description: 'How much of each of its limits the workspace uses, and what that use is made of, answered as a query is (items and links), so a lens can draw it. Each limit (storage, agent sessions at once, requests this minute, looks this hour; members for an admin) is an item whose use says used, shown, of and of_shown (what the limit allows, where there is one), share, near and over; each part of it is an item part_of it: storage by what it is made of (facts, change sets, streams, images), then by type and the largest items (the bytes each has added to the log); sessions by name; requests and looks by who asked. A part that is an item names it (use.item). What you cannot see is summed with no title. Where nothing limits it, of is left out. Params: none.',
    run: (ctx, input, actor) => ctx.call('answer.usage', { ...input, admin: Boolean(actor?.admin) }),
  },
  notifications: {
    description: 'Unread notifications for the human, newest first.',
    run: notifications,
  },
  sessions: {
    description: 'Agent sessions and automation runs: what each open one is working on and holding, the session that started it (parent), its state (session: state, for, line, since) and latest turn, and the last ten that ended. The open ones come in the order they ask for attention: waiting, your_move, blocked, working, quiet, idle, each the longest in it first.',
    run: sessions,
  },
  session_measures: { description: 'What sessions’ turns tell over a range: those waiting on their person now and since when (waiting), turns and tokens per item worked on (per_item), open sessions with an hour of turns and no test passed or commit since (stalled). Params: since, until (ISO; a week to now), stall_minutes (60).', run: (ctx, input) => ctx.call('answer.session_measures', input) },
  saved_views: {
    description: 'Every view kept on the map (a query, named by the style that draws it), with what it is a view of and its life (working, an agent’s; kept, on the owner’s word): the kept first, then the newest. A working view about items that have all closed is retired with them: left out, its id in ended. Params: limit (100).',
    run: (ctx, input) => ctx.call('answer.saved_views', input),
  },
  style: {
    description: 'How a page looks: the style of one item (the presets the packs ship, the workspace’s, its kind’s, its own, nearest last, a named set merged name by name), or with no item the workspace’s; and which styles went in (used). What an item page, the pages that are not views and the canvas are drawn by. Params: of (an item id), style (the id of one kept on the map, used outright), view (a view kept on the map: the styles kept about it too), have (the hashes of the layouts the page holds: then the style carries the layout it names, its code left out when the page has it), try (a theme preset’s id: drawn as if the owner kept it, for this read only, nothing kept), `shape` (the form the reader chose for this view, as the view band’s switch names it: drawn in it, with its layout, over every style).',
    run: (ctx, input) => ctx.call('answer.page_style', input),
  },
  instructions: {
    description: 'What agents are told where: the instructions the packs ship (presets), under the workspace’s kept on the map, under those kept about a repository, nearest last, in order, each with the item (and preset) that says it. A session is told those for session_start when it begins. Params: for (where: session_start, working_rules, tool:<name>, guide:<name> (a guide, as guide:style_code for how a style’s code is written), or file:<path>, what is said about that file by the instructions whose file:<glob> names it; session_start unless said), about (a repository: what is said to a session there), island (an island: what is said there, by the version of its pack it runs).',
    // What a session is told as it begins, unless it says where: the agents pack's default.
    run: (ctx, input) => ctx.call('answer.instructions', { ...(typeof input.for === 'string' && { for: input.for }), ...(typeof input.about === 'string' && { about: input.about }), ...(typeof input.island === 'string' && { island: input.island }) }),
  },
};
