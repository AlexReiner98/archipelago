// One table of tools serves both surfaces: agents reach them over MCP, humans
// over the CLI and local API. Same names, same inputs, same write path.

import { z } from 'zod';
import type { Actor, Lattice } from './lattice.ts';
import { launch, stopLaunched } from './launcher.ts';
import { notify } from './notify.ts';
import { sessionEnd, sessionStart, sessionUpdate } from './sessions.ts';
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

export interface Tool {
  description: string;
  input: z.ZodRawShape;
  /** Not offered to agents. */
  humanOnly?: boolean;
  run(l: Lattice, actor: Actor, input: any): Promise<unknown>;
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
  change: {
    description:
      'The only way to change the map. Send a list of ops (create, update, link, unlink, archive, merge, define_type) with the reason. ' +
      'Creates can carry a ref so later ops in the same change can link to them. Give the source the facts came from. ' +
      'The change is validated as a whole; depending on policy it is applied at once or held as a proposal for a human.',
    input: {
      ops: z.array(op).min(1),
      reason: z.string().min(1).describe('Why this change is being made. Shown in the activity log.'),
      source: source.optional().describe('Where these facts came from. Individual ops can override it.'),
    },
    run: async (l, actor, input) => l.change(actor, input),
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
    run: async (l, actor, input) => l.init(actor, input),
  },
};

/** Validate input and run a tool. */
export async function callTool(l: Lattice, actor: Actor, name: string, input: unknown): Promise<unknown> {
  const tool = TOOLS[name];
  if (!tool) throw new Error(`No tool "${name}". Tools: ${Object.keys(TOOLS).join(', ')}`);
  if (tool.humanOnly && actor.kind !== 'human') throw new Error(`"${name}" is for humans only.`);
  const parsed = z.strictObject(tool.input).safeParse(input ?? {});
  if (!parsed.success) throw new Error(`Invalid input for ${name}:\n${z.prettifyError(parsed.error)}`);
  return tool.run(l, actor, parsed.data);
}
