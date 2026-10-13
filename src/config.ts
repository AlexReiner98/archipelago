import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DEFAULT_AGENT_POLICY, type Policy } from './lattice.ts';

export interface Config {
  port: number;
  dataDir: string;
  packsDir: string;
  /** Pack ids to enable. Omit to enable every pack in packsDir. */
  packs?: string[];
  /** What agents may do without asking. Humans are never restricted. */
  policy?: Partial<Policy>;
  /**
   * off (default): one workspace, and the surface decides who is calling.
   * tokens: every request carries a token naming its workspace and identity.
   */
  auth: 'off' | 'tokens';
  /**
   * The address to listen on. 127.0.0.1 (default) is this machine only.
   * Anything else (LATTICE_HOST, e.g. 0.0.0.0 on a hosting platform) is
   * reachable from outside, and is refused without auth "tokens".
   */
  host: string;
  /**
   * The names the server is reached by from outside, e.g. "lattice.example.com"
   * (LATTICE_PUBLIC_HOST, comma separated). Requests naming any other host are
   * refused. TLS is expected to end in front of the server.
   */
  publicHosts: string[];
  /**
   * The proxies in front of the server whose word is taken for where a
   * request came from, beyond private networks (LATTICE_TRUSTED_PROXIES):
   * networks as CIDR, comma separated, or "cloudflare". See src/address.ts.
   */
  trustedProxies?: string;
  /**
   * Where and how often every workspace is written out as a backup, and how
   * many of each to keep. On by default, beside the data folder, every 6
   * hours, keeping 28 (a week). `"backup": false` turns it off;
   * LATTICE_BACKUP_DIR moves it. With LATTICE_BACKUP_UPLOAD_URL and
   * LATTICE_BACKUP_UPLOAD_KEY set, a copy of each is sent off the server.
   */
  backup: false | { dir: string; everyHours: number; keep: number; upload?: { url: string; key: string } };
  /**
   * A workspace nobody has used for this long has its database closed until
   * the next request, to free its memory (LATTICE_IDLE_MINUTES). 0 never closes.
   */
  idleMinutes: number;
  /** Whether this server may start Claude Code sessions: only when it listens on this machine alone. */
  launch: boolean;
  /**
   * For working on Lattice itself, one person on one machine: agent changes
   * apply without review unless `policy` says otherwise, and agents may restart
   * the server. Set by `npm run dev` (LATTICE_DEV=1). Refused with auth tokens.
   */
  dev: boolean;
}

/** The exit code that asks the dev supervisor (src/dev.ts) to start the server again. */
export const RESTART_EXIT = 75;

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/**
 * The commit this server was started from: the one the hosting platform built
 * (Render says which), or the checkout's HEAD at the moment it started. Asked
 * of /health, it is how "is the new code live yet?" becomes one comparison.
 */
export function startedFrom(): string | undefined {
  const given = process.env.LATTICE_COMMIT ?? process.env.RENDER_GIT_COMMIT;
  if (given?.trim()) return given.trim();
  try {
    const git = join(ROOT, '.git');
    const head = readFileSync(join(git, 'HEAD'), 'utf8').trim();
    if (!head.startsWith('ref: ')) return head;
    const ref = head.slice('ref: '.length);
    if (existsSync(join(git, ref))) return readFileSync(join(git, ref), 'utf8').trim();
    const packed = readFileSync(join(git, 'packed-refs'), 'utf8').split('\n').find((line) => line.endsWith(` ${ref}`));
    return packed?.split(' ')[0];
  } catch {
    return undefined; // not a checkout: nothing to say
  }
}

/** Defaults, overridden by lattice.config.json, overridden by the LATTICE_* environment variables. */
export function loadConfig(): Config {
  const file = join(ROOT, 'lattice.config.json');
  const fromFile: Partial<Config> = existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : {};
  const auth = (process.env.LATTICE_AUTH ?? fromFile.auth) === 'tokens' ? 'tokens' : 'off';
  const dev = process.env.LATTICE_DEV !== undefined ? process.env.LATTICE_DEV === '1' : fromFile.dev === true;
  if (dev && auth === 'tokens') throw new Error('Dev mode turns off review and lets agents restart the server, so it does not run with auth "tokens".');
  const host = process.env.LATTICE_HOST ?? fromFile.host ?? '127.0.0.1';
  const local = ['127.0.0.1', 'localhost', '::1'].includes(host);
  if (!local && auth !== 'tokens') throw new Error(`Listening on ${host} makes the server reachable from outside, which needs auth "tokens": without it anyone who can reach it is the owner.`);
  if (!local && dev) throw new Error('Dev mode does not listen beyond this machine.');
  const named = process.env.LATTICE_PUBLIC_HOST?.split(',') ?? fromFile.publicHosts ?? [];
  const dataDir = resolve(ROOT, process.env.LATTICE_DATA ?? fromFile.dataDir ?? 'data');
  // The key is a secret, so it comes from the environment only, never the config file.
  const sendTo = process.env.LATTICE_BACKUP_UPLOAD_URL && process.env.LATTICE_BACKUP_UPLOAD_KEY ? { url: process.env.LATTICE_BACKUP_UPLOAD_URL, key: process.env.LATTICE_BACKUP_UPLOAD_KEY } : undefined;
  const wanted = fromFile.backup === false ? false : { ...(fromFile.backup as object | undefined) } as { dir?: string; everyHours?: number; keep?: number };
  const backup = wanted && { dir: resolve(ROOT, process.env.LATTICE_BACKUP_DIR ?? wanted.dir ?? join(dataDir, '..', 'backups')), everyHours: wanted.everyHours ?? 6, keep: wanted.keep ?? 28, upload: sendTo };
  const unreviewed = Object.fromEntries(Object.keys(DEFAULT_AGENT_POLICY).map((op) => [op, 'auto'])) as Policy;
  return {
    packs: fromFile.packs,
    policy: dev ? { ...unreviewed, ...fromFile.policy } : fromFile.policy,
    auth,
    dev,
    host,
    idleMinutes: Number(process.env.LATTICE_IDLE_MINUTES ?? fromFile.idleMinutes ?? 30),
    // A hosted server has neither its customers' repositories nor their Claude CLI.
    launch: local,
    publicHosts: named.map((name) => name.trim().toLowerCase()).filter(Boolean),
    trustedProxies: process.env.LATTICE_TRUSTED_PROXIES ?? fromFile.trustedProxies,
    // Hosting platforms say which port to use through PORT.
    port: Number(process.env.LATTICE_PORT ?? process.env.PORT ?? fromFile.port ?? 3100),
    dataDir,
    backup,
    packsDir: resolve(ROOT, fromFile.packsDir ?? 'packs'),
  };
}
