// One table of named tools serves the human's surfaces, the CLI and the local API: same names, same inputs, same
// write path. Agents are offered a small surface over it (src/surface.ts): query, change, undo and the six verbs,
// each routed here onto the tool that runs it. The tools themselves live by what they do: reads (src/tool-reads.ts),
// the write path (src/tool-change.ts), the kernel's actions (src/tool-acts.ts) and the human's own (src/tool-human.ts).

import { z } from 'zod';
import type { Actor, Archipelago } from './pelago.ts';
import { MEMBER_TOOLS } from './members.ts';
import { WORKSPACE_TOOLS } from './workspace-tools.ts';
import { SERVER_PACK_TOOLS } from './server-pack-tools.ts';
import { PACK_STATE_TOOLS } from './packstate.ts';
import { SHARE_TOOLS } from './share-tools.ts';
import { BACKUP_TOOLS } from './backup-tools.ts';
import { FORMER_NAMES, REPORT_TOOLS } from './report.ts';
import { TOKEN_TOOLS } from './token-tools.ts';
import { ASK_TOOLS } from './token-ask.ts';
import { CONNECTION_TOOLS } from './connection-tools.ts';
import { MODEL_TOOLS } from './model-tools.ts';
import { wholeMap } from './outbox.ts';
import type { Registry } from './packs.ts';
import { packActionByShort, packTool, packTools } from './packtools.ts';
import { took } from './presence.ts';
import { withinScope } from './scope.ts';
import { viewsSaid } from './askview.ts';
import { movedTo, route, SURFACE, surfaceTools, type Action } from './surface.ts';
import { ACT_TOOLS } from './tool-acts.ts';
import { WRITE_TOOLS } from './tool-change.ts';
import { devMode } from './tool-config.ts';
import { HUMAN_TOOLS } from './tool-human.ts';
import { READ_TOOLS } from './tool-reads.ts';

export { configureBackup, configureRestart, devMode } from './tool-config.ts';
export { describeChanges, humanChanges, latestSeq, type HumanChange } from './tool-reads.ts';
export { TITLE_MAX } from './tool-ops.ts';

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

// Where an agent pointed the screen and the steps it took are kept for any server to read (src/presence.ts).
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
  await took((await wholeMap(l)).db, l, { kind, actor: actor.name, did, hash: id ? `e/${id}` : name === 'view' && input.name === 'flat' ? 'graph?lens' : undefined });
}

export const TOOLS: Record<string, Tool> = {
  ...READ_TOOLS, ...WRITE_TOOLS, ...ACT_TOOLS, ...HUMAN_TOOLS,
  ...PACK_STATE_TOOLS, ...SHARE_TOOLS, ...BACKUP_TOOLS, ...REPORT_TOOLS, ...MODEL_TOOLS,
  ...TOKEN_TOOLS, ...ASK_TOOLS, ...MEMBER_TOOLS, ...SERVER_PACK_TOOLS, ...WORKSPACE_TOOLS, ...CONNECTION_TOOLS,
};

/** The view tool as a registry offers it: described with the lenses its core pack declares, then the kernel's own views. */
const viewTools = new WeakMap<Registry, Tool>();
const viewTool = (reg: Registry): Tool => viewTools.get(reg) ?? (viewTools.set(reg, { ...TOOLS.view, description: viewsSaid(reg) }), viewTools.get(reg)!);

/** Every named tool in a workspace, as the human's CLI and API call them: the kernel's, then those its packs declare (a kernel tool's name wins). */
export const toolsFor = (reg: Registry): [string, Tool][] => [...Object.entries(TOOLS).map(([name, tool]): [string, Tool] => [name, name === 'view' ? viewTool(reg) : tool]), ...packTools(reg).filter(([t]) => !TOOLS[t])];

/** Whether an agent may call an action here: never the human's own, and the dev server's only in dev mode. */
const offered = (a: Action) => !a.humanOnly && !(a.devOnly && !devMode());

/**
 * query and the six verbs of a registry, made once for each set of packs it has loaded (a pack turned off or on
 * reloads it in place, with a new table of tools) and again when dev mode is turned on or off.
 */
const surfaces = new WeakMap<Registry['tools'], { dev: boolean; tools: Record<string, Tool> }>();
function surfaceOf(reg: Registry): Record<string, Tool> {
  const made = surfaces.get(reg.tools);
  if (made && made.dev === devMode()) return made.tools;
  const tools = surfaceTools(reg, TOOLS, offered);
  surfaces.set(reg.tools, { dev: devMode(), tools });
  return tools;
}

/** What an agent is offered, in order: query, change, undo and the six verbs. */
export const surfaceFor = (reg: Registry): [string, Tool][] => SURFACE.map((name) => [name, TOOLS[name] ?? surfaceOf(reg)[name]]);

/** The call that replaces a tool's old name, for one release (src/surface.ts); undefined for a name that stays. */
export const replacementOf = (reg: Registry, name: string) => movedTo(reg, TOOLS, FORMER_NAMES[name] ?? name);

/** Validate input and run a tool: a named one, or query or a verb, run as the named tool beneath it. */
export async function callTool(l: Archipelago, actor: Actor, given: string, input: unknown): Promise<unknown> {
  const former = FORMER_NAMES[given] ?? given;
  const routed = route(l.registry, TOOLS, former, (input ?? {}) as Record<string, unknown>);
  const asked = routed?.name ?? former;
  // query and a verb answer themselves only with a list: what can be read, what a verb's actions are.
  const surface = routed ? undefined : surfaceOf(l.registry)[asked];
  const name = TOOLS[asked] || surface || l.registry.tools.has(asked) ? asked : (packActionByShort(l.registry, asked) ?? asked);
  const pack = packTool(l.registry, name);
  const tool: Tool | undefined = TOOLS[name] ?? surface ?? pack;
  if (!tool) throw new Error(`No tool "${name}". Tools: ${(actor.kind === 'human' ? toolsFor(l.registry) : surfaceFor(l.registry)).map(([t]) => t).join(', ')}`);
  if (tool.devOnly && !devMode()) throw new Error(`"${name}" is available only in dev mode (npm run dev).`);
  if (tool.humanOnly && actor.kind !== 'human') throw new Error(`"${name}" is for humans only.`);
  if (actor.may === 'report' && !tool.report) throw new Error(`This token may only report: it cannot call ${name}. Send what was measured with report.`);
  const parsed = z.strictObject(tool.input).safeParse(routed ? routed.input : (input ?? {}));
  if (!parsed.success) throw new Error(`Invalid input for ${name}:\n${z.prettifyError(parsed.error)}`);
  // An agent whose token is within some items is held to them here, whatever the tool; what it writes, where every change is checked.
  const limited = actor.kind === 'agent' && Boolean(actor.within?.length);
  if (limited && !surface) await withinScope(l, actor, name, parsed.data as Record<string, unknown>);
  const answer =
    pack && !TOOLS[name] && limited
      ? await pack.run(l, actor, parsed.data, async (done) => {
          if (done.requests?.length) throw new Error(`This token is limited to some of the map: ${name} asks to act outside the map, which it cannot.`);
        })
      : await tool.run(l, actor, parsed.data);
  // A step that could not be kept costs the page a step, never the agent its answer.
  if (actor.kind === 'agent' && !surface) await step(l, actor, name, parsed.data as Record<string, unknown>).catch(() => {});
  return answer;
}
