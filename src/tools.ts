// One table of tools serves both surfaces: agents reach them over MCP, humans
// over the CLI and local API. Same names, same inputs, same write path.

import { readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';
import { bodyAfter } from './ops.ts';
import { actorId, type Actor, type Archipelago } from './pelago.ts';
import { MEMBER_TOOLS, limitOf } from './members.ts'; import { SERVER_PACK_TOOLS } from './server-pack-tools.ts';
import { PACK_STATE_TOOLS } from './packstate.ts';
import { SHARE_TOOLS } from './share-tools.ts';
import { BACKUP_TOOLS } from './backup-tools.ts'; import { FORMER_NAMES, REPORT_TOOLS } from './report.ts'; import { TOKEN_TOOLS } from './token-tools.ts'; import { ASK_TOOLS } from './token-ask.ts';
import { merge, notImported, parseBackup } from './backup.ts';
import { githubStatus, newGithubSecret } from './github.ts';
import type { GithubApp } from './github-app.ts';
import { hasReaderKey, readable, READER_MODEL, recheck, setReaderKey } from './reader.ts';
import { launch, stopLaunched } from './launcher.ts';
import { notify } from './notify.ts';
import { acceptedSenders, notifyWorkspace, wholeMap } from './outbox.ts';
import type { Registry, TypeDef } from './packs.ts';
import { packActionByShort, packTool, packTools } from './packtools.ts';
import { withinScope } from './scope.ts';
import { recordRun, sessionEnd, sessionStart, sessionUpdate, tell } from './sessions.ts';
import { undo } from './undo.ts';
import { withScreens } from './screens.ts'; import { withStyles } from './styles.ts'; import { schemaBrief, schemaOf } from './schema-brief.ts';
import { getPicture, putPicture } from './pictures.ts';
import { pictureOf, readLens, shownIn } from './lens.ts';
import { askView, viewList } from './askview.ts';
import { toConfirm } from './confirm.ts';
import { VIEWS } from './views.ts';
import { keep, kept as keptFor, take } from './transient.ts';
import { type Focus, listening, point as setFocus, presence, tellStamp, took } from './presence.ts';

const props = z.record(z.string(), z.unknown());
const visibility = z.enum(['private', 'shared', 'public']).describe('private: only its author. shared: everyone in the workspace. public: anyone, with no login, on the product\u2019s public page; only a project, feature, release, proof question, test or test result can be, and only a human makes it so (from an agent it waits as a proposal).');
const confidence = z.number().min(0).max(1);
const field = z.object({
  type: z.enum(['string', 'number', 'boolean', 'date', 'datetime', 'url', 'enum', 'json']),
  values: z.array(z.string()).optional(),
  description: z.string().optional(),
  default: z.unknown().optional(),
  shown: z.boolean().optional().describe('Sent with the item in a lens answer, so a style can draw by it.'),
});

const source = z.object({
  uri: z.string().describe('A stable address: file path, URL, message id or commit.'),
  title: z.string().optional(),
  kind: z.enum(['file', 'email', 'web', 'conversation', 'commit', 'other']).optional(),
  excerpt: z.string().optional().describe('The passage the facts were drawn from.'),
});
const opSource = source.optional().describe('Where this one fact came from, when it differs from the source of the whole change.');

/** The longest name an agent may give a thing. A name is read in a row, a box and a tooltip; a sentence does not fit any of them. */
export const TITLE_MAX = 60;
const NAME = `A name, not a sentence: ${TITLE_MAX} characters at most. What else there is to say goes in the note.`;

const op = z.discriminatedUnion('op', [
  z.object({
    op: z.literal('create'),
    ref: z.string().optional().describe('A name for this new entity that later ops in the same change can use in place of an id.'),
    type: z.string(),
    title: z.string().describe(NAME),
    body: z.string().optional(),
    status: z.string().optional(),
    owner: z.string().optional().describe('Id or ref of a person or agent.'),
    visibility: visibility.optional(),
    confidence: confidence.optional(),
    props: props.optional().describe('Only the fields the type declares. See the schema tool.'),
    source: opSource,
  }),
  z.object({
    op: z.literal('update'),
    id: z.string(),
    title: z.string().optional().describe(NAME),
    body: z.string().optional().describe('The whole note, replacing what is there. To change part of a note, use append or replace instead.'),
    append: z.string().optional().describe('Added to the end of the note after a blank line; the rest is left as it is. For an outcome, a new sighting, a further finding.'),
    replace: z
      .object({ find: z.string().min(1).describe('An exact passage of the note as it is now. It must be there exactly once.'), with: z.string().describe('What goes in its place; empty to remove it.') })
      .optional()
      .describe('Replace one passage of the note; the rest is left as it is.'),
    status: z.string().optional(),
    owner: z.string().nullable().optional(),
    visibility: visibility.optional(),
    confidence: confidence.optional(),
    props: props.optional().describe('Merged into existing props. Set a field to null to clear it.'),
  }),
  z.object({
    op: z.literal('link'),
    type: z.string().describe('A relation type, e.g. depends_on.'),
    from: z.string().describe('Id or ref.'),
    to: z.string().describe('Id or ref.'),
    props: props.optional(),
    confidence: confidence.optional(),
    source: opSource,
  }),
  z.object({ op: z.literal('unlink'), relation: z.string().describe('The relation id, from the get tool.') }),
  z.object({ op: z.literal('archive'), id: z.string() }),
  z.object({ op: z.literal('restore'), id: z.string().describe('An archived entity to bring back.') }),
  z.object({ op: z.literal('merge'), keep: z.string(), drop: z.string().describe('Its relations move to keep, then it is archived.') }),
  z.object({
    op: z.literal('define_type'),
    type: z.object({
      id: z.string().describe('Must look like "local.my_type".'),
      title: z.string(),
      description: z.string(),
      extends: z.string().optional().describe('Needed: one of the seven kinds (actor, aim, work, question, record, occurrence, place) or a type of one; it inherits fields, statuses and the kind.'),
      statuses: z.object({ open: z.array(z.string()).min(1), closed: z.array(z.string()) }).optional(),
      fields: z.record(z.string(), field).optional(),
      deliverable: z.boolean().optional().describe('true when it is made for a reader or a customer, like a document or a release: what it is part of names it under its title.'),
    }),
  }),
]);

function needAdmin(actor: Actor, what: string): void {
  if (!actor.admin) throw new Error(`Only a workspace admin can ${what}.`);
}

export interface Tool {
  description: string;
  input: z.ZodRawShape;
  /** Not offered to agents. */
  humanOnly?: boolean;
  /** Exists only when the server runs in dev mode. */
  devOnly?: boolean;
  /** Sends what a system measured: the only kind of tool a token that may only report can call. */
  report?: boolean;
  run(l: Archipelago, actor: Actor, input: any): Promise<unknown>;
}

/** The server's GitHub App, when it can have one. Set by the server. */
let githubApp: GithubApp | undefined;
export function configureGithubApp(app: GithubApp | undefined): void {
  githubApp = app;
}

let backUp: (() => Promise<unknown>) | undefined;
/** The server hands the tools a way to back every workspace up now. */
export function configureBackup(run: (() => Promise<unknown>) | undefined): void {
  backUp = run;
}

let restartServer: (() => void) | undefined;
/** Dev mode hands the tools a way to restart the process they run in. */
export function configureRestart(restart: (() => void) | undefined): void {
  restartServer = restart;
}
export const devMode = () => restartServer !== undefined;

/** Moves when any file of the web UI is saved, so an open page knows to load itself again. */
const UI_DIR = join(import.meta.dirname, '..', 'ui');
const uiStamp = () => Math.max(...readdirSync(UI_DIR).map((file) => statSync(join(UI_DIR, file)).mtimeMs));

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
  const { rows } = await l.db.query<{ seq: number }>(`select coalesce(max(seq), 0)::int as seq from event`);
  return rows[0].seq;
}

/** What humans have done since an event, oldest first: their edits, decisions, approvals and rejections. Reading a notification is not news. */
export async function humanChanges(l: Archipelago, after: number): Promise<HumanChange[]> {
  const { rows } = await l.db.query<{ seq: number; ts: string; actor: string; action: string; target_id: string | null; type: string | null; title: string | null; reason: string | null; detail: Record<string, unknown> | null }>(
    `select e.seq::int as seq, e.ts, e.actor, e.action, e.target_id, t.type, t.title, e.reason, e.detail
     from event e left join entity t on t.id = e.target_id
     where e.seq > $1 and e.actor like 'human:%' and t.type is distinct from 'sys.notification' and ${notImported('e')} order by e.seq limit 50`,
    [after],
  );
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

// Where an agent pointed the screen and the steps it took are kept for any server to read (src/presence.ts).
async function point(l: Archipelago, actor: Actor, kind: 'show' | 'change', hash: string, note?: string): Promise<Focus> {
  const next = { at: Date.now(), hash, actor: actor.name, note };
  const { db } = await wholeMap(l);
  await setFocus(db, l, next);
  await took(db, l, { kind, actor: actor.name, did: note, hash }, true);
  return next;
}
/** Tools that are no step of their own: those that point the screen themselves, and the one that only waits. */
const UNWATCHED = new Set(['show', 'change', 'tell', 'watch']);
const READS = new Set(['get', 'events', 'proposals', 'picture', 'schema']);
async function step(l: Archipelago, actor: Actor, name: string, input: Record<string, unknown>): Promise<void> {
  const params = (input.params ?? {}) as Record<string, unknown>;
  // A session saying only that it is alive has done nothing to see.
  if (UNWATCHED.has(name) || (name === 'session_update' && !input.task && !input.note)) return;
  const named = [input.id, input.entity, input.target, input.task, input.resource, input.about, input.repo, params.from, params.root, params.project, params.event, params.of, params.task, params.repo, params.focus];
  const id = named.find((v): v is string => typeof v === 'string' && /^e_[a-z0-9]{8}$/.test(v));
  const did =
    name === 'get'
      ? 'is reading this'
      : name === 'search'
        ? `searched${input.q ? ` for "${String(input.q).slice(0, 60)}"` : input.type ? ` for every ${String(input.type)}` : ''}`
        : name === 'view'
          ? `asked ${input.name ? `for ${String(input.name).replaceAll('_', ' ')}` : 'what can be asked'}`
          : name.replaceAll('_', ' ');
  const kind = name === 'view' || name === 'search' ? name : READS.has(name) ? 'read' : 'other';
  await took((await wholeMap(l)).db, l, { kind, actor: actor.name, did, hash: id ? `e/${id}` : name === 'view' && input.name === 'lens' ? 'graph?lens' : undefined });
}

/**
 * History as an agent reads it: a long value before or after an edit (a note,
 * mostly) is cut to its start and its length, so an item edited ten times does
 * not answer with its note twenty times over. A change set logs one event for
 * each thing it touched, all with the same reason and authority: those are
 * said on the first of them only. `full` asks for all of it.
 */
function shortHistory<T>(events: T[]): T[] {
  const cut = (v: unknown) => (typeof v === 'string' && v.length > 300 ? `${v.slice(0, 200)}… (${v.length} characters; ask again with full: true for all of it)` : v);
  const said = new Set<string>();
  return events.map((ev) => {
    const { changeset, detail } = ev as { changeset?: string | null; detail?: { changes?: Record<string, { from: unknown; to: unknown }>; authority?: unknown } | null };
    const again = Boolean(changeset && said.has(changeset));
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
      ...(cut && { ready_count: open.ready.length, blocked_count: open.blocked.length, more: `The first ${HANDOFF_LISTED} of each: view repo_work has them all.` }),
    };
  }
  return out;
}

const FULL = z.boolean().optional().describe('true to be given the history whole: long notes, and the reason and authority on every event of a change set. Left out, an agent is given the start of each note and its length, and a change set’s reason and authority on the first of its events only.');

/**
 * Changes an agent sent that were refused, kept for a few minutes so that correcting one op does not mean writing
 * seventy out again. Kept in the workspace's database, so the retry may reach another server than the change did.
 */
const REFUSED_MINUTES = 10;
type Refused = { who: string; input: Record<string, unknown> & { ops: unknown[] } };

export const TOOLS: Record<string, Tool> = {
  schema: {
    description: 'Describe the map\'s model: every entity type with its statuses and the fields you set, and every relation with its ends. Read this before writing. With type (a type, a relation or a pack): those whole, each field explained; full: true for everything, screens and verbs too.',
    input: { type: z.string().optional().describe('A type, a relation or a pack, by its id as the brief lists it.'), full: z.boolean().optional() },
    run: async (l, actor, input) => input.type ? schemaOf(l.registry.describe(), input.type) : actor.kind === 'human' || input.full ? withStyles(l, await withScreens(l, l.registry.describe())) : schemaBrief(l.registry),
  },
  search: {
    description: 'Find entities by text, type (flavours included), status or owner. Text matches words in any form in titles and notes, and titles that are nearly what you typed; the best match comes first. Always search before creating, to avoid duplicates.',
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
    description: 'One entity in full: its fields, the source it came from, where it sits (trail: what it is part of, outermost first, each with the views kept about it), what names it in its text or fields (mentioned_in), the pictures it is drawn in (shown_in: views kept about what it sits in, with the documents that bring them in) and its relations in both directions. Its recent history too, when asked for with history: true.',
    input: { id: z.string(), history: z.boolean().optional().describe('true to be given the last changes to it as well (recent_events).'), full: FULL },
    run: async (l, actor, input) => {
      const found = { ...(await l.get(input.id)), shown_in: [] as Awaited<ReturnType<typeof shownIn>> };
      found.shown_in = await shownIn(l, input.id, found.trail);
      if (actor.kind === 'human' || input.full) return found;
      // An agent mostly wants the item; its history is several times the size, so it is given when asked for.
      const { recent_events, ...item } = found;
      return input.history ? { ...item, recent_events: shortHistory(recent_events) } : item;
    },
  },
  view: {
    description:
      'Answer one of the standing questions. Call with no name to list them. An agent is given each answer without its empty fields and with long lists cut to what is read (params.full: true for all of it). ' +
      Object.entries(VIEWS)
        .map(([name, v]) => `${name}: ${v.description}`)
        .join(' ') + ' The packs here add their own (the repository views handoff, repo_work, recheck and agent_usage are the software pack\u2019s): call with no name for all of them.',
    input: {
      name: z.string().optional(),
      params: props.optional(),
    },
    run: async (l, actor, input) => {
      if (!input.name) return viewList(l);
      const answer = await askView(l, actor, input.name, input.params ?? {});
      if (actor.kind !== 'agent' || input.params?.full) return answer;
      // A view that answers with events (changed_since) is history, and is cut for an agent as history is.
      const events = (answer as { events?: unknown } | null)?.events;
      return forAgent(input.name, Array.isArray(events) ? { ...(answer as object), events: shortHistory(events) } : answer);
    },
  },
  events: {
    description: 'The activity log, newest first: every change to the map and every imported external tool call, with who did it and why. A change set logs an event for each thing it touched; its reason and authority are on the first of them.',
    input: {
      since: z.string().optional().describe('ISO date-time.'),
      target: z.string().optional().describe('An entity id.'),
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
  pulse: {
    description: 'A stamp that moves whenever the map or the review queue changes. The web UI watches it to know when to redraw.',
    humanOnly: true,
    input: {},
    run: async (l) => {
      const [p, { told, ...seen }] = await Promise.all([l.pulse(), presence((await wholeMap(l)).db, l)]);
      return { stamp: `${p.stamp}.${told}`, ...seen, ui: uiStamp() };
    },
  },
  backup: {
    description: 'Back every workspace up now, without waiting for the schedule. Do this before anything that changes the database schema. Answers with what was written.',
    input: {},
    run: async () => {
      if (!backUp) throw new Error('Backups are turned off on this server.');
      return backUp();
    },
  },
  import_backup: {
    description:
      'Merge a backup file into this workspace, matching by id. Nothing is deleted: what the file has and this map lacks is added; an entity on both sides keeps whichever was edited later; ' +
      'a relation ended or a proposal decided on either side is ended or decided; the file’s history is added to the activity log. Tokens and settings are not touched, and sessions still open in the file are left out. ' +
      'Without `apply` nothing changes and the answer says what would. With it, the server backs up first. Admins only.' +
      ' If the file\u2019s owner and this workspace\u2019s are different people entities, the answer names both as `owners`; see `same_owner`.',
    humanOnly: true,
    input: {
      backup: z.string().min(1).describe('The backup file (.json.gz) in base64.'),
      apply: z.boolean().optional().describe('Do it. Leave out to see what it would do.'),
      same_owner: z
        .boolean()
        .optional()
        .describe('When the answer names two `owners`: they are one person. This workspace\u2019s owner becomes the person in the file, with their tokens and everything private to them, so later imports of the same map line up.'),
    },
    run: async (l, actor, input) => {
      needAdmin(actor, 'import a backup');
      const file = parseBackup(Buffer.from(input.backup, 'base64'));
      // Everything in the file goes in, whoever it is private to: this is the map as a whole, as a backup is.
      const whole = await wholeMap(l);
      const defined = ((file.local_pack as { types?: TypeDef[] } | null)?.types ?? []).filter((t) => !whole.registry.types.has(t.id));
      const known = new Set([...whole.registry.types.keys(), ...defined.map((t) => t.id)]);
      const unknown = [...new Set((file.tables?.entity ?? []).map((e) => e.type as string))].filter((t) => !known.has(t));
      if (unknown.length) throw new Error(`The file uses types this server does not have: ${unknown.join(', ')}. Install the pack that defines them first.`);
      const backed_up_first = input.apply ? Boolean(backUp && (await backUp())) : undefined;
      // The file's own types first, in the order they were defined: its entities need them.
      if (input.apply) for (const def of defined) await whole.registry.defineLocal(def);
      // A map brought from elsewhere has its own person for its owner. If that is
      // who owns this workspace too, the two can be made one.
      const theirs = file.tables?.setting?.find((s) => s.key === 'me')?.value as string | undefined;
      const mine = await whole.setting<string>('me');
      const their = theirs && mine && theirs !== mine ? file.tables.entity?.find((e) => e.id === theirs) : undefined;
      const my = their ? await whole.entity(mine!) : undefined;
      const owners = their && my && !my.archived_at ? { here: { id: my.id, title: my.title }, file: { id: theirs!, title: their.title as string }, made_one: false } : undefined;
      const report = await merge(whole.db, file, { workspace: l.workspace, sessionTypes: whole.registry.family('sys.run'), apply: input.apply });
      if (input.apply && input.same_owner && owners) {
        await whole.apply(actorId(actor), { ops: [{ op: 'merge', keep: owners.file.id, drop: owners.here.id }], reason: 'The owner here and the owner in the imported backup are one person' });
        // Who they are goes with them: their tokens, what is private to them, and owning the workspace.
        await whole.db.transaction(async (tx) => {
          await tx.query(`update token set entity_id = $1 where entity_id = $2`, [owners.file.id, owners.here.id]);
          for (const table of ['entity', 'proposal', 'event']) await tx.query(`update ${table} set private_to = $1 where private_to = $2`, [owners.file.id, owners.here.id]);
          await tx.query(`update setting set value = to_jsonb($1::text) where key = 'me'`, [owners.file.id]);
        });
        owners.made_one = true;
      }
      if (input.apply) {
        await whole.log(whole.db, {
          actor: actorId(actor),
          action: 'workspace.import',
          reason: `Merged the backup of "${file.workspace?.name}" taken ${file.taken}`,
          detail: { from: file.workspace, taken: file.taken, first_seq: report.events.first_seq, last_seq: report.events.last_seq, entities: report.entities, relations: report.relations },
        });
      }
      return { ...report, owners, types_added: defined.map((t) => t.id), backed_up_first };
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
    run: async (l, _actor, input) => {
      if (input.after === undefined) return { latest: await latestSeq(l), changes: [] };
      const until = Date.now() + (input.wait_seconds ?? 0) * 1000;
      // Counted on every server, so the web UI can say whether anyone will hear a decision the moment it is made.
      const { db } = await wholeMap(l);
      await listening(db, l.workspace, 1);
      try {
        for (;;) {
          const changes = await humanChanges(l, input.after);
          if (changes.length || Date.now() >= until) return { latest: changes.at(-1)?.seq ?? input.after, changes };
          await new Promise((r) => setTimeout(r, 1000));
        }
      } finally {
        await listening(db, l.workspace, -1).catch(() => {});
      }
    },
  },
  show: {
    description:
      'Point the human\'s web UI at something, so they can follow what you are doing: an entity, a screen (optionally "of" one entity: the graph around it, or a project\'s roadmap), or a picture of the map (a lens, with a style). ' +
      'Their page goes there within a couple of seconds if they have "Follow agents" on. Add a short note saying what they are looking at. ' +
      'An applied or proposed change already points the UI at what it touched; use this for everything else, and before a step worth watching.',
    input: {
      entity: z.string().optional().describe('An entity id: open its page.'),
      screen: z.enum(['today', 'review', 'map', 'graph', 'roadmap', 'questions', 'automations', 'activity', 'workspace']).optional(),
      of: z.string().optional().describe('With screen graph, roadmap or questions: the entity (for the last two, a project) it is drawn for.'),
      lens: z
        .record(z.string(), z.unknown())
        .optional()
        .describe('A picture of the map, drawn on the graph screen for this one look: the params of the lens view (from, story, kinds, by, over, far, lanes, order, measure, fold). {} is the whole map as it opens; story: a run id draws what that session told of.'),
      style: z
        .object({
          lit: z.enum(['all', 'you', 'blocked']).optional().describe('What stays lit: everything, only what waits on the person looking, or only what is blocked.'),
          shape: z.enum(['list', 'flow', 'grid', 'time', 'architecture']).optional().describe('One of the built-in drawings. list: each thing one line, what holds others a box that folds. flow: a process map, top down, wires at right angles. grid: rows by what the start holds, columns by lane, each thing a card. time: along the lens\x27s time axis, a calendar or bars. architecture: a system, each part a box inside a box for where it runs, wires down to what it calls, each part and wire marked with its health.'),
          id: z.string().optional().describe('A style kept on the map (an item of type style), drawn with for this one look.'),
        })
        .optional()
        .describe('How the picture is drawn, for this one look. The style a picture opens in is kept on the map: an item of type style, about the project or item it is for, or about nothing for the whole workspace; change it with change.'),
      note: z.string().max(200).optional().describe('One line shown beside the page.'),
    },
    run: async (l, actor, input) => {
      if (input.lens || input.style) {
        // Read as the lens view reads it, so a lens the page could not draw is refused here and not on the owner's screen.
        const asked = readLens(l, input.lens ?? {});
        if (asked.from && !(await l.entity(asked.from))) throw new Error(`No entity "${asked.from}"`);
        const query = new URLSearchParams();
        for (const [key, value] of Object.entries(input.lens ?? {})) if (key in asked || key === 'lens') query.set(key, Array.isArray(value) ? value.join(',') : String(value));
        if (input.style?.lit) query.set('lit', input.style.lit);
        if (input.style?.shape) query.set('shape', input.style.shape);
        if (input.style?.id) query.set('style', input.style.id);
        // The address always says it is a lens: the graph screen without one is still the old drawing.
        return point(l, actor, 'show', `graph?${query.size ? query : 'lens'}`, input.note);
      }
      if (!input.entity && !input.screen) throw new Error('show needs "entity", "screen" or "lens".');
      return point(l, actor, 'show', input.entity ? `e/${input.entity}` : input.of ? `${input.screen}/${input.of}` : input.screen, input.note);
    },
  },
  change: {
    description:
      'The only way to change the map. Send a list of ops (create, update, link, unlink, archive, restore, merge, define_type) with the reason. ' +
      'Creates can carry a ref so later ops in the same change can link to them, and a title or note in the same change can name what it makes: write {ref} and it becomes that item\u2019s id. Give the source the facts came from. ' +
      'To add to a note or change one passage of it, send append or replace on the update, not the whole body again. ' +
      'An update that changes nothing (only the id) says you checked the item and it is still true as written: it records when it was last known true. ' +
      'The change is validated as a whole; depending on policy it is applied at once or held as a proposal for a human. ' +
      'A change that is refused is kept for a few minutes under a name the refusal gives: correct it with retry and fixes (the ops that were wrong, by number) instead of sending it all again. ' +
      'Keep the map true as you work: when what you did or found settles something that is still open (a task done, an experiment run, a decision made in practice, a hypothesis borne out or not), change its status in the same breath, with the outcome and the evidence, instead of leaving it open with a note. ' +
      'Closing a decision or a hypothesis is held for the human to confirm, so propose the answer freely: it costs them one click. Only in a workspace set to apply agents\u2019 changes does it take effect at once: then a decision must carry what was chosen (props.outcome) and why (props.rationale), it is put to the owner by the next session they talk to (attention, reason to_confirm), and it is yours to get right. Settle what the work or the owner has in fact settled; a choice that is still the owner\u2019s to make stays open.',
    input: {
      ops: z.array(op).min(1).optional().describe('What to change. Needed, except with retry.'),
      reason: z.string().min(1).optional().describe('Why this change is being made. Shown in the activity log. Needed, except with retry.'),
      retry: z.string().optional().describe('The name a refused change was kept under (the refusal gives it). The change is sent again as it was, with fixes put in: send only retry and fixes.'),
      fixes: z
        .array(z.object({ at: z.number().int().positive().describe('The op’s number as the refusal counted it, from 1.'), op: op.nullable().describe('The whole op as it should be; null to leave it out.') }))
        .optional()
        .describe('With retry: the ops to put in place of the ones that were wrong.'),
      source: source.optional().describe('Where these facts came from. Individual ops can override it.'),
      authority: z
        .object({
          of: z.enum(['human', 'agent']).describe('"human" when a person told you to make this change or decided what it records; "agent" when it is your own judgment of the work.'),
          basis: z.string().optional().describe('For "human": what they said and where (required). For "agent": what you saw that it rests on.'),
        })
        .optional()
        .describe('On whose authority this change is made. Kept on every event it logs. Left out, it is recorded as your own judgment; settling a decision or hypothesis needs it said.'),
      hold: z.boolean().optional().describe('true to have this change wait for the human even where agents\u2019 changes are applied as made: for something you want looked at before it takes effect.'),
    },
    run: async (l, actor, { retry, fixes, ...given }) => {
      // Whose it is: the token's, not the name a session gives itself, which it may leave out the second time.
      const who = `${l.workspace}:${actor.token ?? ''}`;
      let input = given;
      if (retry) {
        const kept = await keptFor<Refused>((await wholeMap(l)).db, `refused:${retry}`);
        if (!kept || kept.who !== who) throw new Error(`No refused change is kept as "${retry}": one is kept for ${REFUSED_MINUTES} minutes. Send the change whole.`);
        const ops = [...kept.input.ops];
        for (const fix of fixes ?? []) {
          if (fix.at > ops.length) throw new Error(`Change rejected:\n- fixes: the change kept as "${retry}" has ${ops.length} ops, so there is no op ${fix.at}.`);
          ops[fix.at - 1] = fix.op;
        }
        // What is said again (a reason, an authority) stands in for what was kept.
        input = { ...kept.input, ...Object.fromEntries(Object.entries(given).filter(([, v]) => v !== undefined)), ops: ops.filter(Boolean) };
      }
      if (!input.ops?.length) throw new Error('A change needs ops, or retry with the name a refused change was kept under.');
      if (!input.reason) throw new Error('Every change needs a reason.');
      let result;
      try {
        // Agents write sentences where a name is wanted, and every row and box then has to cut them. Held to a length here,
        // where an agent names things; a person may name a thing as they like, and an undo puts back what was there.
        if (actor.kind === 'agent') {
          const long = (input.ops as { op: string; title?: string }[]).flatMap((o, i) =>
            (o.op === 'create' || o.op === 'update') && o.title && o.title.trim().length > TITLE_MAX
              ? [`op ${i + 1} (${o.op}): the title is ${o.title.trim().length} characters. A title is a name, not a sentence: ${TITLE_MAX} at most. Name the thing in a few words and put the rest in its note.`]
              : [],
          );
          // A note every session adds to (a handoff) is read whole by every session after it. Its type may hold it to a length
          // an agent can only keep by rewriting it (note_max); one that is already over may always be made shorter.
          for (const [i, o] of (input.ops as { op: string; type?: string; id?: string; body?: string; append?: string; replace?: { find: string; with: string } }[]).entries()) {
            let before = 0;
            let after = 0;
            let type = o.op === 'create' ? l.registry.type(o.type ?? '') : undefined;
            if (o.op === 'create') after = o.body?.length ?? 0;
            else if (o.op === 'update' && (o.body !== undefined || o.append !== undefined || o.replace)) {
              const target = await l.entity(o.id!);
              if (!target || !(type = l.registry.type(target.type))) continue;
              before = target.body.length;
              try {
                after = bodyAfter(target.body, o as Parameters<typeof bodyAfter>[1]).length;
              } catch {
                continue; // what is wrong with the op is said by the change itself
              }
            }
            if (type?.noteMax && after > type.noteMax.chars && after > before) long.push(`op ${i + 1} (${o.op}): the ${type.title.toLowerCase()} note would be ${after} characters: ${type.noteMax.chars} at most.${type.noteMax.say ? ` ${type.noteMax.say}` : ''}`);
          }
          if (long.length) throw new Error(`Change rejected:\n- ${long.join('\n- ')}`);
        }
        result = await l.change(actor, input);
      } catch (err) {
        const message = (err as Error).message;
        if (actor.kind !== 'agent' || !message.startsWith('Change rejected')) throw err;
        // A refused change is kept, so that what is wrong with one op is all that has to be sent again.
        const name = retry ?? `k_${Math.random().toString(36).slice(2, 10)}`;
        await keep((await wholeMap(l)).db, `refused:${name}`, { who, input } satisfies Refused, REFUSED_MINUTES * 60_000);
        throw new Error(
          `${message}\nNothing was changed. The change is kept for ${REFUSED_MINUTES} minutes as "${name}": to correct it, send change with only retry: "${name}" and fixes: [{ at: <the op’s number>, op: <the whole op as it should be> }]. Every other op is sent as it was.`,
        );
      }
      if (retry) await take((await wholeMap(l)).db, `refused:${retry}`);
      // A question an agent settled is not left for the human to come across: it is put to them by the next session
      // they talk to (attention, reason to_confirm, and the handoff), all of them in one list, not a notification for each.
      // The human's screen follows an agent's change: to Review when it waits
      // there, otherwise to the first thing it made or touched.
      if (actor.kind === 'agent') {
        const made = 'created' in result ? Object.values(result.created as Record<string, string>)[0] : undefined;
        const touched = (input.ops as { id?: string }[]).find((o) => o.id)?.id;
        const target = made ?? touched;
        // A lens or a style that was changed is seen in the picture it changes, not on its own page.
        const picture = result.status !== 'proposed' && target ? await pictureOf(l, target) : undefined;
        await point(l, actor, 'change', result.status === 'proposed' ? 'review' : (picture ?? (target ? `e/${target}` : 'activity')), input.reason).catch(() => {});
      }
      return result;
    },
  },
  undo: {
    description:
      'Reverse one change set (its id is on every event it logged) by applying the opposite as a new change: created entities are archived, edits put back, links removed or restored. An edit changed again since is left alone and reported. Subject to the same policy as any change.',
    input: { changeset: z.string() },
    run: async (l, actor, input) => undo(l, actor, input),
  },
  claim: {
    description:
      'Take a resource before using it, e.g. the one live app session. Fails, naming the current holder, if an exclusive resource is already held. Takes effect at once.',
    input: {
      resource: z.string(),
      holder: z.string().describe('Id of the run, agent or person taking it.'),
      for: z.string().optional().describe('Id of the task it is being held for; that task is then not shown as blocked.'),
      reason: z.string().min(1),
    },
    run: async (l, actor, input) => l.claim(actor, input),
  },
  release: {
    description: 'Give a resource back when done. Takes effect at once.',
    input: {
      resource: z.string(),
      holder: z.string().optional().describe('Release only this holder\'s claim. Omit to release all.'),
      reason: z.string().min(1),
    },
    run: async (l, actor, input) => l.release(actor, input),
  },
  session_start: {
    description:
      'Register this agent session in the map so the human can see it. Give the task you are working on if there is one: any exclusive resource that task needs is claimed for you, or you are told who holds it. Takes effect at once.',
    input: {
      title: z.string().optional().describe('A few words on what this session is for.'),
      task: z.string().optional().describe('Id of the entity being worked on.'),
      surface: z.string().optional().describe('Where you are running, e.g. claude-code, claude-desktop.'),
      cwd: z.string().optional().describe('Your working directory. Used to find the repository.'),
      remote: z.string().optional().describe('The address the checkout was cloned from (git remote origin). Finds the repository on any machine; the directory is used when this is not given or not known.'),
      session_id: z.string().optional().describe('The id your surface gave this session, if you know it. Makes this call safe to repeat.'),
    },
    run: async (l, actor, input) => sessionStart(l, actor, input),
  },
  session_update: {
    description: 'Report in from a registered session: a note worth keeping, a change to waiting or running, or a task you have picked up. With only the run, it is a heartbeat.',
    input: {
      run: z.string().describe('The run id from session_start, or the session id.'),
      status: z.enum(['running', 'waiting']).optional(),
      note: z.string().optional().describe('What happened, what you found, or what you are blocked on.'),
      task: z.string().optional(),
    },
    run: async (l, actor, input) => sessionUpdate(l, actor, input),
  },
  tell: {
    description:
      'Tell the story of your session as you work, so the owner sees what you see: one beat at a time, what you have concluded and why, in a sentence (said), the items it is about, and the ties between them you want seen (links, each saying in a few words what ties the two: "blocks", "is why", "same fault as"). Tell what matters, not every step: a cause, a choice and its reason, what stands in the way. Your session’s page opens on your finding: send finding: true with what you have found so far, said whole for someone who has read nothing else (a few plain sentences: the point, what it rests on, what is left; item ids in it are shown as their names), its items and the ties between them, which are its picture. Send a new finding whenever what you have found changes; the beats are the history under it. When you change your mind, take the old beat back with replaces (its number) and say what you think now. Takes effect at once.',
    input: {
      run: z.string().describe('The run id from session_start, or the session id.'),
      said: z.string().min(1).describe('What you concluded and why, in a sentence or two: 280 characters at most.'),
      about: z.array(z.string()).optional().describe('Ids of the items it is about; the ends of links are added for you.'),
      links: z
        .array(z.object({ from: z.string(), to: z.string(), says: z.string().describe('What ties them, in a few words.') }))
        .optional()
        .describe('Ties to draw between items, as you see them; the map’s own links between the items are drawn too.'),
      replaces: z.number().int().positive().optional().describe('The number of an earlier beat this one takes back.'),
      finding: z.boolean().optional().describe('true: this is what the session has found, said whole (600 characters at most); its page opens on the latest.'),
    },
    run: async (l, actor, input) => {
      const answer = await tell(l, actor, input);
      const { db } = await wholeMap(l);
      await tellStamp(db, l.workspace);
      await took(db, l, { kind: 'story', actor: actor.name, did: input.said, hash: `e/${answer.run}` }, true);
      return answer;
    },
  },
  run_report: {
    description:
      'Record a run that happened where Archipelago cannot watch it, once it is over: the agent in GitHub Actions that read a push or re-checked the map says what it was, how it ended and what it used. Kept as a run that has ended, in its repository. Takes effect at once.',
    input: {
      repo: z.string().describe('The repository it ran for: its id or its GitHub name "owner/name".'),
      title: z.string().min(1).describe('What the run was, in a few words.'),
      ok: z.boolean().optional().describe('false when it failed.'),
      tokens: z.number().optional().describe('Tokens it used: input and output, not counting cached re-reads.'),
      cost_usd: z.number().optional(),
      turns: z.number().optional(),
      link: z.string().optional().describe('Where the run can be looked at.'),
      summary: z.string().optional().describe('What it said it did.'),
      surface: z.string().optional().describe('Where it ran. Left out: github-actions.'),
    },
    run: async (l, actor, input) => recordRun(l, actor, input),
  },
  picture_put: {
    description:
      'Keep a picture for one item: the picture a test drew, for its test result, or a figure for a note or file, which a document that brings the note in shows above its text, or a still of a lens, which a link to a document shows where the app draws the lens live. A test result\u2019s only when the result is shown in public: until then the picture stays in the repository it was made in, and the result says where (its picture field). One picture per item, PNG, JPEG or WebP, 1 MB at most; sent again it replaces what was kept, and when a test is run again (test_report) what was kept for its result is removed. Takes effect at once.',
    input: {
      result: z.string().describe('The id of the test result, or of the note or file the figure belongs to.'),
      data: z.string().min(1).describe('The file, as base64.'),
      content_type: z.enum(['image/png', 'image/jpeg', 'image/webp']),
    },
    run: async (l, actor, input) => putPicture(l, actor, input),
  },
  picture: {
    description: 'The picture kept for a test result, or the figure kept for a note or file, as base64 with its content type, or null when none is kept (the proof view says which results have one: stored; the document tool, which sections have a figure).',
    input: { result: z.string().describe('The id of the test result, note or file.') },
    run: async (l, _actor, input) => getPicture(l, input),
  },
  session_end: {
    description:
      'Close a registered session with its outcome and a summary. Everything it held is released. A session that finishes in a repository is first shown that repository\'s open work nobody has changed since it began (answer: ended false, with the list): change what is done or no longer as written, name what you checked and found still true in still_true, name what this session had nothing to do with and cannot check in cannot_tell (cannot_tell_rest: true for all the rest), and call again. What waits on a person’s answer (waits_on), or has a change of its own waiting for the human, is not asked about.',
    input: {
      run: z.string().describe('The run id from session_start, or the session id.'),
      outcome: z.enum(['finished', 'failed', 'cancelled']).optional(),
      summary: z.string().optional().describe('What was done and what is left.'),
      still_true: z.array(z.string()).optional().describe('Ids of open items you have checked and found still true as written.'),
      cannot_tell: z.array(z.string()).optional().describe('Ids of open items this session had nothing to do with and cannot check from where it is. They are left as they were, and the session says it did not check them.'),
      cannot_tell_rest: z.boolean().optional().describe('true when every open item you have not changed or named is one this session had nothing to do with: all of them are left as they were, and the session says how many it did not look at.'),
    },
    run: async (l, actor, input) => {
      // An agent says where the repository's work stands; the human ending a session from the UI is not asked.
      const result = await sessionEnd(l, actor, { ...input, reconcile: actor.kind === 'agent' });
      if ('ended' in result) return result;
      // If this server started the session's process, stop that too.
      return { ...result, process_stopped: stopLaunched(result.run) };
    },
  },
  notify: {
    description: 'Send the human a notification: something they should know or act on that is not itself a change to the map. Shown on their Home screen until read. Use sparingly.',
    input: {
      title: z.string().min(1).describe('The whole message in one line if possible.'),
      body: z.string().optional(),
      level: z.enum(['info', 'warning', 'urgent']).optional(),
      about: z.string().optional().describe('Id of the entity it concerns.'),
    },
    run: async (l, actor, input) => notify(l, actor, input),
  },
  check_connections: {
    description: 'Ping every connection (external tool) and record whether it is reachable. Work that needs an unreachable connection shows as blocked.',
    input: {},
    run: async (l, actor) => l.checkConnections(actor),
  },
  rechecked: {
    description:
      'Say that the scheduled re-check of a repository has been done: each project (or feature living there on its own) that was waiting for one starts its interval again (its recheck_days). Call it once, after you have changed or confirmed the items the recheck view gave you. Takes effect at once.',
    input: {
      repo: z.string().describe('The repository: its id, its GitHub name "owner/name", or its title.'),
      summary: z.string().optional().describe('What was checked and what was found.'),
    },
    run: async (l, actor, input) => {
      const projects = ((await askView(l, actor, 'recheck', { repo: input.repo, limit: 0 })) as { projects: { id: string; title: string; waited: boolean }[] }).projects.filter((p) => p.waited);
      const at = new Date().toISOString();
      for (const p of projects) {
        // Bookkeeping stays out of the project's history; the re-check itself is the event.
        await l.db.query(`update entity set props = props || jsonb_build_object('rechecked_at', $2::text) where id = $1`, [p.id, at]);
        await l.log(l.db, { actor: actorId(actor), action: 'recheck.done', target: p.id, reason: input.summary ?? 'Scheduled re-check of the oldest open items' });
      }
      return { rechecked: projects.map((p) => ({ id: p.id, title: p.title })), at };
    },
  },
  import_audit: {
    description: 'Copy new entries from a connection\'s tool-call log into the activity log, so actions taken in that tool are visible here.',
    input: { connection: z.string() },
    run: async (l, actor, input) => l.importAudit(actor, input),
  },
  launch: {
    description:
      'Start a headless Claude Code session on a task, in the task\u2019s repository, with its brief as the prompt. The session is registered first, so it holds any exclusive resource the task needs, or the launch is refused.',
    humanOnly: true,
    input: {
      task: z.string(),
      mode: z.enum(['plan', 'acceptEdits']).optional().describe('plan (default): read and investigate only. acceptEdits: may edit files in the repository.'),
      instructions: z.string().optional().describe('Anything to add to the brief.'),
    },
    run: async (l, actor, input) => launch(l, actor, input),
  },
  ...PACK_STATE_TOOLS, ...SHARE_TOOLS, ...BACKUP_TOOLS, ...REPORT_TOOLS,
  ...TOKEN_TOOLS, ...ASK_TOOLS, ...MEMBER_TOOLS, ...SERVER_PACK_TOOLS,
  notify_workspace: {
    description: 'Send a notification to another workspace on this server. It arrives only if that workspace\u2019s admin has chosen to accept notifications from this one.',
    humanOnly: true,
    input: {
      workspace: z.string().describe('The other workspace\u2019s id.'),
      title: z.string().min(1),
      body: z.string().optional(),
      level: z.enum(['info', 'warning', 'urgent']).optional(),
    },
    run: async (l, actor, input) => notifyWorkspace(l, actor, input),
  },
  github: {
    description:
      'This workspace and GitHub: whether pushes are being received, the address GitHub is to send them to, and for each repository in the map its GitHub name and when it was last pushed to. ' +
      'With new_secret, makes (or replaces) the secret GitHub signs with and shows it once; put it and the address into the repository\u2019s webhook settings, content type application/json, push events only. Admins only for that.',
    humanOnly: true,
    input: { new_secret: z.boolean().optional() },
    run: async (l, actor, input) => {
      if (!input.new_secret) return githubStatus(l);
      needAdmin(actor, 'connect GitHub');
      const whole = await wholeMap(l);
      const secret = await newGithubSecret(whole);
      return { ...(await githubStatus(whole)), secret, note: 'Keep this secret now: it is shown once. A secret made earlier no longer works.' };
    },
  },
  github_app: {
    description:
      'This workspace and the server\u2019s GitHub App: whether the server has its app, and whether this workspace has connected it (and as which GitHub account). ' +
      'create: where to go to create the app, once for the whole server (an admin of the default workspace only). connect: where to go to choose repositories on GitHub; each one chosen is put in the map and its pushes are heard from then on. ' +
      'disconnect: stop hearing from GitHub here (the app stays installed on GitHub until it is removed there). ' +
      'key: the Anthropic key the agent on this server runs on when it reads a push or re-checks old items (kept on the server, never shown again); forget_key removes it, and pushes are then recorded but not read. Admins only for all of these.',
    humanOnly: true,
    input: {
      create: z.boolean().optional(),
      connect: z.boolean().optional(),
      disconnect: z.boolean().optional(),
      key: z.string().min(20).optional().describe('An Anthropic API key.'),
      forget_key: z.boolean().optional(),
      recheck: z.string().optional().describe('A repository\u2019s id: have the agent on this server re-check its oldest open items against the code now, without waiting for one to be due. It runs on the workspace\u2019s key, and its run shows on the repository\u2019s page when it is over.'),
    },
    run: async (l, actor, input) => {
      const app = githubApp;
      const whole = await wholeMap(l);
      const status = async () => ({ available: Boolean(app), app: (await app?.app()) ?? null, can_create: Boolean(app) && !(await app!.app()) && Boolean(actor.admin) && l.workspace === 'default', installation: (await app?.installationOf(l.workspace)) ?? null, reader: { key: await hasReaderKey(whole), model: READER_MODEL } });
      if (!input.create && !input.connect && !input.disconnect && !input.key && !input.forget_key && !input.recheck) return status();
      if (!app) throw new Error('This server cannot have a GitHub App: it has nowhere to keep one.');
      needAdmin(actor, 'connect GitHub');
      if (input.recheck) {
        const mine = await app.installationOf(l.workspace);
        if (!mine) throw new Error('This workspace has not connected GitHub, so there is nothing for the agent to read the repository through.');
        if (!(await hasReaderKey(whole))) throw new Error('This workspace has no Anthropic key for the agent to run on. Set one on the Workspace screen.');
        const repo = (await readable(whole, app, mine.id)).find((r) => r.entity.id === input.recheck);
        if (!repo) throw new Error('That is not a repository the GitHub App was given. Choose it on GitHub first (Workspace, GitHub, Choose repositories).');
        const about = (await app.asInstallation(mine.id, `/repos/${repo.name}`)) as { default_branch?: string };
        // Not waited for: it takes minutes, and says what it did as a run when it is over.
        void recheck(whole, app, repo, about.default_branch ?? 'main', true).catch((err) => console.error(`reader: re-check of ${repo.name} failed: ${(err as Error).message}`));
        return { ...(await status()), started: true };
      }
      if (input.key || input.forget_key) {
        const { checked } = await setReaderKey(whole, input.forget_key ? undefined : input.key);
        // The log says that it was set, and by whom: never the key.
        await l.log(l.db, { actor: actorId(actor), action: 'workspace.set', reason: input.forget_key ? 'Anthropic key removed' : 'Anthropic key set' });
        return { ...(await status()), ...(input.key && { note: checked ? 'Anthropic took the key.' : 'Saved, but Anthropic could not be reached to try it: the first push will tell.' }) };
      }
      if (input.create) {
        if (l.workspace !== 'default') throw new Error('The GitHub App belongs to the whole server: it is created from the default workspace, by its admin.');
        return { ...(await status()), url: await app.startCreate(l.workspace) };
      }
      if (input.connect) return { ...(await status()), url: await app.startConnect(l.workspace) };
      const mine = await app.installationOf(l.workspace);
      if (mine) {
        await app.forget(mine.id);
        await l.log(l.db, { actor: actorId(actor), action: 'github.disconnect', reason: `Stopped hearing from GitHub (${mine.account})` });
      }
      return status();
    },
  },
  workspace_info: {
    description: 'This workspace\u2019s settings: its id, its owner (null until one is set with init), the default visibility of new things, whether agents’ changes are applied as they are made or held for a human, and which workspaces it accepts notifications from.',
    humanOnly: true,
    input: {},
    run: async (l) => {
      const { rows } = await l.db.query<{ id: string; title: string }>(`select e.id, e.title from setting s join entity e on to_jsonb(e.id) = s.value where s.key = 'me'`);
      return { id: l.workspace, owner: rows[0] ?? null, default_visibility: await l.defaultVisibility(), agent_changes: await l.agentChanges(), accepts_from: await acceptedSenders(l), agent_backups: (await l.setting<boolean>('agent_backups')) === true, member_limit: (await limitOf(l.workspace)) ?? null };
    },
  },
  workspace_set: {
    description: 'Change workspace settings. default_visibility: whether new things are private to their author (the default) or shared unless they say otherwise. agent_changes: "apply" to have what agents change take effect as they make it, each change logged and undoable, or "hold" to have it wait for a human. With "apply" an agent can also settle a decision or a hypothesis: it must say what was chosen and why, and the human is notified. accepts_from: which other workspaces may send this one notifications. Admins only.',
    humanOnly: true,
    input: {
      default_visibility: z.enum(['private', 'shared']).optional(),
      agent_changes: z.enum(['apply', 'hold']).optional(),
      accepts_from: z.array(z.string()).optional().describe('Ids of the workspaces allowed to send this one notifications. Replaces the list.'),
      agent_backups: z.boolean().optional().describe('Whether agents may download the whole workspace as a backup file (backup_download), private items included.'),
    },
    run: async (l, actor, input) => {
      needAdmin(actor, 'change workspace settings');
      for (const [key, value] of Object.entries(input)) {
        await l.db.query(`insert into setting (key, value) values ($1, $2::jsonb) on conflict (key) do update set value = excluded.value`, [key, JSON.stringify(value)]);
        await l.log(l.db, { actor: actorId(actor), action: 'workspace.set', reason: `${key} set to ${JSON.stringify(value)}` });
      }
      return { id: l.workspace, default_visibility: await l.defaultVisibility(), agent_changes: await l.agentChanges(), accepts_from: await acceptedSenders(l), agent_backups: (await l.setting<boolean>('agent_backups')) === true };
    },
  },
  seen: {
    description: 'Record that you have looked at what agents changed, up to an event. It permits nothing: it is the mark that a human saw.',
    humanOnly: true,
    input: { upto: z.number().int().nonnegative().describe('The seq of the newest event looked at.') },
    run: async (l, actor, input) => {
      await l.log(l.db, { actor: actorId(actor), action: 'changes.seen', reason: 'Looked at what agents changed', detail: { upto: input.upto } });
      return { seen_upto: input.upto };
    },
  },
  confirmed: {
    description:
      'Record what the owner said, in chat, about the questions agents settled (view attention with reason to_confirm, or for_owner in the handoff): that they have been put to the owner and answered, up to an event. It is the owner\u2019s word as you report it, logged as that, and never the mark that a human looked. Change or reopen what they corrected with change, on their authority, before or after.',
    input: {
      upto: z.number().int().nonnegative().describe('The upto the list gave: the newest settling the owner was shown.'),
      basis: z.string().min(1).describe('What the owner said and where, in their words: "Owner in chat, 12 Oct: all fine but the pricing one".'),
    },
    run: async (l, actor, input) => {
      const asked = await toConfirm(l, { limit: 500 });
      const answered = asked.questions.filter((q) => q.seq <= input.upto).map((q) => q.id);
      await l.log(l.db, { actor: actorId(actor), action: 'questions.confirmed', reason: input.basis, detail: { upto: input.upto, questions: answered.length, authority: actor.kind === 'human' ? { of: 'human', who: actorId(actor) } : { of: 'human', basis: input.basis, stated_by: actorId(actor) } } });
      // The notices that said each one was settled have been answered with them.
      const { rows } = await l.db.query<{ id: string }>(
        `select n.id from entity n join relation r on r.from_id = n.id and r.type = 'about' and r.valid_to is null
         where r.to_id = any($1::text[]) and n.type = 'sys.notification' and n.is_open and n.archived_at is null and n.title like '% settled "%'`,
        [answered],
      );
      if (rows.length) await l.apply('agent:pelago', { ops: rows.map((n) => ({ op: 'update' as const, id: n.id, status: 'read' })), reason: 'Put to the owner and answered in chat' });
      return { confirmed_upto: input.upto, questions: answered.length, left: (await toConfirm(l)).count };
    },
  },
  restart: {
    description:
      'Dev mode only. Restart the server so it runs the code now on disk; use it after changing anything under src/ or packs/. ' +
      'Answers at once, then the server is away for a few seconds: wait for GET /health before the next call. Sessions it launched are stopped. ' +
      'If the new code does not start, the server comes back when a file under src/ or packs/ next changes; the reason is in runs/dev-server.log.',
    devOnly: true,
    input: {},
    run: async () => {
      restartServer!();
      return { restarting: true, log: 'runs/dev-server.log' };
    },
  },
  decide: {
    description: 'Apply a held change (approve: true) or decline it, with a note for whoever made it.',
    humanOnly: true,
    input: {
      proposal: z.string(),
      approve: z.boolean(),
      except: z.array(z.string()).optional().describe('Refs or "#n" op numbers to leave out when approving.'),
      note: z.string().optional(),
      ops: z.array(op).min(1).optional().describe('The reviewer’s corrected ops, replacing the proposed ones. Same order, so "#n" still lines up.'),
    },
    run: async (l, actor, input) => l.decide(actor, input),
  },
  init: {
    description: 'Set the workspace owner, creating their person entity if needed.',
    humanOnly: true,
    input: { name: z.string().min(1), email: z.string().optional() },
    run: async (l, actor, input) => {
      const result = await l.init(actor, input);
      // From now on this token is that person: their view, their private things.
      if (actor.token) await l.db.query(`update token set entity_id = $2 where id = $1 and entity_id is null`, [actor.token, result.me]);
      return result;
    },
  },
};

/** Every tool offered in a workspace: the kernel's, then those its packs declare (a kernel tool's name wins). */
export const toolsFor = (reg: Registry): [string, Tool][] => [...Object.entries(TOOLS), ...packTools(reg).filter(([t]) => !TOOLS[t])];

/** Validate input and run a tool. */
export async function callTool(l: Archipelago, actor: Actor, given: string, input: unknown): Promise<unknown> {
  const asked = FORMER_NAMES[given] ?? given;
  const name = TOOLS[asked] || l.registry.tools.has(asked) ? asked : (packActionByShort(l.registry, asked) ?? asked);
  const pack = packTool(l.registry, name);
  const tool: Tool | undefined = TOOLS[name] ?? pack;
  if (!tool) throw new Error(`No tool "${name}". Tools: ${toolsFor(l.registry).map(([t]) => t).join(', ')}`);
  if (tool.devOnly && !devMode()) throw new Error(`"${name}" is available only in dev mode (npm run dev).`);
  if (tool.humanOnly && actor.kind !== 'human') throw new Error(`"${name}" is for humans only.`);
  if (actor.may === 'report' && !tool.report) throw new Error(`This token may only report: it cannot call ${name}. Send what was measured with report.`);
  const parsed = z.strictObject(tool.input).safeParse(input ?? {});
  if (!parsed.success) throw new Error(`Invalid input for ${name}:\n${z.prettifyError(parsed.error)}`);
  // An agent whose token is within some items is held to them here, whatever the tool; what it writes, where every change is checked.
  const limited = actor.kind === 'agent' && Boolean(actor.within?.length);
  if (limited) await withinScope(l, actor, name, parsed.data as Record<string, unknown>);
  const answer =
    pack && !TOOLS[name] && limited
      ? await pack.run(l, actor, parsed.data, async (done) => {
          if (done.requests?.length) throw new Error(`This token is limited to some of the map: ${name} asks to act outside the map, which it cannot.`);
        })
      : await tool.run(l, actor, parsed.data);
  // A step that could not be kept costs the page a step, never the agent its answer.
  if (actor.kind === 'agent') await step(l, actor, name, parsed.data as Record<string, unknown>).catch(() => {});
  return answer;
}
