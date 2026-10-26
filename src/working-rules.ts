// The working rules a project is handed (`.claude/pelago.md`): examples/working-rules.md, with the instructions the
// packs ship for working_rules said where its marker stands, one bullet each. A rule is worded once, in its preset;
// the file holds only what frames them.

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { presetsOf } from './declared.ts';
import { said } from './instructions.ts';
import { readManifest } from './manifest.ts';
import type { PackFile } from './packs.ts';

const ROOT = join(import.meta.dirname, '..');
const MARKER = /^<!-- working_rules\b.*-->$/m;

/** Every pack file in this checkout, as read. */
export const checkoutPacks = (root = ROOT): PackFile[] =>
  readdirSync(join(root, 'packs'))
    .filter((p) => existsSync(join(root, 'packs', p, 'pack.json')))
    .map((p) => readManifest(readFileSync(join(root, 'packs', p, 'pack.json'), 'utf8'), `packs/${p}/pack.json`).manifest as PackFile);

/** The working rules file, with the packs' working_rules instructions said in it. */
export function workingRules(packs: PackFile[] = checkoutPacks(), root = ROOT): string {
  const rules = said(presetsOf(packs, 'instruction'), [], 'working_rules').map((one) => `- **${one.title}.** ${one.text}`);
  return readFileSync(join(root, 'examples/working-rules.md'), 'utf8').replace(MARKER, rules.join('\n'));
}
