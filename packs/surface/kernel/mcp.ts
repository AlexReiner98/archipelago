// The MCP endpoint, kept by no process. Every POST is answered on its own, by a server made for it with the tools its
// workspace offers now: nothing a request needs was left in memory by the one before, so a client goes on through a
// deploy, or from one server to another, with the session it has (an id it was given before is not looked at). Every
// request is checked on its own: its token says whose it is.
//
// The tools are the small surface (src/surface.ts); a verb's description lists the actions a workspace's packs add,
// so a client that opens the GET stream is told there when its workspace's tools change (a pack turned off or on), so
// it asks again rather than holding the list it was given when it connected. The stream is this process's: after a
// restart the client opens it again, on whichever server answers, and is told at once, since nothing here knows what
// the server it heard from before offered. Claude Code (2.1) starts over instead when its stream drops, and lists the
// tools again itself for some minutes after; a description its model has already read stays as it was read.

import type { IncomingMessage, ServerResponse } from 'node:http';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { z } from 'zod';
import { viewNames } from '../../../src/askview.ts';
import { registerView, toolView, VIEW_CAPABILITY } from '../../../src/mcp-view.ts';
import { onToolsChanged } from '../../../src/packstate.ts';
import type { Actor, Archipelago } from '../../../src/pelago.ts';
import { annotationsOf } from './surface.ts';
import { callTool, surfaceFor, type Tool } from './tools.ts';

const actorField = {
  actor: z.string().optional().describe('Who you are, for the log.'),
};

/**
 * A client keeps the tool list it was given when it connected. An input added
 * since is one it does not know the type of, and it sends it as a string:
 * "true", "[...]". Where an input is not a string and what arrived is one
 * that spells a value the input takes, it is taken as that value.
 */
export function lenient<T extends z.ZodType>(schema: T) {
  return z.preprocess((value) => {
    if (typeof value !== 'string' || schema.safeParse(value).success) return value;
    try {
      const spelt = JSON.parse(value);
      return schema.safeParse(spelt).success ? spelt : value;
    } catch {
      return value;
    }
  }, schema);
}

/** Who a request is for, and the map as they see it. */
export interface Caller {
  workspace: string;
  pelago: Archipelago;
  actor: (label?: string) => Actor;
}

/** What an agent is offered: query, change, undo, the six verbs, a pack's own verbs, and draw (src/surface.ts). */
const offered = (registry: Archipelago['registry']) => surfaceFor(registry);

/** A tool's inputs as MCP is given them, made once per tool rather than for every request. */
const schemas = new WeakMap<Tool, Record<string, z.ZodType>>();
const inputsOf = (tool: Tool) => {
  let made = schemas.get(tool);
  if (!made) schemas.set(tool, (made = { ...Object.fromEntries(Object.entries(tool.input).map(([key, schema]) => [key, lenient(schema as z.ZodType)])), ...actorField }));
  return made;
};

/**
 * What a tool answered, as MCP content: its words as text, and a picture it carries (`image`: base64 and its content
 * type, as a look answers) as an image of its own, which the client shows the model as an image rather than as text.
 */
export function contentOf(result: unknown) {
  const image = result && typeof result === 'object' ? (result as { image?: { data?: unknown; content_type?: unknown } }).image : undefined;
  if (!image || typeof image.data !== 'string' || typeof image.content_type !== 'string') return [{ type: 'text' as const, text: JSON.stringify(result) }];
  const { image: _sent, ...rest } = result as Record<string, unknown>;
  return [
    { type: 'text' as const, text: JSON.stringify(rest) },
    { type: 'image' as const, data: image.data, mimeType: image.content_type },
  ];
}

/**
 * What any client is told on connecting: one with no hooks has nothing else to go by. It names only the views this
 * workspace's packs answer, so an agent on a map without a repository's views is not sent to one.
 */
export function connectText(registry: Archipelago['registry']): string {
  const has = new Set(viewNames(registry));
  const stands = [has.has('frontier') && 'frontier for where this session stands', has.has('handoff') && 'handoff with repo for where a repository stands'].filter(Boolean);
  const where = stands.length ? `name ${stands.join(', ')}, brief with task for one task` : 'name brief with task for where one task stands, search with open true for the open work';
  return `Archipelago is a shared map of people, work and what waits on what. To work here: start with capture, action session_start, params cwd, remote, session_id and title (what your chat is called), and keep the run it gives; when the chat is renamed, report session_update with title. Read with query: ${where}; query with no name lists every view here, and with name actions says what each action takes. Write only with change, giving run and authority. Say what you conclude with report, action tell. Name an item to a person as [its name](link), never a bare id; ids stay in tool calls (link is the pattern session_start answers with). Finish with report, action session_end, and a summary; when the chat itself ends, add its reason (closed, archived), and its tab on the owner’s page closes. A person token reaches every workspace its person is a member of: connect at /mcp/<workspace id>, or give any call a workspace argument (its id); else it acts in its home workspace.`;
}

/** A server for one request, with the tools the caller's workspace offers now. */
function serverFor(caller: Caller): McpServer {
  const mcp = new McpServer({ name: 'pelago', version: '0.1.0' }, { capabilities: { tools: { listChanged: true }, extensions: VIEW_CAPABILITY }, instructions: connectText(caller.pelago.registry) });
  registerView(mcp);
  for (const [name, tool] of offered(caller.pelago.registry)) {
    // The title is said twice, as the tool's own and among its annotations: MCP reads either, and the connectors
    // directory's review asks for a title without saying which. A pack's own verb is annotated as revise is.
    const annotations = annotationsOf(caller.pelago.registry, name);
    mcp.registerTool(name, { title: annotations.title, description: tool.description, inputSchema: inputsOf(tool), annotations, ...toolView(name) }, async (args: Record<string, unknown>) => {
      // A workspace named in the arguments was read by the server before the call was answered (src/server.ts): it is
      // in no tool's inputs, which every request pays for, and is said once in connectText.
      const { actor, workspace: _routed, ...input } = args;
      try {
        const result = await callTool(caller.pelago, caller.actor(actor as string | undefined), name, input);
        return { content: contentOf(result) };
      } catch (err) {
        return { content: [{ type: 'text' as const, text: (err as Error).message }], isError: true };
      }
    });
  }
  return mcp;
}

/** The GET streams open on this process, by workspace: each is told when that workspace's tools change. */
const streams = new Map<string, Set<ServerResponse>>();
const LIST_CHANGED = `event: message\ndata: ${JSON.stringify({ jsonrpc: '2.0', method: 'notifications/tools/list_changed' })}\n\n`;

onToolsChanged((workspace) => {
  for (const res of streams.get(workspace) ?? []) res.write(LIST_CHANGED);
});

// A stream that says nothing for long is cut by the proxies in front: a comment now and then keeps it open.
setInterval(() => {
  for (const open of streams.values()) for (const res of open) res.write(': still here\n\n');
}, 25_000).unref();

const fail = (res: ServerResponse, status: number, message: string) => {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify({ jsonrpc: '2.0', error: { code: -32000, message }, id: null }));
};

/** Open the stream a client hears of changes on. */
function listen(req: IncomingMessage, res: ServerResponse, caller: Caller, allowedHosts: string[]): void {
  if (!allowedHosts.includes(req.headers.host ?? '')) return fail(res, 403, `Invalid Host header: ${req.headers.host}`);
  if (!String(req.headers.accept ?? '').includes('text/event-stream')) return fail(res, 406, 'Not Acceptable: the client must accept text/event-stream.');
  res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache, no-transform', connection: 'keep-alive' });
  res.flushHeaders();
  // A stream opened again after a deploy may have been offered other tools before: the client asks for the list again.
  res.write(LIST_CHANGED);
  const open = streams.get(caller.workspace) ?? new Set();
  streams.set(caller.workspace, open.add(res));
  res.on('close', () => {
    open.delete(res);
    if (!open.size) streams.delete(caller.workspace);
  });
}

/** Answer one request to /mcp. `body` is the parsed JSON of a POST. */
export async function serveMcp(req: IncomingMessage, res: ServerResponse, caller: Caller, allowedHosts: string[], body: unknown): Promise<void> {
  if (req.method === 'GET') return listen(req, res, caller, allowedHosts);
  // There is no session to end: each request stood on its own.
  if (req.method === 'DELETE') return void res.writeHead(200).end();
  if (req.method !== 'POST') return fail(res, 405, 'Method not allowed.');
  const mcp = serverFor(caller);
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableDnsRebindingProtection: true, allowedHosts });
  res.on('close', () => {
    void transport.close();
    void mcp.close();
  });
  await mcp.connect(transport);
  return transport.handleRequest(req, res, body);
}
