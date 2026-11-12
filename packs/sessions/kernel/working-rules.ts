// The working rules a project is handed (`.claude/pelago.md`): examples/working-rules.md, with the instructions the
// packs ship for working_rules said where its marker stands, one bullet each. A rule is worded once, in its preset;
// the file holds only what frames them.
//
// The file is handed out before any workspace is known (src/connect.ts), so it is said in the words of every pack this
// server turns on (PELAGO_ONLY_PACKS; unset, every pack it has), not of one workspace: a habit moved out of core into a
// pack (the practice and findings packs) is said here still. A plugin ships every pack's words: it reaches any server.

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { presetsOf } from '../../../src/declared.ts';
import { said } from '../../../src/instructions.ts';
import { env } from '../../../src/env.ts';
import { readManifest } from '../../../src/manifest.ts';
import { readOnlyPacks } from '../../../src/pack-allow.ts';
import { KERNEL_PACKS } from '../../../src/packorder.ts';
import type { PackFile } from '../../../src/packs.ts';

const ROOT = join(import.meta.dirname, '..', '..', '..');
const MARKER = /^<!-- working_rules\b.*-->$/m;

/** Every pack file in this checkout, as read. */
export const checkoutPacks = (root = ROOT): PackFile[] =>
  readdirSync(join(root, 'packs'))
    .filter((p) => existsSync(join(root, 'packs', p, 'pack.json')))
    .map((p) => readManifest(readFileSync(join(root, 'packs', p, 'pack.json'), 'utf8'), `packs/${p}/pack.json`) as PackFile);

/** The packs of this checkout the server turns on: the kernel's and those PELAGO_ONLY_PACKS names, or every one. */
export function serverPacks(packs = checkoutPacks(), only = readOnlyPacks(env('ONLY_PACKS'))): PackFile[] {
  return only ? packs.filter((p) => KERNEL_PACKS.includes(p.id) || only.includes(p.id)) : packs;
}

/** The working rules file, with the working_rules instructions of the packs this server turns on (or these) said in it. */
export function workingRules(packs: PackFile[] = serverPacks(), root = ROOT): string {
  const rules = said(presetsOf(packs, 'instruction'), [], 'working_rules').map((one) => `- **${one.title}.** ${one.text}`);
  return readFileSync(join(root, 'examples/working-rules.md'), 'utf8').replace(MARKER, rules.join('\n'));
}

/** The working rules as a plugin ships them: without the bump skill's line, a skill only Archipelago's own work has. */
export const shippedRules = (): string => workingRules(checkoutPacks()).replace(/^- \*\*When Archipelago gets in your way,\*\*.*\r?\n(?: {2}.*\r?\n)*/m, '');
