/**
 * How a map read from the old Archipelago server (its `query` reads: flat
 * with every field, and each item's `get`) lands here. Pure: a dump in,
 * change sets out, with an account of what was left behind and why.
 *
 * - The living map: every item onto the four bases plus `kind`, statuses
 *   mapped, only the fields its type declares. Lanes and integrations are
 *   the trial flavour `branch`. A field nothing here declares goes into the
 *   note, under "From the old map"; UI state and private fields are left.
 *   Instructions and reflexes become nodes for the words plugin. Links are
 *   mapped onto the five; an island is an item and what is on it part_of it.
 *   Facts are grouped by on whose authority each item's status was last set.
 * - An archive: the same landing, but every item, link and field is kept.
 */
import type { Fact, Header } from "../spec/changeset.ts";
import type { Authority, Json } from "../spec/common.ts";
import { COMMON, type BaseDef, type FieldDef, type FlavourDef } from "../spec/types.ts";
import { WORK } from "../plugins/work/index.ts";
import { QUESTION } from "../plugins/question/index.ts";
import { RECORD } from "../plugins/record/index.ts";
import { ACTOR } from "../plugins/actor/index.ts";
import { BRANCH } from "../plugins/branch/index.ts";

/** An item as the old server's flat read gives it, with fields true and notes whole. */
export interface OldItem {
  id: string;
  type: string;
  /** What the type is made from, nearest first (flat's `is`). */
  is?: string[];
  title: string;
  status: string;
  phase?: string;
  visibility?: string;
  island?: string;
  owner?: string;
  body?: string;
  updated_at?: string;
  fields: Record<string, Json>;
}
export interface OldLink {
  id: string;
  type: string;
  from: string;
  to: string;
  props?: Record<string, Json>;
}
/** What an item's own get adds. */
export interface OldGet {
  source_id?: string | null;
  created_at?: string;
  confidence?: number;
  owner?: string | null;
  visibility?: string;
  archived_at?: string | null;
}
export interface Dump {
  /** Where it was read from, and when. */
  origin?: string;
  read_at?: string;
  items: OldItem[];
  links: OldLink[];
  /** Items whose status was last set on the owner's say (flat's `by owner`). */
  by_owner?: string[];
  gets?: Record<string, OldGet>;
}

interface Land {
  type: string;
  kind?: string;
  status?: Record<string, string>;
}

const DRAFT = { draft: "current" };
const SIGHT = { grouped: "current", strung: "current", deferred: "superseded", dropped: "superseded" };
const OCCURS = { upcoming: "current", happened: "current", cancelled: "superseded" };

/** Each old type, where it lands. Types not here are the old system's own (runs, lenses, styles) and don't move. */
export const LANDS: Record<string, Land> = {
  task: { type: "work", status: { waiting: "doing" } },
  work: { type: "work", status: { waiting: "doing" } },
  question: { type: "question", status: { settled: "decided", reversed: "decided" } },
  decision: { type: "question", kind: "decision", status: { settled: "decided", reversed: "decided" } },
  record: { type: "record" },
  finding: { type: "record", kind: "finding" },
  shared_document: { type: "record", kind: "document" },
  aim: { type: "work", kind: "aim", status: { active: "doing", achieved: "done", retired: "dropped" } },
  person: { type: "actor", kind: "person" },
  agent: { type: "actor", kind: "agent", status: { retired: "inactive" } },
  place: { type: "record", kind: "place", status: { available: "current", unavailable: "current", retired: "superseded" } },
  island: { type: "record", kind: "island" },
  source: { type: "record", kind: "source", status: { recorded: "current" } },
  occurrence: { type: "record", kind: "occurrence", status: OCCURS },
  event: { type: "record", kind: "event", status: OCCURS },
  meeting: { type: "record", kind: "meeting", status: OCCURS },
  routine: { type: "record", kind: "routine", status: OCCURS },
  "build.feature": { type: "work", kind: "feature", status: { planned: "todo", building: "doing", built: "done" } },
  "build.lane": { type: "branch", kind: "lane", status: { planned: "todo", working: "doing", handed: "doing", merged: "done" } },
  "build.integration": { type: "branch", kind: "integration", status: { waiting: "doing", checked: "doing", in_review: "doing", merged: "done" } },
  "build.overlap": { type: "question", kind: "overlap", status: { agreed: "decided" } },
  "ui.study": { type: "work", kind: "study", status: { planned: "todo", building: "doing", built: "done" } },
  "ui.screen": { type: "work", kind: "screen" },
  "ui.sighting": { type: "record", kind: "sighting", status: SIGHT },
  "ui.theme": { type: "record", kind: "theme", status: SIGHT },
  "ui.verdict": { type: "question", kind: "verdict", status: { kept: "decided", changed: "decided", superseded: "dropped" } },
  "site.site": { type: "record", kind: "site", status: DRAFT },
  "site.page": { type: "record", kind: "page", status: DRAFT },
  "site.figure": { type: "record", kind: "figure", status: DRAFT },
  "site.particle_setup": { type: "record", kind: "particle_setup", status: DRAFT },
};

/** What the old map says to agents: nodes for the words plugin. */
export const SAID = new Set(["instruction", "reflex"]);

/** Each old link, as one of the five. Absent: it doesn't move (see LEFT_LINKS). */
export const LINKS: Record<string, string> = {
  part_of: "part_of",
  depends_on: "depends_on",
  waits_on: "waits_on",
  bears_on: "bears_on",
  about: "about",
  serves: "part_of",
  works_at: "part_of",
  "build.in_lane": "part_of",
  "ui.of_study": "part_of",
  "ui.in_theme": "part_of",
  "ui.from_theme": "depends_on",
  "ui.judges": "about",
  answers: "about",
  produced: "about",
  uses: "about",
  reads: "about",
  link: "about",
};
export const LEFT_LINKS: Record<string, string> = {
  owned_by: "who is responsible is not among the five links; on a map of one person it says nothing more",
  involves: "who is involved is not among the five links",
  needs: "a resource held is runtime state, not a link here yet",
  holds: "a resource held is runtime state, not a link here yet",
  lives_in: "a resource held is runtime state, not a link here yet",
  works_on: "a run's work is the exchange's, not the graph's",
  started_from: "a run's start is the exchange's, not the graph's",
  draws: "lenses don't move",
};

/** Fields left behind on every item: the old UI's state, and what is private or runtime. */
export const DROP: Record<string, string> = {
  cell: "UI state",
  focus: "UI state",
  corner: "UI state",
  plugins_off: "UI state",
  parts_off: "UI state",
  email: "private",
  islands: "UI state",
  value_type: "the value says its own type",
  holders: "runtime state",
  sessions: "runtime state",
};

const BASES: Record<string, BaseDef> = { work: WORK, question: QUESTION, record: RECORD, actor: ACTOR };
const FLAVOURS: Record<string, FlavourDef> = { branch: BRANCH };

function typeInfo(type: string): { base: BaseDef; fields: Record<string, FieldDef> } {
  const flavour = FLAVOURS[type];
  const base = BASES[flavour ? flavour.base : type]!;
  return { base, fields: { ...COMMON, ...base.fields, ...(flavour?.fields ?? {}) } };
}

/** A field's value, if it fits the field's kind. */
function fits(def: FieldDef, v: Json): boolean {
  switch (def.kind) {
    case "text":
      return typeof v === "string";
    case "number":
      return typeof v === "number" && Number.isFinite(v);
    case "boolean":
      return typeof v === "boolean";
    case "date":
      return typeof v === "string" && !Number.isNaN(Date.parse(v));
    case "choice":
      return typeof v === "string" && (!def.values || def.values.includes(v));
    case "id":
      return typeof v === "string" && !!v;
    default:
      return true;
  }
}

/** An old place as one here. `written:` places are files the old map writes: not said until a file is written from them. */
export function placeOf(old: string): string | null {
  if (old.startsWith("tool:")) return `tool:mcp__pelago__${old.slice(5)}`;
  if (old.startsWith("written:")) return null;
  return old;
}

const line = (k: string, v: Json) => `- ${k}: ${typeof v === "string" ? v.replace(/\n/g, " ") : JSON.stringify(v)}`;

export interface Group {
  authority: Authority;
  reason: string;
  facts: Fact[];
}

export interface Landed {
  /** Change sets, in the order they must go in: items, then links. */
  groups: Group[];
  /** Counts by where things went. */
  counts: {
    items: Record<string, number>;
    links: Record<string, number>;
    nodes: number;
    sources: number;
    islands: number;
    left_items: Record<string, number>;
    left_links: Record<string, number>;
    fields_to_note: Record<string, number>;
    fields_dropped: Record<string, number>;
    statuses: Record<string, number>;
  };
  /** Each moved item's id, with its old type: for checks. */
  moved: Map<string, string>;
}

const HUMAN: Authority = { of: "human", basis: "On the old Focus map this item's status was last set on the owner's say (its flat read's `by owner`); moved by the interchange format" };
const AGENT: Authority = { of: "agent", basis: "On the old Focus map this item was last set by agents; moved by the interchange format" };
const LINKED: Authority = { of: "agent", basis: "The old Focus map's links among the items moved, mapped onto the five; moved by the interchange format" };

/** A type with no landing, on an old map: by the base it was made from (flat's `is`), if one of ours. */
const STARTERS: Record<string, string> = { work: "work", question: "question", record: "record", actor: "actor", occurrence: "record", place: "record" };
function byIs(i: OldItem): Land | undefined {
  const base = (i.is ?? []).map((t) => STARTERS[t]).find(Boolean);
  return base ? { type: base, kind: i.type } : undefined;
}

/** Where an item lands in an archive: undefined keeps its old type. */
export const archiveLand = (i: OldItem): Land | undefined => (SAID.has(i.type) ? { type: "node", kind: i.type } : (LANDS[i.type] ?? byIs(i)));

/** A dump with every item's fields there, if empty: a read may leave them out. */
const norm = (dump: Dump): Dump => ({ ...dump, items: dump.items.map((i) => ({ ...i, fields: i.fields ?? {} })) });

/** The living map: Focus onto the bases. */
export function landFocus(dump: Dump, batch = 250): Landed {
  dump = norm(dump);
  const byOwner = new Set(dump.by_owner ?? []);
  const gets = dump.gets ?? {};
  const old = new Map(dump.items.map((i) => [i.id, i]));
  const counts: Landed["counts"] = { items: {}, links: {}, nodes: 0, sources: 0, islands: 0, left_items: {}, left_links: {}, fields_to_note: {}, fields_dropped: {}, statuses: {} };
  const inc = (o: Record<string, number>, k: string) => void (o[k] = (o[k] ?? 0) + 1);

  // Which sources are cited: only those move.
  const cited = new Map<string, string[]>();
  for (const [id, g] of Object.entries(gets)) if (g.source_id && old.has(id)) (cited.get(g.source_id) ?? cited.set(g.source_id, []).get(g.source_id)!).push(id);
  // What is an island: islands themselves, and whatever an item names as its island.
  const islandOf = (i: OldItem) => (typeof i.island === "string" ? i.island : typeof i.fields.island === "string" ? (i.fields.island as string) : undefined);

  const moved = new Map<string, string>();
  const human: Fact[][] = [];
  const agent: Fact[][] = [];
  const extraLinks: { type: string; from: string; to: string; fields?: Record<string, Json> }[] = [];

  for (const i of dump.items) {
    const facts: Fact[] = [];
    const add = (field: string, value: Json) => facts.push(["+", i.id, field, value]);
    if (SAID.has(i.type)) {
      const fors = Array.isArray(i.fields.for) ? (i.fields.for as string[]) : [];
      add("type", "node");
      add("title", i.title);
      add("kind", i.type);
      add("at", fors.map(placeOf).filter((p): p is string => !!p));
      add("words", i.body ?? "");
      if (i.status === "trial") add("status", "trial");
      else if (i.status === "retired") add("status", "retired");
      if (fors.length) add("for", fors);
      for (const k of ["order", "misses"]) if (i.fields[k] !== undefined) add(k, i.fields[k]!);
      counts.nodes++;
      moved.set(i.id, i.type);
      (byOwner.has(i.id) ? human : agent).push(facts);
      continue;
    }
    const land = LANDS[i.type];
    if (!land || (i.type === "source" && !cited.has(i.id))) {
      inc(counts.left_items, i.type === "source" ? "source (cited by no item moved)" : i.type);
      continue;
    }
    const { base, fields } = typeInfo(land.type);
    const all = [...base.statuses.open, ...base.statuses.closed];
    let status = land.status?.[i.status] ?? i.status;
    if (!all.includes(status)) status = i.phase === "finished" ? base.statuses.closed[0]! : base.statuses.open[0]!;
    inc(counts.statuses, `${i.type}: ${i.status} → ${status}`);

    add("type", land.type);
    add("title", i.title);
    add("status", status);
    if (land.kind) add("kind", land.kind);
    const extra: string[] = [];
    const g = gets[i.id] ?? {};
    const given: Record<string, Json> = { ...i.fields };
    if (g.confidence !== undefined && g.confidence !== 1) given.confidence = g.confidence;
    const owner = g.owner ?? i.owner;
    if (owner) given.owner = owner;
    if (i.visibility && i.visibility !== "shared") given.visibility = i.visibility;
    if (land.type === "record" && i.visibility === "public") given.published = given.published ?? true;
    if (i.type === "source") given.uri = i.fields.uri ?? null;
    for (const [k, v] of Object.entries(given)) {
      if (k === "island" || v === null || v === undefined) continue;
      if (k in DROP) {
        inc(counts.fields_dropped, `${k} (${DROP[k]})`);
        continue;
      }
      const def = fields[k];
      if (def && k !== "status" && k !== "title" && k !== "note" && k !== "kind" && fits(def, v)) add(k, v);
      else {
        extra.push(line(k, v));
        inc(counts.fields_to_note, `${i.type}.${k}`);
      }
    }
    if (status !== i.status) extra.push(line("status on the old map", i.status));
    let note = i.body ?? "";
    if (extra.length) note = `${note}${note ? "\n\n" : ""}## From the old map\n${extra.join("\n")}`;
    if (i.type === "build.feature" && i.status === "built" && i.fields.seen_working === undefined) add("seen_working", false);
    if (note) add("note", note);
    // Waiting is a link here: on whoever it waits on, the owner when the old map didn't say.
    if (i.status === "waiting" && !dump.links.some((l) => l.type === "waits_on" && l.from === i.id)) {
      const person = dump.items.find((p) => p.type === "person");
      if (person) extraLinks.push({ type: "waits_on", from: i.id, to: person.id, fields: { for: "What it was waiting for on the old map: its note says" } });
    }
    if (i.type === "island") counts.islands++;
    if (i.type === "source") {
      counts.sources++;
      for (const about of cited.get(i.id) ?? []) extraLinks.push({ type: "about", from: i.id, to: about });
    }
    inc(counts.items, `${land.type}${land.kind ? ` (${land.kind})` : ""}`);
    moved.set(i.id, i.type);
    (byOwner.has(i.id) ? human : agent).push(facts);
  }

  // Links: mapped onto the five, both ends moved, each base where the link allows it, no twice.
  const baseOf = (id: string) => {
    const t = moved.get(id);
    if (!t || SAID.has(t)) return undefined;
    const land = LANDS[t]!;
    return FLAVOURS[land.type]?.base ?? land.type;
  };
  const seen = new Set<string>();
  const links: Fact[][] = [];
  const parentOf = new Map<string, Set<string>>();
  const put = (id: string, type: string, from: string, to: string, fields?: Record<string, Json>) => {
    const key = `${type} ${from} ${to}`;
    if (seen.has(key) || from === to) return false;
    seen.add(key);
    const f: Fact[] = [["+", id, "type", type], ["+", id, "from", from], ["+", id, "to", to]];
    for (const [k, v] of Object.entries(fields ?? {})) f.push(["+", id, k, v]);
    links.push(f);
    inc(counts.links, type);
    if (type === "part_of") (parentOf.get(from) ?? parentOf.set(from, new Set()).get(from)!).add(to);
    return true;
  };
  for (const l of dump.links) {
    let type = LINKS[l.type];
    if (!type) {
      inc(counts.left_links, `${l.type} (${LEFT_LINKS[l.type] ?? "not one of the five"})`);
      continue;
    }
    if (!baseOf(l.from) || !baseOf(l.to)) {
      inc(counts.left_links, `${l.type} (an end that doesn't move)`);
      continue;
    }
    if (type === "waits_on" && baseOf(l.to) !== "actor") type = "depends_on";
    if (type === "bears_on" && baseOf(l.to) !== "question") type = "about";
    const fields = type === "waits_on" && typeof l.props?.for === "string" ? { for: l.props.for } : undefined;
    put(l.id, type, l.from, l.to, fields);
  }
  let n = 0;
  const newId = () => `r_moved${(n++).toString(36).padStart(4, "0")}`;
  for (const l of extraLinks) if (baseOf(l.from) && baseOf(l.to)) put(newId(), l.type, l.from, l.to, l.fields);
  // An item on an island is part of it, unless something it is already part of is on that island too.
  for (const i of dump.items) {
    const at = islandOf(i);
    if (!at || at === i.id || !baseOf(i.id) || !baseOf(at)) continue;
    const parents = parentOf.get(i.id) ?? new Set();
    if (parents.has(at) || [...parents].some((p) => old.get(p) && islandOf(old.get(p)!) === at)) continue;
    put(newId(), "part_of", i.id, at);
  }

  const groups: Group[] = [];
  const chunk = (sets: Fact[][], authority: Authority, reason: string) => {
    for (let k = 0; k < sets.length; k += batch) groups.push({ authority, reason: `${reason} (${k + 1}–${Math.min(k + batch, sets.length)} of ${sets.length})`, facts: sets.slice(k, k + batch).flat() });
  };
  chunk(human, HUMAN, "Focus moves across: items set on the owner's say");
  chunk(agent, AGENT, "Focus moves across: items set by agents");
  chunk(links, LINKED, "Focus moves across: its links");
  return { groups, counts, moved };
}

/** An archive: every item and link, landed on the bases where a type has a landing, every field kept. */
export function landArchive(dump: Dump): { facts: Fact[]; counts: { items: Record<string, number>; links: Record<string, number> } } {
  dump = norm(dump);
  const facts: Fact[] = [];
  const counts = { items: {} as Record<string, number>, links: {} as Record<string, number> };
  const inc = (o: Record<string, number>, k: string) => void (o[k] = (o[k] ?? 0) + 1);
  const ids = new Set(dump.items.map((i) => i.id));
  for (const i of dump.items) {
    const add = (field: string, value: Json) => facts.push(["+", i.id, field, value]);
    const land = archiveLand(i);
    const type = land?.type ?? i.type;
    let status = land && "status" in land ? (land.status?.[i.status] ?? i.status) : i.status;
    if (BASES[FLAVOURS[type]?.base ?? type]) {
      const base = BASES[FLAVOURS[type]?.base ?? type]!;
      if (![...base.statuses.open, ...base.statuses.closed].includes(status)) status = i.phase === "finished" ? base.statuses.closed[0]! : base.statuses.open[0]!;
    }
    add("type", type);
    add("title", i.title);
    add("status", status);
    if (status !== i.status) add("was_status", i.status);
    if (type !== i.type) add("kind", land?.kind ?? i.type);
    if (type !== i.type && land?.kind && land.kind !== i.type) add("was_type", i.type);
    if (i.body) add(SAID.has(i.type) ? "words" : "note", i.body);
    if (i.visibility) add("visibility", i.visibility);
    if (i.updated_at) add("updated_at", i.updated_at);
    if (i.owner) add("owner", i.owner);
    for (const [k, v] of Object.entries(i.fields)) {
      if (v === null || v === undefined || ["type", "title", "status", "note", "words", "kind", "from", "to"].includes(k)) continue;
      add(k, v);
    }
    if (SAID.has(i.type) && Array.isArray(i.fields.for)) add("at", (i.fields.for as string[]).map(placeOf).filter((p): p is string => !!p));
    inc(counts.items, type);
  }
  for (const l of dump.links) {
    if (!ids.has(l.from) || !ids.has(l.to)) continue;
    const type = LINKS[l.type] ?? l.type;
    facts.push(["+", l.id, "type", type], ["+", l.id, "from", l.from], ["+", l.id, "to", l.to]);
    if (type !== l.type) facts.push(["+", l.id, "was_type", l.type]);
    for (const [k, v] of Object.entries(l.props ?? {})) if (!["type", "from", "to"].includes(k)) facts.push(["+", l.id, k, v]);
    inc(counts.links, type);
  }
  return { facts, counts };
}

/** A change set header for a script's own writes to an archive. */
export const archiveHeader = (origin: string): Header => ({
  actor: { id: "agent:interchange", kind: "agent" },
  authority: { of: "agent", basis: `Read from ${origin} through its own query reads` },
  plugin: { id: "archive" },
  action: "archive.make",
  reason: "An old map kept read only",
  time: new Date().toISOString(),
});
