// A lens's steps: how the picture came to be, step by step, ending on the map as it is (the lens type's `steps`).
// Each step changes the one before it, from nothing: what it adds and takes away, the titles and fields things had
// then (a status among them), the words flagged on them, the chapter it starts, what was said, the look it is drawn
// in from then on, whether it goes by quickly, and the words a story ends on (a card). The last step is the map as it is, whatever
// the steps before it say. The kernel reads nothing in them but the items they name, which are sent with the picture
// even when finished (a part that is gone is told of); how they are played is the drawing's.

/** One step, as a lens keeps it. */
export interface Step {
  add?: string[];
  remove?: string[];
  /** Titles things had then, by id; null takes one back to its own. */
  titles?: Record<string, string | null>;
  /** Fields things had then, by id and name; null takes one back to its own. */
  fields?: Record<string, Record<string, unknown>>;
  /** The wires lit in this step, each as [from, to]: what passes along them then. */
  lit?: [string, string][];
  /** A word marked on a thing then (a flag), by id; null takes it off. */
  flag?: Record<string, string | null>;
  /** The chapter this step starts: its name, when, and how far it got (a count, such as commits). */
  chapter?: { name: string; when?: string; count?: number };
  /** What was said: each line by whom (a name) and what. */
  lines?: { by: string; text: string }[];
  /** The look it is drawn in from this step on, by name (the drawing's, such as "islands"); null takes it back to its own. */
  look?: string | null;
  /** Played at a fast-forward pace, not waiting for its lines. */
  quick?: boolean;
  /** Words the picture ends on after this step, a name and a line: "Archipelago", and what it is for. */
  card?: { title: string; text?: string };
}

const MOST_STEPS = 100;
const MOST_LINE = 240;
const LOOK = /^[a-z][a-z0-9_]{0,30}$/;
const MOST_TITLE = 60;

/** The steps a lens keeps, checked: a sentence on what is wrong, else the steps. */
export function readSteps(value: unknown): Step[] {
  if (!Array.isArray(value) || value.length > MOST_STEPS) throw new Error(`steps is a list of at most ${MOST_STEPS} steps`);
  const ids = (v: unknown) => Array.isArray(v) && v.every((x) => typeof x === 'string');
  const byId = (v: unknown) => v === undefined || (typeof v === 'object' && v !== null && !Array.isArray(v));
  value.forEach((s, n) => {
    const at = `step ${n + 1}`;
    if (typeof s !== 'object' || s === null) throw new Error(`${at} is not a step`);
    if ((s.add !== undefined && !ids(s.add)) || (s.remove !== undefined && !ids(s.remove))) throw new Error(`${at}: add and remove are lists of ids`);
    if (!byId(s.titles) || !byId(s.fields) || !byId(s.flag)) throw new Error(`${at}: titles, fields and flag are kept by id`);
    if (s.lit !== undefined && !(Array.isArray(s.lit) && s.lit.every((w: unknown) => Array.isArray(w) && w.length === 2 && ids(w)))) throw new Error(`${at}: lit is a list of wires, each [from, to]`);
    if (s.chapter !== undefined && typeof s.chapter?.name !== 'string') throw new Error(`${at}: a chapter has a name`);
    if (s.look !== undefined && s.look !== null && !(typeof s.look === 'string' && LOOK.test(s.look))) throw new Error(`${at}: a look is named in a word of small letters, such as "islands"`);
    if (s.quick !== undefined && typeof s.quick !== 'boolean') throw new Error(`${at}: quick is true or false`);
    if (s.card !== undefined && !(typeof s.card?.title === 'string' && s.card.title.length <= MOST_TITLE && (s.card.text === undefined || (typeof s.card.text === 'string' && s.card.text.length <= MOST_LINE)))) throw new Error(`${at}: a card has a title of ${MOST_TITLE} characters at most, and may have a line of text`);
    for (const line of s.lines ?? []) if (typeof line?.by !== 'string' || typeof line?.text !== 'string' || line.text.length > MOST_LINE) throw new Error(`${at}: each line says by whom and what, in ${MOST_LINE} characters at most`);
  });
  return value as Step[];
}

/** Every item the steps name: sent with the picture whatever it folds away. */
export function stepIds(steps: unknown): string[] {
  if (!Array.isArray(steps)) return [];
  const named = new Set<string>();
  for (const s of readSteps(steps)) for (const id of [...(s.add ?? []), ...(s.remove ?? []), ...Object.keys(s.titles ?? {}), ...Object.keys(s.fields ?? {}), ...Object.keys(s.flag ?? {})]) named.add(id);
  return [...named];
}

/** The steps as a reader of a published picture may have them: naming only what the picture shows them. */
export function stepsShown(steps: Step[], shown: Set<string>): Step[] {
  const only = <T>(byId: Record<string, T> | undefined) => byId && Object.fromEntries(Object.entries(byId).filter(([id]) => shown.has(id)));
  // Only what a step is known to say: anything else kept in it is not the reader's.
  return steps.map((s) => ({
    ...(s.chapter && { chapter: { name: s.chapter.name, ...(s.chapter.when !== undefined && { when: s.chapter.when }), ...(s.chapter.count !== undefined && { count: s.chapter.count }) } }),
    ...(s.lines && { lines: s.lines.map((l) => ({ by: l.by, text: l.text })) }),
    ...(s.look !== undefined && { look: s.look }),
    ...(s.quick && { quick: true }),
    ...(s.card && { card: { title: s.card.title, ...(s.card.text !== undefined && { text: s.card.text }) } }),
    ...(s.add && { add: s.add.filter((id) => shown.has(id)) }),
    ...(s.remove && { remove: s.remove.filter((id) => shown.has(id)) }),
    ...(s.titles && { titles: only(s.titles) }),
    ...(s.fields && { fields: only(s.fields) }),
    ...(s.flag && { flag: only(s.flag) }),
    ...(s.lit && { lit: s.lit.filter(([a, b]) => shown.has(a) && shown.has(b)) }),
  }));
}
