// The tools that only read: the model, a search, one item, a view, the log, what waits for a person, an image kept
// for an item, and listening for what the owner does. Agents reach each of them through query.

import { z } from 'zod';
import { NEWEST, summed } from './summary.ts';
import { lastSeq, readEvents } from './eventlog.ts';
import { listening } from './presence.ts';
import { askView, viewList, viewsSaid } from './askview.ts';
import { placesOn } from './canvas-places.ts';
import { shownIn } from './query-saved.ts';
import { wholeMap } from './outbox.ts';
import type { Archipelago } from './pelago.ts';
import { lookAt, takeLook } from './looks.ts';
import { getPicture } from './pictures.ts';
import { withScreens } from './screens.ts';
import { schemaBrief, schemaOf } from './schema-brief.ts';
import { withStyles } from './styles.ts';
import { props } from './tool-ops.ts';
import type { Tool } from './tools.ts';
import { VIEW_INPUT, viewAddress } from './view-address.ts';

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
  const rows = read.filter((r) => r.target_type !== 'notification').map((r) => ({ ...r, ts: r.ts as string, type: r.target_type, title: r.target_title }));
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
/**
 * What a list answers an agent: each long string cut to its start and its length, and anything large (a session's
 * story, a style's code) said by its size, so finding one item does not read the whole of it. `more` says where it is.
 */
function shorter(value: unknown, more: string): unknown {
  if (typeof value === 'string') return value.length > 300 ? `${value.slice(0, 200)}… (${value.length} characters; ${more})` : value;
  if (!value || typeof value !== 'object' || value instanceof Date) return value;
  const size = JSON.stringify(value).length;
  if (size > 2000) return `(${size} characters; ${more})`;
  return Array.isArray(value) ? value.map((v) => shorter(v, more)) : Object.fromEntries(Object.entries(value).map(([k, v]) => [k, shorter(v, more)]));
}

/** How many of an item's links in each direction `get` lists for an agent before it counts them by type. */
const GET_LISTED = 20;
/** A hub's links as an agent reads them: the first few, and the rest as a count of each type. */
function fewLinks<T extends { type: string }>(links: T[]) {
  if (links.length <= GET_LISTED) return { links };
  const by_type: Record<string, number> = {};
  for (const { type } of links) by_type[type] = (by_type[type] ?? 0) + 1;
  return { links: links.slice(0, GET_LISTED), counted: { total: links.length, by_type } };
}

/** How many of a closed status's proposals an agent is given, the newest. */
const PROPOSALS_LISTED = 20;

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
    description: 'Find items by text, type (flavours included), status or owner. Text matches words in any form in titles and notes, and titles that are nearly what you typed; the best match comes first. The query (query flat) takes the same search as its filter’s text, so what is found can be read with what it is tied to. Always search before creating, to avoid duplicates.',
    input: {
      q: z.string().optional().describe('Matches title and body.'),
      type: z.string().optional(),
      status: z.string().optional(),
      owner: z.string().optional(),
      open: z.boolean().optional().describe('true for unfinished only, false for finished only.'),
      include_archived: z.boolean().optional(),
      limit: z.number().int().positive().optional(),
      full: z.boolean().optional().describe('true for every field whole. Left out, an agent is given long fields cut, with their length; get has one item whole.'),
    },
    run: async (l, actor, { full, ...input }) => {
      const found = await l.search(input);
      return actor.kind !== 'agent' || full ? found : found.map((row) => ({ ...row, props: Object.fromEntries(Object.entries(row.props).map(([k, v]) => [k, shorter(v, 'get has it')])) }));
    },
  },
  get: {
    description: 'One item in full: its fields, the source it came from, where it sits (trail: what it is part of, outermost first, each with the views kept about it), what names it in its text or fields (mentioned_in), the views it is drawn in (shown_in: views kept about what it sits in, with the documents that bring them in) and its links in both directions. Its last few changes too, when asked for with history: true, each long value cut to its start: the item says what it is now, and the whole record is the log’s (events, with target and full: true).',
    input: { id: z.string(), history: z.boolean().optional().describe('true to be given its last few changes as well (recent_events).'), full: z.boolean().optional().describe(`true for every link: past ${GET_LISTED} in a direction, an agent is given those and a count by type (links_cut). The whole record is in events, with full: true.`) },
    run: async (l, actor, input) => {
      const found = { ...(await l.get(input.id)), shown_in: [] as Awaited<ReturnType<typeof shownIn>> };
      found.shown_in = await shownIn(l, input.id, found.trail);
      // Only the last few changes, long values cut, for anyone; an agent mostly wants the item, so has them when it asks.
      const { recent_events, ...item } = found;
      const recent = shortHistory(recent_events, actor.kind !== 'human', 'query events, with full: true, has all of it');
      const said = actor.kind === 'human' || input.history ? { ...item, recent_events: recent } : item;
      if (actor.kind !== 'agent' || input.full) return said;
      const [out, into] = [fewLinks(item.outgoing as { type: string }[]), fewLinks(item.incoming as { type: string }[])];
      return { ...said, outgoing: out.links, incoming: into.links, ...((out.counted || into.counted) && { links_cut: { outgoing: out.counted, incoming: into.counted, how: 'get with full: true has them all.' } }) };
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
    input: { status: z.enum(['pending', 'approved', 'rejected', 'superseded']).optional(), full: z.boolean().optional().describe(`true for all of them, whole. Left out, an agent is given long values cut, and of a closed status the newest ${PROPOSALS_LISTED}.`) },
    run: async (l, actor, { full, ...input }) => {
      const all = await l.proposals(input);
      const short = actor.kind === 'agent' && !full;
      const held = short ? all.slice(input.status && input.status !== 'pending' ? -PROPOSALS_LISTED : 0).map((p) => ({ ...p, ops: (p.ops as unknown[]).map((op) => shorter(op, 'proposals with full: true has it')) })) : all;
      // The session each was proposed in, named by its name, as everywhere a session is (the held entry says which).
      const { rows } = await l.db.query<{ id: string; run_name: string }>(
        `select p.id, r.title as run_name from log_entry p join entity r on r.id = p.head->>'run' where p.stream = 'pending' and p.id = any($1::text[])`,
        [held.map((p) => p.id)],
      );
      const named = new Map(rows.map((r) => [r.id, r.run_name]));
      return held.map((p) => (named.has(p.id) ? { ...p, run_name: named.get(p.id) } : p));
    },
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
          // A token revoked while it waits (its person removed, say) is told nothing more.
          if (actor.token && !(await db.query(`select 1 from token where id = $1 and revoked_at is null and (expires_at is null or expires_at > now())`, [actor.token])).rows.length) throw new Error('This token was revoked while it waited.');
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
    description: 'The image kept for a test result, or the figure kept for a note or file, as base64 with its content type, or null when none is kept (the proof view says which results have one: stored; query document, which sections have a figure). Or, with look, a look taken in the last 30 minutes, again, as an image.',
    input: { result: z.string().optional().describe('The id of the test result, note or file.'), look: z.string().optional().describe('A look query look or show answered with.') },
    run: async (l, _actor, input) => {
      if (input.look) return lookAt((await wholeMap(l)).db, l, input.look);
      if (!input.result) throw new Error('picture needs "result" or "look".');
      return getPicture(l, { result: input.result });
    },
  },
  look: {
    description:
      'See what a view looks like: the server draws it in its own browser, from the same page, layouts and sandbox the owner’s screen uses, as you see the map (private items as query shows them to you), and answers with the picture as an image, once the view says it has drawn: state (drawn, empty: the query found nothing, error, late), settled (false for a layout still moving), why. ' +
      'It never moves the owner’s page (show with look: true does both), and the person reading a chat does not see it: draw shows them. The same view at the same size, the map unchanged, answers with the picture already taken (again: true) unless fresh. At most 60 an hour per workspace.',
    input: {
      ...VIEW_INPUT,
      width: z.number().int().min(320).max(1920).optional().describe('The picture’s width in pixels (1200).'),
      height: z.number().int().min(240).max(1600).optional().describe('Its height (750).'),
      scheme: z.enum(['dark', 'light']).optional().describe('The theme it is drawn in, as a reader whose system is dark or light sees it (dark).'),
      fresh: z.boolean().optional().describe('Draw it again even when the map has not changed since the last look at it.'),
      marks: z.boolean().optional().describe('Answer with the drawing as marks (markup and its stylesheet, large) in place of the image, where it has them: what a view drawn in a chat asks for. To see a view yourself, leave this out.'),
    },
    run: async (l, actor, input) => takeLook((await wholeMap(l)).db, l.db, l, actor.name, await viewAddress(l, input), input),
  },
  // The one tool that names the page in a chat (src/mcp-view.ts). The page takes the look, at the size it has: this only
  // refuses what could not be drawn. Its inputs are cut short, since the tool list carries them on every request.
  draw: {
    description: 'Draw a view in this chat, for the person reading it, in a client that draws MCP Apps (Claude chat). Elsewhere nothing is drawn: report show opens it on their canvas, query look gives you the picture.',
    input: {
      entity: VIEW_INPUT.entity.describe('A view kept on the map (type lens), or any item.'),
      query: VIEW_INPUT.query.describe('A query, as query flat takes it.'),
      style: z.record(z.string(), z.unknown()).optional().describe('How it is drawn, as query look takes it: { layout, lit, id }.'),
    },
    run: async (l, _actor, { style, ...named }) => {
      if (!named.entity && !named.query && !style) throw new Error('draw needs "entity" or "query".');
      return { view: await viewAddress(l, { ...named, style: VIEW_INPUT.style.parse(style) }), said: 'Drawn here if this client draws MCP Apps.' };
    },
  },
  places: {
    description: 'Where each thing stands on one canvas, as a person put it there: by item, the middle of each as [x, y] in the picture’s own units. Read beside the query of that canvas; what is not here is where the layout lays it.',
    input: { canvas: z.string().optional().describe("The canvas: the id of the item it is drawn from; the workspace's (or nothing) for the whole map.") },
    run: async (l, _actor, input) => placesOn(l, input.canvas),
  },
};
