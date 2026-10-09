// A Claude Code hook that tells Lattice about the session: started, a prompt
// sent, ended. Claude Code hands the hook its input as JSON on stdin and
// reads the answer from stdout; this passes both through to the Lattice
// server the machine is connected to (LATTICE_URL and LATTICE_AGENT_TOKEN,
// the same two that .mcp.json reads), or to the one on this machine when
// those are not set.
//
//   node scripts/lattice-hook.mjs session-start | prompt | session-end
//
// At the start it also says which repository the folder is a checkout of (its
// origin), so the map knows the session's repository on any machine.
//
// With each prompt and at the end it also says how many tokens the session
// has used so far, counted from the session's own record on this machine
// (the transcript Claude Code names in the hook's input): input and output,
// not counting cached re-reads. Lattice gives what is new to the work the
// session is on.
//
// It never fails the session: if the server is away it says so on stderr and
// answers nothing.

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const name = process.argv[2];
const base = (process.env.LATTICE_URL || 'http://127.0.0.1:3100').replace(/\/$/, '');
const token = process.env.LATTICE_AGENT_TOKEN;

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

let body = input.trim() || '{}';
if (name === 'session-start') {
  // Which repository this is, by the address it was cloned from: a folder is somewhere else on every machine.
  try {
    const said = JSON.parse(body);
    const remote = execFileSync('git', ['-C', said.cwd || '.', 'config', '--get', 'remote.origin.url'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 3000 }).trim();
    if (remote) body = JSON.stringify({ ...said, remote });
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
  const res = await fetch(`${base}/hooks/${name}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(token && { authorization: `Bearer ${token}` }) },
    body,
    signal: AbortSignal.timeout(10_000),
  });
  const answer = await res.text();
  if (res.ok) process.stdout.write(answer);
  else console.error(`Lattice ${name} hook: ${base} answered ${res.status}`);
} catch (err) {
  console.error(`Lattice ${name} hook: ${base} did not answer (${err.message})`);
}
