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
   * For working on Lattice itself, one person on one machine: agent changes
   * apply without review unless `policy` says otherwise, and agents may restart
   * the server. Set by `npm run dev` (LATTICE_DEV=1). Refused with auth tokens.
   */
  dev: boolean;
}

/** The exit code that asks the dev supervisor (src/dev.ts) to start the server again. */
export const RESTART_EXIT = 75;

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

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
  const unreviewed = Object.fromEntries(Object.keys(DEFAULT_AGENT_POLICY).map((op) => [op, 'auto'])) as Policy;
  return {
    packs: fromFile.packs,
    policy: dev ? { ...unreviewed, ...fromFile.policy } : fromFile.policy,
    auth,
    dev,
    host,
    publicHosts: named.map((name) => name.trim().toLowerCase()).filter(Boolean),
    // Hosting platforms say which port to use through PORT.
    port: Number(process.env.LATTICE_PORT ?? process.env.PORT ?? fromFile.port ?? 3100),
    dataDir: resolve(ROOT, process.env.LATTICE_DATA ?? fromFile.dataDir ?? 'data'),
    packsDir: resolve(ROOT, fromFile.packsDir ?? 'packs'),
  };
}
