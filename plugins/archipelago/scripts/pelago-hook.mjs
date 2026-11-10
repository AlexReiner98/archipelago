// A Claude Code hook that tells Archipelago about the session: started, a prompt
// sent, ended. Claude Code hands the hook its input as JSON on stdin and
// reads the answer from stdout; this passes both through to the Archipelago
// server the machine is connected to (PELAGO_URL and PELAGO_AGENT_TOKEN,
// the same two that .mcp.json reads), or to the one on this machine when
// those are not set.
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
// And what Claude Code calls the session (its title: the one the owner gave it, else the one Claude Code made), which
// the map calls the session by and its tab on the owner's page shows, at the start (on a resume) and at every event.
// And what the reply did since the owner's last message (the turn): how many times it read the map (and of those,
// surveyed it: read about several items), showed the owner something, changed the map, told a beat of its story, called
// any other tool (worked), edited a file, committed and pushed, so that a rule on a reply's end can ask the agent to go on.
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
// Beside it, the process of the Claude Code that runs the session (CLAUDE_PID, pelago-runs/<session id>.pid). A chat
// archived or closed may be stopped before its SessionEnd hook is heard: the next hook in the checkout finds its
// process gone and ends its run for it.
//
// After a file is read or changed (file-used) it sends the file's path alone, never what is in it, and the
// instructions the session has been told about files already, kept beside its run (pelago-runs/<session id>.said):
// the server answers what bites in that file, said once a session.
//
// At the end of each turn and at the end it also says where the checkout stands (branch, commit, folder, commits no
// remote has, files not committed), which the run keeps, so what a session left unpushed is known after it ends.
//
// It never fails the session: if the server is away or refuses it, it says so in the session once (a message the
// person sees) and answers nothing more. With no token set, a server that asks for one is signed in to through the
// browser (pelago-login.mjs, beside this in the plugin): the session that asked is registered at its first prompt
// after. Run by the plugin (--plugin), the working rules beside it (../pelago.md) are said at the start, since a
// plugin cannot add to CLAUDE.md.

import { execFileSync } from 'node:child_process';
import { appendFileSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';

// Which hand-out of Archipelago's files this project has: the setup writes it in, and the server says when it is behind.
const SETUP = '';

const name = process.argv[2];
const base = (process.env.PELAGO_URL || "https://app.archipelago.tools").replace(/\/$/, '');
const login = await import('./pelago-login.mjs').catch(() => null);
let token = process.env.PELAGO_AGENT_TOKEN || (await login?.accessToken(base).catch(() => undefined));

let input = '';
for await (const chunk of process.stdin) input += chunk;

// The map's tools, as the setup names their server (pelago), and an item's id. A session may be
// connected to other workspaces too, each its own server named after this one (pelago-site): what the reply read,
// changed or told there counts for what it did, while the items it named there are not this map's to ask about.
// Installed as a plugin, Claude Code names them mcp__plugin_<plugin>_pelago__<tool>.
const MAP_TOOL = /^mcp__(plugin_[\w-]+?_)?pelago__/;
const ANY_MAP_TOOL = /^mcp__(plugin_[\w-]+?_)?pelago([-_][\w-]*?)?__/;
const ITEM = /\be_[a-z0-9]{8}\b/g;
// A git command, past the options that come before its subcommand (git -C dir commit, git -c a=b push).
const GIT = (sub) => new RegExp(String.raw`(^|[\s;&|(])git(\s+(-[Cc]\s+("[^"]*"|'[^']*'|\S+)|--?[\w-]+(=\S+)?))*\s+` + sub + String.raw`(?![\w-])`);
const COMMIT = GIT('commit');
const PUSH = GIT('push');
// The reads that are not about several items: one item, what the tools take, where a session starts, how a page looks.
const NOT_SURVEYS = new Set(['get', 'document', 'actions', 'schema', 'watch', 'picture', 'packs', 'style', 'story', 'published', 'publish_plan', 'backup_download', 'share_figure', 'brief', 'handoff', 'frontier']);
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
  let title;
  let made_title;
  let reply = {};
  const named = (said) => {
    for (const id of JSON.stringify(said ?? '').match(ITEM) ?? []) touched.add(id);
  };
  for (const line of text.split('\n')) {
    const calls = line.includes('"mcp__pelago');
    const answered = (changes.size > 0 || committing.size > 0) && line.includes('"tool_result"');
    const asked = line.includes('"user"') && !line.includes('"tool_result"');
    if (line.includes('"custom-title"') || line.includes('"ai-title"')) {
      try {
        const said = JSON.parse(line);
        if (said.type === 'custom-title') title = said.customTitle ?? title;
        else if (said.type === 'ai-title') made_title = said.aiTitle ?? said.title ?? made_title;
      } catch {
        // A line that is not whole yet: the next count has it.
      }
    }
    if (!line.includes('"usage"') && !line.includes('"tool_use"') && !calls && !answered && !asked && !line.includes('"Bash"') && !/"(Edit|Write|MultiEdit|NotebookEdit)"/.test(line)) continue;
    try {
      const entry = JSON.parse(line);
      if (prompted(entry)) {
        turn = entry.uuid;
        reply = { read: 0, surveyed: 0, showed: 0, changed: 0, told: 0, worked: 0, edited: 0, committed: 0, pushed: 0 };
        turnMade = [];
        turns++;
      }
      const usage = entry.message?.usage;
      if (entry.type === 'assistant' && usage) answers.set(entry.message.id ?? entry.uuid, (usage.input_tokens ?? 0) + (usage.output_tokens ?? 0) + (usage.cache_creation_input_tokens ?? 0));
      for (const part of Array.isArray(entry.message?.content) ? entry.message.content : []) {
        if (part.type === 'tool_use' && MAP_TOOL.test(part.name ?? '')) {
          named(part.input);
          if (part.name.endsWith('__change')) changes.add(part.id);
        }
        if (part.type === 'tool_use' && ANY_MAP_TOOL.test(part.name ?? '')) {
          const told = part.name.endsWith('__report') && part.input?.action;
          const did = part.name.endsWith('__query') ? 'read' : part.name.endsWith('__change') ? 'changed' : told === 'show' ? 'showed' : told === 'tell' ? 'told' : undefined;
          if (did) reply[did] = (reply[did] ?? 0) + 1;
          if (did === 'read' && typeof part.input?.name === 'string' && !NOT_SURVEYS.has(part.input.name)) reply.surveyed = (reply.surveyed ?? 0) + 1;
        }
        if (part.type === 'tool_use' && !ANY_MAP_TOOL.test(part.name ?? '')) reply.worked = (reply.worked ?? 0) + 1;
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
  const called = title ?? made_title;
  return { tokens, touched: [...touched], made, ran, ...(called && { title: called }), ...(turn && { turn, reply, turnMade }) };
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

// What the session did, as the events of docs/sessions.md (pelago-events.mjs, handed out beside this). One
// missing (a copy from before it) tells nothing: the hook goes on as before.
const adapter = await import('./pelago-events.mjs').catch(() => null);

/** A wait the session stopped for, kept outside any checkout until something shows it was answered. */
const waitFile = (said) => (typeof said.session_id === 'string' && /^[\w-]+$/.test(said.session_id) ? resolve(tmpdir(), 'pelago-waits', said.session_id) : null);
function waitEnded(said) {
  const file = waitFile(said);
  try {
    const kept = file && readFileSync(file, 'utf8');
    if (!kept) return [];
    rmSync(file, { force: true });
    return [{ at: new Date().toISOString(), kind: 'wait.end', ...(said.prompt_id && { turn: said.prompt_id }), for: kept.trim() }];
  } catch {
    return [];
  }
}

/** Sends events to /hooks/events, briefly: a server away, or one without the route yet, costs the turn nothing. */
async function sendEvents(said, events) {
  if (!events.length || typeof said.session_id !== 'string') return;
  await fetch(`${base}/hooks/events`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(token && { authorization: `Bearer ${token}` }) },
    body: JSON.stringify({ session_id: said.session_id, source: 'claude-code', events }),
    signal: AbortSignal.timeout(3_000),
  }).catch(() => null);
}

// The hooks that only tell events: a wait begun or answered, a turn that ended in an error.
if (name === 'notification' || name === 'tool-used' || name === 'stop-failure') {
  try {
    const said = JSON.parse(input || '{}');
    const wait = name === 'notification' && adapter?.waitStart(said);
    const file = wait && waitFile(said);
    if (file) mkdirSync(dirname(file), { recursive: true }), writeFileSync(file, wait.for);
    if (adapter) await sendEvents(said, wait ? [wait] : name === 'tool-used' ? waitEnded(said) : name === 'stop-failure' ? [...waitEnded(said), adapter.failedEnd(said)] : []);
  } catch {
    // Not JSON, or nothing to say: the session goes on.
  }
  process.exit(0);
}

let body = input.trim() || '{}';
let transcript = '';
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
  // A chat resumed has a title already: its tab is named by it from the start.
  try {
    const said = JSON.parse(body);
    transcript = said.transcript_path ? readFileSync(said.transcript_path, 'utf8') : '';
    const { title } = transcript ? readTranscript(transcript) : {};
    if (title) body = JSON.stringify({ ...said, title });
  } catch {
    // No record yet: a new chat has no title until it is given one.
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
      transcript = readFileSync(said.transcript_path, 'utf8');
      const { made, turnMade, ran, ...read } = readTranscript(transcript);
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

// The events this hook tells, beside its own call; at a turn's end after it, as its answer may send the reply on.
const said = (() => { try { return JSON.parse(input || '{}'); } catch { return {}; } })();
let events = [];
if (adapter) try {
  const at = new Date().toISOString();
  if (name === 'session-start') {
    const { title } = JSON.parse(body);
    const branch = (() => { try { return execFileSync('git', ['-C', said.cwd || '.', 'rev-parse', '--abbrev-ref', 'HEAD'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 3000 }).trim(); } catch { return ''; } })();
    events = [{ at, kind: 'session.start', ...((title ?? said.session_title) && { title: title ?? said.session_title }), ...(branch && { branch }) }];
  } else if (name === 'prompt') events = [...(transcript ? adapter.turnEvents(transcript, said) : []), ...waitEnded(said), { at, kind: 'turn.start', ...(said.prompt_id && { turn: said.prompt_id }), ...adapter.promptedBy(said.prompt) }];
  else if (name === 'stop') events = [...(transcript ? adapter.turnEvents(transcript) : []).map((e) => (e.turn || !said.prompt_id ? e : { ...e, turn: said.prompt_id })), ...waitEnded(said)];
  else if (name === 'session-end') events = [...waitEnded(said), { at, kind: 'session.end', ...(typeof said.reason === 'string' && { reason: said.reason.slice(0, 40) }) }];
  // A commit by its full id, where the checkout has it.
  const full = fullIds(said.cwd, events.filter((e) => e.kind === 'commit').map((e) => e.sha));
  events = events.map((e) => (e.kind === 'commit' ? { ...e, sha: full.find((f) => f.startsWith(e.sha)) ?? e.sha } : e));
} catch {
  // Nothing to tell this time; what the hook is for still goes through.
}
const telling = name === 'stop' ? null : sendEvents(said, events);
let answered = '';

const post = (event, payload) =>
  fetch(`${base}/hooks/${event}`, { method: 'POST', headers: { 'content-type': 'application/json', ...(token && { authorization: `Bearer ${token}` }) }, body: payload, signal: AbortSignal.timeout(10_000) });
/** The run the server named for this session, kept for the commit-msg hook. */
function keepRun(res, sent) {
  const run = res.headers.get('x-pelago-run');
  if (!run || !/^[\w-]+$/.test(run)) return;
  try {
    const file = runFile(JSON.parse(sent));
    if (file) {
      mkdirSync(resolve(file, '..'), { recursive: true });
      writeFileSync(file, run);
      if (/^\d+$/.test(process.env.CLAUDE_PID ?? '')) writeFileSync(`${file}.pid`, process.env.CLAUDE_PID);
      return run;
    }
  } catch (err) {
    console.error(`Archipelago ${name} hook: the run could not be kept for commits (${err.message})`);
  }
  // Outside a git checkout there are no commits to name it in.
  return undefined;
}

/** What goes wrong is said to the person in the session, once a session for each thing, not at every turn. */
function sayOnce(kind, words) {
  console.error(words);
  const file = typeof said.session_id === 'string' && /^[\w-]+$/.test(said.session_id) ? resolve(tmpdir(), 'pelago-said', `${said.session_id}-${kind}`) : null;
  try {
    if (file) mkdirSync(dirname(file), { recursive: true }), writeFileSync(file, '', { flag: 'wx' });
    return words;
  } catch {
    return '';
  }
}
// What this hook says beside the server's answer: context for the agent, and a line the person sees.
const plugin = process.argv.includes('--plugin') ? login?.plugin(said, import.meta.url) : null;
const context = [];
let notice = '';
let out = null;

try {
  // A session that started before its sign-in is registered at its first prompt after.
  const late = name === 'prompt' && token ? plugin?.lateStart() : null;
  if (late) {
    const res = await post('session-start', late);
    if (res.ok) context.push(plugin.fromServer(await res.text())?.hookSpecificOutput?.additionalContext, plugin.rules(), plugin.trailer(keepRun(res, late), said.cwd));
  }
  const res = await post(name, body);
  const answer = (answered = await res.text());
  if (res.status === 401 && plugin && !process.env.PELAGO_AGENT_TOKEN) {
    // No sign-in, or one the server no longer takes: the person is asked to sign in, in the browser.
    if (token) login.forget(base);
    if (name === 'session-start' || name === 'prompt') {
      const asked = await plugin.askSignIn(base, name === 'session-start' && body);
      notice = asked.notice;
      context.push(asked.context);
    }
  } else if (res.ok && name === 'file-used') {
    // What it said is kept, so the next file's answer leaves it out; the rest is Claude Code's.
    const { said: ids, ...rest } = JSON.parse(answer || '{}');
    const told = Array.isArray(ids) && ids.length ? runFile(JSON.parse(body)) : null;
    if (told) {
      mkdirSync(resolve(told, '..'), { recursive: true });
      appendFileSync(`${told}.said`, ids.map((id) => `${id}\n`).join(''));
    }
    out = rest;
  } else if (res.ok) {
    out = answer;
    if (name === 'session-start') {
      const run = keepRun(res, body);
      if (plugin) (out = plugin.fromServer(answer)), context.push(plugin.rules(), plugin.trailer(run, said.cwd));
    }
  } else notice = sayOnce(`status-${res.status}`, `Archipelago ${name} hook: ${base} answered ${res.status}${res.status === 401 || res.status === 403 ? `: this machine ${token ? 'has a token the server refused' : 'has no token for it'}, so this session is not on the map` : ''}.`);
} catch (err) {
  notice = sayOnce('away', `Archipelago ${name} hook: ${base} did not answer (${err.message}), so this session’s work is not reaching the map.`);
}
const written = login && (context.length || notice) ? login.withSaid(out, name, context, notice) : notice ? { systemMessage: notice } : out;
if (written) process.stdout.write(typeof written === 'string' ? written : JSON.stringify(written));
// A reply the server sends on has not ended: its turn goes on.
if (name === 'stop') {
  try {
    if (adapter && !/"decision"\s*:\s*"block"/.test(answered)) events.push(adapter.turnEnd(transcript, said));
  } catch {
    // No end to tell: the next prompt opens the next turn all the same.
  }
  await sendEvents(said, events);
} else await telling;

// A session that has ended makes no more commits: its run is not left for another to be named by.
if (name === 'session-end') {
  try {
    const file = runFile(JSON.parse(body));
    if (file) for (const kept of [file, `${file}.said`, `${file}.pid`]) rmSync(kept, { force: true });
  } catch {
    // Nothing kept, or nothing to read it by.
  }
}

/** Whether a process is still running: one that is gone answers ESRCH; one that is another user's, EPERM. */
function alive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return err.code !== 'ESRCH';
  }
}

// A chat archived or closed whose own end was not heard: its Claude Code is gone, so its run is ended for it, and
// what was kept for it goes. Looked for as a session starts, is prompted or ends a turn, in the checkout's git folder.
if (name === 'session-start' || name === 'prompt' || name === 'stop') {
  try {
    const said = JSON.parse(body);
    const file = runFile(said);
    const folder = file && dirname(file);
    const gone = folder ? readdirSync(folder).filter((f) => f.endsWith('.pid') && f !== `${said.session_id}.pid`).map((f) => f.slice(0, -4)).filter((id) => /^[\w-]+$/.test(id) && !alive(Number(readFileSync(resolve(folder, `${id}.pid`), 'utf8')))) : [];
    await Promise.all(
      gone.map(async (id) => {
        const res = await fetch(`${base}/hooks/session-end`, {
          method: 'POST',
          headers: { 'content-type': 'application/json', ...(token && { authorization: `Bearer ${token}` }) },
          body: JSON.stringify({ session_id: id, cwd: said.cwd, reason: 'closed', setup: SETUP }),
          signal: AbortSignal.timeout(5_000),
        }).catch(() => null);
        // Kept until the server has heard it, so a later hook tries again.
        if (res?.ok) for (const kept of [id, `${id}.said`, `${id}.pid`]) rmSync(resolve(folder, kept), { force: true });
      }),
    );
  } catch {
    // No checkout, nothing kept, or the server away: the next hook looks again.
  }
}
