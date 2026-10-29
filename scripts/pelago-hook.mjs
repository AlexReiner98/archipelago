// A Claude Code hook that tells Archipelago about the session: started, a prompt
// sent, ended. Claude Code hands the hook its input as JSON on stdin and
// reads the answer from stdout; this passes both through to the Archipelago
// server the machine is connected to (PELAGO_URL and PELAGO_AGENT_TOKEN,
// the same two that .mcp.json reads), or to the one on this machine when
// those are not set. A machine connected while this was called Lattice has
// them as LATTICE_URL and LATTICE_AGENT_TOKEN, and those are read too.
//
//   node scripts/pelago-hook.mjs session-start | prompt | stop | session-end | file-used
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
// And what the reply did since the owner's last message (the turn): how many times it read the map (and of those,
// surveyed it: read about several items), showed the owner something, changed the map, edited a file, committed and pushed, so that a rule on a reply's end can ask the agent to go on.
// And the commits the session made, by their full ids (what git answered each commit with, looked up in the
// checkout, and what the checkout's HEAD log records while each commit command ran, for one that answered nothing),
// with those the reply made or, when it pushed, all of them: the map asks about those it does not account for.
//
// It also keeps the run the session is registered as (the server says it beside its answer to session-start) in
// the checkout's git folder, one file per session (pelago-runs/<session id>), and takes it out at the end. The
// commit-msg hook the setup installs reads it by the session id Claude Code gives every command it runs
// (CLAUDE_CODE_SESSION_ID), so a commit made in the session names its run, and one made by anybody else does not:
// several sessions in one checkout each find their own.
//
// After a file is read or changed (file-used) it sends the file's path alone, never what is in it, and the
// instructions the session has been told about files already, kept beside its run (pelago-runs/<session id>.said):
// the server answers what bites in that file, said once a session.
//
// At the end of each turn and at the end it also says where the checkout stands (branch, commit, folder, commits no
// remote has, files not committed), which the run keeps, so what a session left unpushed is known after it ends.
//
// It never fails the session: if the server is away it says so on stderr and
// answers nothing.

import { execFileSync } from 'node:child_process';
import { appendFileSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
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
// The reads that are not about several items: one item, what the tools take, where a session starts, how a page looks.
const NOT_SURVEYS = new Set(['get', 'document', 'actions', 'schema', 'watch', 'picture', 'packs', 'places', 'style', 'story', 'published', 'publish_plan', 'backup_download', 'share_figure', 'brief', 'handoff']);
// The tools that write a file.
const EDITS = new Set(['Edit', 'Write', 'MultiEdit', 'NotebookEdit']);
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
  // When each commit command ran, and in which turn, to find in the HEAD log what it made.
  const running = new Map();
  let turns = 0;
  let turn;
  let reply = {};
  const named = (said) => {
    for (const id of JSON.stringify(said ?? '').match(ITEM) ?? []) touched.add(id);
  };
  for (const line of text.split('\n')) {
    const calls = line.includes('"mcp__pelago__') || line.includes('"mcp__lattice__');
    const answered = (changes.size > 0 || committing.size > 0) && line.includes('"tool_result"');
    const asked = line.includes('"user"') && !line.includes('"tool_result"');
    if (!line.includes('"usage"') && !calls && !answered && !asked && !line.includes('"Bash"') && !/"(Edit|Write|MultiEdit|NotebookEdit)"/.test(line)) continue;
    try {
      const entry = JSON.parse(line);
      if (prompted(entry)) {
        turn = entry.uuid;
        reply = { read: 0, surveyed: 0, showed: 0, changed: 0, edited: 0, committed: 0, pushed: 0 };
        turnMade = [];
        turns++;
      }
      const usage = entry.message?.usage;
      if (entry.type === 'assistant' && usage) answers.set(entry.message.id ?? entry.uuid, (usage.input_tokens ?? 0) + (usage.output_tokens ?? 0) + (usage.cache_creation_input_tokens ?? 0));
      for (const part of Array.isArray(entry.message?.content) ? entry.message.content : []) {
        if (part.type === 'tool_use' && MAP_TOOL.test(part.name ?? '')) {
          named(part.input);
          if (part.name.endsWith('__change')) changes.add(part.id);
          const did = part.name.endsWith('__query') ? 'read' : part.name.endsWith('__change') ? 'changed' : part.name.endsWith('__report') && part.input?.action === 'show' ? 'showed' : undefined;
          if (did) reply[did] = (reply[did] ?? 0) + 1;
          if (did === 'read' && typeof part.input?.name === 'string' && !NOT_SURVEYS.has(part.input.name)) reply.surveyed = (reply.surveyed ?? 0) + 1;
        }
        if (part.type === 'tool_use' && EDITS.has(part.name)) reply.edited = (reply.edited ?? 0) + 1;
        if (part.type === 'tool_use' && part.name === 'Bash' && typeof part.input?.command === 'string') {
          if (COMMIT.test(part.input.command)) (reply.committed = (reply.committed ?? 0) + 1), committing.add(part.id), running.set(part.id, { from: Date.parse(entry.timestamp), turn: turns });
          if (PUSH.test(part.input.command)) reply.pushed = (reply.pushed ?? 0) + 1;
        }
        if (part.type === 'tool_result' && changes.has(part.tool_use_id)) named(part.content);
        if (part.type === 'tool_result' && running.has(part.tool_use_id)) running.get(part.tool_use_id).to = Date.parse(entry.timestamp);
        if (part.type === 'tool_result' && committing.has(part.tool_use_id))
          for (const [, sha] of textOf(part.content).matchAll(MADE)) made.push(sha), turnMade.push(sha);
      }
    } catch {
      // A line that is not whole yet: the next count has it.
    }
  }
  let tokens = 0;
  for (const n of answers.values()) tokens += n;
  const ran = [...running.values()].map((r) => ({ ...r, mine: Boolean(turn) && r.turn === turns }));
  return { tokens, touched: [...touched], made, ran, ...(turn && { turn, reply, turnMade }) };
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

/** The commits the checkout's HEAD log records while the session's commit commands ran (a second's slack), and whether the reply's. */
function logged(cwd, ran) {
  const times = ran.filter((r) => Number.isFinite(r.from));
  if (!times.length) return [];
  try {
    const out = execFileSync('git', ['-C', cwd || '.', 'log', '-g', '-n', '500', '--date=unix', '--format=%H %gd %gs', 'HEAD'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 3000 });
    return out.split('\n').flatMap((l) => {
      const [, sha, at] = /^([0-9a-f]{40}) \S*@\{(\d+)\} commit/.exec(l) ?? [];
      const r = sha && times.find((r) => at * 1000 >= r.from - 1000 && at * 1000 <= (r.to ?? Date.now()) + 1000);
      return r ? [{ sha, mine: r.mine }] : [];
    }).reverse();
  } catch {
    return [];
  }
}

/** The checkout's newest commits, each its id and message, for the server to say which are not accounted for. */
function recentCommits(cwd) {
  try {
    const out = execFileSync('git', ['-C', cwd, 'log', '-40', '--format=%H%x1f%B%x1e'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 3000 });
    return out.split('\x1e').map((one) => one.trim()).filter(Boolean).map((one) => ({ id: one.split('\x1f')[0], message: one.slice(one.indexOf('\x1f') + 1).trim() }));
  } catch {
    return [];
  }
}

/**
 * Where the checkout stands, for the next session to know what this one left: its branch and commit, its folder, how
 * many of its commits no remote has, and how many files are changed and not committed. Null outside a checkout.
 */
function gitState(cwd) {
  const git = (...args) => execFileSync('git', ['-C', cwd || '.', ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 3000 }).trim();
  try {
    const head = git('rev-parse', 'HEAD');
    return { branch: git('rev-parse', '--abbrev-ref', 'HEAD'), head, worktree: git('rev-parse', '--show-toplevel'), unpushed: Number(git('rev-list', '--count', head, '--not', '--remotes')), dirty: git('status', '--porcelain').split('\n').filter(Boolean).length };
  } catch {
    return null;
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
    if (remote) body = JSON.stringify({ ...said, remote: remote.replace(/^([a-z][a-z0-9+.-]*:[/][/])[^/@]*@/i, '$1'), commits: recentCommits(said.cwd || '.') });
  } catch {
    // Not a checkout, or no git here: the folder is all there is to go on.
  }
} else if (name === 'file-used') {
  // The path alone: what the tool read or wrote stays here.
  try {
    const said = JSON.parse(body);
    const path = said.tool_input?.file_path ?? said.tool_input?.notebook_path;
    if (typeof path !== 'string') process.exit(0);
    const told = runFile(said);
    let before = [];
    try {
      before = told ? readFileSync(`${told}.said`, 'utf8').split('\n').filter(Boolean) : [];
    } catch {
      // Nothing said yet.
    }
    body = JSON.stringify({ session_id: said.session_id, cwd: said.cwd, path, said: before });
  } catch {
    process.exit(0);
  }
} else {
  try {
    const said = JSON.parse(body);
    if (said.transcript_path) {
      const { made, turnMade, ran, ...read } = readTranscript(readFileSync(said.transcript_path, 'utf8'));
      const log = logged(said.cwd, ran);
      const commits = [...new Set([...fullIds(said.cwd, made), ...log.map((c) => c.sha)])];
      const turnCommits = read.reply?.pushed ? commits : [...new Set([...fullIds(said.cwd, turnMade ?? []), ...log.filter((c) => c.mine).map((c) => c.sha)])];
      body = JSON.stringify({ ...said, ...read, commits, ...(read.turn && { turn_commits: turnCommits }) });
    }
  } catch {
    // No count this time; what the hook is for still goes through.
  }
  // At a turn's end and at the end, where the checkout stands: so what a session leaves unpushed is known after it.
  if (name === 'stop' || name === 'session-end') {
    try {
      const said = JSON.parse(body);
      const git = gitState(said.cwd);
      if (git) body = JSON.stringify({ ...said, git });
    } catch {
      // Not JSON: it goes as it came.
    }
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
  if (res.ok && name === 'file-used') {
    // What it said is kept, so the next file's answer leaves it out; the rest is Claude Code's.
    const { said: ids, ...rest } = JSON.parse(answer || '{}');
    const told = Array.isArray(ids) && ids.length ? runFile(JSON.parse(body)) : null;
    if (told) {
      mkdirSync(resolve(told, '..'), { recursive: true });
      appendFileSync(`${told}.said`, ids.map((id) => `${id}\n`).join(''));
    }
    process.stdout.write(JSON.stringify(rest));
  } else if (res.ok) process.stdout.write(answer);
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
    if (file) for (const kept of [file, `${file}.said`]) rmSync(kept, { force: true });
  } catch {
    // Nothing kept, or nothing to read it by.
  }
}
