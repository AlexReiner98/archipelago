// One table of named tools serves the human's surfaces, the CLI and the local API: same names, same inputs, same
// write path. Agents are offered a small surface over it (src/surface.ts): query, change, undo and the six verbs,
// each routed here onto the tool that runs it. The tools themselves live by what they do: reads (src/tool-reads.ts),
// the write path (src/tool-change.ts), the kernel's actions (src/tool-acts.ts) and the human's own (src/tool-human.ts).

import { z } from 'zod';
import type { Actor, Archipelago } from '../../../src/pelago.ts';
import { MEMBER_TOOLS } from '../../../src/members.ts';
import { WORKSPACE_TOOLS } from './workspace-tools.ts';
import { SERVER_PACK_TOOLS } from '../../../src/server-pack-tools.ts';
import { PACK_STATE_TOOLS } from '../../../src/packstate.ts';
import { SHARE_TOOLS, context as publishing } from '../../../src/share-tools.ts';
import { BACKUP_TOOLS } from '../../../src/backup-tools.ts';
import { FORMER_NAMES, REPORT_TOOLS } from './report-tool.ts';
import { TOKEN_TOOLS } from '../../../src/token-tools.ts';
import { ASK_TOOLS, context as connecting } from '../../../src/token-ask.ts';
import { CONNECTION_TOOLS } from '../../../src/connection-tools.ts';
import { bypassingRls } from '../../../src/outbox.ts';
import { LOOK_READS } from '../../../src/look-pass.ts';
import type { Registry } from '../../../src/packs.ts';
import { packActionByShort, packTool, packTools } from '../../../src/packtools.ts';
import { took } from '../../../src/presence.ts';
import { withinScope } from '../../../src/scope.ts';
import { viewsSaid } from '../../../src/askview.ts';
import { actionsOf, listedChange, movedTo, route, surfaceNames, surfaceTools, type Action } from './surface.ts';
import { packAct } from './surface-slots.ts';
import { ACT_TOOLS } from './tool-acts.ts';
import { HOOK_TOOLS } from '../../../src/hook-tool.ts';
import { WRITE_TOOLS } from './tool-change.ts';
import { devMode } from './tool-config.ts';
import { HUMAN_TOOLS } from './tool-human.ts';
import { READ_TOOLS } from './tool-reads.ts';
import { declaredTools } from './tool-input.ts';

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
  /** No step of its own on the session's page when this holds of its input: a session saying only that it is alive. */
  quiet?(input: Record<string, unknown>): boolean;
  /** Its answer names the session that called it ({ run }): its first step is already that session's own. */
  begins?: boolean;
  /** For a token limited to some items: the inputs that name the items it acts on, with what it would do to them (src/scope.ts). */
  within?: Record<string, string>;
  run(l: Archipelago, actor: Actor, input: any): Promise<unknown>;
}

// Where an agent pointed the screen and the steps it took are kept for any server to read (src/presence.ts).
/** Tools that are no step of their own: those that point the screen themselves, and the one that only waits. */
const UNWATCHED = new Set(['show', 'change', 'tell', 'watch', 'hook']);
const READS = new Set(['get', 'events', 'proposals', 'picture', 'schema']);
/** What a member who only reads may call (src/members.ts): the reads a canvas makes, the page's feed of the log, query, and the workspace's settings. Their database writes nothing besides (src/db.ts). */
const MEMBER_READS = new Set([...LOOK_READS, 'tail', 'query', 'workspace_info']);
async function step(l: Archipelago, actor: Actor, name: string, input: Record<string, unknown>, tool?: Tool): Promise<void> {
  const params = (input.params ?? {}) as Record<string, unknown>;
  // A session saying only that it is alive has done nothing to see (the tool's quiet).
  if (UNWATCHED.has(name) || tool?.quiet?.(input)) return;
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
  const run = typeof input.run === 'string' && /^e_[a-z0-9]{8}$/.test(input.run) ? input.run : undefined;
  await took((await bypassingRls(l)).db, l, { kind, actor: actor.name, did, hash: id ? `e/${id}` : name === 'view' && input.name === 'flat' ? 'graph?lens' : undefined, ...(run && { run }) });
}

export const TOOLS: Record<string, Tool> = {
  ...READ_TOOLS, ...WRITE_TOOLS, ...ACT_TOOLS, ...HOOK_TOOLS, ...HUMAN_TOOLS,
  ...PACK_STATE_TOOLS, ...declaredTools(SHARE_TOOLS, publishing), ...BACKUP_TOOLS, ...REPORT_TOOLS,
  ...TOKEN_TOOLS, ...declaredTools(ASK_TOOLS, connecting), ...MEMBER_TOOLS, ...SERVER_PACK_TOOLS, ...WORKSPACE_TOOLS, ...declaredTools(CONNECTION_TOOLS, connecting),
};

/** The view tool as a registry offers it: described with the lenses its core pack declares, then the kernel's own views. */
const viewTools = new WeakMap<Registry, Tool>();
const viewTool = (reg: Registry): Tool => viewTools.get(reg) ?? (viewTools.set(reg, { ...TOOLS.view, description: viewsSaid(reg) }), viewTools.get(reg)!);

/** Every named tool in a workspace, as the human's CLI and API call them: the kernel's, then those its packs declare (a kernel tool's name wins). */
export const toolsFor = (reg: Registry): [string, Tool][] => [...Object.entries(TOOLS).map(([name, tool]): [string, Tool] => [name, name === 'view' ? viewTool(reg) : tool]), ...packTools(reg).filter(([t]) => !TOOLS[t])];

/** Whether an agent may call an action here: never the human's own, and the dev server's only in dev mode. */
const offered = (a: Action) => !a.humanOnly && !(a.devOnly && !devMode());

/** The actions an agent is offered here, each as its verb and name ("revise withdraw"): what a restart is compared by. */
export const offeredActions = (reg: Registry): string[] => actionsOf(reg, TOOLS).filter(offered).map((a) => `${a.verb} ${a.name}`);

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

const CHANGE = listedChange(TOOLS.change);

/** What an agent is offered, in order: query, change, undo, the six verbs, any verb a pack declares, and draw. */
export const surfaceFor = (reg: Registry): [string, Tool][] => surfaceNames(reg).map((name) => [name, name === 'change' ? CHANGE : (TOOLS[name] ?? surfaceOf(reg)[name])]);

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
  // An internal pack's action whose code is in-process (src/surface-slots.ts, packAct) runs there, not in the sandbox.
  const inProcess = pack && !TOOLS[name] ? await packAct(l, name) : undefined;
  const tool: Tool | undefined = TOOLS[name] ?? surface ?? pack;
  if (!tool) throw new Error(`No tool "${name}". Tools: ${(actor.kind === 'human' ? toolsFor(l.registry) : surfaceFor(l.registry)).map(([t]) => t).join(', ')}`);
  if (tool.devOnly && !devMode()) throw new Error(`"${name}" is available only in dev mode (npm run dev).`);
  if (tool.humanOnly && actor.kind !== 'human') throw new Error(`"${name}" is for humans only.`);
  if (actor.may === 'read' && !MEMBER_READS.has(name)) throw new Error(`This sign-in only reads the map: it cannot call ${name}.`);
  if (actor.may === 'report' && !tool.report) throw new Error(`This token may only report: it cannot call ${name}. Send what was measured with report.`);
  const parsed = z.strictObject(tool.input).safeParse(routed ? routed.input : (input ?? {}));
  if (!parsed.success) throw new Error(`Invalid input for ${name}:\n${z.prettifyError(parsed.error)}`);
  // An agent whose token is within some items is held to them here, whatever the tool; what it writes, where every change is checked.
  const limited = actor.kind === 'agent' && Boolean(actor.within?.length);
  if (limited && !surface) await withinScope(l, actor, name, parsed.data as Record<string, unknown>, tool.within);
  const answer = inProcess
    ? await inProcess(l, actor, parsed.data)
    : pack && !TOOLS[name] && limited
      ? await pack.run(l, actor, parsed.data, async (done) => {
          if (done.requests?.length) throw new Error(`This token is limited to some of the map: ${name} asks to act outside the map, which it cannot.`);
        })
      : await tool.run(l, actor, parsed.data);
  // A step that could not be kept costs the page a step, never the agent its answer.
  // A session that has just started is named by the run its answer gives, so its first step is already its own.
  const begun = tool.begins && typeof (answer as { run?: unknown })?.run === 'string' ? { run: (answer as { run: string }).run } : {};
  if (actor.kind === 'agent' && !surface) await step(l, actor, name, { ...(parsed.data as Record<string, unknown>), ...begun }, tool).catch((err) => console.error(`${name}: the session's step could not be kept: ${(err as Error).message}`));
  return answer;
}
