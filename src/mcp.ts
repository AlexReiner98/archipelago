// The MCP endpoint, kept by no process. Every POST is answered on its own, by a server made for it with the tools its
// workspace offers now: nothing a request needs was left in memory by the one before, so a client goes on through a
// deploy, or from one server to another, with the session it has (an id it was given before is not looked at). Every
// request is checked on its own: its token says whose it is.
//
// The tools are the small surface (src/surface.ts); a verb's description lists the actions a workspace's packs add,
// so a client that opens the GET stream is told there when its workspace's tools change (a pack turned off or on), so
// it asks again rather than holding the list it was given when it connected. The stream is this process's: after a
// restart the client opens it again, on whichever server answers.

import type { IncomingMessage, ServerResponse } from 'node:http';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { z } from 'zod';
import { onToolsChanged } from './packstate.ts';
import type { Actor, Archipelago } from './pelago.ts';
import { callTool, surfaceFor, type Tool } from './tools.ts';

const actorField = {
  actor: z.string().optional().describe('Who you are, e.g. "claude-code:my-project". Recorded against everything you do.'),
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

/** What an agent is offered: query, change, undo and the six verbs (src/surface.ts), whatever packs are on. */
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

/** A server for one request, with the tools the caller's workspace offers now. */
function serverFor(caller: Caller): McpServer {
  const mcp = new McpServer({ name: 'pelago', version: '0.1.0' }, { capabilities: { tools: { listChanged: true } } });
  for (const [name, tool] of offered(caller.pelago.registry))
    mcp.registerTool(name, { description: tool.description, inputSchema: inputsOf(tool) }, async (args: Record<string, unknown>) => {
      const { actor, ...input } = args;
      try {
        const result = await callTool(caller.pelago, caller.actor(actor as string | undefined), name, input);
        return { content: contentOf(result) };
      } catch (err) {
        return { content: [{ type: 'text' as const, text: (err as Error).message }], isError: true };
      }
    });
  return mcp;
}

/** The GET streams open on this process, by workspace: each is told when that workspace's tools change. */
const streams = new Map<string, Set<ServerResponse>>();
const event = (message: unknown) => `event: message\ndata: ${JSON.stringify(message)}\n\n`;

onToolsChanged((workspace) => {
  for (const res of streams.get(workspace) ?? []) res.write(event({ jsonrpc: '2.0', method: 'notifications/tools/list_changed' }));
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
