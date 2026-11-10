// Connect this computer's coding agents to an Archipelago map in one go: the server hands this script out at GET
// /connect/install.mjs with two lines in front of it, ORIGIN (its own address) and FILES (what it keeps in ~/.pelago:
// pelago-login.mjs, which signs in through the browser, and the hook Codex and Cursor run, with the working rules). A person runs it from the one line on /connect/install; an agent asked to install
// Archipelago runs the same line. It says each step before it takes it, and writes no secret anywhere it prints.
//
//   For each agent it finds (or names with --client):
//   - Claude Code: the plugin (claude plugin install), whose hooks and tools share one sign-in, made here in the browser.
//   - Codex: the map as an MCP server (codex mcp add), then Codex's own sign-in (codex mcp login); the session hooks
//     in ~/.codex/hooks.json, on the one sign-in made here.
//   - Cursor: the map as an MCP server in ~/.cursor/mcp.json (Cursor signs in when it first connects); the session
//     hooks in ~/.cursor/hooks.json, through pelago-cursor.mjs, on the one sign-in made here.
//   And an old token setup's `pelago` server in ~/.mcp.json, which every folder under home inherits, is offered out.
//
//   node -e "fetch('<origin>/connect/install.mjs').then(r=>r.text()).then(t=>import('data:text/javascript,'+encodeURIComponent(t)))" -- [options]
//     --client <claude|codex|cursor>   only these (repeat it, or a comma list); else every one found here
//     --yes                            ask nothing (an agent runs it so); an old server is then only reported
//     --remove-old                     take an old `pelago` server out of ~/.mcp.json (a copy is kept)
//     --dry-run                        say what it would do, and do nothing
// PELAGO_MARKETPLACE installs the plugin from another marketplace (a path, to try a change before it is pushed).

import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { createInterface } from 'node:readline/promises';
import { pathToFileURL } from 'node:url';

/* global ORIGIN, FILES */
const HOSTED = 'https://app.archipelago.tools';
const MARKETPLACE = process.env.PELAGO_MARKETPLACE || 'AlexReiner98/archipelago';
const CLIENTS = ['claude', 'codex', 'cursor'];
const OPTIONS = ['--client', '--yes', '--remove-old', '--dry-run'];

const args = process.argv.slice(1).filter((a) => a !== '--' && a !== '-');
const named = [];
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--client') named.push(...String(args[++i] ?? '').split(','));
  else if (args[i].startsWith('--client=')) named.push(...args[i].slice(9).split(','));
  else if (args[i].startsWith('--') && !OPTIONS.includes(args[i])) {
    console.error(`Unknown option ${args[i]}. The options are ${OPTIONS.join(', ')}.`);
    process.exit(2);
  }
}
const YES = args.includes('--yes');
const DRY = args.includes('--dry-run');
const REMOVE_OLD = args.includes('--remove-old');
const asked = named.map((c) => c.trim().toLowerCase()).filter(Boolean);
const wrong = asked.filter((c) => !CLIENTS.includes(c));
if (wrong.length) {
  console.error(`No client called ${wrong.join(', ')} here: the ones this sets up are ${CLIENTS.join(', ')}. ChatGPT and Grok Bot are set up in their own apps: ${ORIGIN}/connect/install says how.`);
  process.exit(2);
}

const say = (words) => console.log(words);
const step = (words) => console.log(`\n> ${words}`);
const HOME = homedir();
const interactive = process.stdin.isTTY && process.stdout.isTTY && !YES;
/** A command run where the person can see it; on Windows through the shell, where claude and codex are scripts. */
const quoted = (arg) => (/^[\w@./:=,\\-]+$/.test(arg) ? arg : `"${arg.replace(/"/g, '\\"')}"`);
const spawned = (cmd, argv, opts) => (process.platform === 'win32' ? spawnSync([cmd, ...argv].map(quoted).join(' '), { ...opts, shell: true }) : spawnSync(cmd, argv, opts));
const run = (cmd, argv, { quiet = false } = {}) => {
  if (DRY) return say(`  (would run) ${cmd} ${argv.join(' ')}`), { status: 0, stdout: '' };
  const r = spawned(cmd, argv, { stdio: quiet ? ['ignore', 'pipe', 'pipe'] : 'inherit', encoding: 'utf8', timeout: 5 * 60_000 });
  return { status: r.status ?? 1, stdout: r.stdout ?? '' };
};
const has = (cmd) => spawned(cmd, ['--version'], { stdio: 'ignore', timeout: 30_000 }).status === 0;
const readJson = (file) => {
  try {
    return JSON.parse(readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
};
async function confirm(question) {
  if (!interactive) return false;
  const ask = createInterface({ input: process.stdin, output: process.stdout });
  const answer = (await ask.question(`${question} [y/N] `)).trim().toLowerCase();
  ask.close();
  return answer === 'y' || answer === 'yes';
}

const found = { claude: has('claude'), codex: has('codex'), cursor: existsSync(join(HOME, '.cursor')) || has('cursor') };
const doing = asked.length ? asked : CLIENTS.filter((c) => found[c]);
say(`Archipelago: connecting this computer to ${ORIGIN}.`);
if (!doing.length) {
  say(`\nNo coding agent found here (Claude Code, Codex or Cursor). Install one, then run this again.\nChatGPT and Grok Bot are connected in their own apps: ${ORIGIN}/connect/install says how.`);
  process.exit(1);
}
for (const c of asked) if (!found[c]) say(`\n${c} was named but is not found on this computer: its step may fail.`);

// The sign-in, kept where every hook and the plugin's tools read it (~/.pelago), with its script, and the hook that
// Codex and Cursor run (a plugin brings its own), beside it.
const home = process.env.PELAGO_HOME || join(HOME, '.pelago');
const bin = join(home, 'bin');
const loginFile = join(bin, 'pelago-login.mjs');
if (!DRY) for (const [path, text] of Object.entries(FILES)) mkdirSync(dirname(join(home, path)), { recursive: true }), writeFileSync(join(home, path), text);
const login = DRY ? null : await import(pathToFileURL(loginFile).href);
const done = [];
const hookCommand = (script, name) => `node ${JSON.stringify(join(bin, script))} ${name}${script === 'pelago-hook.mjs' ? ' --plugin' : ''}`;
const ours = (entry) => JSON.stringify(entry).includes('pelago-hook.mjs') || JSON.stringify(entry).includes('pelago-cursor.mjs');
/** A client's hooks file with ours put in, and every hook of its own kept: ours from an earlier run are replaced. */
function withHooks(file, add, top = {}) {
  const now = readJson(file) ?? top;
  const hooks = { ...(now.hooks ?? {}) };
  for (const [event, entry] of Object.entries(add)) hooks[event] = [...(hooks[event] ?? []).filter((e) => !ours(e)), entry];
  if (DRY) return say(`  (would write) ${Object.keys(add).join(', ')} hooks in ${file}`);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify({ ...now, hooks }, null, 2) + '\n');
}
/** One sign-in for the hooks of clients whose tools sign in on their own: the first that needs it asks. */
let hooksSigned = false;
async function signHooks() {
  if (hooksSigned || DRY) return true;
  step('Signing in for the hooks, which tell your map what each session does: one Allow in your browser');
  hooksSigned = await login.signInHere(ORIGIN, (w) => say(`  ${w.replace(/\n/g, '\n  ')}`)).catch((err) => (say(`  Could not ask for the sign-in (${err.message}). Run later: node "${loginFile}" sign-in`), false));
  return hooksSigned;
}

if (doing.includes('claude')) {
  step(`Claude Code: installing the Archipelago plugin from ${MARKETPLACE}`);
  const listed = run('claude', ['plugin', 'list'], { quiet: true });
  const there = /\barchipelago@/.test(listed.stdout);
  const r = there ? run('claude', ['plugin', 'update', 'archipelago@archipelago']) : run('claude', ['plugin', 'install', 'archipelago', '--marketplace', MARKETPLACE]);
  if (r.status !== 0) say(`  The plugin did not install. Run it yourself: claude plugin install archipelago --marketplace ${MARKETPLACE}`);
  if (ORIGIN !== HOSTED) say(`  This map is not ${HOSTED}: set PELAGO_URL=${ORIGIN} in your environment for the plugin to reach it.`);
  step('Signing in: one Allow in your browser, for the plugin’s hooks and its tools');
  const signed = DRY ? true : await login.signInHere(ORIGIN, (w) => say(`  ${w.replace(/\n/g, '\n  ')}`));
  hooksSigned = signed;
  if (signed && r.status === 0) done.push('Claude Code');
}

if (doing.includes('codex')) {
  step('Codex: adding the map as an MCP server, then Codex’s own sign-in');
  const added = run('codex', ['mcp', 'add', 'pelago', '--url', `${ORIGIN}/mcp`]);
  const signed = added.status === 0 && run('codex', ['mcp', 'login', 'pelago']).status === 0;
  if (!signed) say(`  Not finished. Run: codex mcp add pelago --url ${ORIGIN}/mcp, then codex mcp login pelago`);
  const file = join(HOME, '.codex', 'hooks.json');
  step(`Codex: the session hooks, in ${file}`);
  // Codex's hooks are Claude Code's in name and input, so the one hook answers them as it is.
  const entry = (name, matcher) => ({ ...(matcher && { matcher }), hooks: [{ type: 'command', command: hookCommand('pelago-hook.mjs', name), timeout: 30 }] });
  withHooks(file, { SessionStart: entry('session-start', 'startup|resume|clear'), UserPromptSubmit: entry('prompt'), Stop: entry('stop'), SessionEnd: entry('session-end') });
  say('  Codex asks you to review new hooks once: type /hooks in Codex and allow these four.');
  if (signed && (await signHooks())) done.push('Codex');
}

if (doing.includes('cursor')) {
  const file = join(HOME, '.cursor', 'mcp.json');
  step(`Cursor: adding the map to ${file}`);
  const now = readJson(file) ?? {};
  const servers = { ...(now.mcpServers ?? {}), pelago: { url: `${ORIGIN}/mcp` } };
  if (DRY) say(`  (would write) mcpServers.pelago = { url: "${ORIGIN}/mcp" }`);
  else mkdirSync(dirname(file), { recursive: true }), writeFileSync(file, JSON.stringify({ ...now, mcpServers: servers }, null, 2) + '\n');
  say('  Cursor asks you to sign in the first time it connects: Settings, MCP, then Connect beside pelago.');
  const hooksFile = join(HOME, '.cursor', 'hooks.json');
  step(`Cursor: the session hooks, in ${hooksFile}`);
  const entry = (name) => ({ command: hookCommand('pelago-cursor.mjs', name), timeout: 30 });
  withHooks(hooksFile, { sessionStart: entry('session-start'), beforeSubmitPrompt: entry('prompt'), stop: entry('stop'), sessionEnd: entry('session-end') }, { version: 1 });
  if (await signHooks()) done.push('Cursor');
}

// An old setup's server, inherited by every folder under home: with the plugin there would be two.
const old = join(HOME, '.mcp.json');
const oldSaid = readJson(old);
if (doing.includes('claude') && oldSaid?.mcpServers?.pelago) {
  step(`An older Archipelago setup is in ${old} (a server called pelago, with a token): with the plugin, Claude Code would have two.`);
  if (REMOVE_OLD || (await confirm('  Take it out? A copy of the file is kept beside it.'))) {
    if (DRY) say(`  (would remove) mcpServers.pelago from ${old}`);
    else {
      copyFileSync(old, `${old}.pelago-old`);
      delete oldSaid.mcpServers.pelago;
      writeFileSync(old, JSON.stringify(oldSaid, null, 2) + '\n');
      say(`  Taken out. The old file is ${old}.pelago-old.`);
    }
  } else say(`  Left as it is. To take it out, run this again with --remove-old, or delete "pelago" from ${old}.`);
}

if (!DRY && done.includes('Claude Code')) {
  step('Checking: one call to your map');
  const { status } = await login.call(ORIGIN, 'query', {});
  say(status === 200 ? '  Your map answered.' : `  Your map answered ${status}: the sign-in did not take. Run this again.`);
  if (status !== 200) done.splice(done.indexOf('Claude Code'), 1);
}

say(done.length ? `\nDone: ${done.join(', ')} ${done.length > 1 ? 'are' : 'is'} connected. The next session there answers from your map.` : '\nNothing was connected.');
if (done.includes('Claude Code')) say(`An agent in a session that was already open can reach the map now with:\n  node "${loginFile}" call query name=frontier`);
// Left to end by itself: on Windows, exiting while a fetch's socket is closing can crash node.
process.exitCode = done.length ? 0 : 1;
