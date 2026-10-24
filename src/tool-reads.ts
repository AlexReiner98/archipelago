// The tools that only read: the model, a search, one item, a view, the log, what waits for a person, an image kept
// for an item, and listening for what the owner does. Agents reach each of them through query.

import { z } from 'zod';
import { NEWEST, summed } from './summary.ts';
import { lastSeq, readEvents } from './eventlog.ts';
import { listening } from './presence.ts';
import { askView, viewList, viewsSaid } from './askview.ts';
import { shownIn } from './lens.ts';
import { wholeMap } from './outbox.ts';
import type { Archipelago } from './pelago.ts';
import { getPicture } from './pictures.ts';
import { withScreens } from './screens.ts';
import { schemaBrief, schemaOf } from './schema-brief.ts';
import { withStyles } from './styles.ts';
import { props } from './tool-ops.ts';
import type { Tool } from './tools.ts';

/** One thing the human did to the map, small enough to put in front of a model. */
export interface HumanChange {
  seq: number;
  ts: string;
  actor: string;
  action: string;
  target?: { id: string; type: string; title: string };
  reason?: string;
  /** For an edit, each field's value before and after. */
  changes?: unknown;
}

export async function latestSeq(l: Archipelago): Promise<number> {
  return lastSeq(l.db);
}

/** What humans have done since an event, oldest first: their edits, decisions, approvals and rejections. Reading a notification is not news. */
export async function humanChanges(l: Archipelago, after: number): Promise<HumanChange[]> {
  const read = await readEvents(l.db, { after, actorLike: 'human:%', news: true, oldest: true, limit: 50 });
  const rows = read.filter((r) => r.target_type !== 'sys.notification').map((r) => ({ ...r, ts: r.ts as string, type: r.target_type, title: r.target_title }));
  return rows.map((r) => ({
    seq: r.seq,
    ts: r.ts,
    actor: r.actor,
    action: r.action,
    target: r.target_id ? { id: r.target_id, type: r.type ?? '', title: r.title ?? '' } : undefined,
    reason: r.reason || undefined,
    changes: r.detail?.changes ?? r.detail ?? undefined,
  }));
}

/** The same, as lines of text for a hook to hand to a session. */
export function describeChanges(changes: HumanChange[]): string {
  const short = (v: unknown) => (v == null ? 'nothing' : JSON.stringify(v));
  return changes
    .map((c) => {
      const what = c.target ? `${c.target.type} "${c.target.title}" (${c.target.id})` : '';
      const fields =
        c.action === 'entity.update' && c.changes && typeof c.changes === 'object'
          ? Object.entries(c.changes as Record<string, { from?: unknown; to?: unknown }>).map(([k, v]) => `${k}: ${short(v.from)} -> ${short(v.to)}`).join('; ')
          : c.changes
            ? JSON.stringify(c.changes)
            : '';
      // An update that changed nothing is someone saying the item is still true.
      const checked = c.action === 'entity.update' && !fields;
      return `- ${checked ? 'checked, still true as written:' : c.action} ${what}${fields ? `: ${fields}` : ''}${c.reason ? ` [${c.reason}]` : ''}`;
    })
    .join('\n');
}

/**
 * History as an agent reads it: a long value before or after an edit (a note,
 * mostly) is cut to its start and its length, so an item edited ten times does
 * not answer with its note twenty times over. A change set logs one event for
 * each thing it touched, all with the same reason and authority: those are
 * said on the first of them only (once). `more` says where the whole of it is.
 */
function shortHistory<T>(events: T[], once = true, more = 'ask again with full: true for all of it'): T[] {
  const cut = (v: unknown) => (typeof v === 'string' && v.length > 300 ? `${v.slice(0, 200)}… (${v.length} characters; ${more})` : v);
  const said = new Set<string>();
  return events.map((ev) => {
    const { changeset, detail } = ev as { changeset?: string | null; detail?: { changes?: Record<string, { from: unknown; to: unknown }>; authority?: unknown } | null };
    const again = once && Boolean(changeset && said.has(changeset));
    if (changeset) said.add(changeset);
    if (!again && !detail?.changes) return ev;
    const changes = detail?.changes && Object.fromEntries(Object.entries(detail.changes).map(([key, c]) => [key, { from: cut(c.from), to: cut(c.to) }]));
    return { ...ev, ...(again && { reason: undefined }), detail: detail && { ...detail, ...(changes && { changes }), ...(again && { authority: undefined }) } };
  });
}
/** How many of a repository's open items the handoff lists for an agent before it says how many more there are. */
const HANDOFF_LISTED = 25;

/**
 * A view as an agent reads it. The answer is drawn for a screen, where a row
 * says its owner and its due date even when it has neither and a blocked item
 * repeats what blocks it in full; an agent pays for every character of that
 * on every call. It is given the same facts without the empty fields, a
 * project's settled questions by their answer only, and of a repository's
 * open work in a handoff the first few and the count. `full: true` in the
 * params asks for the answer as the screen has it.
 */
function forAgent(name: string, answer: unknown): unknown {
  const bare = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(bare);
    if (!value || typeof value !== 'object' || value instanceof Date) return value;
    const row = value as Record<string, unknown>;
    // An empty field is left out of a row that is an item (it has an id); elsewhere null may be the answer itself.
    const entries = Object.entries(row).filter(([, v]) => !('id' in row && v === null));
    return Object.fromEntries(entries.map(([k, v]) => [k, bare(v)]));
  };
  const out = bare(answer) as Record<string, unknown>;
  if (name === 'tree' && Array.isArray(out?.branches)) {
    // A branch as an agent reads it: what is open under it by name, what is finished by count, and a mark only when it is set.
    type Node = Record<string, unknown> & { branches?: Node[]; work?: (Record<string, unknown> & { open?: boolean })[] };
    const light = ({ sessions, active, blocked, ...node }: Node): Node => ({ ...node, ...(blocked ? { blocked } : {}), ...(active ? { active } : {}), ...(Array.isArray(sessions) && sessions.length ? { sessions } : {}) });
    const prune = (node: Node): Node => {
      const work = node.work ?? [];
      const open = work.filter((w) => w.open !== false);
      return { ...light(node), ...(node.branches && { branches: node.branches.map(prune) }), ...(node.work && { work: open.map((w) => light(w)), ...(work.length > open.length && { finished_work: work.length - open.length }) }) };
    };
    out.branches = (out.branches as Node[]).map(prune);
  }
  if (name === 'handoff' && out?.open) {
    const open = out.open as { ready: unknown[]; blocked: unknown[] };
    const cut = open.ready.length > HANDOFF_LISTED || open.blocked.length > HANDOFF_LISTED;
    out.open = {
      ready: open.ready.slice(0, HANDOFF_LISTED),
      blocked: open.blocked.slice(0, HANDOFF_LISTED),
      ...(cut && { ready_count: open.ready.length, blocked_count: open.blocked.length, more: `The first ${HANDOFF_LISTED} of each: query repo_work has them all.` }),
    };
  }
  return out;
}

const FULL = z.boolean().optional().describe('true to be given the history whole: long notes, and the reason and authority on every event of a change set. Left out, an agent is given the start of each note and its length, and a change set’s reason and authority on the first of its events only.');

export const READ_TOOLS: Record<string, Tool> = {
  schema: {
    description: 'Describe the map\'s model: every type of item with its statuses and the fields you set, and every link type with its ends. Read this before writing. With type (a type, a link type or a pack): those whole, each field explained; full: true for everything, screens and verbs too.',
    input: { type: z.string().optional().describe('A type, a link type or a pack, by its id as the brief lists it.'), full: z.boolean().optional() },
    run: async (l, actor, input) => input.type ? schemaOf(l.registry.describe(), input.type) : actor.kind === 'human' || input.full ? withStyles(l, await withScreens(l, l.registry.describe())) : schemaBrief(l.registry),
  },
  search: {
    description: 'Find items by text, type (flavours included), status or owner. Text matches words in any form in titles and notes, and titles that are nearly what you typed; the best match comes first. Always search before creating, to avoid duplicates.',
    input: {
      q: z.string().optional().describe('Matches title and body.'),
      type: z.string().optional(),
      status: z.string().optional(),
      owner: z.string().optional(),
      open: z.boolean().optional().describe('true for unfinished only, false for finished only.'),
      include_archived: z.boolean().optional(),
      limit: z.number().int().positive().optional(),
    },
    run: async (l, _actor, input) => l.search(input),
  },
  get: {
    description: 'One item in full: its fields, the source it came from, where it sits (trail: what it is part of, outermost first, each with the views kept about it), what names it in its text or fields (mentioned_in), the views it is drawn in (shown_in: views kept about what it sits in, with the documents that bring them in) and its links in both directions. Its last few changes too, when asked for with history: true, each long value cut to its start: the item says what it is now, and the whole record is the log’s (events, with target and full: true).',
    input: { id: z.string(), history: z.boolean().optional().describe('true to be given its last few changes as well (recent_events).'), full: z.boolean().optional().describe('Taken, and changes nothing here: the whole record is in events, with full: true.') },
    run: async (l, actor, input) => {
      const found = { ...(await l.get(input.id)), shown_in: [] as Awaited<ReturnType<typeof shownIn>> };
      found.shown_in = await shownIn(l, input.id, found.trail);
      // Only the last few changes, long values cut, for anyone; an agent mostly wants the item, so has them when it asks.
      const { recent_events, ...item } = found;
      const recent = shortHistory(recent_events, actor.kind !== 'human', 'query events, with full: true, has all of it');
      return actor.kind === 'human' || input.history ? { ...item, recent_events: recent } : item;
    },
  },
  view: {
    description: viewsSaid(),
    input: {
      name: z.string().optional(),
      params: props.optional(),
    },
    run: async (l, actor, input) => {
      if (!input.name) return viewList(l);
      const answer = await askView(l, actor, input.name, input.params ?? {});
      if (actor.kind !== 'agent' || input.params?.full) return answer;
      // A view that answers with events (changed_since) is history, and is cut for an agent as history is: its counts,
      // and the newest few unless it asked for more.
      const events = (answer as { events?: unknown } | null)?.events;
      if (!Array.isArray(events)) return forAgent(input.name, answer);
      const counted = Object.values((answer as { counts?: Record<string, number> }).counts ?? {}).reduce((sum, n) => sum + n, 0);
      const few = input.params?.limit === undefined && events.length > NEWEST;
      return forAgent(input.name, { ...(answer as object), events: shortHistory(few ? events.slice(0, NEWEST) : events), ...(few && { more: `The newest ${NEWEST} of ${counted}; counts has each kind. Ask with a limit, or query events, for more.` }) });
    },
  },
  events: {
    description: 'The activity log, newest first: every change to the map and every imported external tool call, with who did it and why. A change set logs an event for each thing it touched; its reason and authority are on the first of them.',
    input: {
      since: z.string().optional().describe('ISO date-time.'),
      target: z.string().optional().describe('An item id.'),
      actor: z.string().optional().describe('e.g. "agent:claude" or "human:local".'),
      by: z.string().optional().describe('Only what this actor did, e.g. "agent:reader" or "human:owner". For an agent, whose own name travels as actor, this is the filter.'),
      before: z.number().int().positive().optional().describe('Only events older than this seq: the seq of the oldest event of the answer before, to read the log back a page at a time.'),
      origin: z.enum(['pelago', 'external', 'github']).optional(),
      limit: z.number().int().positive().optional(),
      full: FULL,
    },
    run: async (l, actor, { full, by, ...input }) => {
      const events = await l.events({ ...input, ...(by && { actor: by }) });
      return actor.kind === 'human' || full ? events : shortHistory(events);
    },
  },
  proposals: {
    description:
      'List the changes held for a human, by status (default pending; "approved" is applied, "rejected" is declined, "superseded" asked only for what a later change had already made so). Agents can read these but only a human can decide them.',
    input: { status: z.enum(['pending', 'approved', 'rejected', 'superseded']).optional() },
    run: async (l, _actor, input) => l.proposals(input),
  },
  watch: {
    description:
      'Hear what the human does in the map, as it happens: a decision made, an edit, an approval or a rejection. ' +
      'Call it once with no input to get `latest`. Then call it with `after` set to that and `wait_seconds` up to 600: it answers the moment the human changes something, ' +
      'or with no changes when the time runs out. Call again with the new `latest` to keep listening. While a session waits here, the web UI shows that an agent is listening.',
    input: {
      after: z.number().int().nonnegative().optional().describe('The `latest` from the previous call.'),
      wait_seconds: z.number().int().min(0).max(600).optional().describe('How long to wait for something to happen. Default 0: answer at once.'),
    },
    run: async (l, actor, input) => {
      if (input.after === undefined) return { latest: await latestSeq(l), changes: [] };
      const until = Date.now() + (input.wait_seconds ?? 0) * 1000;
      // Counted on every server, so the web UI can say whether anyone will hear a decision the moment it is made.
      const { db } = await wholeMap(l);
      await listening(db, l.workspace, 1);
      try {
        for (;;) {
          const changes = await humanChanges(l, input.after);
          // An agent is told how many of each, and the newest few.
          const { newest, counts, more } = actor.kind === 'agent' ? summed(changes, (c) => c.action) : { newest: changes };
          if (changes.length || Date.now() >= until) return { latest: changes.at(-1)?.seq ?? input.after, changes: newest, ...(counts && { counts, more }) };
          await new Promise((r) => setTimeout(r, 1000));
        }
      } finally {
        await listening(db, l.workspace, -1).catch(() => {});
      }
    },
  },
  picture: {
    description: 'The image kept for a test result, or the figure kept for a note or file, as base64 with its content type, or null when none is kept (the proof view says which results have one: stored; query document, which sections have a figure).',
    input: { result: z.string().describe('The id of the test result, note or file.') },
    run: async (l, _actor, input) => getPicture(l, input),
  },
};
