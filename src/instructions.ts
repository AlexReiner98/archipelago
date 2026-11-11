// What agents are told: the instructions the packs ship as presets, under those the map keeps, as styles are for
// looks (src/styles.ts). Where each is said is its field `for`: session_start, working_rules, tool:<name>, or
// file:<glob>, said to a session about to read or change a file the glob names (what bites there).
//
// Layers, the nearest last, each over one of the same name (its preset, or else its own id):
//   a preset, an instruction kept about nothing (the workspace's), one kept about the repository a session is in.
// One kept with a preset's id (preset) is the owner's version of it: its note and fields over the preset's, in the
// preset's place; retired, it is not said. A pack's preset that replaces another (its prop `replaces`, a preset's id) is
// said in that one's place when its pack is on, so core can word a rule in its own types and a pack in its richer ones.
// Read each time, so a change is said to the next session.

import { presetsOf, type StyleDef } from './declared.ts';
import { islandRegistry } from './island-pin.ts';
import type { Archipelago } from './pelago.ts';

/** An instruction the map keeps, with what it is about. */
export interface KeptInstruction {
  id: string;
  title: string;
  body: string | null;
  is_open: boolean;
  props: Record<string, unknown>;
  about: string[];
}

/** One thing said, and which instruction (and preset) said it. */
export interface Said {
  id: string;
  title: string;
  text: string;
  preset?: string;
  /** For one said for files: the globs it names. */
  files?: string[];
}

const listed = (v: unknown) => (Array.isArray(v) ? v.map(String) : []);

/** Said for files: file:<glob> in `for`, and asked as file:<path>, or as file: alone for every one said for a file. */
export const FILE = 'file:';
/** A path as globs read it: forward slashes, no leading ./ */
const slashed = (path: string) => path.replace(/\\/g, '/').replace(/^(\.\/)+/, '');
/** A glob as a pattern: ** any folders, * any name within one, ? one character, the rest as written. */
const globRe = (glob: string) =>
  slashed(glob).replace(/[.+^${}()|[\]]/g, '\\$&').replace(/\*\*\/|\*\*|\*|\?/g, (m) => (m === '**/' ? '(?:.*/)?' : m === '**' ? '.*' : m === '*' ? '[^/]*' : '[^/]'));
/** Whether a glob names a path: the whole of it, or its end from a folder on, so a path from the disk's root matches a glob from the checkout's. */
export const globNames = (glob: string, path: string) => new RegExp(`(^|/)${globRe(glob)}$`, 'i').test(slashed(path));

/** Whether what is said at `where` is said by these `for`s: the same place, or a file one of its globs names (any file, for file: alone). */
const saidAt = (fors: string[], where: string) =>
  fors.includes(where) || (where.startsWith(FILE) && fors.some((f) => f.startsWith(FILE) && (where === FILE || globNames(f.slice(FILE.length), where.slice(FILE.length)))));
const globsOf = (fors: string[]) => fors.filter((f) => f.startsWith(FILE)).map((f) => f.slice(FILE.length));

/** What is said where (`for`), to a session about `about`: the presets under what the map keeps, in order. Pure: what is read is handed in. */
export function said(presets: StyleDef[], kept: KeptInstruction[], where: string, about?: string): Said[] {
  const named = new Map<string, { weight: number; at: number; id: string; title: string; open: boolean; text: string; props: Record<string, unknown>; preset?: string }>();
  presets.forEach((p, at) => {
    const key = typeof p.props.replaces === 'string' ? p.props.replaces : p.id;
    // A preset that replaces another takes its place; the one replaced, if it comes later, does not take it back.
    if (key !== p.id || !named.has(key)) named.set(key, { weight: 0, at: named.get(key)?.at ?? at, id: p.id, title: p.title, open: true, text: p.body ?? '', props: p.props, preset: p.id });
  });
  const weighed = kept.map((one, i) => ({ one, i, weight: !one.about.length ? 1 : about !== undefined && one.about.includes(about) ? 2 : -1 }));
  for (const { one, i, weight } of weighed.filter((w) => w.weight > 0).sort((a, b) => a.weight - b.weight)) {
    const namedAs = typeof one.props.preset === 'string' ? one.props.preset : one.id;
    // The owner's version of a preset that replaces another stands where that one does.
    const key = [...named.entries()].find(([, n]) => n.preset === namedAs)?.[0] ?? namedAs;
    const under = named.get(key);
    const props = { ...under?.props, ...Object.fromEntries(Object.entries(one.props).filter(([, v]) => v != null)) };
    named.set(key, { weight, at: under?.at ?? presets.length + i, id: one.id, title: one.title || under?.title || '', open: one.is_open, text: one.body?.trim() ? one.body : (under?.text ?? ''), props, ...(under?.preset && { preset: under.preset }) });
  }
  const order = (props: Record<string, unknown>) => (typeof props.order === 'number' ? props.order : Infinity);
  return [...named.values()]
    .filter((one) => one.open && one.text.trim() && saidAt(listed(one.props.for), where))
    .sort((a, b) => order(a.props) - order(b.props) || a.at - b.at)
    .map(({ id, title, text, preset, props }) => ({ id, title, text, ...(preset && { preset }), ...(where.startsWith(FILE) && { files: globsOf(listed(props.for)) }) }));
}

/** A name in braces filled in from `fill`; one it does not have is left as it is. */
export const filled = (text: string, fill: Record<string, string>) => text.replace(/\{([a-z_]+)\}/g, (all, name: string) => fill[name] ?? all);

/** Every instruction kept on the map, open or retired, with what each is about. */
async function keptInstructions(l: Archipelago): Promise<KeptInstruction[]> {
  const { rows } = await l.db.query<Omit<KeptInstruction, 'about'>>(
    `select id, title, body, is_open, ${l.props} from entity where type = any($1::text[]) and archived_at is null order by updated_at, id -- index entity_type_created`,
    [l.registry.family('instruction')],
  );
  const { rows: links } = await l.db.query<{ from_id: string; to_id: string }>(`select from_id, to_id from relation where type = 'about' and valid_to is null and from_id = any($1::text[])`, [rows.map((r) => r.id)]);
  return rows.map((r) => ({ ...r, about: links.filter((link) => link.from_id === r.id).map((link) => link.to_id) }));
}

/** What agents are told where (`for`), to a session about `about`, with the names in braces filled in; on an island, the presets of the version of its pack it runs (src/island-pin.ts). */
export async function instructionsFor(l: Archipelago, where: string, input: { about?: string; island?: string; fill?: Record<string, string> } = {}): Promise<Said[]> {
  const told = said(presetsOf((await islandRegistry(l, input.island)).packs, 'instruction'), await keptInstructions(l), where, input.about);
  return told.map((one) => ({ ...one, text: filled(one.text, input.fill ?? {}) }));
}
