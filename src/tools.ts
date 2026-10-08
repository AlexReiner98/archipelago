// One table of tools serves both surfaces: agents reach them over MCP, humans
// over the CLI and local API. Same names, same inputs, same write path.

import { readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';
import { actorId, type Actor, type Lattice } from './lattice.ts';
import { createToken, listTokens, revokeToken } from './auth.ts';
import { merge, notImported, parseBackup } from './backup.ts';
import { githubStatus, newGithubSecret } from './github.ts';
import { launch, stopLaunched } from './launcher.ts';
import { notify } from './notify.ts';
import { acceptedSenders, notifyWorkspace, wholeMap } from './outbox.ts';
import type { TypeDef } from './packs.ts';
import { sessionEnd, sessionStart, sessionUpdate } from './sessions.ts';
import { undo } from './undo.ts';
import { VIEWS } from './views.ts';

const props = z.record(z.string(), z.unknown());
const visibility = z.enum(['private', 'shared']);
const confidence = z.number().min(0).max(1);
const field = z.object({
  type: z.enum(['string', 'number', 'boolean', 'date', 'datetime', 'url', 'enum', 'json']),
  values: z.array(z.string()).optional(),
  description: z.string().optional(),
  default: z.unknown().optional(),
});

const source = z.object({
  uri: z.string().describe('A stable address: file path, URL, message id or commit.'),
  title: z.string().optional(),
  kind: z.enum(['file', 'email', 'web', 'conversation', 'commit', 'other']).optional(),
  excerpt: z.string().optional().describe('The passage the facts were drawn from.'),
});
const opSource = source.optional().describe('Where this one fact came from, when it differs from the source of the whole change.');

const op = z.discriminatedUnion('op', [
  z.object({
    op: z.literal('create'),
    ref: z.string().optional().describe('A name for this new entity that later ops in the same change can use in place of an id.'),
    type: z.string(),
    title: z.string(),
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
    title: z.string().optional(),
    body: z.string().optional(),
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
      extends: z.string().optional().describe('Make this a flavour of an existing type; it inherits fields and statuses.'),
      statuses: z.object({ open: z.array(z.string()).min(1), closed: z.array(z.string()) }).optional(),
      fields: z.record(z.string(), field).optional(),
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
  run(l: Lattice, actor: Actor, input: any): Promise<unknown>;
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

export async function latestSeq(l: Lattice): Promise<number> {
  const { rows } = await l.db.query<{ seq: number }>(`select coalesce(max(seq), 0)::int as seq from event`);
  return rows[0].seq;
}

/** What humans have done since an event, oldest first: their edits, decisions, approvals and rejections. Reading a notification is not news. */
export async function humanChanges(l: Lattice, after: number): Promise<HumanChange[]> {
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
      return `- ${c.action} ${what}${fields ? `: ${fields}` : ''}${c.reason ? ` [${c.reason}]` : ''}`;
    })
    .join('\n');
}

// Agents waiting in `watch` to hear what the human does. Counted so the web UI
// can say whether anyone will hear a decision the moment it is made.
let listening = 0;

/** Where an agent last pointed the human's screen: a place in the web UI. */
interface Focus {
  /** When it was set; a new value is how the UI knows to move. */
  at: number;
  /** The UI address without its "#/", e.g. "e/e_abc" or "roadmap/e_abc". */
  hash: string;
  actor: string;
  note?: string;
}

// Kept in memory, per workspace and per person: it is where to look right now,
// not a fact about the map, and it means nothing after a restart.
const focus = new Map<string, Focus>();
const focusKey = (l: Lattice) => `${l.workspace}:${l.viewer ?? ''}`;
function point(l: Lattice, actor: Actor, hash: string, note?: string): Focus {
  const next = { at: Date.now(), hash, actor: actor.name, note };
  focus.set(focusKey(l), next);
  return next;
}

export const TOOLS: Record<string, Tool> = {
  schema: {
    description:
      'Describe the map\'s model: enabled packs, every entity type with its statuses and fields, and every relation type. Read this before writing.',
    input: {},
    run: async (l) => l.registry.describe(),
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
    description: 'One entity in full: its fields, the source it came from, its relations in both directions, and its recent history.',
    input: { id: z.string() },
    run: async (l, _actor, input) => l.get(input.id),
  },
  view: {
    description:
      'Answer one of the standing questions. Call with no name to list them. ' +
      Object.entries(VIEWS)
        .map(([name, v]) => `${name}: ${v.description}`)
        .join(' '),
    input: {
      name: z.string().optional(),
      params: props.optional(),
    },
    run: async (l, _actor, input) => {
      if (!input.name) return Object.fromEntries(Object.entries(VIEWS).map(([name, v]) => [name, v.description]));
      const view = VIEWS[input.name];
      if (!view) throw new Error(`No view "${input.name}". Views: ${Object.keys(VIEWS).join(', ')}`);
      return view.run(l, input.params ?? {});
    },
  },
  events: {
    description: 'The activity log, newest first: every change to the map and every imported external tool call, with who did it and why.',
    input: {
      since: z.string().optional().describe('ISO date-time.'),
      target: z.string().optional().describe('An entity id.'),
      actor: z.string().optional().describe('e.g. "agent:claude" or "human:local".'),
      origin: z.enum(['lattice', 'external', 'github']).optional(),
      limit: z.number().int().positive().optional(),
    },
    run: async (l, _actor, input) => l.events(input),
  },
  proposals: {
    description: 'List the changes held for a human, by status (default pending; "approved" is applied, "rejected" is declined). Agents can read these but only a human can decide them.',
    input: { status: z.enum(['pending', 'approved', 'rejected']).optional() },
    run: async (l, _actor, input) => l.proposals(input),
  },
  pulse: {
    description: 'A stamp that moves whenever the map or the review queue changes. The web UI watches it to know when to redraw.',
    humanOnly: true,
    input: {},
    run: async (l) => ({ ...(await l.pulse()), focus: focus.get(focusKey(l)), ui: uiStamp(), listening }),
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
      if (input.apply) for (const def of defined) whole.registry.defineLocal(def);
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
      listening++;
      try {
        for (;;) {
          const changes = await humanChanges(l, input.after);
          if (changes.length || Date.now() >= until) return { latest: changes.at(-1)?.seq ?? input.after, changes };
          await new Promise((r) => setTimeout(r, 1000));
        }
      } finally {
        listening--;
      }
    },
  },
  show: {
    description:
      'Point the human\'s web UI at something, so they can follow what you are doing: an entity, or a screen (optionally "of" one entity: the graph around it, or a project\'s roadmap). ' +
      'Their page goes there within a couple of seconds if they have "Follow agents" on. Add a short note saying what they are looking at. ' +
      'An applied or proposed change already points the UI at what it touched; use this for everything else, and before a step worth watching.',
    input: {
      entity: z.string().optional().describe('An entity id: open its page.'),
      screen: z.enum(['today', 'review', 'map', 'graph', 'roadmap', 'questions', 'automations', 'activity', 'workspace']).optional(),
      of: z.string().optional().describe('With screen graph, roadmap or questions: the entity (for the last two, a project) it is drawn for.'),
      note: z.string().max(200).optional().describe('One line shown beside the page.'),
    },
    run: async (l, actor, input) => {
      if (!input.entity && !input.screen) throw new Error('show needs "entity" or "screen".');
      return point(l, actor, input.entity ? `e/${input.entity}` : input.of ? `${input.screen}/${input.of}` : input.screen, input.note);
    },
  },
  change: {
    description:
      'The only way to change the map. Send a list of ops (create, update, link, unlink, archive, restore, merge, define_type) with the reason. ' +
      'Creates can carry a ref so later ops in the same change can link to them. Give the source the facts came from. ' +
      'The change is validated as a whole; depending on policy it is applied at once or held as a proposal for a human. ' +
      'Keep the map true as you work: when what you did or found settles something that is still open (a task done, an experiment run, a decision made in practice, a hypothesis borne out or not), change its status in the same breath, with the outcome and the evidence, instead of leaving it open with a note. ' +
      'Closing a decision or a hypothesis is always held for the human to confirm, so propose the answer freely: it costs them one click.',
    input: {
      ops: z.array(op).min(1),
      reason: z.string().min(1).describe('Why this change is being made. Shown in the activity log.'),
      source: source.optional().describe('Where these facts came from. Individual ops can override it.'),
    },
    run: async (l, actor, input) => {
      const result = await l.change(actor, input);
      // The human's screen follows an agent's change: to Review when it waits
      // there, otherwise to the first thing it made or touched.
      if (actor.kind === 'agent') {
        const made = 'created' in result ? Object.values(result.created as Record<string, string>)[0] : undefined;
        const touched = (input.ops as { id?: string }[]).find((o) => o.id)?.id;
        const target = made ?? touched;
        point(l, actor, result.status === 'proposed' ? 'review' : target ? `e/${target}` : 'activity', input.reason);
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
  session_end: {
    description: 'Close a registered session with its outcome and a summary. Everything it held is released.',
    input: {
      run: z.string().describe('The run id from session_start, or the session id.'),
      outcome: z.enum(['finished', 'failed', 'cancelled']).optional(),
      summary: z.string().optional().describe('What was done and what is left.'),
    },
    run: async (l, actor, input) => {
      const result = await sessionEnd(l, actor, input);
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
  member_add: {
    description: 'Add a person to this workspace: creates their (shared) person entity and a human token for them. Admins only.',
    humanOnly: true,
    input: {
      name: z.string().min(1),
      email: z.string().optional(),
      admin: z.boolean().optional().describe('May manage members, tokens and workspace settings.'),
    },
    run: async (l, actor, input) => {
      needAdmin(actor, 'add members');
      const { created } = await l.apply(actorId(actor), {
        ops: [{ op: 'create', ref: 'p', type: 'person', title: input.name, visibility: 'shared', props: input.email ? { email: input.email } : {} }],
        reason: 'Added to the workspace',
      });
      const token = await createToken(l.db, l.workspace, { kind: 'human', name: input.name, entity: created.p, admin: input.admin });
      return { person: created.p, token: token.token, note: token.note };
    },
  },
  token_create: {
    description:
      'Make a token. Anyone can make an agent token that acts for themselves: it sees what they see and proposes to them. Only an admin can make a token for someone else or for a human. The secret is shown once.',
    humanOnly: true,
    input: {
      kind: z.enum(['human', 'agent']),
      name: z.string().min(1).describe('Who or what will use it, e.g. "claude-code". Recorded against everything done with it.'),
      entity: z.string().optional().describe('Id of the person this token is, or acts for. Defaults to you.'),
      admin: z.boolean().optional(),
      expires_days: z.number().int().positive().optional(),
    },
    run: async (l, actor, input) => {
      const entity = input.entity ?? actor.person;
      if (input.kind === 'human' || input.admin || entity !== actor.person) needAdmin(actor, 'make a token for anyone but an agent acting for yourself');
      return createToken(l.db, l.workspace, { ...input, entity });
    },
  },
  token_list: {
    description: 'List tokens: an admin sees the whole workspace\u2019s, anyone else their own. Secrets are never shown.',
    humanOnly: true,
    input: {},
    run: async (l, actor) => listTokens(l.db, actor.admin ? undefined : (actor.person ?? '')),
  },
  token_revoke: {
    description: 'Revoke a token at once. An admin can revoke any; anyone else only their own.',
    humanOnly: true,
    input: { id: z.string() },
    run: async (l, actor, input) => revokeToken(l.db, input.id, actor.admin ? undefined : (actor.person ?? '')),
  },
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
  workspace_info: {
    description: 'This workspace\u2019s settings: its id, its owner (null until one is set with init), the default visibility of new things, whether agents’ changes are applied as they are made or held for a human, and which workspaces it accepts notifications from.',
    humanOnly: true,
    input: {},
    run: async (l) => {
      const { rows } = await l.db.query<{ id: string; title: string }>(`select e.id, e.title from setting s join entity e on to_jsonb(e.id) = s.value where s.key = 'me'`);
      return { id: l.workspace, owner: rows[0] ?? null, default_visibility: await l.defaultVisibility(), agent_changes: await l.agentChanges(), accepts_from: await acceptedSenders(l) };
    },
  },
  workspace_set: {
    description: 'Change workspace settings. default_visibility: whether new things are private to their author (the default) or shared unless they say otherwise. agent_changes: "apply" to have what agents change take effect as they make it, each change logged and undoable, or "hold" to have it wait for a human; settling a decision or hypothesis waits either way. accepts_from: which other workspaces may send this one notifications. Admins only.',
    humanOnly: true,
    input: {
      default_visibility: z.enum(['private', 'shared']).optional(),
      agent_changes: z.enum(['apply', 'hold']).optional(),
      accepts_from: z.array(z.string()).optional().describe('Ids of the workspaces allowed to send this one notifications. Replaces the list.'),
    },
    run: async (l, actor, input) => {
      needAdmin(actor, 'change workspace settings');
      for (const [key, value] of Object.entries(input)) {
        await l.db.query(`insert into setting (key, value) values ($1, $2::jsonb) on conflict (key) do update set value = excluded.value`, [key, JSON.stringify(value)]);
        await l.log(l.db, { actor: actorId(actor), action: 'workspace.set', reason: `${key} set to ${JSON.stringify(value)}` });
      }
      return { id: l.workspace, default_visibility: await l.defaultVisibility(), agent_changes: await l.agentChanges(), accepts_from: await acceptedSenders(l) };
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

/** Validate input and run a tool. */
export async function callTool(l: Lattice, actor: Actor, name: string, input: unknown): Promise<unknown> {
  const tool = TOOLS[name];
  if (!tool) throw new Error(`No tool "${name}". Tools: ${Object.keys(TOOLS).join(', ')}`);
  if (tool.devOnly && !devMode()) throw new Error(`"${name}" is available only in dev mode (npm run dev).`);
  if (tool.humanOnly && actor.kind !== 'human') throw new Error(`"${name}" is for humans only.`);
  const parsed = z.strictObject(tool.input).safeParse(input ?? {});
  if (!parsed.success) throw new Error(`Invalid input for ${name}:\n${z.prettifyError(parsed.error)}`);
  return tool.run(l, actor, parsed.data);
}
