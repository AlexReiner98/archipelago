import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Policy } from './lattice.ts';

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
}

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** Defaults, overridden by lattice.config.json, overridden by LATTICE_PORT / LATTICE_DATA. */
export function loadConfig(): Config {
  const file = join(ROOT, 'lattice.config.json');
  const fromFile: Partial<Config> = existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : {};
  return {
    packs: fromFile.packs,
    policy: fromFile.policy,
    auth: (process.env.LATTICE_AUTH ?? fromFile.auth) === 'tokens' ? 'tokens' : 'off',
    port: Number(process.env.LATTICE_PORT ?? fromFile.port ?? 3100),
    dataDir: resolve(ROOT, process.env.LATTICE_DATA ?? fromFile.dataDir ?? 'data'),
    packsDir: resolve(ROOT, fromFile.packsDir ?? 'packs'),
  };
}
