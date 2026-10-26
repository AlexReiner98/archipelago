// A Claude Code hook that tells Archipelago about the session: started, a prompt
// sent, ended. Claude Code hands the hook its input as JSON on stdin and
// reads the answer from stdout; this passes both through to the Archipelago
// server the machine is connected to (PELAGO_URL and PELAGO_AGENT_TOKEN,
// the same two that .mcp.json reads), or to the one on this machine when
// those are not set. A machine connected while this was called Lattice has
// them as LATTICE_URL and LATTICE_AGENT_TOKEN, and those are read too.
//
//   node scripts/pelago-hook.mjs session-start | prompt | stop | session-end
//
// At the start it also says which repository the folder is a checkout of (its
// origin), so the map knows the session's repository on any machine.
//
// With each prompt, at the end of each turn (stop) and at the end it also says how many tokens the session
// has used so far, counted from the session's own record on this machine
// (the transcript Claude Code names in the hook's input): input and output,
// not counting cached re-reads. Archipelago gives what is new to the work the
// session is on.
//
// It also keeps the run the session is registered as (the server says it beside its answer to session-start) in
// the checkout's git folder, one file per session (pelago-runs/<session id>), and takes it out at the end. The
// commit-msg hook the setup installs reads it by the session id Claude Code gives every command it runs
// (CLAUDE_CODE_SESSION_ID), so a commit made in the session names its run, and one made by anybody else does not:
// several sessions in one checkout each find their own.
//
// It never fails the session: if the server is away it says so on stderr and
// answers nothing.

import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

// Which hand-out of Archipelago's files this project has: the setup writes it in, and the server says when it is behind.
const SETUP = '';

const name = process.argv[2];
const base = (process.env.PELAGO_URL || process.env.LATTICE_URL || 'http://127.0.0.1:3100').replace(/\/$/, '');
const token = process.env.PELAGO_AGENT_TOKEN || process.env.LATTICE_AGENT_TOKEN;

let input = '';
for await (const chunk of process.stdin) input += chunk;

/** Tokens used so far, from a transcript: each answer counted once, however many lines it was written as. */
function tokensUsed(file) {
  const answers = new Map();
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    if (!line.includes('"usage"')) continue;
    try {
      const entry = JSON.parse(line);
      const usage = entry.message?.usage;
      if (entry.type !== 'assistant' || !usage) continue;
      answers.set(entry.message.id ?? entry.uuid, (usage.input_tokens ?? 0) + (usage.output_tokens ?? 0) + (usage.cache_creation_input_tokens ?? 0));
    } catch {
      // A line that is not whole yet: the next count has it.
    }
  }
  let total = 0;
  for (const n of answers.values()) total += n;
  return total;
}

/** The file in the checkout's git folder (shared by its worktrees) that holds a session's run, or null outside a checkout. */
function runFile(said) {
  if (typeof said.session_id !== 'string' || !/^[\w-]+$/.test(said.session_id)) return null;
  const cwd = said.cwd || '.';
  try {
    const git = execFileSync('git', ['-C', cwd, 'rev-parse', '--git-common-dir'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 3000 }).trim();
    return git ? resolve(cwd, git, 'pelago-runs', said.session_id) : null;
  } catch {
    return null;
  }
}

let body = input.trim() || '{}';
if (name === 'session-start') {
  // Which repository this is, by the address it was cloned from: a folder is somewhere else on every machine.
  try {
    const said = JSON.parse(body);
    const remote = execFileSync('git', ['-C', said.cwd || '.', 'config', '--get', 'remote.origin.url'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 3000 }).trim();
    // An address can carry a name and a password for the host (https://name:secret@host/...): those stay here.
    if (remote) body = JSON.stringify({ ...said, remote: remote.replace(/^([a-z][a-z0-9+.-]*:[/][/])[^/@]*@/i, '$1') });
  } catch {
    // Not a checkout, or no git here: the folder is all there is to go on.
  }
} else {
  try {
    const said = JSON.parse(body);
    if (said.transcript_path) body = JSON.stringify({ ...said, tokens: tokensUsed(said.transcript_path) });
  } catch {
    // No count this time; what the hook is for still goes through.
  }
}

try {
  body = JSON.stringify({ ...JSON.parse(body), setup: SETUP });
} catch {
  // Not JSON: it goes as it came.
}

try {
  const res = await fetch(`${base}/hooks/${name}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(token && { authorization: `Bearer ${token}` }) },
    body,
    signal: AbortSignal.timeout(10_000),
  });
  const answer = await res.text();
  if (res.ok) process.stdout.write(answer);
  else console.error(`Archipelago ${name} hook: ${base} answered ${res.status}`);
  const run = res.ok && name === 'session-start' ? res.headers.get('x-pelago-run') : null;
  if (run && /^[\w-]+$/.test(run)) {
    try {
      const file = runFile(JSON.parse(body));
      if (file) {
        mkdirSync(resolve(file, '..'), { recursive: true });
        writeFileSync(file, run);
      }
    } catch (err) {
      console.error(`Archipelago ${name} hook: the run could not be kept for commits (${err.message})`);
    }
  }
} catch (err) {
  console.error(`Archipelago ${name} hook: ${base} did not answer (${err.message})`);
}

// A session that has ended makes no more commits: its run is not left for another to be named by.
if (name === 'session-end') {
  try {
    const file = runFile(JSON.parse(body));
    if (file) rmSync(file, { force: true });
  } catch {
    // Nothing kept, or nothing to read it by.
  }
}
