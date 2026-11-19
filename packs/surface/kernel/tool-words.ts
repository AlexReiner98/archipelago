// The words the surface describes its tools and greets a client in: the surface pack's presets, instructions at
// tool:<name> (each tool's own words) and connect:<part> (what a client is told on connecting), read from its pack file
// once, so each is worded in one place. Where a client is answered (./mcp.ts), the map's version of each (the owner's,
// said through answer.instructions) is put in their place. What fills them in (the reads, views, actions and ops a
// workspace offers) is the surface's to list.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { presetsOf } from '../../loader/kernel/declared.ts';
import type { PackFile } from '../../loader/kernel/packs.ts';
import { presetsSaid } from '../../loader/kernel/working-rules.ts';

/** What is said at a place, one string: the words a tool or a client's greeting is made of. */
export type Words = (where: string) => string;

const OWN = presetsOf([JSON.parse(readFileSync(join(import.meta.dirname, '..', 'pack.json'), 'utf8')) as PackFile], 'instruction');

/** What the surface pack's own presets say at a place: the words a tool is declared with, before the map's. */
export const ownWords: Words = (where) =>
  presetsSaid(OWN, where)
    .map((one) => one.text)
    .join(' ');

/** The map's words at each place (`at`, as answer.instructions gives them), the surface's own where the map says nothing there. */
export const wordsFrom =
  (at: Record<string, string>): Words =>
  (where) =>
    at[where] || ownWords(where);

/** The names in braces filled in; one the fill does not have is left as it is (the agents pack's `filled`, copied). */
export const fillIn = (text: string, fill: Record<string, string>) => text.replace(/\{([a-z_]+)\}/g, (all, name: string) => fill[name] ?? all);

/** Where the tools' words are: each tool's own, and the tails a verb's and change's list is said in. */
export const TOOL_PLACES = (names: string[]) => [...names.map((name) => `tool:${name}`), 'tool:verb_actions', 'tool:change_ops'];

/** Where a client's greeting is worded. */
export const CONNECT_PLACES = ['connect', 'connect:reads', 'connect:reads_none', 'connect:frontier', 'connect:handoff'];
