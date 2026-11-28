/**
 * Claude Code's MCP server for a map named, not an address: a stdio MCP
 * server that passes each message on to the map's adapter (`/mcp`), found
 * in the registry of servers (registry.ts) at each call. A connected folder's
 * `.mcp.json` runs it (plugins/connect), since Claude Code's HTTP servers
 * need a fixed URL, and a map's server takes any free port.
 *
 *   node plugins/claude-code/proxy.ts <map>
 *   node plugins/claude-code/proxy.ts current
 *
 * `current` follows the switch (`<home>/current`, `npm run map -- use`):
 * the map it names is read again at each call, so a switch moves every
 * session at once. A map may be remote (`<home>/remotes/<name>.json`): its
 * `/mcp` is reached at its address, with its token as `Authorization: Bearer`.
 *
 * - The map moved (it started again, on another port): the adapter doesn't
 *   know the session, so the proxy opens a new one with the client's own
 *   `initialize` and sends the message again. The client sees nothing.
 * - The map isn't running: `initialize` is answered here, with no tools,
 *   `tools/list` with none, and a tool call with an error that says so. When
 *   the map then starts, the proxy tells the client its tools changed
 *   (`notifications/tools/list_changed`), and it lists them.
 *
 * Plain Node, no imports from the repository but registry.ts beside it.
 */
import { CURRENT, currentOf, homeOf, reachOf, type Reach } from "./registry.ts";

type Msg = { jsonrpc: "2.0"; id?: string | number | null; method?: string; params?: any; result?: unknown; error?: unknown };

export interface ProxyOptions {
  map: string;
  /** Sends a message to the client (a line on stdout). */
  send(msg: object): void;
  /** The registry's home (default ARCHIPELAGO_HOME or ~/.archipelago). */
  home?: string;
  /** How often to look whether a map that was down has started, in ms (default 2000). */
  poll?: number;
}

export const PROXY = { name: "archipelago", version: "0.1.0" };

/** A proxy for one client: `handle` each message it sends; `close` when it goes. */
export function proxy({ map, send, home = homeOf(), poll = 2000 }: ProxyOptions) {
  let init: Msg | undefined;
  let session: string | undefined;
  let at: string | undefined;
  let opening: Promise<boolean> | undefined;
  /** Whether the client was told there are no tools, because the map was down. */
  let toldNone = false;
  let timer: ReturnType<typeof setInterval> | undefined;

  /** Where the map is now, and its token: read again at each call. */
  let reach: Reach | undefined;
  const where = () => (reach = reachOf(map, home));
  /** What to say while there is no map to reach: down, or (for `current`) none named. */
  const missing = () => {
    if (map !== CURRENT) return `The map ${map} isn't running`;
    const named = currentOf(home);
    return named ? `The map ${named} (the current one) isn't running` : "No map is current: npm run map -- use <name> sets one";
  };

  const post = async (url: string, msg: Msg | Msg[], withSession: boolean) =>
    fetch(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
        ...(withSession && session ? { "mcp-session-id": session } : {}),
        ...(reach?.token ? { authorization: `Bearer ${reach.token}` } : {}),
      },
      body: JSON.stringify(msg),
    });

  /** A session with the adapter at `url`, opened with the client's own `initialize`. */
  const open = (url: string) =>
    (opening ??= (async () => {
      try {
        if (!init) return false;
        session = undefined;
        const res = await post(url, init, false);
        if (!res.ok) return false;
        session = res.headers.get("mcp-session-id") ?? undefined;
        await res.text();
        at = url;
        await post(url, { jsonrpc: "2.0", method: "notifications/initialized" }, true).then((r) => r.text()).catch(() => undefined);
        return true;
      } catch {
        return false;
      } finally {
        opening = undefined;
      }
    })());

  const down = (msg: Msg): object | undefined => {
    if (msg.id === undefined) return undefined;
    switch (msg.method) {
      case "initialize":
        return {
          jsonrpc: "2.0",
          id: msg.id,
          result: {
            protocolVersion: typeof msg.params?.protocolVersion === "string" ? msg.params.protocolVersion : "2025-06-18",
            capabilities: { tools: { listChanged: true } },
            serverInfo: PROXY,
            instructions: `${missing()}. Its tools appear when it starts.`,
          },
        };
      case "ping":
        return { jsonrpc: "2.0", id: msg.id, result: {} };
      case "tools/list":
        toldNone = true;
        watch();
        return { jsonrpc: "2.0", id: msg.id, result: { tools: [] } };
      default:
        return { jsonrpc: "2.0", id: msg.id, error: { code: -32000, message: `${missing()}.` } };
    }
  };

  /** While the client holds no tools, look for the map; once it runs, tell the client to list them. */
  const watch = () => {
    if (timer) return;
    timer = setInterval(() => {
      if (!where()) return;
      clearInterval(timer);
      timer = undefined;
      if (toldNone) {
        toldNone = false;
        send({ jsonrpc: "2.0", method: "notifications/tools/list_changed" });
      }
    }, poll);
  };

  /** The answer to one message from the client, or nothing for a notification. */
  async function handle(msg: Msg): Promise<object | undefined> {
    if (msg.method === "initialize") init = msg;
    const url = where()?.mcp;
    if (!url) {
      if (msg.method === "initialize") watch();
      return down(msg);
    }
    try {
      if (msg.method === "initialize") {
        session = undefined;
        const res = await post(url, msg, false);
        session = res.headers.get("mcp-session-id") ?? undefined;
        at = url;
        const out = (await res.json()) as Msg & { result?: { capabilities?: { tools?: object } } };
        // The proxy may tell the client its tools changed (a map that starts later).
        if (out.result?.capabilities) out.result.capabilities.tools = { ...(out.result.capabilities.tools ?? {}), listChanged: true };
        return out;
      }
      // A map that moved, or a client that never initialized here: a session first.
      if (at !== url && init && msg.method !== "notifications/initialized" && !(await open(url))) return down(msg);
      let res = await post(url, msg, true);
      if (res.status === 404 && init && (await open(url))) res = await post(url, msg, true);
      if (msg.method === "notifications/initialized") at = url;
      if (res.status === 202 || msg.id === undefined) {
        await res.text();
        return undefined;
      }
      const out = (await res.json()) as Msg;
      if (msg.method === "tools/list") toldNone = false;
      return out;
    } catch {
      return down(msg);
    }
  }

  return {
    handle,
    close() {
      clearInterval(timer);
      timer = undefined;
    },
  };
}

if (import.meta.main) {
  // No name: the current map, as `current`.
  const map = process.argv[2] ?? CURRENT;
  const p = proxy({ map, send: (m) => process.stdout.write(`${JSON.stringify(m)}\n`) });
  let rest = "";
  process.stdin.setEncoding("utf8");
  process.stdin.on("data", (chunk: string) => {
    rest += chunk;
    let nl: number;
    while ((nl = rest.indexOf("\n")) >= 0) {
      const line = rest.slice(0, nl).trim();
      rest = rest.slice(nl + 1);
      if (!line) continue;
      let msg: Msg;
      try {
        msg = JSON.parse(line) as Msg;
      } catch {
        continue;
      }
      void p.handle(msg).then((out) => out && process.stdout.write(`${JSON.stringify(out)}\n`));
    }
  });
  process.stdin.on("end", () => {
    p.close();
    process.exit(0);
  });
}
