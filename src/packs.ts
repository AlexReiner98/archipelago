// Packs: versioned bundles of types and relation types, stored as files. A type may extend another (a "flavour"); it
// inherits the parent's fields and statuses, and anything that queries the parent also sees its flavours.

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { capacityOf, checkCapabilities, type Capabilities } from './capabilities.ts';
import { checkDeclared, KERNEL_VERBS, screensOf, stylesOf, toolName, type ActionDef, type TreeDef, type VerbDef, type ViewDef } from './declared.ts';
import { altitudeOf, type Altitude } from './altitude.ts';
import { checkValue } from './fields.ts';
import { checkFieldDecls, headOf, SYSTEM, type ColumnField } from './head.ts';
import { orderPacks, KERNEL_PACKS, type PackState } from './packorder.ts';
import { checkRules, type RuleDef } from './rules.ts';
import { isServerPack, parts, readManifest, withoutAbsent, type Manifest } from './manifest.ts';
import { createHash } from 'node:crypto';
import { ownPack, withVersions, type TypeItem } from './type-overlay.ts';

export type FieldType = 'string' | 'number' | 'boolean' | 'date' | 'datetime' | 'url' | 'enum' | 'json';

export interface FieldDef {
  type: FieldType;
  values?: string[];
  description?: string;
  default?: unknown;
  /** Maintained by the system; shown but not offered for editing. */
  system?: boolean;
  /** Sent with the item in a lens answer, so a style can draw by it (a kind to colour, an amount, a date). */
  shown?: boolean;
  /** Kept in a column of the item's row, not in props: status, owner, confidence and source, declared by a kind (src/head.ts). */ column?: boolean; /** May hold a value over LARGE: a system type's field only (code, a story). */ large?: boolean;
}

export interface Statuses {
  open: string[];
  closed: string[];
}

export interface TypeDef {
  id: string;
  title: string;
  description: string;
  extends?: string;
  /** One of the kinds every other type extends: the seven of the work, and system for the app's own. Only the core pack declares them. */
  kind?: boolean;
  statuses?: Statuses;
  fields?: Record<string, FieldDef>;
  /** What is made for a reader or a customer (a document, a file, a release): named under the title of what it is part of. A flavour inherits it. */
  deliverable?: boolean;
  /** How high its items sit (ALTITUDES): a project, a stream in it, a step in that. A flavour inherits it. */ altitude?: Altitude;
  /** What anyone may see, with no login, once a person makes it public (a product, what it has built, how we know). A flavour inherits it. */
  public?: boolean;
  /** What it goes with (linked by relation, out from it or in to it): public when that is, a limited token's when that is. A flavour inherits it. */
  belongs_with?: BelongsWith[];
  /** What the kernel computes from it, each naming the field it reads. A flavour inherits them. */
  capabilities?: Capabilities;
  /** How long its note may grow by an agent's hand, and what to tell one that goes over: a note every session reads whole is kept short. A flavour inherits it. */
  note_max?: NoteMax;
  moved_from?: string[]; retired?: boolean; // Types whose items are this one's now, moved once no pack defines them (cost became cost); retired: the owner's version is (src/type-overlay.ts).
}

export type NoteMax = { chars: number; say?: string };
export type BelongsWith = { relation: string; direction: 'out' | 'in' };

export interface RelationDef {
  id: string;
  /** One of the root relations every other relation extends. Only the core pack declares them. */
  root?: boolean;
  /** The relation this one is a flavour of. What the kernel computes from its root holds for it too. */
  extends?: string;
  title: string;
  inverse: string;
  from: string[];
  to: string[];
  description: string; moved_from?: string[]; retired?: boolean; // Relations whose links are this one's now, moved once no pack defines them; retired, as a type is.
}

/** A pack file as the registry reads it: the manifest (src/manifest.ts). */
export type PackFile = Manifest;

export interface ResolvedType {
  id: string;
  pack: string;
  title: string;
  description: string;
  /** This type first, then each ancestor, its kind last. */
  lineage: string[];
  /** The kind it falls back to: the last of its lineage. Undefined only for a workspace's own type left to the type table. */
  kind: string | undefined;
  /** The type nearest its kind: what it is, said without the kind (task for an experiment). */
  base: string;
  /** Of the system kind: the app's own configuration, which views of the work leave out. */
  system: boolean;
  statuses: Statuses;
  /** The fields kept in props, and those kept in the item's row (status and the rest a kind declares). */
  fields: Record<string, FieldDef>; columns: Partial<Record<ColumnField, FieldDef>>;
  deliverable: boolean; altitude?: Altitude;
  public: boolean;
  belongs_with?: BelongsWith[];
  capabilities: Capabilities;
  noteMax?: NoteMax; movedFrom?: string[];
  /** Kept from the type table: its pack is gone, its items are not. */ dormant?: boolean; /** No new item is made of it: the owner retired it. */ retired?: boolean;
}

/** A relation as loaded: `root` names the root it extends (itself, for a root). */
export type ResolvedRelation = Omit<RelationDef, 'root'> & { pack: string; root: string; dormant?: boolean };

/** The pack that approved type proposals are written to. */ export const LOCAL_PACK = 'local'; /** The plain wire: no link type is a flavour of it. */ export const BASE_LINK = 'link';
export { SYSTEM } from './head.ts';

export class Registry {
  readonly dir: string;
  readonly only: string[] | undefined;
  /** The types this workspace defined for itself (define_type), in order: its database keeps them (src/control.ts). */
  private local: TypeDef[]; /** The types and link types kept on the map (src/type-items.ts). */ private items: TypeItem[] = [];
  /** Where a type defined here is kept once the registry has taken it: the workspace's database. None keeps it in memory. */
  keepLocal: (def: TypeDef) => Promise<void> = async () => {};
  packs: PackFile[] = [];
  types = new Map<string, ResolvedType>();
  relations = new Map<string, ResolvedRelation>();
  trees = new Map<string, TreeDef & { pack: string }>();
  rules: (RuleDef & { pack: string })[] = [];
  verbs: VerbDef[] = [];
  /** Each pack's actions and views by the tool name they are offered as. */
  tools = new Map<string, { pack: string; call: 'action' | 'view'; def: ActionDef | ViewDef }>();
  /** Every pack found, active, waiting or off, with why. */
  states = new Map<string, PackState>();
  found: PackFile[] = [];
  /** Each pack's manifest as it was read: the SHA-256 of its pack.json, which its fact on the log names. */
  hashes = new Map<string, string>();
  /** The fields a pack adds to another pack's type, by type and field: the pack that added each (src/reach.ts). */
  added = new Map<string, Map<string, string>>();
  /** A name a type or link type had before (its moved_from), by the one it is now: what an old name still reads as. */ renamed = new Map<string, string>();
  /** Warnings said once: a pack file using the keys of the shape before the manifest. */
  private warned = new Set<string>();
  /** Packs the owner turned off in this workspace. */
  private turnedOff: string[] = [];
  /** Definitions kept from the type table whose packs are gone, put back after every reload. */
  private kept: { types: ResolvedType[]; relations: ResolvedRelation[] } = { types: [], relations: [] };

  constructor(dir: string, only?: string[], local: TypeDef[] = []) {
    this.dir = dir;
    this.only = only;
    this.local = [...local];
    this.reload();
  }

  reload(): void {
    const found = new Map<string, PackFile>();
    // A workspace's own types are in its database, never in a folder another server started from here would read.
    const folders = readdirSync(this.dir)
      .filter((name) => name !== LOCAL_PACK)
      .map((name) => [name, join(this.dir, name, 'pack.json')]);
    const hashes = new Map<string, string>();
    const warnings: string[] = [];
    for (const [name, file] of folders) {
      if (!existsSync(file)) continue;
      const text = readFileSync(file, 'utf8');
      const { manifest: pack, warnings: said } = readManifest(text, `packs/${name}/pack.json`);
      // A server pack kept beside the workspace packs is the server's (src/server-packs.ts), never a workspace's.
      if (isServerPack(pack)) continue;
      if (pack.id !== name) throw new Error(`Pack folder "${name}" contains pack id "${pack.id}"`);
      found.set(pack.id, pack);
      hashes.set(pack.id, createHash('sha256').update(text).digest('hex'));
      warnings.push(...said);
    }
    for (const w of warnings) if (!this.warned.has(w)) (this.warned.add(w), console.warn(w));
    if (!found.has('core')) throw new Error(`No core pack in ${this.dir}`);
    const own = ownPack(this.localPack(), this.items, LOCAL_PACK); if (own) found.set(LOCAL_PACK, own);

    // Load in dependency order what is on and has what it requires; the rest waits or is off.
    const off = new Map([...found.keys()].filter((id) => this.only && !this.only.includes(id) && id !== LOCAL_PACK).map((id) => [id, 'not enabled on this server']));
    for (const id of this.turnedOff) off.set(id, 'turned off here');
    const { ordered: loaded, states } = orderPacks(found, off, LOCAL_PACK);
    // What a pack names of a pack it uses is registered only while that one is active (src/manifest.ts, uses).
    const declaredBy = new Map([...found.values()].flatMap((p) => [...parts(p).types, ...parts(p).relations].map((t) => [t.id, p.id] as const)));
    const ordered = withVersions(loaded.map((pack) => withoutAbsent(pack, (id) => states.get(id)?.state === 'active', (name) => declaredBy.get(name))), this.items);

    const raw = new Map<string, TypeDef & { pack: string }>();
    const relations = new Map<string, ResolvedRelation>();
    const declared = new Map<string, RelationDef>();
    const owned = (pack: PackFile, id: string) => pack.id === 'core' || id.startsWith(pack.id + '.'); // a tree's name; a type is named by what it is
    for (const pack of ordered) {
      for (const type of parts(pack).types) {
        if (raw.has(type.id)) throw new Error(`Type "${type.id}" is defined twice`);
        if (type.kind && pack.id !== 'core') throw new Error(`Type "${type.id}": only the core pack declares kinds`);
        raw.set(type.id, { ...type, pack: pack.id });
      }
      for (const rel of parts(pack).relations) {
        if (relations.has(rel.id)) throw new Error(`Relation "${rel.id}" is defined twice`);
        if (rel.root && pack.id !== 'core') throw new Error(`Relation "${rel.id}": only the core pack declares root relations`);
        declared.set(rel.id, rel);
        relations.set(rel.id, { ...rel, pack: pack.id, root: rel.id });
      }
    }
    const extra = new Map<string, Record<string, FieldDef>>();
    const added = new Map<string, Map<string, string>>();
    for (const pack of ordered) {
      for (const [typeId, ext] of Object.entries(parts(pack).adds)) {
        if (!raw.has(typeId)) throw new Error(`Pack "${pack.id}" extends unknown type "${typeId}"`);
        extra.set(typeId, { ...extra.get(typeId), ...ext.fields });
        for (const field of Object.keys(ext.fields)) (added.get(typeId) ?? added.set(typeId, new Map()).get(typeId)!).set(field, pack.id);
      }
    }

    const types = new Map<string, ResolvedType>();
    const resolve = (id: string, trail: string[]): ResolvedType => {
      const done = types.get(id);
      if (done) return done;
      const def = raw.get(id);
      if (!def) throw new Error(`Unknown type "${id}"${trail.length ? ` (extended by "${trail.at(-1)}")` : ''}`);
      if (trail.includes(id)) throw new Error(`Type cycle: ${[...trail, id].join(' -> ')}`);
      const parent = def.extends ? resolve(def.extends, [...trail, id]) : undefined;
      if (def.extends && def.kind) throw new Error(`Type "${id}" is a kind and extends nothing`);
      const kind = def.kind ? id : parent?.kind;
      if (!kind) throw new Error(`Type "${id}" in pack "${def.pack}" must extend one of the kinds: ${[...raw.values()].filter((t) => t.kind && t.id !== SYSTEM).map((t) => t.id).join(', ')}`);
      if (kind === SYSTEM && !KERNEL_PACKS.includes(def.pack)) throw new Error(`Type "${id}" in pack "${def.pack}" cannot be of the system kind: that is the kernel's own`);
      const statuses = def.statuses ?? parent?.statuses;
      if (!statuses?.open.length) throw new Error(`Type "${id}" needs at least one open status`);
      const resolved: ResolvedType = {
        id,
        pack: def.pack,
        title: def.title,
        description: def.description,
        lineage: [id, ...(parent?.lineage ?? [])],
        kind,
        base: !parent || parent.id === parent.kind ? id : parent.base,
        system: kind === SYSTEM,
        statuses,
        ...headOf({ ...parent?.fields, ...parent?.columns, ...def.fields, ...extra.get(id) }, statuses),
        deliverable: def.deliverable ?? parent?.deliverable ?? false,
        public: def.public ?? parent?.public ?? false,
        ...((def.altitude ?? parent?.altitude) && { altitude: altitudeOf(id, def.altitude ?? parent?.altitude) }),
        ...((def.belongs_with ?? parent?.belongs_with)?.length && { belongs_with: def.belongs_with ?? parent?.belongs_with }),
        capabilities: { ...parent?.capabilities, ...def.capabilities },
        ...((def.note_max ?? parent?.noteMax) && { noteMax: def.note_max ?? parent?.noteMax }),
        ...(def.moved_from?.length && { movedFrom: def.moved_from }), ...(def.retired && { retired: true }),
      };
      types.set(id, resolved);
      return resolved;
    };
    for (const id of raw.keys()) {
      try {
        resolve(id, []);
      } catch (err) {
        // A workspace's own type may extend one whose pack is not active: it is left to the type table.
        if (raw.get(id)!.pack !== LOCAL_PACK) throw err;
      }
    }

    for (const t of types.values())
      for (const b of t.belongs_with ?? [])
        if (!relations.has(b.relation) || !['out', 'in'].includes(b.direction)) throw new Error(`Type "${t.id}" goes with what "${b.relation}" links it to: that needs a relation the packs define, and a direction, out or in`);
    for (const rel of relations.values()) {
      for (const end of [...rel.from, ...rel.to]) {
        if (end !== '*' && !types.has(end)) throw new Error(`Relation "${rel.id}" refers to unknown type "${end}"`);
      }
    }
    // Every relation extends a root, and joins only what its root may join.
    const fits = (allowed: string[], end: string) => allowed.some((a) => a === '*' || (end !== '*' && types.get(end)!.lineage.includes(a)));
    const rootOf = (rel: RelationDef, trail: string[]): string => {
      if (rel.root) return rel.id;
      if (rel.extends && rel.extends === rel.id) throw new Error(`Relation "${rel.id}" extends itself`);
      if (trail.includes(rel.id)) throw new Error(`Relation cycle: ${[...trail, rel.id].join(' -> ')}`);
      const parent = rel.extends ? declared.get(rel.extends) : undefined; if (rel.extends === BASE_LINK) throw new Error(`Relation "${rel.id}" cannot be a flavour of ${BASE_LINK}, which means nothing more than that its ends relate: extend the root it means`);
      if (!parent) throw new Error(`Relation "${rel.id}" must extend one of the root relations${rel.extends ? `, not unknown "${rel.extends}"` : ''}`);
      for (const [side, ends] of [['from', rel.from], ['to', rel.to]] as const) {
        const bad = ends.find((end) => !fits(parent[side], end));
        if (bad) throw new Error(`Relation "${rel.id}" goes ${side} ${bad}, which "${parent.id}" does not`);
      }
      return rootOf(parent, [...trail, rel.id]);
    };
    for (const rel of relations.values()) rel.root = rootOf(declared.get(rel.id)!, []);

    for (const type of types.values()) {
      const problems = [...checkCapabilities(type.capabilities, type.fields, new Set(relations.keys()), [...type.statuses.open, ...type.statuses.closed]), ...checkFieldDecls(type, raw.get(type.id), extra.get(type.id))];
      if (problems.length) throw new Error(`Type "${type.id}" in pack "${type.pack}": ${problems.join('; ')}`);
    }

    const trees = new Map<string, TreeDef & { pack: string }>();
    for (const pack of ordered) {
      for (const tree of parts(pack).trees) {
        if (!owned(pack, tree.id)) throw new Error(`Tree "${tree.id}" in pack "${pack.id}" must be named "${pack.id}.<name>"`);
        for (const kind of [...tree.roots, ...tree.branches, ...tree.work]) {
          if (!types.has(kind)) throw new Error(`Tree "${tree.id}" refers to unknown type "${kind}"`);
        }
        trees.set(tree.id, { ...tree, pack: pack.id });
      }
    }

    const verbs = ordered.flatMap((pack) => parts(pack).verbs);
    const tools = new Map<string, { pack: string; call: 'action' | 'view'; def: ActionDef | ViewDef }>();
    for (const pack of ordered) {
      const declared = checkDeclared(pack, types, verbs.map((v) => v.id), pack.id !== LOCAL_PACK && existsSync(join(this.dir, pack.id, 'handler.js')));
      if (declared.length) throw new Error(`Pack "${pack.id}": ${declared.join('; ')}`);
      for (const def of parts(pack).actions) tools.set(toolName(def.id), { pack: pack.id, call: 'action', def });
      // A lens preset is asked through the view tool, as any lens is: it is no tool of its own.
      for (const def of parts(pack).views) if (!def.lens) tools.set(toolName(def.id), { pack: pack.id, call: 'view', def });
      const problems = checkRules(pack.rules ?? [], { types });
      if (problems.length) throw new Error(`Pack "${pack.id}": ${problems.join('; ')}`);
    }

    this.packs = ordered;
    this.added = added;
    this.hashes = hashes;
    this.states = states;
    this.found = [...found.values()];
    this.rules = ordered.flatMap((pack) => (pack.rules ?? []).map((rule) => ({ ...rule, pack: pack.id })));
    this.types = types;
    this.relations = relations; this.renamed = new Map([...[...types.values()].flatMap((t) => (t.movedFrom ?? []).map((o) => [o, t.id] as const)), ...[...relations.values()].flatMap((r) => (r.moved_from ?? []).map((o) => [o, r.id] as const))]);
    this.trees = trees; this.verbs = verbs;
    this.tools = tools;
    this.keep(this.kept);
  }

  /**
   * Take in definitions the workspace kept whose packs are not loaded, as dormant: their items keep kind, statuses,
   * fields and capabilities. One that a pack defines again is the pack's.
   */
  keep(kept: { types: ResolvedType[]; relations: ResolvedRelation[] }): void {
    this.kept = kept;
    for (const t of kept.types) if (!this.types.has(t.id)) this.types.set(t.id, { ...t, dormant: true });
    for (const r of kept.relations) if (!this.relations.has(r.id)) this.relations.set(r.id, { ...r, dormant: true });
  }

  type(id: string): ResolvedType | undefined { return this.types.get(id); }
  /** The name a type or link type has now, given one it had before (work.task is task). */ canonical = (id: string): string => this.renamed.get(id) ?? id;

  /** Turn packs off in this workspace (the rest on), and load again if that changed anything. The kernel's packs stay on. Says what was newly turned off, or undefined when nothing changed. */
  turnOff(packs: string[]): string[] | undefined {
    const next = packs.filter((p) => !KERNEL_PACKS.includes(p));
    const newly = next.filter((p) => !this.turnedOff.includes(p));
    if (!newly.length && next.length === this.turnedOff.length) return undefined;
    this.turnedOff = next;
    this.reload();
    return newly;
  }

  /** The kinds, in the core pack's order: the seven of the work, then system. */
  kinds(): ResolvedType[] {
    return [...this.types.values()].filter((t) => t.kind === t.id);
  }

  /** A relation and every relation extending it: what the kernel computes from a root holds for all of them. */
  relationFamily(...roots: string[]): string[] {
    const family = (id: string): string[] => [id, ...[...this.relations.values()].filter((r) => r.extends === id).flatMap((r) => family(r.id))];
    return roots.map(this.canonical).flatMap(family);
  }

  isA(typeId: string, ancestor: string): boolean {
    return this.types.get(this.canonical(typeId))?.lineage.includes(this.canonical(ancestor)) ?? false;
  }

  /** What a picture says a thing is: its type nearest the kind (root) and its kind. */
  ancestry(typeId: string): { root: string; kind: string | null } {
    const type = this.types.get(typeId);
    return { root: type?.base ?? typeId, kind: type?.kind ?? null };
  }

  /** How many may hold an item at once: Infinity for any number, undefined when it cannot be held. */
  capacity(item: { type: string; props: Record<string, unknown> }): number | undefined {
    return capacityOf(this.types.get(item.type)?.capabilities, item.props);
  }

  /** Every type that has this capability, its own or its parent's. */
  having(capability: keyof Capabilities): string[] {
    return [...this.types.values()].filter((t) => t.capabilities[capability] !== undefined).map((t) => t.id);
  }

  /** The types a pack's screen draws this piece on (a document read whole, a figure kept), flavours included. */
  drawnWith(piece: string): string[] {
    const on = screensOf(this.packs).filter((s) => s.pieces.some((p) => p.piece === piece)).flatMap((s) => s.on ?? []);
    return [...new Set(on.flatMap((t) => this.family(t)))];
  }

  /** The type and every flavour of it. */
  family(typeId: string): string[] {
    return [...this.types.values()].filter((t) => t.lineage.includes(this.canonical(typeId))).map((t) => t.id);
  }

  isOpen(typeId: string, status: string): boolean {
    return this.types.get(typeId)?.statuses.open.includes(status) ?? true;
  }

  /** Problems with a status and props for a type. Empty means valid. */
  check(typeId: string, status: string | undefined, props: Record<string, unknown>): string[] {
    const type = this.types.get(typeId);
    const taken = [...this.types.values()].filter((t) => !t.dormant && t.movedFrom?.includes(typeId)).map((t) => `: it is ${t.id} now`).join('');
    if (!type || (type.dormant && taken)) return [`unknown type "${typeId}"${taken}. Known types: ${[...this.types.keys()].join(', ')}`];
    const problems: string[] = [];
    const statuses = [...type.statuses.open, ...type.statuses.closed];
    if (status !== undefined && !statuses.includes(status)) {
      problems.push(`status "${status}" is not valid for ${typeId}. Use one of: ${statuses.join(', ')}`);
    }
    for (const [key, value] of Object.entries(props)) {
      const field = type.fields[key];
      if (!field) {
        const known = Object.keys(type.fields).join(', ') || 'none';
        // The field may be one a flavour of the type has: an issue has no "repro", a bug does.
        const flavour = [...this.types.values()].find((t) => t.id !== typeId && t.lineage.includes(typeId) && t.fields[key]);
        const instead = flavour ? `${flavour.id}, a flavour of ${typeId}, has it: make it that type, or put free-form detail in body.` : 'Put free-form detail in body.';
        problems.push(`${typeId} has no field "${key}" (fields: ${known}). ${instead}`);
        continue;
      }
      if (value === null) continue; // null clears a field on update
      const problem = checkValue(field, value);
      if (problem) problems.push(`${typeId}.${key} ${problem}`);
    }
    return problems;
  }

  defaults(typeId: string): Record<string, unknown> {
    const out: Record<string, unknown> = {};
    for (const [key, field] of Object.entries(this.types.get(typeId)?.fields ?? {})) {
      if (field.default !== undefined) out[key] = field.default;
    }
    return out;
  }

  /** Why a relation of this type cannot join these two entity types, if it cannot. */
  checkRelation(relId: string, fromType: string, toType: string): string | undefined {
    const rel = this.relations.get(relId);
    const taken = [...this.relations.values()].filter((r) => !r.dormant && r.moved_from?.includes(relId)).map((r) => `: it is ${r.id} now`).join('');
    if (!rel || (rel.dormant && taken)) return `unknown relation "${relId}"${taken}. Known relations: ${[...this.relations.keys()].join(', ')}`;
    if (rel.retired) return `"${relId}" is retired here: no new link is made of it`;
    const fits = (allowed: string[], type: string) => allowed.some((a) => a === '*' || this.isA(type, a));
    if (!fits(rel.from, fromType)) return `"${relId}" must start from ${rel.from.join(' or ')}, not ${fromType}`;
    if (!fits(rel.to, toType)) return `"${relId}" must point to ${rel.to.join(' or ')}, not ${toType}`;
    return undefined;
  }

  /** Problems with a proposed new type. Empty means it can be defined. */
  checkNewType(def: TypeDef): string[] {
    const problems: string[] = [];
    if (!/^local\.[a-z][a-z0-9_]*$/.test(def.id)) problems.push(`new type id must look like "local.my_type", got "${def.id}"`);
    if (this.types.has(def.id)) problems.push(`type "${def.id}" already exists`);
    const kinds = this.kinds().filter((t) => !t.system).map((t) => t.id).join(', ');
    if (!def.extends) problems.push(`a new type extends one of the kinds (${kinds}) or a type of one`);
    else if (!this.types.has(def.extends)) problems.push(`cannot extend unknown type "${def.extends}"`);
    else if (this.types.get(def.extends)!.system) problems.push(`cannot extend "${def.extends}", which is the kernel's own`);
    return problems;
  }

  /** The types this workspace defined for itself, as a pack, if it has any. */
  localPack(): PackFile | undefined {
    return this.local.length ? { id: LOCAL_PACK, version: '0.1.0', title: 'Local', description: 'Types defined in this workspace.', types: this.local } : undefined;
  }

  /** Add a type of this workspace's own, reload, and keep it. */
  async defineLocal(def: TypeDef): Promise<void> {
    this.local = [...this.local, def];
    try {
      this.reload();
    } catch (err) {
      this.local = this.local.slice(0, -1);
      this.reload();
      throw err;
    }
    await this.keepLocal(def);
  }

  /** Take in the types and link types kept on the map; one that does not load leaves the registry as it was, and says why. */
  takeItems(items: TypeItem[]): void { const was = this.items; this.items = items; try { this.reload(); } catch (err) { this.items = was; this.reload(); throw err; } }
  /** A registry like this one with these type items in place of its own: what a change that makes or changes one is checked against. */
  trial(items: TypeItem[]): Registry { const r = new Registry(this.dir, this.only, this.local); r.turnedOff = this.turnedOff; r.kept = this.kept; r.takeItems(items); return r; }
  /** Take up the types defined here by another server on the same database. Returns whether any were new. */
  followLocal(defs: TypeDef[]): boolean {
    const added = defs.filter((t) => !this.local.some((l) => l.id === t.id));
    if (!added.length) return false;
    this.local = [...this.local, ...added];
    this.reload();
    return true;
  }

  describe() {
    return {
      packs: this.packs.map((p) => ({ id: p.id, version: p.version, title: p.title, description: p.description })),
      // The head every item has; status, owner, confidence and source are each type's columns, as its kind declares them.
      common_fields: { title: 'Required. A short name.', body: 'Free-form markdown detail.', visibility: 'private (default) or shared.' },
      types: [...this.types.values()].map((t) => ({
        id: t.id,
        pack: t.pack,
        title: t.title,
        description: t.description,
        flavour_of: t.lineage[1],
        kind: t.kind,
        statuses: t.statuses,
        fields: t.fields,
        columns: t.columns,
        ...(t.deliverable && { deliverable: true }), ...(t.altitude && { altitude: t.altitude }),
        ...(t.public && { public: true }),
        ...(t.belongs_with && { belongs_with: t.belongs_with }),
        ...(Object.keys(t.capabilities).length && { capabilities: t.capabilities }),
        ...(t.dormant && { dormant: true }), ...(t.retired && { retired: true }),
      })),
      relations: [...this.relations.values()],
      trees: [...this.trees.values()],
      verbs: this.verbs.map((v) => ({ ...v, kernel_tools: Object.keys(KERNEL_VERBS).filter((t) => KERNEL_VERBS[t] === v.id) })),
      pack_tools: [...this.tools].map(([tool, { pack, call, def }]) => ({ tool, pack, [call]: def.id, ...('verb' in def ? { verb: def.verb, title: def.title, on: def.on, item: def.item, input: def.input } : { shape: def.shape }) })),
      screens: screensOf(this.packs), styles: stylesOf(this.packs),
    };
  }
}
