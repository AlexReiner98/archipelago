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

import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parts as declared, type Manifest } from './manifest.ts';
import { KERNEL_PACKS, needOf, ownsId } from './packorder.ts';
import type { ResolvedType } from './packs.ts';
import { HOST_SLOTS, SLOT, slotsOpenTo } from './slots.ts';

/** A part a pack declares: what it fills, reads, sends and opens, and its code. */
export interface PartDef {
  id: string;
  title: string;
  /** The slot it fills: the host's, one its own pack opens, or one it asks for as slot:<name>. */
  slot: string;
  /** The fields it reads, by type: what the host hands it of an item of that type, and no more. */
  reads?: Record<string, string[]>;
  /** The actions it may send, each its pack's own. */
  sends?: string[];
  /** The slots it draws for other parts to fill, each named `<pack>.<name>`, or a piece or page the host no longer draws (piece.<name>, page.<name>). */
  opens?: string[];
  /** Its modules by name, each a file in the pack's folder, entered at index.js. */
  modules: Record<string, string>;
}

/** A part as the page is sent it. */
export interface Part {
  id: string;
  pack: string;
  title: string;
  slot: string;
  reads: Record<string, string[]>;
  sends: string[];
  opens: string[];
  hash: string;
  /** Left out when the page says it has them (`have`). */
  modules?: Record<string, string>;
}

/** An item's head and the fields every starter type keeps in the row: a part may read them of any type (packs/loader/kernel/head.ts). */
const HEAD = ['id', 'type', 'title', 'body', 'visibility', 'created_at', 'updated_at', 'status', 'owner', 'confidence', 'source'];
const MODULE = /^[a-z][a-z0-9_-]*\.js$/;

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
  const seen = new Set<string>(), opened = new Set<string>();
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
    if (part.opens !== undefined && !Array.isArray(part.opens)) problems.push(`${at}: opens is a list of slots`);
    if (part.reads !== undefined && (typeof part.reads !== 'object' || part.reads === null || Array.isArray(part.reads))) problems.push(`${at}: reads is the fields it reads, by type: { "<type>": ["<field>", ...] }`);
    else for (const [type, fields] of Object.entries(part.reads ?? {})) {
      const t = types.get(type);
      if (!t) { problems.push(`${at} reads unknown type "${type}"`); continue; }
      if (!Array.isArray(fields) || !fields.length) { problems.push(`${at}: reads of "${type}" is a list of its fields`); continue; }
      for (const f of fields) {
        if (typeof f !== 'string' || !(HEAD.includes(f) || t.fields[f] || f in t.columns)) problems.push(`${at} reads "${String(f)}" of "${type}", which has no such field`);
        else if (!asksFor(pack, type, f, types)) problems.push(`${at} reads "${f}" of "${type}", ${t.pack}'s: ask for it, as type:${type} or field:${f}@${type} in requires or uses`);
      }
    }
    if (part.sends !== undefined && !Array.isArray(part.sends)) problems.push(`${at}: sends is a list of its pack's actions`);
    else for (const a of part.sends ?? []) {
      if (!actions.has(a)) problems.push(`${at} sends "${String(a)}", which is not an action of ${pack.id}: a part sends its own pack's actions alone`);
      // What only a person or an admin may call is theirs to choose, never a part's to send (packs/loader/kernel/part-calls.ts).
      else if (personal.has(a)) problems.push(`${at} sends "${a}", which only a person or an admin may call: a part never sends it`);
    }
    if (typeof part.modules?.['index.js'] !== 'string') problems.push(`${at} needs its modules, entered at index.js`);
    for (const [name, file] of Object.entries(part.modules ?? {})) {
      if (!MODULE.test(name) || typeof file !== 'string' || file.includes('..') || file.startsWith('/')) problems.push(`${at}: "${name}" is not a module's name (a-z, ending .js) with a file in the pack`);
      else if (folder && !existsSync(join(folder, file))) problems.push(`${at}: its module ${name} is ${file}, which the pack has no file of`);
    }
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
 * part the owner retired (their version of it closed) is not drawn.
 */
export function partsFor(packs: Packs, kept: Kept[] = [], have: string[] = []): Part[] {
  const out: Part[] = [];
  for (const d of partsOf(packs.packs)) {
    const mine = kept.find((v) => v.props.preset === d.id);
    if (mine && !mine.is_open) continue;
    const modules = modulesOf(packs, d, mine), hash = hashOf(modules);
    out.push({ id: d.id, pack: d.pack, title: d.title, slot: d.slot, reads: d.reads ?? {}, sends: d.sends ?? [], opens: d.opens ?? [], hash, ...(!have.includes(hash) && { modules }) });
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
