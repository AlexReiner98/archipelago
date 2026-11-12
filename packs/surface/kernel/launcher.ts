// Launching: start a headless agent session on a task from the map. The session is registered before it starts, so
// it holds whatever exclusive resource the task needs (or is refused), and its outcome is written back to its run when
// it ends. Only a human can launch.
//
// What is held stays here, whoever names the command: the run, the token the process is given (and revoked when it
// ends), the MCP config, the spawn, and what is recorded of each line it prints. The command and how its lines are
// read come from a server pack's launcher (src/server-launch.ts, decision e_885ztqkv): the kernel names no agent's CLI.
// The surface's since wave 6b (the owner, 12 Nov 2026, e_wuqn82rf): it writes runs as launched:<pack> past the rules,
// spawns processes and holds tokens, which only a root may. The brief is the agents pack's (answer.launch_brief and
// answer.launch_prompt, asked by name); the run's writes are the sessions pack's, handed in by the surface's session
// acts (tool-acts.ts), which reach them already, until that pack offers them by name.

import { spawn, type ChildProcess } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { createWriteStream, existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import { createToken, revokeToken } from '../../identity/kernel/auth.ts';
import { launchedMay, needHuman } from '../../identity/kernel/actor-checks.ts';
import { actorId, type Actor, type Archipelago } from '../../write/kernel/pelago.ts';
import type { recordUsage, sessionEnd, sessionStart, sessionUpdate, tell } from './session-calls.ts';
import type { Brief, LaunchInput, LaunchMode, StartedBy } from '../../agents/kernel/launch-brief.ts';
import { callAs } from '../../loader/kernel/kernel-context.ts';
import { setPackLaunch } from '../../loader/kernel/pack-launch.ts';
import { setActionLaunch } from '../../loader/kernel/pack-action-launch.ts';

export type { LaunchMode, StartedBy } from '../../agents/kernel/launch-brief.ts';

// The pelago tools a launched session may call unprompted, as an MCP client names them: a launcher's {tools}.
// `change` is safe here because agent changes are held as proposals.
const ALLOWED_TOOLS = ['query', 'change', 'report', 'assign', 'revise', 'ask'].map((t) => `mcp__pelago__${t}`).join(',');

/** What a launcher's reading of one line it printed answers: each part recorded on the run. */
export interface Read {
  /** The tokens it has used so far, in all. */
  tokens?: number;
  /** What it said: a beat of its story, and what its run ends with if it says nothing after. */
  said?: string;
  /** It has finished: what it said last is its result. */
  done?: boolean;
  outcome?: 'finished' | 'failed';
}

/** What the kernel fills a launcher's command with. */
export interface Fills {
  prompt: string;
  mcp_config: string;
  tools: string;
  model?: string;
  /** The id the run is registered under, for a CLI that takes its session's id. */
  session_id: string;
  /** How the launch was asked to run: plan, or acceptEdits. */
  mode: LaunchMode;
}

/** One launch's command, and how what it prints is read. */
export interface Command {
  argv: string[];
  /** Its environment: its token and the system's own, never the server's secrets. */
  env: NodeJS.ProcessEnv;
  /** Given the prompt on its standard input, when its command does not name it. */
  stdin?: boolean;
  /** Each of its said is told as a beat of the run's story. */
  tells?: boolean;
  /** With no outcome read, it failed even if it exited cleanly. */
  needsResult?: boolean;
  read(line: string): Promise<Read | undefined> | Read | undefined;
  /** What is added to its summary when it ends. */
  detail?(): string;
}

/** How a launch is started: a server pack's launcher (pack, its id). */
export interface Launcher {
  pack: string;
  command(fill: Fills, token: string | undefined): Command;
}

export interface LauncherConfig {
  /** The pelago MCP endpoint to give the session. */
  mcpUrl: string;
  /** Where transcripts and the MCP config file are written. */
  dir: string;
  /** The server requires tokens, so each launched session is given one of its own. */
  auth?: boolean;
  /** The model a launcher's {model} is filled with. */
  model?: string;
  /** The server pack's launcher the launch setting names (src/server-launch.ts). */
  via: Launcher;
}

/** What a launched session's run is kept with: the sessions pack's run writes. */
export interface RunWrites { sessionStart: typeof sessionStart; sessionUpdate: typeof sessionUpdate; sessionEnd: typeof sessionEnd; tell: typeof tell; recordUsage: typeof recordUsage }
let writes: RunWrites | undefined;
/** Hand in the run writes (tool-acts.ts does, as it loads). */
export function keepRunsWith(next: RunWrites): void {
  writes = next;
}

let config: LauncherConfig | undefined;
const running = new Map<string, { child: ChildProcess; pack?: string }>();

/** Set how this server launches; undefined turns launching off. */
export function configureLauncher(next: LauncherConfig | undefined): void {
  config = next;
}

export async function launch(l: Archipelago, actor: Actor, input: LaunchInput, by?: StartedBy) {
  needHuman(actor, 'Only a human can launch a session.');
  if (!config) throw new Error('Launching is off on this server. It starts an agent in a repository on the machine the server runs on, so it works only on a server that listens on that machine alone.');
  const at = config;
  if (!writes) throw new Error('Launching is off: the sessions pack that keeps a launched run is not here.');
  const { recordUsage, sessionEnd, sessionStart, sessionUpdate, tell } = writes;
  const via = at.via;
  const mode = input.mode ?? 'plan';
  const { brief, started } = await callAs<{ brief: Brief; started?: StartedBy }>(l, 'answer.launch_brief', { actor, input, by });
  const cwd = brief.repo?.path;
  if (!cwd) throw new Error(`"${brief.task.title}" is not linked to a repository with a local path, so there is nowhere to run it.`);
  if (!existsSync(cwd)) throw new Error(`The repository path ${cwd} does not exist on this machine.`);

  // Register first: this is what takes the lane, or tells us it is taken.
  const sessionId = randomUUID();
  const surface = `pack:${via.pack}`;
  const agent: Actor = { kind: 'agent', name: `launched:${via.pack}` };
  // A frozen brief is run again, not worked on: its run is tied to no task (its started_by names the task).
  const begun = await sessionStart(l, agent, { task: input.brief ? undefined : input.task, cwd, session_id: sessionId, surface, title: `Headless (${mode}): ${brief.task.title}` });
  const run = begun.run;
  if (begun.status === 'waiting') {
    const why = (('blocked' in begun ? begun.blocked : undefined) ?? []).map((b) => b.why).join(' ');
    await sessionEnd(l, agent, { run, outcome: 'cancelled', summary: `Not launched: ${why}` });
    throw new Error(`Not launched. ${why}`);
  }

  mkdirSync(at.dir, { recursive: true });
  // With tokens on, the session gets its own agent token, good for a day and revoked the moment it ends; one someone
  // else started may only propose. The run says who. (With tokens off there is no identity to hold: everyone is the owner.)
  const key = at.auth ? await createToken(l.db, l.workspace, { kind: 'agent', name: `launched:${run}`, expires_days: 1, entity: l.viewer || undefined, ...launchedMay(started) }) : undefined;
  if (started) await l.apply(actorId(agent), { ops: [{ op: 'update', id: run, props: { started_by: started } }], reason: `Started by ${started.name}` });
  if (at.model) await l.apply(actorId(agent), { ops: [{ op: 'update', id: run, props: { model: at.model } }], reason: `Runs on ${at.model}` });
  const mcpFile = join(at.dir, `${run}.mcp.json`);
  writeFileSync(mcpFile, JSON.stringify({ mcpServers: { pelago: { type: 'http', url: at.mcpUrl, ...(key && { headers: { Authorization: `Bearer ${key.token}` } }) } } }));
  const transcript = join(at.dir, `${run}.jsonl`);
  const prompt = await callAs<string>(l, 'answer.launch_prompt', { brief, mode, run, instructions: input.instructions });
  const close = async (summary: string) => {
    if (key) await revokeToken(l.db, key.id).catch(() => {});
    rmSync(mcpFile, { force: true });
    await sessionEnd(l, agent, { run, outcome: 'failed', summary });
  };

  let command: Command;
  let child: ChildProcess;
  try {
    command = via.command({ prompt, mcp_config: mcpFile, tools: ALLOWED_TOOLS, model: at.model, session_id: sessionId, mode }, key?.token);
    const [bin, ...rest] = command.argv;
    child = spawn(bin, rest, { cwd, shell: false, env: command.env, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
  } catch (err) {
    await close(`Could not start: ${(err as Error).message}`);
    throw err;
  }
  running.set(run, { child, pack: via.pack });
  child.stdin!.on('error', () => {});
  child.stdin!.end(command.stdin ? prompt : undefined);

  const log = createWriteStream(transcript);
  const last: Read = {};
  let stderr = '';
  let lastBeat = Date.now();
  // Lines are read one after another, in the order printed, and the run ends only after the last is recorded.
  let reading: Promise<void> = Promise.resolve();
  const record = async (line: string) => {
    const got = await command.read(line);
    if (!got) return;
    if (typeof got.tokens === 'number') await recordUsage(l, sessionId, got.tokens).catch(() => {});
    if (typeof got.said === 'string' && got.said.trim()) {
      last.said = got.said;
      if (command.tells) await tell(l, agent, { run, said: got.said.trim().slice(0, 280) }).catch(() => {});
    }
    if (got.done) last.done = true;
    if (got.outcome === 'finished' || got.outcome === 'failed') last.outcome = got.outcome;
  };
  child.stderr!.on('data', (chunk: Buffer) => (stderr = (stderr + chunk.toString()).slice(-2000)));
  createInterface({ input: child.stdout! }).on('line', (line) => {
    log.write(line + '\n');
    reading = reading.then(() => record(line)).catch((err) => {
      stderr = `${stderr}\nIts line could not be read: ${(err as Error).message}`.slice(-2000);
      // A pack no longer on the server reads nothing more: its process is stopped.
      if (/No server pack/.test((err as Error).message)) stopLaunched(run);
    });
    if (Date.now() - lastBeat > 20_000) {
      lastBeat = Date.now();
      sessionUpdate(l, agent, { run }).catch(() => {});
    }
  });

  const finish = async (problem?: string, code?: number | null) => {
    if (!running.delete(run)) return;
    await reading;
    log.end();
    if (key) await revokeToken(l.db, key.id).catch(() => {});
    rmSync(mcpFile, { force: true });
    // What it read last decides; else it finished if it said it was done, or exited cleanly where no result is needed.
    const outcome = problem ? 'failed' : (last.outcome ?? (last.done || (!command.needsResult && code === 0) ? 'finished' : 'failed'));
    const text = problem ?? (last.said || stderr.trim() || 'The session ended without a result.');
    const detail = command.detail?.() ?? '';
    await sessionEnd(l, agent, { run, outcome, summary: `${text.slice(0, 6000)}\n\n(${[detail, `transcript: ${transcript}`].filter(Boolean).join('; ')})` }).catch(() => {});
  };
  child.on('error', (err) => void finish(`Could not start: ${err.message}`));
  child.on('close', (code) => void finish(undefined, code));

  return { run, session_id: sessionId, mode, cwd, transcript, claimed: ('claimed' in begun ? begun.claimed : undefined) ?? [] };
}

// A pack's answer launches through this (src/pack-launch.ts).
setPackLaunch(launch);
setActionLaunch(launch);

/** Kill a launched session's process, if this server started one for the run. */
export function stopLaunched(run: string): boolean {
  const child = running.get(run)?.child;
  if (!child) return false;
  // What it started goes with it.
  if (process.platform === 'win32' && child.pid) spawn('taskkill', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true });
  else child.kill();
  return true;
}

/** Stop every process a server pack's launcher started: the pack is gone. Their runs end as their processes do. */
export function stopLaunchedOf(pack: string): string[] {
  const runs = [...running].filter(([, r]) => r.pack === pack).map(([run]) => run);
  for (const run of runs) stopLaunched(run);
  return runs;
}

export function stopAllLaunched(): void {
  for (const run of [...running.keys()]) stopLaunched(run);
}
