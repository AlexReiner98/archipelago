// Launching an agent a server pack declares (task e_ukp2mqys, decision e_885ztqkv): the pack names its command
// (reach.server.launchers, argv with {prompt}, {mcp_config}, {tools}, {model}, {mode}, {session_id}) and reads each
// line it prints (read); the server's launch setting names the pack that may launch. The kernel registers the run,
// mints the token the process is given (the pack never sees it), spawns with no shell and an environment of the token
// and the system's own, records what read answers, and on exit ends the run and revokes the token (src/launcher.ts).
// Only a person launches.
//
// The setting is PELAGO_LAUNCH_PACK (or pack, given): "<pack>" or "<pack>:<launcher>". With none named it is the
// launcher a server pack marks its default (the open core ships the claude_code pack's); a pack named that is not here,
// or none marked when none is named, turns launching off.

import { existsSync, readFileSync } from 'node:fs';
import { delimiter, dirname, extname, isAbsolute, join, resolve } from 'node:path';
import { env } from '../../../src/env.ts';
import { configureLauncher, stopLaunchedOf, type Launcher, type LauncherConfig, type Read } from './launcher.ts';
import type { ServerPacks } from './server-host.ts';
import { LAUNCH_FILLS } from '../../loader/kernel/server-reach.ts';

/** How long reading one line may take. */
const READ_MS = 5_000;
/** The token's name in the process's environment. */
export const TOKEN_ENV = 'PELAGO_AGENT_TOKEN';
/** What of the server's environment a launched process is given beside its token: what the system needs to start a
 * program and find its user's own files, never a secret of the server's. */
const SYSTEM_ENV = ['PATH', 'Path', 'PATHEXT', 'SystemRoot', 'SYSTEMROOT', 'windir', 'ComSpec', 'TEMP', 'TMP', 'TMPDIR', 'HOME', 'USERPROFILE', 'APPDATA', 'LOCALAPPDATA', 'LANG'];

export type LaunchConfig = Omit<LauncherConfig, 'via'> & {
  /** The server's packs, the launch setting's pack read from them. Optional until src/server.ts passes them. */
  packs?: Pick<ServerPacks, 'find' | 'call' | 'packs'>;
  /** Which pack may launch, and which of its launchers ("<pack>:<launcher>"); left out, PELAGO_LAUNCH_PACK, else defaultLaunch. */
  pack?: string;
};

/** The launch setting when none is given: the launcher a server pack marks default (reach.server.launchers[].default), if one does. */
export function defaultLaunch(packs: Pick<ServerPacks, 'packs'>): string | undefined {
  for (const p of packs.packs) {
    const l = p.file.reach.server.launchers?.find((d) => d.default);
    if (l) return `${p.file.id}:${l.id}`;
  }
  return undefined;
}

/**
 * A command named by its bare name, as a Windows machine finds it without a shell. An npm-installed CLI is there a
 * .cmd shim, which only a shell can start; the program it starts is run instead: its .exe, or its script under this
 * node. Anywhere else, or for anything else, the argv as it was.
 */
export function withoutShell(argv: string[], platform = process.platform, path = process.env.PATH ?? process.env.Path ?? ''): string[] {
  const [bin, ...rest] = argv;
  if (platform !== 'win32' || !bin || isAbsolute(bin) || extname(bin) || /[\\/]/.test(bin)) return argv;
  for (const dir of path.split(delimiter).filter(Boolean)) {
    if (existsSync(join(dir, `${bin}.exe`))) return argv;
    const shim = join(dir, `${bin}.cmd`);
    if (!existsSync(shim)) continue;
    // npm's shims end by running "%dp0%\<the program>" %*: that program, found beside the shim.
    const named = [...readFileSync(shim, 'utf8').matchAll(/"%dp0%\\([^"%]+\.(exe|js|cjs|mjs))"/gi)].at(-1);
    if (!named) return argv;
    // The shim says its path with backslashes: split there, so it is the same file wherever it is read.
    const target = resolve(dirname(shim), ...named[1].split('\\'));
    return named[2].toLowerCase() === 'exe' ? [target, ...rest] : [process.execPath, target, ...rest];
  }
  return argv;
}

type Fill = Partial<Record<(typeof LAUNCH_FILLS)[number], string>>;

/** A launcher's argv filled: an argument left empty (no model given) goes, with the --flag before it. */
export function fillArgv(argv: string[], fill: Fill): string[] {
  const out: string[] = [];
  for (const a of argv) {
    const filled = a.replace(/\{([a-z_]+)\}/g, (_, name: string) => ((LAUNCH_FILLS as readonly string[]).includes(name) ? (fill[name as keyof Fill] ?? '') : `{${name}}`));
    if (filled === '' && a !== '') {
      if (out.length && out[out.length - 1].startsWith('-')) out.pop();
      continue;
    }
    out.push(filled);
  }
  return out;
}

/** What a pack's read answered, kept to what is recorded. */
function readOf(answer: unknown): Read | undefined {
  if (!answer || typeof answer !== 'object') return undefined;
  const a = answer as Record<string, unknown>;
  return {
    ...(typeof a.tokens === 'number' && Number.isFinite(a.tokens) && { tokens: a.tokens }),
    ...(typeof a.said === 'string' && { said: a.said.slice(0, 6000) }),
    ...(a.done === true && { done: true }),
    ...((a.outcome === 'finished' || a.outcome === 'failed') && { outcome: a.outcome }),
  };
}

/** The launcher the setting names, as the kernel runs it; why not, as a sentence. */
export function packLauncher(packs: Pick<ServerPacks, 'find' | 'call'>, setting: string): Launcher | string {
  const [id, which] = setting.split(':');
  const pack = packs.find(id);
  if (!pack) return `the launch setting names "${id}", which is no server pack here`;
  const declared = pack.file.reach.server.launchers ?? [];
  const l = which ? declared.find((d) => d.id === which) : declared[0];
  if (!l) return `the server pack "${id}" declares no launcher${which ? ` "${which}"` : ''}`;
  return {
    pack: id,
    command: (fill, token) => {
      // Removed since, it launches nothing more.
      if (!packs.find(id)) throw new Error(`The server pack "${id}" is no longer on this server.`);
      const named = l.argv.some((a) => a.includes('{prompt}'));
      const system = Object.fromEntries(SYSTEM_ENV.filter((k) => process.env[k] !== undefined).map((k) => [k, process.env[k]]));
      return {
        argv: withoutShell(fillArgv(l.argv, fill)),
        env: { ...system, ...(token && { [TOKEN_ENV]: token }) },
        stdin: !named,
        tells: true,
        read: async (line) => readOf(await packs.call(id, 'entry', l.read, { line }, READ_MS, true)),
      };
    },
  };
}

/** Set up launching for this server: the launcher of the pack the setting names, or of the one the open core ships. */
export function configureLaunch(config: LaunchConfig): void {
  const { packs, pack, ...rest } = config;
  const setting = pack ?? env('LAUNCH_PACK') ?? (packs && defaultLaunch(packs));
  const via = !packs ? 'the server passed no server packs to launch with' : setting ? packLauncher(packs, setting) : 'no launch pack is named, and no server pack marks a launcher its default';
  if (typeof via === 'string') {
    // Named wrong, nothing launches.
    console.error(`Launching is off: ${via}.`);
    return configureLauncher(undefined);
  }
  configureLauncher({ ...rest, via });
}

/** A server pack is gone: its processes are stopped, and their runs end. Answers those runs. */
export const launchPackGone = (id: string): string[] => stopLaunchedOf(id);
