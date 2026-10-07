// Launching: start a headless Claude Code session on a task from the map.
// The session is registered before it starts, so it holds whatever exclusive
// resource the task needs (or is refused), and its outcome is written back to
// its run when it ends. Only a human can launch.

import { spawn, type ChildProcess } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { createWriteStream, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import type { Actor, Lattice } from './lattice.ts';
import { sessionEnd, sessionStart, sessionUpdate } from './sessions.ts';
import { VIEWS } from './views.ts';

/** What the launched session may do without anyone there to approve it. */
export type LaunchMode = 'plan' | 'acceptEdits';

const MODE_NOTE: Record<LaunchMode, string> = {
  plan: 'You are running unattended in plan mode: you cannot edit files or run commands that change anything. Investigate, then reply with what you found and a concrete plan.',
  acceptEdits:
    'You are running unattended and may edit files in this repository. Do not commit, push or delete anything. Do not use a live application unless this brief says its resource is claimed for you. Finish with a summary of what you changed and what is left.',
};

// The lattice tools a launched session may call unprompted. `change` is safe
// here because agent changes are held as proposals.
const ALLOWED_TOOLS = ['session_update', 'schema', 'search', 'get', 'view', 'events', 'change', 'claim', 'release'].map((t) => `mcp__lattice__${t}`).join(',');

interface LauncherConfig {
  /** The lattice MCP endpoint to give the session. */
  mcpUrl: string;
  /** Where transcripts and the MCP config file are written. */
  dir: string;
  /** argv prefix of the Claude Code CLI. */
  command: string[];
}

let config: LauncherConfig | undefined;
const running = new Map<string, ChildProcess>();

export function configureLauncher(next: LauncherConfig): void {
  config = next;
}

export async function launch(l: Lattice, actor: Actor, input: { task: string; mode?: LaunchMode; instructions?: string }) {
  if (actor.kind !== 'human') throw new Error('Only a human can launch a session.');
  if (!config) throw new Error('Launching is not configured on this server.');
  const mode = input.mode ?? 'plan';
  const brief = (await VIEWS.brief.run(l, { task: input.task })) as {
    task: { id: string; title: string };
    repo?: { title: string; path?: string };
    text: string;
  };
  const cwd = brief.repo?.path;
  if (!cwd) throw new Error(`"${brief.task.title}" is not linked to a repository with a local path, so there is nowhere to run it.`);
  if (!existsSync(cwd)) throw new Error(`The repository path ${cwd} does not exist on this machine.`);

  // Register first: this is what takes the lane, or tells us it is taken.
  const sessionId = randomUUID();
  const agent: Actor = { kind: 'agent', name: 'claude-headless' };
  const started = await sessionStart(l, agent, { task: input.task, cwd, session_id: sessionId, surface: 'claude-headless', title: `Headless (${mode}): ${brief.task.title}` });
  const run = started.run;
  if (started.status === 'waiting') {
    const why = (('blocked' in started ? started.blocked : undefined) ?? []).map((b) => b.why).join(' ');
    await sessionEnd(l, agent, { run, outcome: 'cancelled', summary: `Not launched: ${why}` });
    throw new Error(`Not launched. ${why}`);
  }

  mkdirSync(config.dir, { recursive: true });
  const mcpFile = join(config.dir, 'mcp.json');
  writeFileSync(mcpFile, JSON.stringify({ mcpServers: { lattice: { type: 'http', url: config.mcpUrl } } }));
  const transcript = join(config.dir, `${run}.jsonl`);
  const prompt = [
    brief.text,
    '',
    '## How you are running',
    MODE_NOTE[mode],
    `Your Lattice run id is ${run}; it is already registered and will be closed for you. Use the lattice session_update tool (run ${run}) for anything the owner should know along the way.`,
    input.instructions ? `\n## Instructions from the owner\n${input.instructions}` : '',
  ].join('\n');

  const args = ['-p', '--output-format', 'stream-json', '--verbose', '--permission-mode', mode, '--session-id', sessionId, '--mcp-config', mcpFile, '--allowedTools', ALLOWED_TOOLS];
  // On Windows the CLI is a .cmd shim, which only a shell can start.
  const shell = process.platform === 'win32';
  const quote = (a: string) => (shell && /\s/.test(a) ? `"${a}"` : a);
  const [bin, ...prefix] = config.command;
  let child: ChildProcess;
  try {
    child = spawn(quote(bin), [...prefix, ...args].map(quote), { cwd, shell, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
  } catch (err) {
    await sessionEnd(l, agent, { run, outcome: 'failed', summary: `Could not start: ${(err as Error).message}` });
    throw err;
  }
  running.set(run, child);
  child.stdin!.end(prompt);

  const log = createWriteStream(transcript);
  let result: { is_error?: boolean; result?: string; total_cost_usd?: number; num_turns?: number } | undefined;
  let lastText = '';
  let plan = '';
  let stderr = '';
  let lastBeat = Date.now();
  child.stderr!.on('data', (chunk: Buffer) => (stderr = (stderr + chunk.toString()).slice(-2000)));
  createInterface({ input: child.stdout! }).on('line', (line) => {
    log.write(line + '\n');
    try {
      const message = JSON.parse(line);
      if (message.type === 'result') result = message;
      // In plan mode the answer arrives as a plan, or as the last thing said,
      // and the result itself comes back empty.
      for (const part of message.type === 'assistant' ? (message.message?.content ?? []) : []) {
        if (part.type === 'text' && part.text?.trim()) lastText = part.text;
        if (part.type === 'tool_use' && part.name === 'ExitPlanMode' && part.input?.plan) plan = part.input.plan;
      }
    } catch {
      // Not every line is JSON; the transcript keeps it either way.
    }
    if (Date.now() - lastBeat > 20_000) {
      lastBeat = Date.now();
      sessionUpdate(l, agent, { run }).catch(() => {});
    }
  });

  const finish = async (problem?: string) => {
    if (!running.delete(run)) return;
    log.end();
    const ok = !problem && result && !result.is_error;
    const detail = result ? `${result.num_turns ?? '?'} turns${result.total_cost_usd != null ? `, $${result.total_cost_usd.toFixed(2)}` : ''}` : '';
    const text = problem ?? (result?.result || plan || lastText || stderr.trim() || 'The session ended without a result.');
    await sessionEnd(l, agent, {
      run,
      outcome: ok ? 'finished' : 'failed',
      summary: `${text.slice(0, 6000)}\n\n(${[detail, `transcript: ${transcript}`].filter(Boolean).join('; ')})`,
    }).catch(() => {});
  };
  child.on('error', (err) => void finish(`Could not start: ${err.message}`));
  child.on('close', () => void finish());

  return { run, session_id: sessionId, mode, cwd, transcript, claimed: ('claimed' in started ? started.claimed : undefined) ?? [] };
}

/** Kill a launched session's process, if this server started one for the run. */
export function stopLaunched(run: string): boolean {
  const child = running.get(run);
  if (!child) return false;
  // With a shell in between, killing the child would orphan the CLI itself.
  if (process.platform === 'win32' && child.pid) spawn('taskkill', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true });
  else child.kill();
  return true;
}

export function stopAllLaunched(): void {
  for (const run of [...running.keys()]) stopLaunched(run);
}
