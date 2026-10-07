// One local process owns the database and serves both surfaces:
//   POST /mcp        MCP (streamable HTTP) for agents
//   POST /api/<tool> the same tools for the human CLI and web UI, with human authority
//   POST /agent/<tool> the same tools with agent authority, as plain JSON, for
//                    hooks and scripts that cannot speak MCP
//   POST /hooks/session-start, /hooks/session-end
//                    Claude Code HTTP hooks: a session registers itself and is
//                    handed what the map knows about its repository
//   GET  /           the web UI
// It listens on 127.0.0.1 only.

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { readFile } from 'node:fs/promises';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { join } from 'node:path';
import { z } from 'zod';
import { loadConfig } from './config.ts';
import { openDb } from './db.ts';
import { configureLauncher, stopAllLaunched } from './launcher.ts';
import { Lattice } from './lattice.ts';
import { Registry } from './packs.ts';
import { hookSessionEnd, hookSessionStart } from './sessions.ts';
import { callTool, TOOLS } from './tools.ts';

const actorField = {
  actor: z.string().optional().describe('Who you are, e.g. "claude-code:aperture". Recorded against everything you do.'),
};

function buildMcp(lattice: Lattice): McpServer {
  const mcp = new McpServer({ name: 'lattice', version: '0.1.0' });
  for (const [name, tool] of Object.entries(TOOLS)) {
    if (tool.humanOnly) continue;
    mcp.registerTool(name, { description: tool.description, inputSchema: { ...tool.input, ...actorField } }, async (args: Record<string, unknown>) => {
      const { actor, ...input } = args;
      try {
        const result = await callTool(lattice, { kind: 'agent', name: (actor as string) || 'claude' }, name, input);
        return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] };
      } catch (err) {
        return { content: [{ type: 'text' as const, text: (err as Error).message }], isError: true };
      }
    });
  }
  return mcp;
}

async function readJson(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  const text = Buffer.concat(chunks).toString('utf8');
  return text ? JSON.parse(text) : undefined;
}

function send(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'content-type': 'application/json' }).end(JSON.stringify(body));
}

const UI_DIR = join(import.meta.dirname, '..', 'ui');
const UI_FILES: Record<string, string> = {
  '/': 'index.html',
  '/app.js': 'app.js',
  '/style.css': 'style.css',
};
const MIME: Record<string, string> = { html: 'text/html', js: 'text/javascript', css: 'text/css' };

export function createHttpServer(lattice: Lattice, port: number): Server {
  const hosts = [`127.0.0.1:${port}`, `localhost:${port}`];
  const origins = hosts.map((h) => `http://${h}`);

  return createServer(async (req, res) => {
    try {
      const url = new URL(req.url ?? '/', 'http://localhost');

      if (req.method === 'GET' && url.pathname === '/health') return send(res, 200, { ok: true, name: 'lattice' });

      if (req.method === 'GET' && UI_FILES[url.pathname]) {
        const file = UI_FILES[url.pathname];
        res.writeHead(200, { 'content-type': `${MIME[file.split('.').pop()!]}; charset=utf-8`, 'cache-control': 'no-store' });
        return res.end(await readFile(join(UI_DIR, file)));
      }

      if (url.pathname === '/mcp') {
        if (req.method !== 'POST') return send(res, 405, { error: 'This server is stateless: POST only.' });
        const mcp = buildMcp(lattice);
        const transport = new StreamableHTTPServerTransport({
          sessionIdGenerator: undefined,
          enableDnsRebindingProtection: true,
          allowedHosts: hosts,
        });
        res.on('close', () => {
          void transport.close();
          void mcp.close();
        });
        await mcp.connect(transport);
        return await transport.handleRequest(req, res, await readJson(req));
      }

      const surface = url.pathname.startsWith('/api/') ? 'api' : url.pathname.startsWith('/agent/') ? 'agent' : undefined;
      if (req.method === 'POST' && surface) {
        // /api carries human authority, so keep other web pages out: a browser
        // always sends Origin on a cross-site POST, and cannot send a JSON
        // content type without a preflight we never answer. Our own UI is the
        // one origin allowed.
        const origin = req.headers.origin;
        if ((origin && !origins.includes(origin)) || !hosts.includes(req.headers.host ?? '') || !req.headers['content-type']?.startsWith('application/json')) {
          return send(res, 403, { error: 'The API accepts only local JSON requests from the CLI, hooks or the lattice UI.' });
        }
        const name = url.pathname.slice(surface.length + 2);
        try {
          const body = ((await readJson(req)) ?? {}) as Record<string, unknown>;
          if (surface === 'api') return send(res, 200, { result: await callTool(lattice, { kind: 'human', name: 'local' }, name, body) });
          const { actor, ...input } = body;
          return send(res, 200, { result: await callTool(lattice, { kind: 'agent', name: (actor as string) || 'script' }, name, input) });
        } catch (err) {
          return send(res, 400, { error: (err as Error).message });
        }
      }

      if (req.method === 'POST' && url.pathname.startsWith('/hooks/')) {
        if (req.headers.origin || !hosts.includes(req.headers.host ?? '')) return send(res, 403, { error: 'Hooks are local only.' });
        const body = ((await readJson(req)) ?? {}) as { session_id?: string; cwd?: string; reason?: string };
        if (url.pathname === '/hooks/session-start') {
          const additionalContext = await hookSessionStart(lattice, body);
          return send(res, 200, { hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext } });
        }
        if (url.pathname === '/hooks/session-end') {
          await hookSessionEnd(lattice, body);
          return send(res, 200, {});
        }
      }

      send(res, 404, { error: 'Not found' });
    } catch (err) {
      if (!res.headersSent) send(res, 500, { error: (err as Error).message });
      else res.end();
    }
  });
}

if (import.meta.main) {
  const config = loadConfig();
  const lattice = new Lattice(await openDb(config.dataDir), new Registry(config.packsDir, config.packs), config.policy);
  configureLauncher({ mcpUrl: `http://127.0.0.1:${config.port}/mcp`, dir: join(config.dataDir, '..', 'runs'), command: ['claude'] });
  const server = createHttpServer(lattice, config.port);
  server.listen(config.port, '127.0.0.1', () => {
    console.log(`lattice listening on http://127.0.0.1:${config.port}  (MCP at /mcp)`);
    console.log(`data: ${config.dataDir}`);
    console.log(`packs: ${lattice.registry.packs.map((p) => `${p.id}@${p.version}`).join(', ')}`);
  });
  const stop = async () => {
    stopAllLaunched();
    server.close();
    await lattice.db.close();
    process.exit(0);
  };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
}
