// What agents are told: the instructions the packs ship as presets, under those the map keeps, as styles are for
// looks (packs/styles/kernel/styles.ts). Where each is said is its field `for`: session_start, working_rules, tool:<name>, or
// file:<glob>, said to a session about to read or change a file the glob names (what bites there).
//
// Layers, the nearest last, each over one of the same name (its preset, or else its own id):
//   a preset, an instruction kept about nothing (the workspace's), one kept about the repository a session is in.
// One kept with a preset's id (preset) is the owner's version of it: its note and fields over the preset's, in the
// preset's place; retired, it is not said. A pack's preset that replaces another (its prop `replaces`, a preset's id) is
// said in that one's place when its pack is on, so core can word a rule in its own types and a pack in its richer ones.
// Read each time, so a change is said to the next session.
//
// A kept one in trial (a reflex being tried, the reflex pack's) is said only where its for names the place exactly,
// never by a glob or under file: alone, and marked as a trial. One that names a map action (action, with its input)
// asks the agent to take it with its own tools: the instruction never acts. Each one said to a run is kept as said
// there (the read said_here, the reflex_said pack's), so its record can say whether it stopped its miss.

import type { KernelContext } from '#pelago/kernel';

/** A preset a pack ships, as the registry gives it (packs/loader/kernel/declared.ts, StyleDef): an instruction's words and fields. */
export interface StyleDef {
  id: string;
  type?: string;
  title: string;
  body?: string;
  on?: string[];
  over?: 'workspace' | 'chosen';
  props: Record<string, unknown>;
}

/** An instruction the map keeps, with what it is about. */
export interface KeptInstruction {
  id: string;
  title: string;
  body: string | null;
  is_open: boolean;
  /** Its status: trial for a reflex being tried. */
  status?: string | null;
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
  /** Said as a trial: a reflex being tried. */
  trial?: true;
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
/** Where a trial is said: only where one of its fors names the place exactly. */
const trialAt = (fors: string[], where: string) => fors.includes(where);
/** What a kept instruction's action asks the agent to do, as the line said after its words. */
const actionLine = (props: Record<string, unknown>) =>
  typeof props.action === 'string' && props.action.trim() ? `
Take it with your own tools: ${props.action.trim()}${props.input !== undefined && props.input !== null ? ` ${JSON.stringify(props.input)}` : ''}.` : '';
/** The mark a trial is said with. */
export const TRIAL = 'Trial: ';
/** A trial's title, marked once, though its writer marked it already. */
const trialTitle = (title: string) => (title.toLowerCase().startsWith(TRIAL.toLowerCase()) ? title : `${TRIAL}${title}`);

/**
 * Every tool's place at once, asked as a session begins (TOOLS): what is said in the tools' descriptions reaches a
 * session when its client connects, before it has a run, so it is kept as said to the run once, at its start, each
 * tool's place apart. An approximation: a session given the tools is counted as told what their descriptions say.
 */
export const TOOLS = 'tool:*';
/** The tool places what is kept and shipped is said at. */
const toolPlaces = (presets: StyleDef[], kept: KeptInstruction[]) =>
  [...new Set([...presets.map((p) => p.props), ...kept.filter((k) => k.is_open).map((k) => k.props)].flatMap((props) => listed(props.for)).filter((f) => f.startsWith('tool:') && f !== TOOLS))].sort();
const globsOf = (fors: string[]) => fors.filter((f) => f.startsWith(FILE)).map((f) => f.slice(FILE.length));

/** What is said where (`for`), to a session about `about`: the presets under what the map keeps, in order. Pure: what is read is handed in. */
export function said(presets: StyleDef[], kept: KeptInstruction[], where: string, about?: string): Said[] {
  const named = new Map<string, { weight: number; at: number; id: string; title: string; open: boolean; text: string; props: Record<string, unknown>; preset?: string; trial?: boolean }>();
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
    named.set(key, { weight, at: under?.at ?? presets.length + i, id: one.id, title: one.title || under?.title || '', open: one.is_open, text: one.body?.trim() ? one.body : (under?.text ?? ''), props, ...(under?.preset && { preset: under.preset }), ...(one.status === 'trial' && { trial: true }) });
  }
  const order = (props: Record<string, unknown>) => (typeof props.order === 'number' ? props.order : Infinity);
  return [...named.values()]
    .filter((one) => one.open && one.text.trim() && (one.trial ? trialAt : saidAt)(listed(one.props.for), where))
    .sort((a, b) => order(a.props) - order(b.props) || a.at - b.at)
    .map(({ id, title, text, preset, props, trial }) => ({
      id,
      title: trial ? trialTitle(title) : title,
      text: `${text}${actionLine(props)}`,
      ...(preset && { preset }),
      ...(trial && { trial: true }),
      ...(where.startsWith(FILE) && { files: globsOf(listed(props.for)) }),
    }));
}

/** A name in braces filled in from `fill`; one it does not have is left as it is. */
export const filled = (text: string, fill: Record<string, string>) => text.replace(/\{([a-z_]+)\}/g, (all, name: string) => fill[name] ?? all);

/** What agents are told where (`for`), to a session about `about`, with the names in braces filled in; on an island, the presets of the version of its pack it runs (packs/loader/kernel/island-pin.ts). */
export async function instructionsFor(ctx: KernelContext, where: string, input: { about?: string; island?: string; fill?: Record<string, string>; run?: string; count?: boolean } = {}): Promise<Said[]> {
  return (await instructionsAt(ctx, [where], input))[where];
}

/**
 * What agents are told at each of several places at once, read once: the words a hook or the server composes an
 * answer from, each place one part of it. Each one said is counted and kept as said to the run, as instructionsFor
 * does, unless `count` is false (a description the client is handed on every request, counted where it is listed).
 */
export async function instructionsAt(ctx: KernelContext, wheres: string[], input: { about?: string; island?: string; fill?: Record<string, string>; run?: string; count?: boolean } = {}): Promise<Record<string, Said[]>> {
  // The presets (of the island's version of each pack, on an island) and every instruction kept, open or retired, with what each is about.
  const { presets, kept } = (await ctx.reads({ told_from: { ...(input.island !== undefined && { island: input.island }) } })) as { presets: StyleDef[]; kept: KeptInstruction[] };
  // Each place it is asked at, a session's tools at every tool's place (TOOLS), each said and kept apart.
  const placesOf = (where: string) => (where === TOOLS ? toolPlaces(presets, kept) : [where]);
  const each = wheres.map((where) => [where, placesOf(where).map((place) => [place, said(presets, kept, place, input.about)] as const)] as const);
  const all = each.flatMap(([, places]) => places.flatMap(([, told]) => told));
  if (input.count !== false && all.length) {
    // Each one said is counted as a use of it (packs/usage/kernel/uses.ts).
    await ctx.reads({ told: all.map((one) => one.preset ?? one.id) });
    // Said to a run, each is kept as said there, by the pack that keeps the record; where none does, it is not.
    const run = input.run ?? input.fill?.run;
    if (run)
      for (const [, places] of each)
        for (const [place, told] of places)
          if (told.length) await ctx.reads({ said_here: { ids: told.map((one) => one.preset ?? one.id), run, where: place } }).catch((err: Error) => ctx.said?.(`keeping what was said to ${run} failed: ${err.message}`));
  }
  return Object.fromEntries(each.map(([where, places]) => [where, places.flatMap(([, told]) => told).map((one) => ({ ...one, text: filled(one.text, input.fill ?? {}) }))]));
}
