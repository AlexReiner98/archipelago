// The files this repository keeps that a script makes from others, each with the command that makes it. A change to a
// source leaves its file behind until the command is run, and no test that a change names reads the sources (the
// script reads them by path), so the structure test, which every run has, checks them all: a stale file fails there,
// before a commit, not on the first push.
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { DIRECTORY_ICON, PLUGIN_ICON, pluginFiles } from '../scripts/plugin.ts';
import { LISTING } from '../packs/surface/kernel/listing.ts';

// A plain module with no types: what the setup's maker gives.
const { made, OUT } = (await import('../packs/claude_code/sync.mjs' as string)) as { made(): string; OUT: string };

const ROOT = join(import.meta.dirname, '..');
const at = (path: string) => join(ROOT, path);
const holds = (path: string, text: string) => existsSync(at(path)) && readFileSync(at(path), 'utf8') === text;

/** Each generated file that is not what its sources make now, with the command that makes it. */
export function behind(): string[] {
  const stale: string[] = [];
  const setup = 'packs/claude_code/files/setup.mjs';
  if (!existsSync(OUT) || readFileSync(OUT, 'utf8') !== made()) stale.push(`${setup}: run node packs/claude_code/sync.mjs`);
  for (const [path, text] of Object.entries(pluginFiles())) if (!holds(path, text)) stale.push(`${path}: run npm run plugin`);
  const icon = readFileSync(at(LISTING.icon));
  for (const path of [PLUGIN_ICON, DIRECTORY_ICON]) if (!existsSync(at(path)) || !readFileSync(at(path)).equals(icon)) stale.push(`${path}: run npm run plugin`);
  return stale;
}
