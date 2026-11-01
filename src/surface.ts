// What an agent is offered (Rule 7 of the target model): it reads with query, writes with change, takes back with
// undo, and calls every other action under one of the six verbs the core pack declares (capture, assign, report, ask,
// settle, revise), naming the action. One tool stands apart, draw: a client opens a page for a tool, not for a call, so
// a view drawn in a chat has a tool of its own (src/mcp-view.ts). The named operations beneath stay one table
// (src/tools.ts) for the human's CLI and the web UI; for agents, query and the verbs are routed onto them here. An old
// name still answers for one release, as POST /agent/<name>, with the call that replaces it (movedTo).

import { z } from 'zod';
import { viewList, viewsSaid } from './askview.ts';
import { KERNEL_VERBS } from './declared.ts';
import type { ActionDef } from './declared.ts';
import type { Registry } from './packs.ts';
import { props } from './tool-ops.ts';
import type { Tool } from './tools.ts';

/** The kernel's tools an agent reaches through query, each by its own name. Every view, lens and pack view is a name of query too. */
export const QUERY_READS = ['schema', 'search', 'get', 'events', 'proposals', 'picture', 'watch', 'packs', 'acts', 'document', 'publish_plan', 'published', 'share_figure', 'backup_download', 'places', 'look'];

/** What query lists when asked for nothing: the reads, then every view. */
const LIST = 'actions';

/** An action as an agent names it, the verb it is under, and the tool beneath that runs it. */
export interface Action {
  name: string;
  verb: string;
  tool: string;
  description: string;
  /** The JSON Schema of its params. */
  params: unknown;
  humanOnly?: boolean;
  devOnly?: boolean;
}

/** The first sentence of a description (an "e.g." ends none), cut to a line: what a list says of each thing. */
const GIST_MAX = 160;
function gist(text: string): string {
  const first = (/^.*?(?<!\be\.g)\.(?=\s|$)/s.exec(text)?.[0] ?? text).trim();
  return first.length > GIST_MAX ? `${first.slice(0, GIST_MAX - 1).trimEnd()}…` : first;
}
const schemaOf = (input: z.ZodRawShape) => {
  const { $schema: _, ...schema } = z.toJSONSchema(z.object(input)) as Record<string, unknown>;
  return schema;
};

/**
 * Every action in a workspace: the kernel's (KERNEL_VERBS) and those its packs declare, by the name an agent calls it.
 * A pack's action for admins is offered as before: it says so, and refuses anyone else when it runs.
 */
export function actionsOf(reg: Registry, tools: Record<string, Tool>): Action[] {
  const kernel = Object.entries(KERNEL_VERBS)
    .filter(([name]) => tools[name])
    .map(([name, verb]): Action => ({ name, verb, tool: name, description: tools[name].description, params: schemaOf(tools[name].input), humanOnly: tools[name].humanOnly, devOnly: tools[name].devOnly }));
  const packs = [...reg.tools]
    .filter(([, t]) => t.call === 'action')
    .map(([tool, t]): Action => ({ name: t.def.id, verb: (t.def as ActionDef).verb, tool, description: `${t.def.description} (from the ${t.pack} pack)`, params: t.def.input }));
  return [...kernel, ...packs];
}

/** The action a name stands for: its own name, its tool's name (time_log), or what follows its pack's name when only one pack has it. */
function findAction(actions: Action[], name: string): Action | undefined {
  const exact = actions.find((a) => a.name === name || a.tool === name);
  if (exact) return exact;
  const short = actions.filter((a) => a.name.slice(a.name.indexOf('.') + 1) === name);
  return short.length === 1 ? short[0] : undefined;
}

/** What a list of params says of each: its name, with ? when it may be left out. */
function paramsSaid(schema: unknown): string {
  const s = schema as { properties?: Record<string, unknown>; required?: string[] } | undefined;
  const keys = Object.keys(s?.properties ?? {});
  return keys.length ? keys.map((k) => (s?.required?.includes(k) ? k : `${k}?`)).join(', ') : 'none';
}

/** The tools an agent is offered, in order. */
export const SURFACE = ['query', 'change', 'undo', 'capture', 'assign', 'report', 'ask', 'settle', 'revise', 'draw'];

/** query and the six verbs as tools, described with what this workspace offers (offered: an action an agent may call here). */
export function surfaceTools(reg: Registry, tools: Record<string, Tool>, offered: (a: Action) => boolean): Record<string, Tool> {
  const actions = actionsOf(reg, tools);
  const reads = QUERY_READS.map((name) => `${name} (${gist(tools[name].description)} Params: ${paramsSaid(schemaOf(tools[name].input))})`).join('; ');
  const out: Record<string, Tool> = {
    query: {
      description:
        `Read the map: every read is one call, query with the name of what to read and its params. With no name, the list of every name. ` +
        `The reads: ${reads}. ${LIST} (what each verb's actions take, whole; params: verb, action). ` +
        `Every other name is a view: ${viewsSaid(reg).replace(/ call with no name for all of them\.$/, '')}`,
      input: { name: z.string().optional().describe('What to read: a read, a view or a lens. Left out, the list of them.'), params: props.optional().describe('Its inputs, as the list names them.') },
      run: async (l, actor, input) => {
        if (input.name !== LIST) return { reads: Object.fromEntries(QUERY_READS.map((name) => [name, gist(tools[name].description)])), [LIST]: 'what each verb’s actions take', views: viewList(l) };
        const { verb, action } = (input.params ?? {}) as { verb?: string; action?: string };
        const mine = actionsOf(l.registry, tools).filter((a) => (actor.kind === 'human' || offered(a)) && (!verb || a.verb === verb) && (!action || a === findAction([a], action)));
        if (action && !mine.length) throw new Error(`No action "${action}". ${verbsSaid(l.registry, actions.filter(offered))}`);
        return mine.map(({ name, verb, description, params }) => ({ action: name, verb, description, params }));
      },
    },
  };
  for (const verb of reg.verbs) {
    const mine = actions.filter((a) => a.verb === verb.id && offered(a));
    const kuma = verb.id === 'report' ? ' Sent as POST /agent/report with no action, the body is what a running system measured (health): Uptime Kuma posts its webhook so.' : '';
    out[verb.id] = {
      description: `${verb.description} Call with the action and its params; each action is one of the six verbs, and here these are ${verb.id}: ${mine.map((a) => `${a.name} (${gist(a.description)} Params: ${paramsSaid(a.params)})`).join('; ') || 'none'}. query ${LIST} gives each one's params whole.${kuma}`,
      input: { action: z.string().optional().describe('The action, by its name.'), params: props.optional().describe('Its inputs.') },
      // Reached only with no action: then what this verb's actions are.
      run: async () => mine.map(({ name, description }) => ({ action: name, description: gist(description) })),
    };
  }
  return out;
}

const verbsSaid = (reg: Registry, actions: Action[]) =>
  `The actions: ${reg.verbs.map((v) => `${v.id}: ${actions.filter((a) => a.verb === v.id).map((a) => a.name).join(', ') || 'none'}`).join('; ')}.`;

/**
 * What a call to query or a verb runs beneath: the named tool and its input. Undefined when the surface tool answers
 * itself (a list). A verb named for an action under another verb is refused with the call that would run it.
 */
export function route(reg: Registry, tools: Record<string, Tool>, name: string, input: Record<string, unknown>): { name: string; input: Record<string, unknown> } | undefined {
  if (name === 'query') {
    const asked = input.name as string | undefined;
    const params = (input.params ?? {}) as Record<string, unknown>;
    if (!asked || asked === LIST) return undefined;
    if (QUERY_READS.includes(asked)) return { name: asked, input: params };
    return { name: 'view', input: { name: asked, params } };
  }
  if (!reg.verbs.some((v) => v.id === name)) return undefined;
  const { action, params, ...rest } = input as { action?: string; params?: Record<string, unknown> };
  // Uptime Kuma posts its body as it is: a report with no action is what a system measured.
  if (name === 'report' && action === undefined && (Object.keys(rest).length || !params)) return { name: 'health', input: params ?? rest };
  if (action === undefined) return undefined;
  if (Object.keys(rest).length) throw new Error(`Invalid input for ${name}: give the action and its params, as ${name} { action: "${action}", params: { ${Object.keys(rest).join(', ')} } }.`);
  const actions = actionsOf(reg, tools);
  const found = findAction(actions, action);
  if (!found) throw new Error(`No action "${action}". ${verbsSaid(reg, actions.filter((a) => !a.humanOnly && !a.devOnly))}`);
  if (found.verb !== name) throw new Error(`"${found.name}" is a ${found.verb}: call ${found.verb} with action "${found.name}".`);
  return { name: found.tool, input: params ?? {} };
}

/**
 * The call that replaces an old name, said to whoever still uses it, for one release. Undefined for a name of the
 * surface and for the human's own tools, which keep their names.
 */
export function movedTo(reg: Registry, tools: Record<string, Tool>, name: string): string | undefined {
  if (SURFACE.includes(name)) return undefined;
  const until = `"${name}" still answers until the next release.`;
  if (QUERY_READS.includes(name)) return `Moved: call query with { name: "${name}", params: <what you sent> }. ${until}`;
  if (name === 'view') return `Moved: call query with { name, params } as you sent them to view. ${until}`;
  const view = reg.tools.get(name);
  if (view?.call === 'view') return `Moved: call query with { name: "${view.def.id.slice(view.def.id.indexOf('.') + 1)}", params: <what you sent> }. ${until}`;
  const action = findAction(actionsOf(reg, tools), name);
  if (!action || action.humanOnly) return undefined;
  return `Moved: call ${action.verb} with { action: "${action.name}", params: <what you sent> }. ${until}`;
}
