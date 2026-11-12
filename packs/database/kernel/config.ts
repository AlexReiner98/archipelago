import { existsSync, readFileSync, statSync } from 'node:fs';
import { delimiter, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { env } from '../../../src/env.ts';
import { readOnlyPacks, readWorkspacePacks } from '../../../src/pack-allow.ts';
import type { Policy } from '../../../src/pelago.ts';
import { serverPolicy } from '../../identity/kernel/policy.ts';

export interface Config {
  port: number;
  dataDir: string;
  /** A Postgres server holding the databases (PELAGO_DATABASE_URL); unset, each is a folder under dataDir. */
  databaseUrl?: string;
  packsDir: string;
  /** Every folder workspace packs are read from: packsDir, then those PELAGO_PACKS names (separated as PATH is), so a
   * private pack is a folder on the machine the server runs on, never a file of this repository. */
  packDirs: string[];
  /** Pack ids to enable (PELAGO_ONLY_PACKS, comma separated). Omit to enable every pack found (src/pack-allow.ts). */
  packs?: string[];
  /** Packs one workspace may have beyond `packs`, by workspace id (PELAGO_WORKSPACE_PACKS, "islands=a,b;other=c"). */
  workspacePacks?: Record<string, string[]>;
  /** What agents may do without asking. Humans are never restricted. */
  policy?: Partial<Policy>;
  /**
   * off (default): one workspace, and the surface decides who is calling.
   * tokens: every request carries a token naming its workspace and identity.
   */
  auth: 'off' | 'tokens';
  /**
   * The address to listen on. 127.0.0.1 (default) is this machine only.
   * Anything else (PELAGO_HOST, e.g. 0.0.0.0 on a hosting platform) is
   * reachable from outside, and is refused without auth "tokens".
   */
  host: string;
  /**
   * The names the server is reached by from outside, e.g. "pelago.example.com"
   * (PELAGO_PUBLIC_HOST, comma separated). Requests naming any other host are
   * refused. TLS is expected to end in front of the server.
   */
  publicHosts: string[];
  /**
   * The name that serves the frame drawings run in, and nothing else (PELAGO_DRAW_HOST, e.g. "draw.example.com"),
   * so the frame has an origin of its own and keeps a service worker (src/draw-host.ts). Unset, a dev server frames
   * drawings at the other loopback name, and any other at the page's own origin, sandboxed with none.
   */
  drawHost?: string;
  /**
   * Domains that each serve one workspace's public site (PELAGO_SITES,
   * "archipelago.tools=archipelago", comma separated): there a published
   * document is read at its address word, and the one called home at /.
   */
  sites: Record<string, string>;
  /**
   * The proxies in front of the server whose word is taken for where a
   * request came from, beyond private networks (PELAGO_TRUSTED_PROXIES):
   * networks as CIDR, comma separated, or "cloudflare". See src/address.ts.
   */
  trustedProxies?: string;
  /**
   * Where and how often every workspace is written out as a backup, and how
   * many of each to keep. On by default, beside the data folder, every 6
   * hours, keeping 28 (a week). `"backup": false` turns it off;
   * PELAGO_BACKUP_DIR moves it. With PELAGO_BACKUP_UPLOAD_URL and
   * PELAGO_BACKUP_UPLOAD_KEY set, a copy of each is sent off the server.
   */
  backup: false | { dir: string; everyHours: number; keep: number; upload?: { url: string; key: string } };
  /**
   * A workspace nobody has used for this long has its database closed until
   * the next request, to free its memory (PELAGO_IDLE_MINUTES). 0 never closes.
   */
  idleMinutes: number;
  /**
   * Where this server starts sessions (PELAGO_LAUNCH): local, Claude Code on this machine, only when the server
   * listens on it alone (the default there); or not at all. Launching in the cloud went on 8 Nov 2026.
   */
  launch: 'local' | false;
  /**
   * For working on Archipelago itself, one person on one machine: agent changes
   * apply without review unless `policy` says otherwise, and agents may restart
   * the server. Set by `npm run dev` (PELAGO_DEV=1). Refused with auth tokens.
   */
  dev: boolean;
}

/** The exit code that asks the dev supervisor (scripts/dev.ts) to start the server again. */
export const RESTART_EXIT = 75;

/** A name a drawing host may have (PELAGO_DRAW_HOST, src/draw-host.ts): a host name, and a port. */
export const DRAW_HOST_NAME = /^[a-z0-9.-]+(:\d{1,5})?$/;

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');

/**
 * The commit this server was started from: the one the hosting platform built
 * (Render says which), or the checkout's HEAD at the moment it started. Asked
 * of /health, it is how "is the new code live yet?" becomes one comparison.
 */
export function startedFrom(): string | undefined {
  const given = env('COMMIT') ?? process.env.RENDER_GIT_COMMIT;
  if (given?.trim()) return given.trim();
  try {
    let git = join(ROOT, '.git');
    // In a worktree .git is a file naming its own folder, which holds HEAD; the refs are in the folder it shares.
    const own = statSync(git).isFile() ? resolve(ROOT, readFileSync(git, 'utf8').trim().replace(/^gitdir: /, '')) : git;
    if (own !== git) git = resolve(own, existsSync(join(own, 'commondir')) ? readFileSync(join(own, 'commondir'), 'utf8').trim() : '.');
    const head = readFileSync(join(own, 'HEAD'), 'utf8').trim();
    if (!head.startsWith('ref: ')) return head;
    const ref = head.slice('ref: '.length);
    if (existsSync(join(git, ref))) return readFileSync(join(git, ref), 'utf8').trim();
    const packed = readFileSync(join(git, 'packed-refs'), 'utf8').split('\n').find((line) => line.endsWith(` ${ref}`));
    return packed?.split(' ')[0];
  } catch {
    return undefined; // not a checkout: nothing to say
  }
}

/**
 * Defaults, overridden by pelago.config.json, overridden by the PELAGO_* environment variables.
 */
export function loadConfig(): Config {
  const file = existsSync(join(ROOT, 'pelago.config.json')) ? join(ROOT, 'pelago.config.json') : '';
  const fromFile: Partial<Config> = file ? JSON.parse(readFileSync(file, 'utf8')) : {};
  const auth = (env('AUTH') ?? fromFile.auth) === 'tokens' ? 'tokens' : 'off';
  const dev = env('DEV') !== undefined ? env('DEV') === '1' : fromFile.dev === true;
  if (dev && auth === 'tokens') throw new Error('Dev mode turns off review and lets agents restart the server, so it does not run with auth "tokens".');
  const host = env('HOST') ?? fromFile.host ?? '127.0.0.1';
  const local = ['127.0.0.1', 'localhost', '::1'].includes(host);
  if (!local && auth !== 'tokens') throw new Error(`Listening on ${host} makes the server reachable from outside, which needs auth "tokens": without it anyone who can reach it is the owner.`);
  if (!local && dev) throw new Error('Dev mode does not listen beyond this machine.');
  const named = env('PUBLIC_HOST')?.split(',') ?? fromFile.publicHosts ?? [];
  const drawHost = (env('DRAW_HOST') ?? fromFile.drawHost)?.trim().toLowerCase() || undefined;
  if (drawHost && (!DRAW_HOST_NAME.test(drawHost) || named.some((n) => n.trim().toLowerCase() === drawHost))) throw new Error(`PELAGO_DRAW_HOST is a name of its own (and a port), never one the page is reached at: not ${drawHost}.`);
  const dataDir = resolve(ROOT, env('DATA') ?? fromFile.dataDir ?? 'data');
  // A Postgres server for the databases, in place of folders: it carries a password, so from the environment only.
  const databaseUrl = env('DATABASE_URL');
  // The key is a secret, so it comes from the environment only, never the config file.
  const [url, key] = [env('BACKUP_UPLOAD_URL'), env('BACKUP_UPLOAD_KEY')];
  const sendTo = url && key ? { url, key } : undefined;
  const wanted = fromFile.backup === false ? false : { ...(fromFile.backup as object | undefined) } as { dir?: string; everyHours?: number; keep?: number };
  const backup = wanted && { dir: resolve(ROOT, env('BACKUP_DIR') ?? wanted.dir ?? join(dataDir, '..', 'backups')), everyHours: wanted.everyHours ?? 24, keep: wanted.keep ?? 7, upload: sendTo };
  const wantLaunch = env('LAUNCH') ?? (local ? 'local' : 'off');
  if (!['local', 'off'].includes(wantLaunch)) throw new Error('PELAGO_LAUNCH is local or off.');
  if (wantLaunch === 'local' && !local) throw new Error('Launching on this machine starts Claude Code as the server, so it runs only on a server that listens on this machine alone.');
  const launch = wantLaunch === 'off' ? false : ('local' as const);
  return {
    packs: readOnlyPacks(env('ONLY_PACKS')) ?? fromFile.packs,
    workspacePacks: env('WORKSPACE_PACKS') !== undefined ? readWorkspacePacks(env('WORKSPACE_PACKS')) : fromFile.workspacePacks,
    // The policy half is identity's (packs/identity/kernel/policy.ts): dev mode reviews nothing unless the file says.
    policy: serverPolicy(fromFile.policy, dev),
    auth,
    dev,
    host,
    idleMinutes: Number(env('IDLE_MINUTES') ?? fromFile.idleMinutes ?? 30),
    // A hosted server has neither its customers' repositories nor their Claude CLI: it launches nothing.
    launch,
    drawHost,
    publicHosts: named.map((name) => name.trim().toLowerCase()).filter(Boolean),
    sites: Object.fromEntries((env('SITES') ?? '').split(',').map((pair) => pair.split('=').map((part) => part.trim().toLowerCase())).filter(([host, ws]) => host && ws)),
    trustedProxies: env('TRUSTED_PROXIES') ?? fromFile.trustedProxies,
    // Hosting platforms say which port to use through PORT.
    port: Number(env('PORT') ?? process.env.PORT ?? fromFile.port ?? 3100),
    dataDir,
    databaseUrl,
    backup,
    packsDir: resolve(ROOT, fromFile.packsDir ?? 'packs'),
    packDirs: [resolve(ROOT, fromFile.packsDir ?? 'packs'), ...(env('PACKS') ?? '').split(delimiter).map((d) => d.trim()).filter(Boolean).map((d) => resolve(d))],
  };
}
