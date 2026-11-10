// Signing a machine's hooks in to Archipelago through the browser, so a plugin install needs no token copied by hand.
// It is OAuth with PKCE and a redirect to this machine, as an MCP client does it (src/oauth.ts): the hook (pelago-hook.mjs)
// asks for the sign-in when the server answers 401 and no token is set, this file run on its own waits for the browser
// to come back, and the token it is given is kept in a file of this person's (the plugin's data folder, else
// ~/.pelago), never printed, and refreshed before it runs out. PELAGO_AGENT_TOKEN, where it is set, still wins.
//
//   node pelago-login.mjs sign-in [<origin>]          sign in, waiting for the browser (the installer runs it)
//   node pelago-login.mjs headers                     the sign-in as headers, for Claude Code's headersHelper
//   node pelago-login.mjs call <tool> '<json>'        one call to the map, for a session whose tools have not loaded
//   node pelago-login.mjs <origin> <folder> <port> <verifier> <state> <client id> [<address to open>]   (started by the hook, detached)

import { execFile, execFileSync, spawn } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/** How long a sign-in waits for the browser, and how long before it runs out a token is refreshed. */
const WAIT_MS = 10 * 60_000;
const EARLY_MS = 2 * 60_000;
const REDIRECT = '/callback';

/**
 * Where this person's sign-ins are kept: ~/.pelago (PELAGO_HOME for another), one place that the installer, the hooks
 * and the map's tools (the plugin's headersHelper) all read, so one Allow in the browser serves them all.
 */
export const folderOf = (env = process.env) => env.PELAGO_HOME || join(homedir(), '.pelago');
/** The server this file signs in to when nothing names one; the plugin and the installer write the hosted one in. */
const DEFAULT = "https://app.archipelago.tools";
const hostOf = (origin) => new URL(origin).host.replace(/[^\w.-]/g, '_');
const fileOf = (folder, origin, what) => join(folder, `${what}-${hostOf(origin)}.json`);
const readJson = (file) => {
  try {
    return JSON.parse(readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
};
const keep = (file, value) => {
  mkdirSync(join(file, '..'), { recursive: true });
  writeFileSync(file, JSON.stringify(value), { mode: 0o600 });
};

/** Whether a process is still running. */
const alive = (pid) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return err.code !== 'ESRCH';
  }
};

/** A refresh made by one hook at a time: a second waits for the first, then reads what it kept. */
async function locked(file, fn) {
  const lock = `${file}.lock`;
  for (let i = 0; i < 30; i++) {
    try {
      mkdirSync(join(file, '..'), { recursive: true });
      writeFileSync(lock, String(process.pid), { flag: 'wx' });
      try {
        return await fn();
      } finally {
        rmSync(lock, { force: true });
      }
    } catch (err) {
      if (err.code !== 'EEXIST') throw err;
      // A lock left by a hook that was stopped goes after ten seconds.
      try {
        if (Date.now() - statSync(lock).mtimeMs > 10_000) rmSync(lock, { force: true });
      } catch { /* gone already */ }
      await new Promise((r) => setTimeout(r, 100));
    }
  }
  return fn();
}

async function tokenCall(origin, form) {
  const res = await fetch(`${origin}/oauth/token`, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(form), signal: AbortSignal.timeout(10_000) });
  const said = await res.json().catch(() => ({}));
  if (!res.ok || !said.access_token) throw Object.assign(new Error(said.error_description || `the server answered ${res.status}`), { refused: res.status === 400 });
  return said;
}

const kept = (said, client) => ({ access: said.access_token, refresh: said.refresh_token, until: Date.now() + (said.expires_in ?? 3600) * 1000, client });

/**
 * The token this machine's hooks act with at this server, from a sign-in kept before: refreshed when it is near its
 * end. Undefined when there is none, or the server no longer takes it (then it is forgotten, and asked for again).
 */
export async function accessToken(origin, folder = folderOf()) {
  const file = fileOf(folder, origin, 'signed-in');
  const now = readJson(file);
  if (!now?.access) return undefined;
  if (now.until - Date.now() > EARLY_MS) return now.access;
  return locked(file, async () => {
    const again = readJson(file);
    if (again?.access && again.until - Date.now() > EARLY_MS) return again.access;
    try {
      const said = await tokenCall(origin, { grant_type: 'refresh_token', refresh_token: again.refresh, client_id: again.client, resource: `${origin}/mcp` });
      const next = kept(said, again.client);
      keep(file, next);
      return next.access;
    } catch (err) {
      if (err.refused) rmSync(file, { force: true });
      return err.refused ? undefined : again.access;
    }
  });
}

/** Forget the sign-in kept for this server (the server refused it). */
export const forget = (origin, folder = folderOf()) => rmSync(fileOf(folder, origin, 'signed-in'), { force: true });

/**
 * Ask for a sign-in: the address a person opens to say Allow, and a process that waits for the browser to come back
 * and keeps the token. One sign-in at a time per server: a second session starting meanwhile is given the same address.
 */
export async function signIn(origin, folder = folderOf(), { open = !process.env.PELAGO_LOGIN_QUIET } = {}) {
  const pending = fileOf(folder, origin, 'signing-in');
  const was = readJson(pending);
  if (was?.url && Date.now() - was.at < WAIT_MS && alive(was.pid)) return { url: was.url, waiting: true };
  const port = await freePort();
  const redirect = `http://127.0.0.1:${port}${REDIRECT}`;
  const res = await fetch(`${origin}/oauth/register`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ client_name: 'Claude Code hooks', redirect_uris: [`http://127.0.0.1${REDIRECT}`] }), signal: AbortSignal.timeout(5_000) });
  const { client_id } = await res.json();
  if (!res.ok || !client_id) throw new Error(`the server would not register the sign-in (${res.status})`);
  const verifier = randomBytes(32).toString('base64url');
  const state = randomBytes(16).toString('base64url');
  const url = new URL(`${origin}/oauth/authorize`);
  for (const [k, v] of Object.entries({ response_type: 'code', client_id, redirect_uri: redirect, code_challenge: createHash('sha256').update(verifier).digest('base64url'), code_challenge_method: 'S256', state, scope: 'map offline_access', resource: `${origin}/mcp` })) url.searchParams.set(k, v);
  const child = spawn(process.execPath, [fileURLToPath(import.meta.url), origin, folder, String(port), verifier, state, client_id, open ? url.href : ''], { detached: true, stdio: 'ignore', windowsHide: true });
  child.unref();
  keep(pending, { url: url.href, pid: child.pid, at: Date.now() });
  return { url: url.href, waiting: false };
}

/** A port on this machine that nothing listens on now. */
const freePort = () =>
  new Promise((done, fail) => {
    const probe = createServer();
    probe.once('error', fail);
    probe.listen(0, '127.0.0.1', () => {
      const { port } = probe.address();
      probe.close(() => done(port));
    });
  });

/** Open an address in this person's browser. */
function openBrowser(url) {
  const [cmd, args] = process.platform === 'win32' ? ['rundll32', ['url.dll,FileProtocolHandler', url]] : process.platform === 'darwin' ? ['open', [url]] : ['xdg-open', [url]];
  execFile(cmd, args, { windowsHide: true }, () => {});
}

const PAGE = (words) => `<!doctype html><meta charset="utf-8"><title>Archipelago</title><body style="font:16px system-ui;margin:4em auto;max-width:30em">${words}</body>`;

/** Run on its own: wait for the browser to come back with a code, trade it, keep the token. */
async function waitForBrowser([origin, folder, port, verifier, state, client, open]) {
  const pending = fileOf(folder, origin, 'signing-in');
  const redirect = `http://127.0.0.1:${port}${REDIRECT}`;
  const done = (code) => {
    const was = readJson(pending);
    if (was?.pid === process.pid) rmSync(pending, { force: true });
    process.exit(code);
  };
  const server = createServer(async (req, res) => {
    const at = new URL(req.url ?? '/', redirect);
    if (at.pathname !== REDIRECT) return res.writeHead(404).end();
    const answer = (status, words) => res.writeHead(status, { 'content-type': 'text/html; charset=utf-8' }).end(PAGE(words));
    if (at.searchParams.get('state') !== state) return answer(400, 'This sign-in is not the one this computer asked for. Start a new Claude Code session to ask again.');
    if (at.searchParams.get('error')) {
      answer(200, 'Not connected. Claude Code’s sessions will not be on the map until you allow it.');
      return server.close(() => done(1));
    }
    try {
      const said = await tokenCall(origin, { grant_type: 'authorization_code', code: at.searchParams.get('code') ?? '', redirect_uri: redirect, client_id: client, code_verifier: verifier, resource: `${origin}/mcp` });
      keep(fileOf(folder, origin, 'signed-in'), kept(said, client));
      answer(200, 'Connected. Claude Code’s sessions on this computer now go on your map: you can close this tab.');
      server.close(() => done(0));
    } catch (err) {
      answer(400, `Not connected: ${err.message}. Start a new Claude Code session to try again.`);
      server.close(() => done(1));
    }
  });
  server.listen(Number(port), '127.0.0.1', () => {
    if (open) openBrowser(open);
  });
  setTimeout(() => server.close(() => done(1)), WAIT_MS).unref();
}

/** The server named for this run: Claude Code's for the MCP server it asks headers for, else PELAGO_URL, else the default. */
const originNamed = (env = process.env) => {
  try {
    if (env.CLAUDE_CODE_MCP_SERVER_URL) return new URL(env.CLAUDE_CODE_MCP_SERVER_URL).origin;
  } catch { /* not an address: the next says */ }
  return (env.PELAGO_URL || DEFAULT).replace(/\/$/, '');
};
const tokenFor = async (origin) => process.env.PELAGO_AGENT_TOKEN || (await accessToken(origin).catch(() => undefined));

/** Call one of the map's tools as plain JSON with this machine's sign-in: what an agent uses before its tools load. */
export async function call(origin, tool, input) {
  const token = await tokenFor(origin);
  const res = await fetch(`${origin}/agent/${tool}`, { method: 'POST', headers: { 'content-type': 'application/json', ...(token && { authorization: `Bearer ${token}` }) }, body: JSON.stringify(input ?? {}), signal: AbortSignal.timeout(30_000) });
  return { status: res.status, text: await res.text() };
}

/** Sign in, waiting here until the browser comes back: what the installer runs. True once signed in. */
export async function signInHere(origin, say = console.log) {
  if ((await tokenFor(origin)) && (await call(origin, 'query', {})).status === 200) return say(`Already signed in to ${origin}.`), true;
  forget(origin);
  const { url, waiting } = await signIn(origin, folderOf(), { open: true });
  if (waiting) openBrowser(url);
  say(`A browser window is open to sign in to ${origin}: say Allow there.\nIf no window opened, open this address:\n${url}`);
  for (const until = Date.now() + WAIT_MS; Date.now() < until; await new Promise((r) => setTimeout(r, 1000))) {
    if (readJson(fileOf(folderOf(), origin, 'signed-in'))?.access) return say('Signed in.'), true;
    const pending = readJson(fileOf(folderOf(), origin, 'signing-in'));
    if (!pending || !alive(pending.pid)) break;
  }
  say('Not signed in: the browser did not say Allow.');
  return false;
}

const same = (a, b) => a.replace(/\\/g, '/').toLowerCase() === b.replace(/\\/g, '/').toLowerCase();
if (process.argv[1] && existsSync(process.argv[1]) && same(fileURLToPath(import.meta.url), process.argv[1])) {
  const [what, ...rest] = process.argv.slice(2);
  // Claude Code's headersHelper: the sign-in as Authorization, or nothing, so Claude's own sign-in is the fallback.
  if (what === 'headers') {
    const token = await tokenFor(originNamed());
    process.stdout.write(JSON.stringify(token ? { Authorization: `Bearer ${token}` } : {}));
  } else if (what === 'sign-in') process.exit((await signInHere((rest[0] || originNamed()).replace(/\/$/, ''))) ? 0 : 1);
  else if (what === 'call') {
    // node pelago-login.mjs call <tool> '<json>': the answer, never the token.
    const { status, text } = await call(originNamed(), rest[0], JSON.parse(rest[1] || '{}'));
    process.stdout.write(text + '\n');
    process.exit(status < 300 ? 0 : 1);
  } else await waitForBrowser(process.argv.slice(2));
}

// What the hook says when it runs as the plugin's: Claude Code's names for its events, and what each answer carries.
const EVENTS = { 'session-start': 'SessionStart', prompt: 'UserPromptSubmit', stop: 'Stop', 'file-used': 'PostToolUse' };

/** The hook's answer with what it adds: context for the agent beside the server's, and a line for the person. */
export function withSaid(out, name, context, notice) {
  let answer = {};
  try {
    answer = typeof out === 'string' ? JSON.parse(out || '{}') : (out ?? {});
  } catch { /* not JSON: what is added stands alone */ }
  const said = [answer.hookSpecificOutput?.additionalContext, ...context].filter(Boolean).join('\n\n');
  if (said && EVENTS[name]) answer.hookSpecificOutput = { ...answer.hookSpecificOutput, hookEventName: EVENTS[name], additionalContext: said };
  if (notice) answer.systemMessage = [answer.systemMessage, notice].filter(Boolean).join('\n');
  return answer;
}

/** For one session, run by the plugin: its rules, its start held until a sign-in, and the asking for that sign-in. */
export function plugin(session, hookUrl, folder = folderOf()) {
  const id = typeof session.session_id === 'string' && /^[\w-]+$/.test(session.session_id) ? session.session_id : null;
  const late = id && join(folder, 'late', id);
  return {
    /** The working rules, which a plugin cannot add to CLAUDE.md, said at the start instead. */
    rules: () => {
      try {
        return readFileSync(new URL('../pelago.md', hookUrl), 'utf8');
      } catch {
        return '';
      }
    },
    /**
     * A plugin installs no commit-msg hook, so where the checkout has none naming the run (the setup's), the session is
     * asked to name it in its commits itself. Nothing outside a git checkout, where keepRun kept no run.
     */
    trailer: (run, cwd) => {
      if (!run) return undefined;
      try {
        const git = execFileSync('git', ['-C', cwd || '.', 'rev-parse', '--git-common-dir'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 3000 }).trim();
        if (readFileSync(resolve(cwd || '.', git, 'hooks', 'commit-msg'), 'utf8').includes('Archipelago-Run')) return undefined;
      } catch { /* no hook there: ask */ }
      return `End each commit message you make in this session with the trailer "Archipelago-Run: ${run}", so the map reads the commit against this session's work.`;
    },
    /** The server's answer to a start, less its word on a project's setup files: a plugin is renewed by Claude Code. */
    fromServer: (text) => {
      try {
        const answer = JSON.parse(text);
        const said = answer.hookSpecificOutput?.additionalContext;
        if (typeof said === 'string') answer.hookSpecificOutput.additionalContext = said.replace(/\n\nThis folder's Archipelago files \(hooks[\s\S]*?next session\./, '');
        return answer;
      } catch {
        return text;
      }
    },
    /** A start that waited for the sign-in, taken to be sent now. */
    lateStart: () => {
      try {
        const body = late && readFileSync(late, 'utf8');
        if (body) rmSync(late, { force: true });
        return body || null;
      } catch {
        return null;
      }
    },
    /** Ask the person to sign in; a start is kept to be sent once they have. */
    askSignIn: async (origin, startBody) => {
      if (late && startBody) keep(late, JSON.parse(startBody));
      try {
        const { url, waiting } = await signIn(origin, folder);
        return {
          notice: `Archipelago: ${waiting ? 'sign in to connect this computer' : 'a browser window opened to connect this computer'}. Say Allow there, and this session goes on your map with your next message. If no window opened: ${url}`,
          context: 'This session is not on the Archipelago map yet: the person is asked to sign in, in their browser, and it is registered with their next message. The map’s tools use the same sign-in from the next session. Say so in one line in your first reply.',
        };
      } catch (err) {
        return { notice: `Archipelago: could not ask for a sign-in at ${origin} (${err.message}). This session is not on the map.`, context: '' };
      }
    },
  };
}
