// One table of named tools serves the human's surfaces, the CLI and the local API: same names, same inputs, same
// write path. Agents are offered a small surface over it (packs/surface/kernel/surface.ts): query, change, undo and the six verbs,
// each routed here onto the tool that runs it. The tools themselves live by what they do: reads (packs/surface/kernel/tool-reads.ts),
// the write path (packs/surface/kernel/tool-change.ts), the kernel's actions (packs/surface/kernel/tool-acts.ts) and the human's own (packs/surface/kernel/tool-human.ts);
// those an internal pack declares come through the slot surface.tools (./server-fillings.ts).

import { z } from 'zod';
import type { Actor, Archipelago } from '../../write/kernel/pelago.ts';
import { MEMBER_TOOLS } from '../../identity/kernel/members.ts';
import { WORKSPACE_TOOLS } from './workspace-tools.ts';
import { PACK_STATE_TOOLS } from '../../loader/kernel/packstate.ts';
import { BACKUP_TOOLS } from './backup-tools.ts';
import { FORMER_NAMES, REPORT_TOOLS } from './report-tool.ts';
import { TOKEN_TOOLS } from '../../identity/kernel/token-tools.ts';
import { callAs, ownContext, type KernelContext } from '../../loader/kernel/kernel-context.ts';
import { LOOK_READS } from '../../walls/kernel/look-pass.ts';
import type { Registry } from '../../loader/kernel/packs.ts';
import { packActionByShort, packTool, packTools } from '../../loader/kernel/packtools.ts';
import { partCall } from '../../loader/kernel/part-calls.ts';
import { withinScope } from './scope.ts';
import { viewsSaid } from './view-words.ts';
import { actionsOf, listedChange, movedTo, route, surfaceNames, surfaceTools, type Action } from './surface.ts';
import { packAct } from './surface-slots.ts';
import { ACT_TOOLS } from './tool-acts.ts';
import { WRITE_TOOLS } from './tool-change.ts';
import { devMode } from './tool-config.ts';
import { HUMAN_TOOLS } from './tool-human.ts';
import { READ_TOOLS } from './tool-reads.ts';
import { readsSaid, toolsSaid } from './tool-said.ts';
import { declaredTools, type DeclaredTool } from './tool-input.ts';
import { serverFillings } from './server-fillings.ts';

export { configureBackup, configureRestart, devMode } from './tool-config.ts';
export { describeChanges, humanChanges, latestSeq, type HumanChange } from './tool-reads.ts';
export { TITLE_MAX } from './tool-ops.ts';

export interface Tool {
  description: string;
  input: z.ZodRawShape;
  /** Not offered to agents. */
  humanOnly?: boolean;
  /** A read an agent reaches through query, by its own name (./surface.ts, queryReads). */
  query?: boolean;
  /** Exists only when the server runs in dev mode. */
  devOnly?: boolean;
  /** Sends what a system measured: the only kind of tool a token that may only report can call. */
  report?: boolean;
  /** No step of its own on the session's page when this holds of its input: a session saying only that it is alive. */
  quiet?(input: Record<string, unknown>): boolean;
  /** Its answer names the session that called it ({ run }): its first step is already that session's own. */
  begins?: boolean;
  /** It ends the session it names: the act the page ends one with. */
  ends?: boolean;
  /** It reads an item whole, as its reader meets it: the read the page draws such an item by. */
  whole?: boolean;
  /** For a token limited to some items: the inputs that name the items it acts on, with what it would do to them (packs/surface/kernel/scope.ts). */
  within?: Record<string, string>;
  run(l: Archipelago, actor: Actor, input: any): Promise<unknown>;
}

// Where an agent pointed the screen and the steps it took are kept for any server to read: the presence pack's (act.report.step).
/** Tools that are no step of their own: those that point the screen themselves, and the one that only waits. */
const UNWATCHED = new Set(['show', 'change', 'tell', 'watch', 'hook']);
const READS = new Set(['get', 'events', 'proposals', 'picture', 'schema']);
/** What a member who only reads may call (packs/identity/kernel/members.ts): the reads a canvas makes, the page's feed of the log, query, and the workspace's settings. Their database writes nothing besides (packs/database/kernel/db.ts). */
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
  await callAs(l, 'act.report.step', { step: { kind, actor: actor.name, did, hash: id ? `e/${id}` : name === 'view' && input.name === 'flat' ? 'graph?lens' : undefined, ...(run && { run }) }, viewer: l.viewer });
}

/**
 * The tools the internal packs declare (surface.tools, ./server-fillings.ts), each run on its pack's context of the map
 * it is called on, whether or not the map has the pack on (an optional pack's too: a session's hook answers on any map).
 * Filled once, before anything is called: the table is the server's, whatever a workspace runs.
 */
const PACK_TOOLS: Record<string, Tool> = Object.assign({}, ...(await serverFillings<Record<string, DeclaredTool<KernelContext>>>('surface.tools')).map(({ pack, filled }) => declaredTools(filled, (l) => ownContext(l, pack))));

export const TOOLS: Record<string, Tool> = {
  ...READ_TOOLS, ...WRITE_TOOLS, ...ACT_TOOLS, ...HUMAN_TOOLS,
  ...PACK_STATE_TOOLS, ...BACKUP_TOOLS, ...REPORT_TOOLS,
  ...TOKEN_TOOLS, ...MEMBER_TOOLS, ...WORKSPACE_TOOLS, ...PACK_TOOLS,
};
// The schema a person reads says what the tools declare (./tool-said.ts): the act that ends a session, the reads.
// Asked for its reads alone (a reader's page, /read/<id>), it answers only those, not the whole model.
TOOLS.schema = { ...READ_TOOLS.schema, run: async (l, actor, input) => (input.reads ? { reads: readsSaid(Object.fromEntries(toolsFor(l.registry))) } : toolsSaid(await READ_TOOLS.schema.run(l, actor, input), Object.fromEntries(toolsFor(l.registry)))) };

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

/** The call that replaces a tool's old name, for one release (packs/surface/kernel/surface.ts); undefined for a name that stays. */
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
  // An internal pack's action whose code is in-process (packs/surface/kernel/surface-slots.ts, packAct) runs there, not in the sandbox.
  const inProcess = pack && !TOOLS[name] ? await packAct(l, name) : undefined;
  // A part of the page names itself on its pack's action: checked, then named on the change (packs/loader/kernel/part-calls.ts).
  const named = pack && !TOOLS[name] && !('part' in pack.input) && input && typeof input === 'object' && 'part' in input ? (input as Record<string, unknown>) : undefined;
  const { part: partAsked, ...unnamed } = named ?? {};
  const part = named ? await partCall(l, actor, name, unnamed.island, partAsked) : undefined;
  if (part && inProcess) throw new Error(`A part may not send this: "${name}" runs inside the server, where its change cannot name the part.`);
  const tool: Tool | undefined = TOOLS[name] ?? surface ?? pack;
  if (!tool) throw new Error(`No tool "${name}". Tools: ${(actor.kind === 'human' ? toolsFor(l.registry) : surfaceFor(l.registry)).map(([t]) => t).join(', ')}`);
  if (tool.devOnly && !devMode()) throw new Error(`"${name}" is available only in dev mode (npm run dev).`);
  if (tool.humanOnly && actor.kind !== 'human') throw new Error(`"${name}" is for humans only.`);
  if (actor.may === 'read' && !MEMBER_READS.has(name)) throw new Error(`This sign-in only reads the map: it cannot call ${name}.`);
  if (actor.may === 'report' && !tool.report) throw new Error(`This token may only report: it cannot call ${name}. Send what was measured with report.`);
  const parsed = z.strictObject(tool.input).safeParse(routed ? routed.input : named ? unnamed : (input ?? {}));
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
      : part && pack
        ? await pack.run(l, actor, parsed.data, undefined, part)
        : await tool.run(l, actor, parsed.data);
  // A step that could not be kept costs the page a step, never the agent its answer.
  // A session that has just started is named by the run its answer gives, so its first step is already its own.
  const begun = tool.begins && typeof (answer as { run?: unknown })?.run === 'string' ? { run: (answer as { run: string }).run } : {};
  if (actor.kind === 'agent' && !surface) await step(l, actor, name, { ...(parsed.data as Record<string, unknown>), ...begun }, tool).catch((err) => console.error(`${name}: the session's step could not be kept: ${(err as Error).message}`));
  return answer;
}
