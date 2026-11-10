// Launching an agent a server pack declares (task e_ukp2mqys, decision e_885ztqkv): the pack names its command
// (reach.server.launchers, argv with {prompt}, {mcp_config}, {tools}, {model}) and reads each line it prints (read); the
// server's launch setting names the pack that may launch. The kernel registers the run, mints the token the process
// is given (the pack never sees it), spawns with no shell and an environment of the token and the system's own, records what read answers, and
// on exit ends the run and revokes the token (src/launcher.ts). Only a person launches.
//
// The setting is PELAGO_LAUNCH_PACK (or pack, given): "<pack>" or "<pack>:<launcher>". With none named, the kernel's
// own Claude Code launcher runs, as before, until the claude_code pack ships (the adapter cut); then none named is off.

import { env } from './env.ts';
import { configureLauncher, stopLaunchedOf, type Launcher, type LauncherConfig, type Read } from './launcher.ts';
import type { ServerPacks } from './server-host.ts';
import { LAUNCH_FILLS } from './server-reach.ts';

/** How long reading one line may take. */
const READ_MS = 5_000;
/** The token's name in the process's environment. */
export const TOKEN_ENV = 'PELAGO_AGENT_TOKEN';
/** What of the server's environment a launched process is given beside its token: what the system needs to start a
 * program and find its user's own files, never a secret of the server's. */
const SYSTEM_ENV = ['PATH', 'Path', 'PATHEXT', 'SystemRoot', 'SYSTEMROOT', 'windir', 'ComSpec', 'TEMP', 'TMP', 'TMPDIR', 'HOME', 'USERPROFILE', 'APPDATA', 'LOCALAPPDATA', 'LANG'];

export type LaunchConfig = Omit<LauncherConfig, 'via'> & {
  /** The server's packs, the launch setting's pack read from them. Optional until src/server.ts passes them. */
  packs?: Pick<ServerPacks, 'find' | 'call'>;
  /** Which pack may launch, and which of its launchers ("<pack>:<launcher>"); left out, PELAGO_LAUNCH_PACK. */
  pack?: string;
};

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
        argv: fillArgv(l.argv, fill),
        env: { ...system, ...(token && { [TOKEN_ENV]: token }) },
        stdin: !named,
        tells: true,
        read: async (line) => readOf(await packs.call(id, 'entry', l.read, { line }, READ_MS, true)),
      };
    },
  };
}

/** Set up launching for this server: the setting's pack, when one is named; the kernel's own launcher until then. */
export function configureLaunch(config: LaunchConfig): void {
  const { packs, pack, ...rest } = config;
  const setting = pack ?? env('LAUNCH_PACK');
  if (!setting) return configureLauncher(rest);
  const via = packs ? packLauncher(packs, setting) : 'the server passed no server packs to launch with';
  if (typeof via === 'string') {
    // Named wrong, nothing launches: never the kernel's own in its place.
    console.error(`Launching is off: ${via}.`);
    return configureLauncher(undefined);
  }
  configureLauncher({ ...rest, via });
}

/** A server pack is gone: its processes are stopped, and their runs end. Answers those runs. */
export const launchPackGone = (id: string): string[] => stopLaunchedOf(id);
