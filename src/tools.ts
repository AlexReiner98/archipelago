// One table of tools serves both surfaces: agents reach them over MCP, humans
// over the CLI and local API. Same names, same inputs, same write path.

import { readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';
import { actorId, type Actor, type Lattice } from './lattice.ts';
import { createToken, listTokens, revokeToken } from './auth.ts';
import { launch, stopLaunched } from './launcher.ts';
import { notify } from './notify.ts';
import { acceptedSenders, notifyWorkspace } from './outbox.ts';
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

let restartServer: (() => void) | undefined;
/** Dev mode hands the tools a way to restart the process they run in. */
export function configureRestart(restart: (() => void) | undefined): void {
  restartServer = restart;
}
export const devMode = () => restartServer !== undefined;

/** Moves when any file of the web UI is saved, so an open page knows to load itself again. */
const UI_DIR = join(import.meta.dirname, '..', 'ui');
const uiStamp = () => Math.max(...readdirSync(UI_DIR).map((file) => statSync(join(UI_DIR, file)).mtimeMs));

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
    description: 'Find entities by text, type (flavours included), status or owner. Always search before creating, to avoid duplicates.',
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
      origin: z.enum(['lattice', 'external']).optional(),
      limit: z.number().int().positive().optional(),
    },
    run: async (l, _actor, input) => l.events(input),
  },
  proposals: {
    description: 'List proposed changes by status (default pending). Agents can read these but only a human can decide them.',
    input: { status: z.enum(['pending', 'approved', 'rejected']).optional() },
    run: async (l, _actor, input) => l.proposals(input),
  },
  pulse: {
    description: 'A stamp that moves whenever the map or the review queue changes. The web UI watches it to know when to redraw.',
    humanOnly: true,
    input: {},
    run: async (l) => ({ ...(await l.pulse()), focus: focus.get(focusKey(l)), ui: uiStamp() }),
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
      'The change is validated as a whole; depending on policy it is applied at once or held as a proposal for a human.',
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
    description: 'Send the human a notification: something they should know or act on that is not itself a change to the map. Shown on their Today screen until read. Use sparingly.',
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
  workspace_info: {
    description: 'This workspace\u2019s settings: its id, the default visibility of new things, and which workspaces it accepts notifications from.',
    humanOnly: true,
    input: {},
    run: async (l) => ({ id: l.workspace, default_visibility: await l.defaultVisibility(), accepts_from: await acceptedSenders(l) }),
  },
  workspace_set: {
    description: 'Change workspace settings. default_visibility: whether new things are private to their author (the default) or shared unless they say otherwise. accepts_from: which other workspaces may send this one notifications. Admins only.',
    humanOnly: true,
    input: {
      default_visibility: z.enum(['private', 'shared']).optional(),
      accepts_from: z.array(z.string()).optional().describe('Ids of the workspaces allowed to send this one notifications. Replaces the list.'),
    },
    run: async (l, actor, input) => {
      needAdmin(actor, 'change workspace settings');
      for (const [key, value] of Object.entries(input)) {
        await l.db.query(`insert into setting (key, value) values ($1, $2::jsonb) on conflict (key) do update set value = excluded.value`, [key, JSON.stringify(value)]);
        await l.log(l.db, { actor: actorId(actor), action: 'workspace.set', reason: `${key} set to ${JSON.stringify(value)}` });
      }
      return { id: l.workspace, default_visibility: await l.defaultVisibility(), accepts_from: await acceptedSenders(l) };
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
    description: 'Approve or reject a proposal.',
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
