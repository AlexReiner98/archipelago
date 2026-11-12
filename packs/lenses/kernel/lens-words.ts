// Small pure helpers the lenses pack keeps of the query pack's (docs/kernel-packs.md: a pack imports no other, and a
// small pure helper is copied): the steps a kept view plays (packs/query/kernel/query-steps.ts: readSteps, stepsWrong,
// stepIds, stepsPhased), and a filter said in the words before its three lists, in them (src/query-flat.ts,
// fromBefore). Keep each the same as where it came from.

/** One step, as a lens keeps it (query-steps.ts, Step). */
export interface Step {
  add?: string[];
  remove?: string[];
  titles?: Record<string, string | null>;
  fields?: Record<string, Record<string, unknown>>;
  lit?: [string, string][];
  link?: [string, string][];
  unlink?: [string, string][];
  flag?: Record<string, string | null>;
  chapter?: { name: string; when?: string; count?: number };
  lines?: { by: string; text: string }[];
  look?: string | null;
  quick?: boolean;
  card?: { title: string; text?: string };
}

const MOST_STEPS = 100;
const MOST_LINE = 240;
const LOOK = /^[a-z][a-z0-9_]{0,30}$/;
const MOST_TITLE = 60;

/** The steps a lens keeps, checked: a sentence on what is wrong, else the steps. */
function readSteps(value: unknown): Step[] {
  if (!Array.isArray(value) || value.length > MOST_STEPS) throw new Error(`steps is a list of at most ${MOST_STEPS} steps`);
  const ids = (v: unknown) => Array.isArray(v) && v.every((x) => typeof x === 'string');
  const byId = (v: unknown) => v === undefined || (typeof v === 'object' && v !== null && !Array.isArray(v));
  value.forEach((s, n) => {
    const at = `step ${n + 1}`;
    if (typeof s !== 'object' || s === null) throw new Error(`${at} is not a step`);
    if ((s.add !== undefined && !ids(s.add)) || (s.remove !== undefined && !ids(s.remove))) throw new Error(`${at}: add and remove are lists of ids`);
    if (!byId(s.titles) || !byId(s.fields) || !byId(s.flag)) throw new Error(`${at}: titles, fields and flag are kept by id`);
    for (const name of ['lit', 'link', 'unlink'] as const) if (s[name] !== undefined && !(Array.isArray(s[name]) && s[name].every((w: unknown) => Array.isArray(w) && w.length === 2 && ids(w)))) throw new Error(`${at}: ${name} is a list of wires, each [from, to]`);
    if (s.chapter !== undefined && typeof s.chapter?.name !== 'string') throw new Error(`${at}: a chapter has a name`);
    if (s.look !== undefined && s.look !== null && !(typeof s.look === 'string' && LOOK.test(s.look))) throw new Error(`${at}: a look is named in a word of small letters, such as "islands"`);
    if (s.quick !== undefined && typeof s.quick !== 'boolean') throw new Error(`${at}: quick is true or false`);
    if (s.card !== undefined && !(typeof s.card?.title === 'string' && s.card.title.length <= MOST_TITLE && (s.card.text === undefined || (typeof s.card.text === 'string' && s.card.text.length <= MOST_LINE)))) throw new Error(`${at}: a card has a title of ${MOST_TITLE} characters at most, and may have a line of text`);
    for (const line of s.lines ?? []) if (typeof line?.by !== 'string' || typeof line?.text !== 'string' || line.text.length > MOST_LINE) throw new Error(`${at}: each line says by whom and what, in ${MOST_LINE} characters at most`);
  });
  return value as Step[];
}

/** What is wrong with the steps a lens keeps, in a sentence; nothing when they pass. A read says it, never throws it. */
export function stepsWrong(value: unknown): string | undefined {
  try {
    readSteps(value);
  } catch (e) {
    return (e as Error).message;
  }
}

/** Every item the steps name: sent with the picture whatever it folds away. Read from whatever is kept, passing or not. */
export function stepIds(steps: unknown): string[] {
  if (!Array.isArray(steps)) return [];
  const named = new Set<string>();
  const ids = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []);
  const keys = (v: unknown) => (typeof v === 'object' && v !== null && !Array.isArray(v) ? Object.keys(v) : []);
  for (const s of steps) if (typeof s === 'object' && s !== null) for (const id of [...ids(s.add), ...ids(s.remove), ...keys(s.titles), ...keys(s.fields), ...keys(s.flag)]) named.add(id);
  return [...named];
}

/** The steps with the phase of each status they give, by the type of the item it is given to. */
export function stepsPhased(steps: Step[], phaseOf: (id: string, status: string) => string | undefined): Step[] {
  return steps.map((s) => {
    if (!s.fields) return s;
    const fields = Object.fromEntries(Object.entries(s.fields).map(([id, f]) => {
      const phase = typeof f?.status === 'string' ? phaseOf(id, f.status) : undefined;
      return [id, phase ? { ...f, phase } : f];
    }));
    return { ...s, fields };
  });
}

/** The most items one answer of the flat lens sends (src/query-flat.ts, LENS_LIMIT). */
export const LENS_LIMIT = 2000;
/** The kind of the app's own configuration (src/head.ts, SYSTEM). */
const SYSTEM = 'system';

/** A view kept in the words before the three lists, in them: what the migration writes (src/query-flat.ts, fromBefore). */
export const fromBefore = (f: Record<string, unknown>) => {
  const list = (x: unknown) => (x === undefined || x === null ? [] : Array.isArray(x) ? x : [x]) as string[];
  const link = (t: unknown) => (typeof t === 'string' ? t : (t as { to?: string }).to !== undefined ? `${(t as { link: string }).link} ${(t as { to: string }).to}` : `${(t as { link: string }).link}< ${(t as { from: string }).from}`);
  return {
    find: [...list(f.ids).map((x) => `id ${x}`), ...list(f.links).map(link), ...list(f.in).map((x) => `in ${x}`), ...list(f.text).map(String).map((w) => w.trim()).filter(Boolean).map((w) => `text ${w}`), ...list(f.types).map((t) => `type ${t}`)],
    only: [...list(f.only), ...list(f.within).map((x) => `in ${x}`)],
    ...(f.exclude !== undefined && { not: list(f.exclude).map((x) => (x === 'closed' ? 'done' : x === SYSTEM ? `kind ${SYSTEM}` : `type ${x}`)) }),
  };
};

/** The types a pack's screen draws this piece on (a document read whole), flavours included (Registry.drawnWith). */
export function drawnWith(registry: { packs: readonly unknown[]; family(t: string): string[] }, piece: string): string[] {
  type Screen = { form?: string; on?: string[]; pieces?: { piece?: string }[] };
  const screens = registry.packs.flatMap((p) => ((p as { views?: Screen[] }).views ?? []).filter((v) => v.form === 'screen'));
  const on = screens.filter((s) => (s.pieces ?? []).some((p) => p.piece === piece)).flatMap((s) => s.on ?? []);
  return [...new Set(on.flatMap((t) => registry.family(t)))];
}
