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
//
// It never fails the session: if the server is away it says so on stderr and
// answers nothing.

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

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

/**
 * From a transcript: the tokens used so far, each answer counted once however many lines it was written as, and the
 * items the session's calls to the map named, in what it sent and in what a change answered (the items it made).
 */
function readTranscript(text) {
  const answers = new Map();
  const touched = new Set();
  const changes = new Set();
  const named = (said) => {
    for (const id of JSON.stringify(said ?? '').match(ITEM) ?? []) touched.add(id);
  };
  for (const line of text.split('\n')) {
    const calls = line.includes('"mcp__pelago__') || line.includes('"mcp__lattice__');
    const answered = changes.size > 0 && line.includes('"tool_result"');
    if (!line.includes('"usage"') && !calls && !answered) continue;
    try {
      const entry = JSON.parse(line);
      const usage = entry.message?.usage;
      if (entry.type === 'assistant' && usage) answers.set(entry.message.id ?? entry.uuid, (usage.input_tokens ?? 0) + (usage.output_tokens ?? 0) + (usage.cache_creation_input_tokens ?? 0));
      for (const part of Array.isArray(entry.message?.content) ? entry.message.content : []) {
        if (part.type === 'tool_use' && MAP_TOOL.test(part.name ?? '')) {
          named(part.input);
          if (part.name.endsWith('__change')) changes.add(part.id);
        }
        if (part.type === 'tool_result' && changes.has(part.tool_use_id)) named(part.content);
      }
    } catch {
      // A line that is not whole yet: the next count has it.
    }
  }
  let tokens = 0;
  for (const n of answers.values()) tokens += n;
  return { tokens, touched: [...touched] };
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
    if (said.transcript_path) body = JSON.stringify({ ...said, ...readTranscript(readFileSync(said.transcript_path, 'utf8')) });
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
} catch (err) {
  console.error(`Archipelago ${name} hook: ${base} did not answer (${err.message})`);
}
