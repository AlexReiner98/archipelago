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
// session is on. From the same record it says which items the session's calls
// to the map named (read, shown or changed), so the session's end asks about
// what it touched: the server cannot tell apart sessions that share a token.
// And what the reply did since the owner's last message (the turn): how many times it read the map, showed the owner
// something, changed the map, committed and pushed, so that a rule on a reply's end can ask the agent to go on.
// And the commits the session made, by their full ids (what git answered each commit with, looked up in the
// checkout), with those the reply made or, when it pushed, all of them: the map asks about those it does not account for.
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

// The map's tools, as the setup names their server (pelago; lattice before it), and an item's id.
const MAP_TOOL = /^mcp__(pelago|lattice)__/;
const ITEM = /\be_[a-z0-9]{8}\b/g;
// A git command, past the options that come before its subcommand (git -C dir commit, git -c a=b push).
const GIT = (sub) => new RegExp(String.raw`(^|[\s;&|(])git(\s+(-[Cc]\s+("[^"]*"|'[^']*'|\S+)|--?[\w-]+(=\S+)?))*\s+` + sub + String.raw`(?![\w-])`);
const COMMIT = GIT('commit');
const PUSH = GIT('push');
// What git answers a commit with: [branch 1a2b3c4] Subject, or [main (root-commit) 1a2b3c4], or [detached HEAD 1a2b3c4].
const MADE = /^\[[^\]\n]*? ([0-9a-f]{7,40})\] /gm;
const textOf = (content) => (typeof content === 'string' ? content : Array.isArray(content) ? content.map((p) => p.text ?? '').join('\n') : '');

/** Whether a transcript entry is a message the owner wrote: not a tool's answer, nor what Claude Code put in. */
const prompted = (entry) =>
  entry.type === 'user' &&
  !entry.isMeta &&
  !entry.isCompactSummary &&
  (typeof entry.message?.content === 'string' ||
    (Array.isArray(entry.message?.content) && entry.message.content.some((p) => p.type === 'text') && !entry.message.content.some((p) => p.type === 'tool_result')));

/**
 * From a transcript: the tokens used so far, each answer counted once however many lines it was written as, and the
 * items the session's calls to the map named, in what it sent and in what a change answered (the items it made).
 */
function readTranscript(text) {
  const answers = new Map();
  const touched = new Set();
  const changes = new Set();
  const committing = new Set();
  const made = [];
  let turnMade = [];
  let turn;
  let reply = {};
  const named = (said) => {
    for (const id of JSON.stringify(said ?? '').match(ITEM) ?? []) touched.add(id);
  };
  for (const line of text.split('\n')) {
    const calls = line.includes('"mcp__pelago__') || line.includes('"mcp__lattice__');
    const answered = (changes.size > 0 || committing.size > 0) && line.includes('"tool_result"');
    const asked = line.includes('"user"') && !line.includes('"tool_result"');
    if (!line.includes('"usage"') && !calls && !answered && !asked && !line.includes('"Bash"')) continue;
    try {
      const entry = JSON.parse(line);
      if (prompted(entry)) {
        turn = entry.uuid;
        reply = { read: 0, showed: 0, changed: 0, committed: 0, pushed: 0 };
        turnMade = [];
      }
      const usage = entry.message?.usage;
      if (entry.type === 'assistant' && usage) answers.set(entry.message.id ?? entry.uuid, (usage.input_tokens ?? 0) + (usage.output_tokens ?? 0) + (usage.cache_creation_input_tokens ?? 0));
      for (const part of Array.isArray(entry.message?.content) ? entry.message.content : []) {
        if (part.type === 'tool_use' && MAP_TOOL.test(part.name ?? '')) {
          named(part.input);
          if (part.name.endsWith('__change')) changes.add(part.id);
          const did = part.name.endsWith('__query') ? 'read' : part.name.endsWith('__change') ? 'changed' : part.name.endsWith('__report') && part.input?.action === 'show' ? 'showed' : undefined;
          if (did) reply[did] = (reply[did] ?? 0) + 1;
        }
        if (part.type === 'tool_use' && part.name === 'Bash' && typeof part.input?.command === 'string') {
          if (COMMIT.test(part.input.command)) (reply.committed = (reply.committed ?? 0) + 1), committing.add(part.id);
          if (PUSH.test(part.input.command)) reply.pushed = (reply.pushed ?? 0) + 1;
        }
        if (part.type === 'tool_result' && changes.has(part.tool_use_id)) named(part.content);
        if (part.type === 'tool_result' && committing.has(part.tool_use_id))
          for (const [, sha] of textOf(part.content).matchAll(MADE)) made.push(sha), turnMade.push(sha);
      }
    } catch {
      // A line that is not whole yet: the next count has it.
    }
  }
  let tokens = 0;
  for (const n of answers.values()) tokens += n;
  return { tokens, touched: [...touched], made, ...(turn && { turn, reply, turnMade }) };
}

/** Commits by their full ids, looked up in the checkout: what it does not hold (gone, or another folder's) is left out. */
function fullIds(cwd, shorts) {
  if (!shorts.length) return [];
  try {
    const out = execFileSync('git', ['-C', cwd || '.', 'cat-file', '--batch-check'], { input: shorts.map((s) => `${s}^{commit}`).join('\n') + '\n', encoding: 'utf8', stdio: ['pipe', 'pipe', 'ignore'], timeout: 3000 });
    return [...new Set(out.split('\n').flatMap((l) => /^([0-9a-f]{40}) commit /.exec(l)?.slice(1) ?? []))];
  } catch {
    return [];
  }
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
    if (said.transcript_path) {
      const { made, turnMade, ...read } = readTranscript(readFileSync(said.transcript_path, 'utf8'));
      const commits = fullIds(said.cwd, made);
      const turnCommits = read.reply?.pushed ? commits : fullIds(said.cwd, turnMade ?? []);
      body = JSON.stringify({ ...said, ...read, commits, ...(read.turn && { turn_commits: turnCommits }) });
    }
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
