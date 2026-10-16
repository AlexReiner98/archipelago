// The MCP endpoint. A client that initializes gets a session, kept while it is used: its tool list follows the
// workspace's packs, and when a pack is turned off or on the client is told the list changed, so it asks again
// rather than holding the tools it was given when it connected. Every request is still checked on its own: its token
// must be the session's. A request with no session (a client that does not keep one) is answered on its own, as
// before.

import { randomUUID } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { McpServer, type RegisteredTool } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { isInitializeRequest } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import { onToolsChanged } from './packstate.ts';
import type { Actor, Archipelago } from './pelago.ts';
import { callTool, devMode, toolsFor, type Tool } from './tools.ts';

const actorField = {
  actor: z.string().optional().describe('Who you are, e.g. "claude-code:aperture". Recorded against everything you do.'),
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

interface Session {
  workspace: string;
  /** The token's identity, which every request to the session must carry. */
  who: string;
  /** The map and actor of the latest request: a workspace closed and opened again is a new map. */
  current: Caller;
  mcp: McpServer;
  transport?: StreamableHTTPServerTransport;
  tools: Map<string, RegisteredTool>;
  used: number;
}

const sessions = new Map<string, Session>();
/** A session not used for this long is closed; its client starts another. */
const IDLE_MS = 30 * 60_000;

const offered = (registry: Archipelago['registry']) => toolsFor(registry).filter(([, tool]) => !tool.humanOnly && !(tool.devOnly && !devMode()));

function register(mcp: McpServer, name: string, tool: Tool, caller: () => Caller): RegisteredTool {
  const inputSchema = { ...Object.fromEntries(Object.entries(tool.input).map(([key, schema]) => [key, lenient(schema as z.ZodType)])), ...actorField };
  return mcp.registerTool(name, { description: tool.description, inputSchema }, async (args: Record<string, unknown>) => {
    const { actor, ...input } = args;
    const { pelago, actor: actorFor } = caller();
    try {
      const result = await callTool(pelago, actorFor(actor as string | undefined), name, input);
      return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] };
    } catch (err) {
      return { content: [{ type: 'text' as const, text: (err as Error).message }], isError: true };
    }
  });
}

/** Bring a session's tools in line with what its workspace offers now; the SDK tells the client of each change. */
function sync(session: Session): void {
  const now = new Map(offered(session.current.pelago.registry));
  for (const [name, registered] of session.tools) {
    if (now.has(name)) continue;
    registered.remove();
    session.tools.delete(name);
  }
  for (const [name, tool] of now) if (!session.tools.has(name)) session.tools.set(name, register(session.mcp, name, tool, () => session.current));
}

onToolsChanged((workspace) => {
  for (const session of sessions.values()) if (session.workspace === workspace) sync(session);
});

setInterval(() => {
  for (const [id, session] of sessions) {
    if (Date.now() - session.used < IDLE_MS) continue;
    sessions.delete(id);
    void session.mcp.close();
  }
}, 5 * 60_000).unref();

const fail = (res: ServerResponse, status: number, message: string) => {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify({ jsonrpc: '2.0', error: { code: -32000, message }, id: null }));
};

/** Answer one request to /mcp: in its session, opening one, or on its own. `body` is the parsed JSON of a POST. */
export async function serveMcp(req: IncomingMessage, res: ServerResponse, caller: Caller, allowedHosts: string[], body: unknown): Promise<void> {
  const id = req.headers['mcp-session-id'];
  const who = JSON.stringify(caller.actor());
  if (typeof id === 'string') {
    const session = sessions.get(id);
    // Not found, as the protocol says, whether it ended or is someone else's: the client starts a new one.
    if (!session || session.workspace !== caller.workspace || session.who !== who) return fail(res, 404, 'No such session. Initialize a new one.');
    session.current = caller;
    session.used = Date.now();
    if (req.method === 'DELETE') sessions.delete(id);
    return session.transport!.handleRequest(req, res, body);
  }
  if (req.method !== 'POST') return fail(res, 405, 'GET and DELETE need a session: POST an initialize request first.');
  const keep = isInitializeRequest(body);
  const mcp = new McpServer({ name: 'pelago', version: '0.1.0' }, { capabilities: { tools: { listChanged: true } } });
  const session: Session = { workspace: caller.workspace, who, current: caller, mcp, tools: new Map(), used: Date.now() };
  sync(session);
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: keep ? randomUUID : undefined,
    enableDnsRebindingProtection: true,
    allowedHosts,
    onsessioninitialized: (sid) => void sessions.set(sid, session),
  });
  session.transport = transport;
  transport.onclose = () => {
    if (transport.sessionId) sessions.delete(transport.sessionId);
  };
  if (!keep)
    res.on('close', () => {
      void transport.close();
      void mcp.close();
    });
  await mcp.connect(transport);
  return transport.handleRequest(req, res, body);
}
