/**
 * What Claude Code needs to report to this map: the MCP line and the hooks
 * for `~/.claude/settings.json`, built from where this server is. Plain
 * data, no I/O: the server plugin hands it to the page, and the tests check it.
 *
 * A token is never in it. Where the server wants one, the texts hold
 * `TOKEN`, and the page puts the person's own in when they make one.
 */

/** Stands for the person's token in the texts until they make one. */
export const TOKEN = "<token>";

/** Claude Code's events the adapter answers (plugins/claude-code/README.md). */
export const EVENTS = ["SessionStart", "UserPromptSubmit", "PreToolUse", "PostToolUse", "PostToolUseFailure", "Stop", "SessionEnd", "SubagentStart", "SubagentStop", "PreCompact", "PermissionRequest", "Notification"] as const;
const MATCHED = new Set(["PreToolUse", "PostToolUse", "PostToolUseFailure", "PermissionRequest"]);

export interface Where {
  /** The adapter's `/hook`. */
  hook: string;
  /** The adapter's `/mcp`. */
  mcp: string;
  /** How each hook runs: a command that forwards stdin to `hook` (plugins/claude-code/hook.ts). */
  command: string;
  /** Whether the server wants a token: the texts then hold `TOKEN`. */
  token: boolean;
  /** The name the MCP server is added under. */
  name?: string;
  /** On a guest map: where the guest goes to keep it (sign-up). */
  save?: string;
  /** On a guest map: where someone with an account signs in instead. */
  signin?: string;
  /** Where a hook script is served (`<origin>/hook.ts`): the hooks are then one command that fetches it and wires it in. */
  script?: string;
  /** Where the page asks for a token (a path, POST `{name}` → `{name, token}`), instead of `connect.token`. */
  tokenAt?: string;
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
  /** On a guest map: where someone with an account signs in instead. */
  signin?: string;
  /** With a served script: one command for a terminal that fetches it to ~/.archipelago/hook.ts and merges the hooks into ~/.claude/settings.json. */
  install?: string;
  /** Where the page asks for a token, when not through `connect.token`. */
  tokenAt?: string;
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
  return {
    mcp,
    hooks: JSON.stringify(settings, null, 2),
    token: w.token,
    hookUrl: w.hook,
    mcpUrl: w.mcp,
    ...(w.save ? { save: w.save } : {}),
    ...(w.signin ? { signin: w.signin } : {}),
    ...(w.script ? { install: install(w.script, w.hook, w.token) } : {}),
    ...(w.tokenAt ? { tokenAt: w.tokenAt } : {}),
  };
}

/** Safe inside a double-quoted argument in bash, PowerShell and cmd alike, and in a single-quoted JS string: no quotes, `$`, backticks, `!`, `%` or backslashes. */
const SAFE = /^[^"'$`!%\\\s]*$/;

/**
 * One command, the same in bash, PowerShell and cmd: Node fetches the hook
 * script to ~/.archipelago/hook.ts, then merges a hook per event into
 * ~/.claude/settings.json (replacing an earlier one of its own, keeping the
 * rest), with the token in its env when there is one.
 */
export function install(script: string, hook: string, token: boolean): string {
  // The hook's transcript, as numbers, is a file beside it: fetched with it, from beside it.
  const slim = script.replace(/hook\.ts$/, "slim.ts");
  for (const s of [script, slim, hook]) if (!SAFE.test(s)) throw new Error(`Not safe in a command: ${s}`);
  const list = (xs: Iterable<string>) => `[${[...xs].map((x) => `'${x}'`).join(",")}]`;
  const env = token ? `c.env=Object.assign(c.env||{},{ARCHIPELAGO_TOKEN:'${TOKEN}'});` : "";
  const js =
    `const f=require('fs'),p=require('path'),o=require('os');` +
    `const d=p.join(o.homedir(),'.archipelago'),h=p.join(d,'hook.ts'),s=p.join(o.homedir(),'.claude','settings.json');` +
    `const E=${list(EVENTS)},M=${list(MATCHED)};` +
    `const get=u=>fetch(u).then(r=>{if(r.ok)return r.text();throw new Error(u+': '+r.status)});` +
    `Promise.all([get('${script}'),get('${slim}')]).then(([t,sl])=>{` +
    `f.mkdirSync(d,{recursive:true});f.writeFileSync(h,t);f.writeFileSync(p.join(d,'slim.ts'),sl);` +
    `let c={};try{c=JSON.parse(f.readFileSync(s,'utf8'))}catch(e){}` +
    `const cmd='node '+JSON.stringify(h.split(p.sep).join('/'))+' ${hook}';` +
    `c.hooks=c.hooks||{};` +
    `for(const e of E){const g=(c.hooks[e]||[]).filter(x=>JSON.stringify(x).indexOf('.archipelago/hook.ts')<0);` +
    `g.push(Object.assign(M.includes(e)?{matcher:'*'}:{},{hooks:[{type:'command',command:cmd,timeout:5}]}));c.hooks[e]=g}` +
    env +
    `f.mkdirSync(p.dirname(s),{recursive:true});f.writeFileSync(s,JSON.stringify(c,null,2));console.log('Claude Code reports to the map: '+s)})` +
    `.catch(e=>{console.error(String(e));process.exitCode=1})`;
  return `node -e "${js}"`;
}

/** A text with the person's token put in. */
export const withToken = (text: string, token: string | undefined) => (token ? text.replaceAll(TOKEN, token) : text);
