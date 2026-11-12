// The working rules a project is handed (`.claude/pelago.md`): examples/working-rules.md, with the instructions the
// packs ship for working_rules said where its marker stands, one bullet each. A rule is worded once, in its preset;
// the file holds only what frames them.
//
// The file is handed out before any workspace is known (the connect pack's install, the surface's server files, the
// plugin), so it is said in the words of every pack this server turns on (PELAGO_ONLY_PACKS; unset, every pack it
// has), not of one workspace: a habit moved out of core into a pack (the practice and findings packs) is said here
// still. A plugin ships every pack's words: it reaches any server. Which packs the server's folder holds and turns on
// is the loader's to read, so the file is the loader's (wave 6b, e_rr96yyj3: it was the sessions pack's, and needs no
// map); what a preset says where is the agents pack's `said`, of which only the presets' part is used here, copied.

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { presetsOf, type StyleDef } from './declared.ts';
import { env } from '../../../src/env.ts';
import { readManifest } from './manifest.ts';
import { readOnlyPacks } from './pack-allow.ts';
import { KERNEL_PACKS } from './packorder.ts';
import type { PackFile } from './packs.ts';

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

const listed = (v: unknown) => (Array.isArray(v) ? v.map(String) : []);
const order = (props: Record<string, unknown>) => (typeof props.order === 'number' ? props.order : Infinity);

/**
 * What the presets say at `where` (not a file), in order: the agents pack's `said` with nothing kept on a map. A preset
 * that replaces another takes its place; the one replaced, if it comes later, does not take it back.
 */
export function presetsSaid(presets: StyleDef[], where: string): { title: string; text: string }[] {
  const named = new Map<string, { at: number; title: string; text: string; props: Record<string, unknown> }>();
  presets.forEach((p, at) => {
    const key = typeof p.props.replaces === 'string' ? p.props.replaces : p.id;
    if (key !== p.id || !named.has(key)) named.set(key, { at: named.get(key)?.at ?? at, title: p.title, text: p.body ?? '', props: p.props });
  });
  return [...named.values()]
    .filter((one) => one.text.trim() && listed(one.props.for).includes(where))
    .sort((a, b) => order(a.props) - order(b.props) || a.at - b.at)
    .map(({ title, text }) => ({ title, text }));
}

/** The working rules file, with the working_rules instructions of the packs this server turns on (or these) said in it. */
export function workingRules(packs: PackFile[] = serverPacks(), root = ROOT): string {
  const rules = presetsSaid(presetsOf(packs, 'instruction'), 'working_rules').map((one) => `- **${one.title}.** ${one.text}`);
  return readFileSync(join(root, 'examples/working-rules.md'), 'utf8').replace(MARKER, rules.join('\n'));
}

/** The working rules as a plugin ships them: without the bump skill's line, a skill only Archipelago's own work has. */
export const shippedRules = (): string => workingRules(checkoutPacks()).replace(/^- \*\*When Archipelago gets in your way,\*\*.*\r?\n(?: {2}.*\r?\n)*/m, '');
