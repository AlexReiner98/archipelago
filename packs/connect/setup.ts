/**
 * What Claude Code needs to report to this map: the MCP line and the hooks
 * for `~/.claude/settings.json`, built from where this server is. Plain
 * data, no I/O: the server pack hands it to the page, and the tests check it.
 *
 * A token is never in it. Where the server wants one, the texts hold
 * `TOKEN`, and the page puts the person's own in when they make one.
 */

/** Stands for the person's token in the texts until they make one. */
export const TOKEN = "<token>";

/** Claude Code's events the adapter answers (packs/claude-code/README.md). */
export const EVENTS = ["SessionStart", "UserPromptSubmit", "PreToolUse", "PostToolUse", "PostToolUseFailure", "Stop", "SessionEnd", "SubagentStart", "SubagentStop", "PreCompact", "PermissionRequest", "Notification"] as const;
const MATCHED = new Set(["PreToolUse", "PostToolUse", "PostToolUseFailure", "PermissionRequest"]);

export interface Where {
  /** The adapter's `/hook`. */
  hook: string;
  /** The adapter's `/mcp`. */
  mcp: string;
  /** How each hook runs: a command that forwards stdin to `hook` (packs/claude-code/hook.ts). */
  command: string;
  /** Whether the server wants a token: the texts then hold `TOKEN`. */
  token: boolean;
  /** The name the MCP server is added under. */
  name?: string;
  /** On a guest map: where the guest goes to keep it (sign-up). */
  save?: string;
}

export interface Setup {
  /** One line for a terminal. */
  mcp: string;
  /** A settings file's JSON, to merge into `~/.claude/settings.json`. */
  hooks: string;
  /** Whether the texts hold `TOKEN`. */
  token: boolean;
  hookUrl: string;
  mcpUrl: string;
  /** On a guest map: where the guest goes to keep it. */
  save?: string;
}

const quote = (s: string) => (/[\s"]/.test(s) ? `"${s.replaceAll('"', '\\"')}"` : s);

/** The MCP line and the hooks, for where this server is. */
export function setup(w: Where): Setup {
  const name = w.name ?? "archipelago";
  const header = w.token ? ` --header ${quote(`Authorization: Bearer ${TOKEN}`)}` : "";
  const mcp = `claude mcp add --scope user --transport http ${name} ${w.mcp}${header}`;
  const hooks = Object.fromEntries(
    EVENTS.map((e) => [e, [{ ...(MATCHED.has(e) ? { matcher: "*" } : {}), hooks: [{ type: "command", command: w.command, timeout: 5 }] }]]),
  );
  const settings = { ...(w.token ? { env: { ARCHIPELAGO_TOKEN: TOKEN } } : {}), hooks };
  return { mcp, hooks: JSON.stringify(settings, null, 2), token: w.token, hookUrl: w.hook, mcpUrl: w.mcp, ...(w.save ? { save: w.save } : {}) };
}

/** A text with the person's token put in. */
export const withToken = (text: string, token: string | undefined) => (token ? text.replaceAll(TOKEN, token) : text);
