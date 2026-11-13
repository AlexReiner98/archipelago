// Parts: the app's page as packs (decision e_fxayrhma, task e_hnsknspb). A map pack declares its parts in its manifest
// (`parts`): the slot each fills, the fields of each type it reads, the actions it may send, the slots it opens for
// others, and its code, modules entered at index.js, as a layout's are. The loader checks the shapes here: a part's
// fields are on the type, and the type is its pack's, core's, or one it asks for (rule: ask for what you need); its
// actions are its own pack's; its slot is provided (packs/loader/kernel/slots.ts). Who owns a slot is packs/loader/kernel/packorder.ts's.
//
// A part's code is read from its pack's folder as the registry has it (`folderOf`): the server's for the map, and for
// an island that pins a version of the pack, the folder its code is laid out in (packs/loader/kernel/pack-code.ts), so the
// island runs the part of the version it pins. Each part goes to the page by the hash of its modules, so a module is
// fetched once and kept. The owner's version of a part is an item of core's `part` type naming it as its `preset`,
// its `code` (modules by name) standing in for the pack's file by file, as a layout's `modules` do.
//
// A part names the marks it answers with (`marks`), the contract it leans on the host for (task e_jqj87va8). The host's
// vocabulary is its page's (packs/walls/page/part-check.js), timed by commit, and the page hands it in when it asks for
// its parts: the loader checks only a list's shape, so a host that drops a mark leaves the pack active and sends the
// parts that use it to waiting, their code never sent, rather than refusing them at draw (the rule "users leave before
// the provider").

import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parts as declared, type Manifest } from './manifest.ts';
import { KERNEL_PACKS, needOf, ownsId } from './packorder.ts';
import type { ResolvedType } from './packs.ts';
import { DECISION_SLOTS, HOST_SLOTS, SLOT, slotsOpenTo } from './slots.ts';

/** A part a pack declares: what it fills, reads, sends and opens, and its code. */
export interface PartDef {
  id: string;
  title: string;
  /** The slot it fills: the host's, one its own pack opens, or one it asks for as slot:<name>. */
  slot: string;
  /** The fields it reads, by type: what the host hands it of an item of that type, and no more. */
  reads?: Record<string, string[]> | '*';
  /** The items it is handed beside the one it stands on: a filter's terms, `{here}` standing for that item's id, each item cut to what it `reads` of its type. */
  query?: PartQuery;
  /** The named reads it is handed, by name: views its pack answers (answer.<name>) or asks for, `{here}` in a param for that item's id, a param of only `{piece.<name>}` for that setting of its piece on the screen (left out, as a lone `{here}` is, when there is none). What is no item (a run's turns) comes so. */
  views?: PartView[];
  /** The actions it may send, each its pack's own. */
  sends?: string[];
  /** The slots it draws for other parts to fill, each named `<pack>.<name>`, or a piece or page the host no longer draws (piece.<name>, page.<name>). */
  opens?: string[];
  /** The marks it answers with, each a kind the host draws (box, text, ...): the host refuses any other, and a part naming one the host lacks waits. */
  marks: string[];
  /** Whether it may move the page: handed the address the page draws, it may name another after a gesture (`tools.go`). */
  go?: boolean;
  /** The page state it publishes (`tools.state`): names the runtime writes on the root for anything watching the page from outside (a picture taken once the canvas has drawn). One name, one owner. */
  state?: string[];
  /** Its modules by name, each a file in the pack's folder, entered at index.js. */
  modules: Record<string, string>;
}

/** A part's query: the terms of a filter (the flat view's), with `{here}` for the item the part stands on. */
export interface PartQuery {
  find: string[];
  only?: string[];
  not?: string[];
  limit?: number;
}

/** A named read a part is handed: a view, asked as the person looking, its params' `{here}` the item it stands on. */
export interface PartView {
  name: string;
  params?: Record<string, string | number | boolean>;
  /** Asked when the part asks (`tools.read`), not handed at mount: a read it needs as the person types. */
  live?: boolean;
}

/** A part as the page is sent it. */
export interface Part {
  id: string;
  pack: string;
  title: string;
  slot: string;
  reads: Record<string, string[]> | '*';
  query?: PartQuery;
  views?: PartView[];
  sends: string[];
  opens: string[];
  marks: string[];
  go?: true;
  state?: string[];
  hash: string;
  /** Why it is not drawn: it names a mark the host that asked does not draw. Its modules are then never sent. */
  waiting?: string;
  /** Left out when the page says it has them (`have`), and for a waiting part. */
  modules?: Record<string, string>;
}

/** An item's head and the fields every starter type keeps in the row: a part may read them of any type (packs/loader/kernel/head.ts). */
const HEAD = ['id', 'type', 'title', 'body', 'visibility', 'created_at', 'updated_at', 'status', 'owner', 'confidence', 'source'];
const MODULE = /^[a-z][a-z0-9_-]*\.js$/;
/** A mark's kind, as a part names it and a host says it draws. */
export const MARK = /^[a-z][a-z0-9_]*$/;
/** A name of page state a part publishes: written on the root as `data-<name>`, so anything watching the page reads it. */
export const STATE = /^[a-z][a-z0-9_]*$/;

/** Why a part waits on a host: the marks it names that the host (the kinds it draws) does not draw, or nothing. */
export function marksWaiting(marks: unknown, host: string[]): string | undefined {
  const lacking = (Array.isArray(marks) ? marks : []).filter((m) => !host.includes(m));
  return lacking.length ? `it answers with ${lacking.map((m) => `"${String(m).slice(0, 40)}"`).join(', ')}, which this host does not draw` : undefined;
}

/** Whether a pack may read a type's fields: its own, core's, or one it asks for by name (type:, field:, status:, phase: of it). */
function asksFor(pack: Manifest, type: string, field: string, types: Map<string, ResolvedType>): boolean {
  const of = types.get(type)?.pack;
  if (of === pack.id || (of !== undefined && KERNEL_PACKS.includes(of)) || ownsId(pack, type)) return true;
  return [...(pack.requires ?? []), ...(pack.uses ?? [])].some((n) => {
    const need = needOf(n);
    return (need.by === 'type' && need.name === type) || (need.by === 'field' && need.of === type && need.name === field) || (need.by === 'pack' && need.name === of);
  });
}

/** Problems with the parts a pack declares, given the types loaded and the pack's folder (to find its modules). Empty means they load. */
export function checkParts(pack: Manifest, types: Map<string, ResolvedType>, folder?: string): string[] {
  const given = (pack as { parts?: unknown }).parts;
  if (given === undefined) return [];
  if (!Array.isArray(given)) return ['parts is a list of parts: { id, title, slot, reads?, sends?, opens?, modules }'];
  const problems: string[] = [];
  const seen = new Set<string>(), opened = new Set<string>(), claimed = new Set<string>();
  const actions = new Set(declared(pack).actions.map((a) => a.id));
  const personal = new Set(declared(pack).actions.filter((a) => a.humanOnly || a.admin).map((a) => a.id));
  const open = slotsOpenTo(pack);
  for (const part of given as PartDef[]) {
    const at = `part "${String(part?.id)}"`;
    if (typeof part?.id !== 'string' || !ownsId(pack, part.id)) problems.push(`${at} must be named "${pack.id}.<name>"`);
    if (seen.has(part.id)) problems.push(`${at} is declared twice`);
    seen.add(part.id);
    if (typeof part.title !== 'string' || !part.title) problems.push(`${at} needs a title`);
    if (typeof part.slot !== 'string' || !SLOT.test(part.slot)) problems.push(`${at}: slot is the name of the slot it fills`);
    else if (!open.includes(part.slot)) problems.push(`${at} fills "${part.slot}", which is not open to it: a slot of the host (${HOST_SLOTS.filter((s) => !s.includes('.')).join(', ')}, piece.<name>, page.<name>), one its pack's parts open, or one it asks for as slot:${part.slot}`);
    for (const s of part.opens ?? []) {
      if (typeof s !== 'string' || !SLOT.test(s)) { problems.push(`${at}: opens names slots`); continue; }
      if (HOST_SLOTS.includes(s)) problems.push(`${at} opens "${s}", which the host draws: one name, one owner (the step that moves it takes it off the host's list)`);
      else if (!ownsId(pack, s) && !/^(?:piece|page)\.[a-z][a-z0-9_-]*$/.test(s)) problems.push(`${at} opens "${s}": a slot it opens is named "${pack.id}.<name>", or is a piece or page (piece.<name>, page.<name>)`);
      if (opened.has(s)) problems.push(`${at} opens "${s}", which another of its pack's parts opens`);
      opened.add(s);
    }
    if (part.go !== undefined && typeof part.go !== 'boolean') problems.push(`${at}: go is true or false`);
    if (part.state !== undefined && (!Array.isArray(part.state) || !part.state.length || part.state.some((s) => typeof s !== 'string' || !STATE.test(s)))) problems.push(`${at}: state is the page state it publishes, a list of names such as ["look", "look_why"]`);
    else for (const s of part.state ?? []) {
      // One name, one owner, within the pack here; across packs the page refuses the second to write it (part-host.js).
      if (claimed.has(s)) problems.push(`${at} publishes the page state "${s}", which another of its pack's parts publishes: one name, one owner`);
      claimed.add(s);
    }
    if (part.opens !== undefined && !Array.isArray(part.opens)) problems.push(`${at}: opens is a list of slots`);
    // An item whole (`*`): a root pack's part alone, which keeps the human in control as the host's page did (the sheet).
    if (part.reads === '*') {
      if ((pack.kernel as { trust?: string } | undefined)?.trust !== 'root') problems.push(`${at} reads items whole ("*"), which only a root pack's part may: name the fields it reads, by type`);
    } else if (part.reads !== undefined && (typeof part.reads !== 'object' || part.reads === null || Array.isArray(part.reads))) problems.push(`${at}: reads is the fields it reads, by type: { "<type>": ["<field>", ...] }`);
    else for (const [type, fields] of Object.entries(part.reads ?? {})) {
      const t = types.get(type);
      if (!t) { problems.push(`${at} reads unknown type "${type}"`); continue; }
      if (!Array.isArray(fields) || !fields.length) { problems.push(`${at}: reads of "${type}" is a list of its fields`); continue; }
      for (const f of fields) {
        if (typeof f !== 'string' || !(HEAD.includes(f) || t.fields[f] || f in t.columns)) problems.push(`${at} reads "${String(f)}" of "${type}", which has no such field`);
        else if (!asksFor(pack, type, f, types)) problems.push(`${at} reads "${f}" of "${type}", ${t.pack}'s: ask for it, as type:${type} or field:${f}@${type} in requires or uses`);
      }
    }
    problems.push(...queryProblems(at, part.query, part.reads));
    problems.push(...viewProblems(at, part.views, pack));
    if (part.sends !== undefined && !Array.isArray(part.sends)) problems.push(`${at}: sends is a list of its pack's actions`);
    else for (const a of part.sends ?? []) {
      if (!actions.has(a)) problems.push(`${at} sends "${String(a)}", which is not an action of ${pack.id}: a part sends its own pack's actions alone`);
      // What only a person or an admin may call is theirs to choose, never a part's to send (packs/loader/kernel/part-calls.ts).
      else if (personal.has(a)) problems.push(`${at} sends "${a}", which only a person or an admin may call: a part never sends it`);
    }
    // By shape alone: whether the host draws them is asked where the part is drawn, so a host's change never refuses the pack.
    // A part that only publishes page state, or only answers a decision (a slot that asks one: tabs.land), draws
    // nothing, so it may name no mark; every other part names at least one.
    const decides = typeof part.slot === 'string' && DECISION_SLOTS.includes(part.slot);
    const draws = !decides && !(Array.isArray(part.state) && part.state.length && Array.isArray(part.marks) && !part.marks.length);
    if (!Array.isArray(part.marks) || (draws && !part.marks.length) || part.marks.some((m) => typeof m !== 'string' || !MARK.test(m))) problems.push(`${at} names the marks it answers with: marks is a list of mark kinds, such as ["box", "text"] (packs/walls/page/part-check.js); a part that only publishes state names none`);
    else if (new Set(part.marks).size !== part.marks.length) problems.push(`${at} names a mark twice`);
    if (typeof part.modules?.['index.js'] !== 'string') problems.push(`${at} needs its modules, entered at index.js`);
    for (const [name, file] of Object.entries(part.modules ?? {})) {
      if (!MODULE.test(name) || typeof file !== 'string' || file.includes('..') || file.startsWith('/')) problems.push(`${at}: "${name}" is not a module's name (a-z, ending .js) with a file in the pack`);
      else if (folder && !existsSync(join(folder, file))) problems.push(`${at}: its module ${name} is ${file}, which the pack has no file of`);
    }
  }
  return problems;
}

/** What is wrong with a part's query: a filter of terms, asked as the person looking, of the types it reads alone. */
function queryProblems(at: string, query: unknown, reads: unknown): string[] {
  if (query === undefined) return [];
  const q = query as PartQuery;
  const terms = (v: unknown) => v === undefined || (Array.isArray(v) && v.every((s) => typeof s === 'string' && s.length > 0 && s.length <= 200));
  if (typeof q !== 'object' || q === null || Array.isArray(q) || !Array.isArray(q.find) || !q.find.length || !terms(q.find) || !terms(q.only) || !terms(q.not)) return [`${at}: query is a filter's terms, { find, only?, not?, limit? }, {here} for the item it stands on`];
  const problems: string[] = [];
  if (q.limit !== undefined && !(Number.isInteger(q.limit) && q.limit > 0 && q.limit <= 200)) problems.push(`${at}: query's limit is a whole number up to 200`);
  if (!reads || typeof reads !== 'object' || !Object.keys(reads).length) problems.push(`${at} has a query but reads no type: it is handed only the fields it reads`);
  return problems;
}

/** How many named reads one part may be handed. */
const VIEWS_MOST = 4;

/** What is wrong with a part's named reads: each a view its pack answers or asks for (rule: ask for what you need), its params words, numbers or yes and no. */
/** The kernel's reads a part may declare live with no pack answering them (packs/surface/page/part-read.js). */
export const LIVE_KERNEL_READS = ['search'];

function viewProblems(at: string, views: unknown, pack: Manifest): string[] {
  if (views === undefined) return [];
  if (!Array.isArray(views) || !views.length || views.length > VIEWS_MOST) return [`${at}: views is a list of up to ${VIEWS_MOST} named reads, { name, params? }`];
  const provides = Object.keys((pack.kernel as { provides?: Record<string, unknown> } | undefined)?.provides ?? {});
  const asked = [...(pack.requires ?? []), ...(pack.uses ?? [])];
  const problems: string[] = [];
  const names = new Set<string>();
  for (const v of views as PartView[]) {
    const name = typeof v?.name === 'string' && /^[a-z][a-z0-9_]*$/.test(v.name) ? v.name : undefined;
    if (!name) { problems.push(`${at}: a view it reads is named, { name, params? }`); continue; }
    if (names.has(name)) problems.push(`${at} reads the view "${name}" twice`);
    names.add(name);
    const service = `answer.${name}`;
    if (v.live !== undefined && typeof v.live !== 'boolean') problems.push(`${at}: the view "${name}"'s live is true or false`);
    // A kernel read declared live (search) is anyone's who may read the map: no pack answers it.
    if (v.live && LIVE_KERNEL_READS.includes(name)) continue;
    if (!provides.includes(service) && !asked.includes(`service:${service}`)) problems.push(`${at} reads the view "${name}", which ${pack.id} does not answer: ask for it, as service:${service} in requires or uses`);
    const params = v.params ?? {};
    if (typeof params !== 'object' || params === null || Array.isArray(params) || !Object.values(params).every((p) => (typeof p === 'string' && p.length <= 200) || (typeof p === 'number' && Number.isFinite(p)) || typeof p === 'boolean')) problems.push(`${at}: the view "${name}"'s params are words, numbers or true and false, {here} for the item it stands on`);
  }
  return problems;
}

/** Every part the packs declare, in the order they load. */
export const partsOf = (packs: Manifest[]) => packs.flatMap((pack) => ((pack as { parts?: PartDef[] }).parts ?? []).map((p) => ({ ...p, pack: pack.id })));

/** What a registry gives this module: its packs, and the folder each one's code is read from (a pinned version's, on an island). */
type Packs = { folderOf(pack: string): string; packs: Manifest[] };
/** The owner's versions of parts, as items of core's part type: open or not, and their fields. */
type Kept = { is_open: boolean; props: Record<string, unknown> };

const hashOf = (modules: Record<string, string>) => createHash('sha256').update(JSON.stringify(Object.entries(modules).sort(([a], [b]) => (a < b ? -1 : 1)))).digest('hex');

/** A part's modules, read from its pack's folder, under the owner's version of it: its `code` stands in file by file. */
function modulesOf(packs: Packs, d: PartDef & { pack: string }, mine?: Kept): Record<string, string> {
  const folder = packs.folderOf(d.pack);
  const own = Object.fromEntries(Object.entries(d.modules).map(([name, file]) => [name, readFileSync(join(folder, file), 'utf8')]));
  const code = mine?.props.code;
  const changed = code && typeof code === 'object' && !Array.isArray(code) ? Object.entries(code as Record<string, unknown>).filter(([name, text]) => MODULE.test(name) && typeof text === 'string') : [];
  return { ...own, ...Object.fromEntries(changed) } as Record<string, string>;
}

/**
 * The parts a page draws, each by the hash of its modules, which are sent only when the page does not have them yet
 * (`have`). Read from the registry it is given: an island's, where it pins a version, gives that version's code. A
 * part the owner retired (their version of it closed) is not drawn. Given the marks the asking host draws (`host`), a
 * part naming another waits, sent without its code.
 */
export function partsFor(packs: Packs, kept: Kept[] = [], have: string[] = [], host?: string[]): Part[] {
  const out: Part[] = [];
  for (const d of partsOf(packs.packs)) {
    const mine = kept.find((v) => v.props.preset === d.id);
    if (mine && !mine.is_open) continue;
    const modules = modulesOf(packs, d, mine), hash = hashOf(modules), waiting = host && marksWaiting(d.marks, host);
    out.push({ id: d.id, pack: d.pack, title: d.title, slot: d.slot, reads: d.reads ?? {}, ...(d.query && { query: d.query }), ...(d.views && { views: d.views }), sends: d.sends ?? [], opens: d.opens ?? [], marks: d.marks ?? [], ...(d.go && { go: true as const }), ...(d.state?.length && { state: d.state }), hash, ...(waiting ? { waiting } : !have.includes(hash) && { modules }) });
  }
  return out;
}

/** Every part's modules a page may be sent, by hash: each as its pack ships it, and as each open version of it changes it. What a route serving them by hash reads. */
export function partsBy(packs: Packs, kept: Kept[] = []): Map<string, Record<string, string>> {
  const out = new Map<string, Record<string, string>>();
  for (const d of partsOf(packs.packs)) {
    for (const mine of [undefined, ...kept.filter((v) => v.is_open && v.props.preset === d.id)]) {
      const modules = modulesOf(packs, d, mine);
      out.set(hashOf(modules), modules);
    }
  }
  return out;
}
