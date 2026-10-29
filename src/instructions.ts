// What agents are told: the instructions the packs ship as presets, under those the map keeps, as styles are for
// looks (src/styles.ts). Where each is said is its field `for`: session_start, working_rules, tool:<name>, or
// file:<glob>, said to a session about to read or change a file the glob names (what bites there).
//
// Layers, the nearest last, each over one of the same name (its preset, or else its own id):
//   a preset, an instruction kept about nothing (the workspace's), one kept about the repository a session is in.
// One kept with a preset's id (preset) is the owner's version of it: its note and fields over the preset's, in the
// preset's place; retired, it is not said. Read each time, so a change is said to the next session.

import { presetsOf, type StyleDef } from './declared.ts';
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
}

const listed = (v: unknown) => (Array.isArray(v) ? v.map(String) : []);

const FILE = 'file:';
/** A path as globs read it: forward slashes, no leading ./ */
const slashed = (path: string) => path.replace(/\\/g, '/').replace(/^(\.\/)+/, '');
/** A glob as a pattern: ** any folders, * any name within one, ? one character, the rest as written. */
const globRe = (glob: string) =>
  slashed(glob).replace(/[.+^${}()|[\]]/g, '\\$&').replace(/\*\*\/|\*\*|\*|\?/g, (m) => (m === '**/' ? '(?:.*/)?' : m === '**' ? '.*' : m === '*' ? '[^/]*' : '[^/]'));
/** Whether a glob names a path: the whole of it, or its end from a folder on, so a path from the disk's root matches a glob from the checkout's. */
export const globNames = (glob: string, path: string) => new RegExp(`(^|/)${globRe(glob)}$`, 'i').test(slashed(path));

/** Whether what is said at `where` is said by these `for`s: the same place, or a file one of its globs names. */
const saidAt = (fors: string[], where: string) => fors.includes(where) || (where.startsWith(FILE) && fors.some((f) => f.startsWith(FILE) && globNames(f.slice(FILE.length), where.slice(FILE.length))));

/** What is said where (`for`), to a session about `about`: the presets under what the map keeps, in order. Pure: what is read is handed in. */
export function said(presets: StyleDef[], kept: KeptInstruction[], where: string, about?: string): Said[] {
  const named = new Map<string, { weight: number; at: number; id: string; title: string; open: boolean; text: string; props: Record<string, unknown>; preset?: string }>();
  presets.forEach((p, at) => named.set(p.id, { weight: 0, at, id: p.id, title: p.title, open: true, text: p.body ?? '', props: p.props, preset: p.id }));
  const weighed = kept.map((one, i) => ({ one, i, weight: !one.about.length ? 1 : about !== undefined && one.about.includes(about) ? 2 : -1 }));
  for (const { one, i, weight } of weighed.filter((w) => w.weight > 0).sort((a, b) => a.weight - b.weight)) {
    const key = typeof one.props.preset === 'string' ? one.props.preset : one.id;
    const under = named.get(key);
    const props = { ...under?.props, ...Object.fromEntries(Object.entries(one.props).filter(([, v]) => v != null)) };
    named.set(key, { weight, at: under?.at ?? presets.length + i, id: one.id, title: one.title || under?.title || '', open: one.is_open, text: one.body?.trim() ? one.body : (under?.text ?? ''), props, ...(under?.preset && { preset: under.preset }) });
  }
  const order = (props: Record<string, unknown>) => (typeof props.order === 'number' ? props.order : Infinity);
  return [...named.values()]
    .filter((one) => one.open && one.text.trim() && saidAt(listed(one.props.for), where))
    .sort((a, b) => order(a.props) - order(b.props) || a.at - b.at)
    .map(({ id, title, text, preset }) => ({ id, title, text, ...(preset && { preset }) }));
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

/** What agents are told where (`for`), to a session about `about`, with the names in braces filled in. */
export async function instructionsFor(l: Archipelago, where: string, input: { about?: string; fill?: Record<string, string> } = {}): Promise<Said[]> {
  const told = said(presetsOf(l.registry.packs, 'instruction'), await keptInstructions(l), where, input.about);
  return told.map((one) => ({ ...one, text: filled(one.text, input.fill ?? {}) }));
}
