// Packs: versioned bundles of types and relation types, stored as files. A type may extend another (a "flavour"); it
// inherits the parent's fields and statuses, and anything that queries the parent also sees its flavours.

import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { capacityOf, checkCapabilities, type Capabilities } from './capabilities.ts'; import { capabilityOf, holds, unknownEnd, within } from '../../../src/link-ends.ts';
import { checkDeclared, KERNEL_VERBS, presetsOf, screensOf, stylesOf, toolName, type ActionDef, type TreeDef, type VerbDef, type ViewDef } from './declared.ts';
import { altitudeOf, type Altitude } from '../../../src/altitude.ts';
import { checkValue } from '../../../src/fields.ts';
import { checkFieldDecls, headOf, ownHead, type ColumnField } from '../../../src/head.ts';
import { actorsOf, islandsOff, packKind, sharedOf } from './islands.ts'; import { ISLAND, ISLAND_FIELD, livesOnIsland } from './island-items.ts';
import { orderPacks, KERNEL_PACKS, ownsId, providersOf, type PackState } from './packorder.ts';
import { checkRules, type RuleDef } from '../../../src/rules.ts';
import { isInternal, isRequired, kernelRefused, parts, withoutAbsent, type Manifest } from './manifest.ts'; import { openedTo, providedOf } from '../../../src/services.ts';
import { OWN_PACKS, readPackFolders } from './pack-folders.ts'; import { madePacks, type ItemPack, type PackVersion } from './pack-items.ts'; import { versionWhere } from './pack-code.ts';
import { ownPack, withVersions, type TypeItem } from './type-overlay.ts'; import { checkPhases, phasesOf } from '../../../src/phases.ts'; import { keepVersionTypes } from './version-types.ts';

export type FieldType = 'string' | 'number' | 'boolean' | 'date' | 'datetime' | 'url' | 'enum' | 'json';

export interface FieldDef {
  type: FieldType;
  values?: string[];
  description?: string;
  default?: unknown;
  /** Maintained by the system; shown but not offered for editing. */
  system?: boolean;
  /** Sent with the item in a lens answer, so a style can draw by it (a type to colour, an amount, a date). */
  shown?: boolean;
  /** Kept in a column of the item's row, not in props: status, owner, confidence and source, declared by a starter type (src/head.ts). */ column?: boolean; /** May hold a value over LARGE: a system type's field only (code, a story). */ large?: boolean; /** A published page's stylesheet: checked on write as the page checks it (src/css-check.ts). */ css?: boolean; /** Holds code (a module, a stylesheet): drawn as a code block, folded. */ code?: boolean;
  /** Of type json, holding a value of the simple type another field of the item names (src/fields.ts SIMPLE_TYPES): checked on write with the two together. */ typed_by?: string;
}

export interface Statuses {
  open: string[]; closed: string[];
  /** Where each stands in its course, by status (src/phases.ts): what it says, else read from its place. Resolved, every status has one. */ phases?: Record<string, string>;
}

export interface TypeDef {
  id: string;
  title: string;
  description: string;
  extends?: string;
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
  /** By a type it was moved from, what each of that type's statuses is here, when the two lists differ: said once, as the items move (part's works is component's up). */
  moved_statuses?: Record<string, Record<string, string>>;
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
  description: string; /** May join items on two islands: the one kind of tie that crosses (a reading of a finding). */ crosses?: boolean; /** Kept by the kernel (a claim, a session's work, a tie between actors), never an island's vocabulary. Only the kernel's packs say it. */ kernel?: boolean; offers_close?: boolean; /* closing its source offers to close its target (src/close-offer.ts) */ moved_from?: string[]; retired?: boolean; // Relations whose links are this one's now, moved once no pack defines them; retired, as a type is.
}

/** A pack file as the registry reads it: the manifest (src/manifest.ts). */
export type PackFile = Manifest;

export interface ResolvedType {
  id: string;
  pack: string;
  title: string;
  description: string;
  /** This type first, then each ancestor, the starter type it comes from last. */
  lineage: string[];
  /** The starter type it comes from: the last of its lineage, a type that extends nothing (core's eight, or a pack's own). The item's `kind` column holds it. */
  starter: string;
  /** The type nearest its starter: what it is, said without the starter (task for an experiment). */
  base: string;
  /** The kernel's own (the kernel flag, src/capabilities.ts): the app's configuration, which views of the work leave out. */
  system: boolean;
  statuses: Statuses;
  /** The fields kept in props, and those kept in the item's row (status and the rest its starter declares). */
  fields: Record<string, FieldDef>; columns: Partial<Record<ColumnField, FieldDef>>;
  deliverable: boolean; altitude?: Altitude;
  public: boolean;
  belongs_with?: BelongsWith[];
  capabilities: Capabilities;
  noteMax?: NoteMax; movedFrom?: string[]; movedStatuses?: Record<string, Record<string, string>>;
  /** Kept from the type table: its pack is gone, its items are not. */ dormant?: boolean; /** No new item is made of it: the owner retired it. */ retired?: boolean;
}

/** A relation as loaded: `root` names the root it extends (itself, for a root). */
export type ResolvedRelation = Omit<RelationDef, 'root'> & { pack: string; root: string; dormant?: boolean };

/** The pack that approved type proposals are written to. */ export const LOCAL_PACK = 'local'; /** The plain wire: no link type is a flavour of it. */ export const BASE_LINK = 'link';
export { SYSTEM } from '../../../src/head.ts';

export class Registry {
  /** The first folder packs are read from: the server's own (`packsDir`). */
  readonly dir: string;
  /** Every folder packs are read from, in order: the server's own, then those `PELAGO_PACKS` names. */
  readonly dirs: string[];
  /** The folder each pack was found in. */
  private where = new Map<string, string>();
  readonly only: string[] | undefined;
  /** The types this workspace defined for itself (define_type), in order: its database keeps them (src/control.ts). */
  private local: TypeDef[]; /** The types and link types kept on the map (src/type-items.ts). */ items: TypeItem[] = [];
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
  states = new Map<string, PackState>(); /** The server's own internal packs (root and service, docs/kernel-packs.md), found here: each required (always on) or optional (a map may switch it off). */ internal = new Set<string>();
  found: PackFile[] = [];
  /** Each pack's manifest as it was read: the SHA-256 of its pack.json, which its fact on the log names. */
  hashes = new Map<string, string>();
  /** The fields a pack adds to another pack's type, by type and field: the pack that added each (src/reach.ts). */
  added = new Map<string, Map<string, string>>();
  /** A name a type or link type had before (its moved_from), by the one it is now: what an old name still reads as. */ renamed = new Map<string, string>();
  /** Packs the owner turned off in this workspace. */
  private turnedOff: string[] = []; /** Whether this workspace holds its packs to the island rules (src/islands.ts). */ private islands = false; /** Whether this workspace has islands on: its items live on islands (src/island-items.ts). */ get onIslands() { return this.islands; }
  /** The packs kept as items (src/pack-items.ts) by id, the pack items that are none with why, and those the owner added here. */ made = new Map<string, ItemPack>(); madeWrong = new Map<string, string>(); private madeOn = new Set<string>(); /** The versions of packs kept as items, by item (src/island-pin.ts), and the one this registry runs in its pack's place. */ versions = new Map<string, PackVersion>(); private swap?: PackVersion;
  /** Definitions kept from the type table whose packs are gone, put back after every reload. */
  private kept: { types: ResolvedType[]; relations: ResolvedRelation[] } = { types: [], relations: [] };

  /** The manifests this registry was given in place of folders: the packs as the log said them at a past position (src/registry-at.ts). Their code is read from `where` (src/pack-code.ts), as the log kept it, and a handler they declare is taken as it was said. */ private given?: { found: Map<string, PackFile>; hashes: Map<string, string>; where?: Map<string, string> };
  constructor(dirs: string | string[] | { found: Map<string, PackFile>; hashes: Map<string, string>; where?: Map<string, string> }, only?: string[], local: TypeDef[] = []) {
    if (typeof dirs === 'object' && !Array.isArray(dirs)) (this.given = dirs), (dirs = []);
    this.dirs = [dirs].flat(); this.dir = this.dirs[0] ?? '';
    this.only = only;
    this.local = [...local];
    this.reload();
  }

  reload(): void {
    // A workspace's own types are in its database, never in a folder another server started from here would read.
    const { found, hashes, where } = this.given ? { found: new Map(this.given.found), hashes: new Map(this.given.hashes), where: new Map(this.given.where) } : readPackFolders<PackFile>(this.dirs, LOCAL_PACK);
    this.where = where;
    const own = ownPack(this.localPack(), this.items, LOCAL_PACK); if (own) found.set(LOCAL_PACK, own);
    const made = madePacks(this.items, found, LOCAL_PACK); this.made = new Map(made.packs.map((p) => [p.manifest.id, p])); this.madeWrong = made.wrong;
    for (const p of [...made.packs, ...(this.swap ? [{ manifest: this.swap.manifest, hash: this.swap.hash }] : [])]) found.set(p.manifest.id, p.manifest), hashes.set(p.manifest.id, p.hash); this.versions = new Map(made.versions.map((v) => [v.item, v])); if (this.swap?.code) where.set(this.swap.of, versionWhere(this.swap.of, join(where.get(this.swap.of) ?? this.dir, this.swap.of), this.swap.code)); // a version's own code runs from its own folder

    // Load in dependency order what is on and has what it requires; the rest waits or is off.
    const off = new Map([...found.keys()].filter((id) => this.only && !this.only.includes(id) && id !== LOCAL_PACK && !this.made.has(id)).map((id) => [id, 'not enabled on this server']));
    for (const id of this.turnedOff) off.set(id, 'turned off here');
    for (const id of this.made.keys()) if (!this.madeOn.has(id)) off.set(id, 'kept as an item: the owner has not added it here');
    if (this.islands) for (const [id, why] of islandsOff([...found.values()].filter((p) => !off.has(p.id) || KERNEL_PACKS.includes(p.id)), LOCAL_PACK)) off.set(id, why); const refused = new Map(kernelRefused(found.values(), (id) => !this.made.has(id) && this.swap?.of !== id && (!!this.given || this.where.get(id) === this.dir || this.where.get(id) === OWN_PACKS))); for (const p of found.values()) if (isRequired(p)) off.delete(p.id); for (const [id, why] of refused) off.set(id, why); this.internal = new Set([...found.values()].filter((p) => isInternal(p) && !refused.has(p.id)).map((p) => p.id)); // a required internal pack is always on, an optional one off where the map turned it off (kernel.optional); kernel code from anywhere but the server's own folder never runs
    const { ordered: loaded, states } = orderPacks(found, off, LOCAL_PACK);
    // What a pack names of a pack it uses is registered only while that one is active (src/manifest.ts, uses); a name it uses is read as the pack that provides it.
    const declaredBy = new Map([...found.values()].flatMap((p) => [...parts(p).types, ...parts(p).relations].map((t) => [t.id, p.id] as const)));
    const usesPacks = (pack: PackFile) => (pack.uses?.length ? { ...pack, uses: pack.uses.flatMap((u) => { const by = providersOf(u, found.values()); return by.length ? by : [u]; }) } : pack); const ordered = withVersions(loaded.map((pack) => { const read = usesPacks(pack), kept = withoutAbsent(read, (id) => states.get(id)?.state === 'active', (name) => declaredBy.get(name)); return kept === read ? pack : kept; }), this.items);

    const raw = new Map<string, TypeDef & { pack: string }>();
    const relations = new Map<string, ResolvedRelation>();
    const declared = new Map<string, RelationDef>();
    const owned = (pack: PackFile, id: string) => ownsId(pack, id); // a tree's name; a type is named by what it is
    for (const pack of ordered) {
      for (const type of parts(pack).types) {
        if (raw.has(type.id)) throw new Error(`Type "${type.id}" is defined twice`);
        raw.set(type.id, { ...type, pack: pack.id });
      }
      for (const rel of parts(pack).relations) {
        if (relations.has(rel.id)) throw new Error(`Relation "${rel.id}" is defined twice`);
        if ((rel.root || rel.kernel) && !KERNEL_PACKS.includes(pack.id)) throw new Error(`Relation "${rel.id}": only the core pack declares ${rel.root ? 'root relations' : 'the kernel’s own'}`);
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
      const kernel = Boolean(def.capabilities?.kernel ?? parent?.capabilities.kernel); if (kernel && !KERNEL_PACKS.includes(def.pack)) throw new Error(`Type "${id}" in pack "${def.pack}" cannot carry the kernel flag: that is the kernel's own`);
      const statuses = def.statuses ?? parent?.statuses;
      if (!statuses?.open.length) throw new Error(`Type "${id}" needs at least one open status`);
      const resolved: ResolvedType = {
        id,
        pack: def.pack,
        title: def.title,
        description: def.description,
        lineage: [id, ...(parent?.lineage ?? [])],
        starter: parent?.starter ?? id,
        base: !parent || parent.id === parent.starter ? id : parent.base,
        system: kernel,
        statuses: { ...statuses, phases: phasesOf(statuses, [def.statuses?.phases, parent?.statuses.phases]) },
        // A type that extends nothing keeps in its row the columns it declares, or the common ones (src/head.ts, ownHead).
        ...headOf({ ...ownHead(Boolean(parent?.columns.status ?? def.fields?.status?.column), Boolean(def.capabilities?.owned ?? parent?.capabilities.owned)), ...parent?.fields, ...parent?.columns, ...def.fields, ...extra.get(id), ...(this.islands && (livesOnIsland({ system: kernel, lineage: [id, ...(parent?.lineage ?? [])] }) || (def.capabilities?.subject ?? parent?.capabilities.subject)) && { [ISLAND]: ISLAND_FIELD }) }, statuses),
        deliverable: def.deliverable ?? parent?.deliverable ?? false,
        public: def.public ?? parent?.public ?? false,
        ...((def.altitude ?? parent?.altitude) && { altitude: altitudeOf(id, def.altitude ?? parent?.altitude) }),
        ...((def.belongs_with ?? parent?.belongs_with)?.length && { belongs_with: def.belongs_with ?? parent?.belongs_with }),
        capabilities: { ...parent?.capabilities, ...def.capabilities },
        ...((def.note_max ?? parent?.noteMax) && { noteMax: def.note_max ?? parent?.noteMax }),
        ...(def.moved_from?.length && { movedFrom: def.moved_from }), ...(def.moved_statuses && { movedStatuses: def.moved_statuses }), ...(def.retired && { retired: true }),
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
      for (const end of [...rel.from, ...rel.to]) { const why = unknownEnd(end, (id) => types.has(id)); if (why) throw new Error(`Relation "${rel.id}" refers to ${why}`); }
    }
    // A relation that extends nothing is its own root; one that extends another joins only what that one may join.
    const rootOf = (rel: RelationDef, trail: string[]): string => {
      if (rel.root || !rel.extends) return rel.id;
      if (rel.extends === rel.id) throw new Error(`Relation "${rel.id}" extends itself`);
      if (trail.includes(rel.id)) throw new Error(`Relation cycle: ${[...trail, rel.id].join(' -> ')}`);
      const parent = declared.get(rel.extends); if (rel.extends === BASE_LINK) throw new Error(`Relation "${rel.id}" cannot be a flavour of ${BASE_LINK}, which means nothing more than that its ends relate: extend the root it means`);
      if (!parent) throw new Error(`Relation "${rel.id}" extends unknown "${rel.extends}"`);
      for (const [side, ends] of [['from', rel.from], ['to', rel.to]] as const) {
        const bad = ends.find((end) => !within(end, parent[side], (id) => types.get(id)));
        if (bad) throw new Error(`Relation "${rel.id}" goes ${side} ${bad}, which "${parent.id}" does not`);
      }
      return rootOf(parent, [...trail, rel.id]);
    };
    for (const rel of relations.values()) rel.root = rootOf(declared.get(rel.id)!, []);

    const openedOf = (pack: string) => { const p = ordered.find((x) => x.id === pack); return p ? openedTo(p, 'capability') : []; }; for (const type of types.values()) {
      const problems = [...checkCapabilities(type.capabilities, type.fields, new Set(relations.keys()), [...type.statuses.open, ...type.statuses.closed], openedOf(type.pack)), ...checkFieldDecls(type, raw.get(type.id), extra.get(type.id)), ...checkPhases(raw.get(type.id)?.statuses ?? { open: [], closed: [] })];
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
      const declared = checkDeclared(pack, types, verbs.map((v) => v.id), !!this.given || (pack.id !== LOCAL_PACK && !this.made.has(pack.id) && existsSync(join(this.folderOf(pack.id), 'handler.js'))), providedOf(ordered.filter(isInternal), 'answer')); // an internal pack's answers, always on: any view names them
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
    this.keep(this.kept); if (!this.swap) keepVersionTypes(this); // what versions add, dormant and retired here (src/version-types.ts)
  }

  /**
   * Take in definitions the workspace kept whose packs are not loaded, as dormant: their items keep starter, statuses,
   * fields and capabilities. One that a pack defines again is the pack's.
   */
  keep(kept: { types: ResolvedType[]; relations: ResolvedRelation[] }): void {
    this.kept = kept;
    // One kept before owned was a capability says it by its owner column: links from it are allowed as they were.
    for (const t of kept.types) if (!this.types.has(t.id)) this.types.set(t.id, { ...t, starter: t.starter ?? t.lineage?.at(-1) ?? t.id, capabilities: { ...(t.columns?.owner && { owned: true }), ...t.capabilities }, dormant: true });
    for (const r of kept.relations) if (!this.relations.has(r.id)) this.relations.set(r.id, { ...r, dormant: true });
  }

  type(id: string): ResolvedType | undefined { return this.types.get(id); }
  /** The starter type a type comes from (the item's kind column); null for a type nothing defines. */ starterOf = (id: string): string | null => this.types.get(id)?.starter ?? null;
  /** The name a type or link type has now, given one it had before (work.task is task). */ canonical = (id: string): string => this.renamed.get(id) ?? id;

  /** Turn packs off in this workspace (the rest on), and load again if that changed anything. The kernel's packs stay on. Says what was newly turned off, or undefined when nothing changed. */
  turnOff(packs: string[], islands = this.islands): string[] | undefined {
    const next = packs.filter((p) => !KERNEL_PACKS.includes(p));
    const newly = next.filter((p) => !this.turnedOff.includes(p));
    // a pack kept as an item is on once the owner adds it (it is not in the list), and off while it is new to this registry.
    const madeOn = new Set([...this.made.keys()].filter((p) => !next.includes(p))); const sameMade = madeOn.size === this.madeOn.size && [...madeOn].every((p) => this.madeOn.has(p));
    if (!newly.length && next.length === this.turnedOff.length && islands === this.islands && sameMade) return undefined;
    this.turnedOff = next; this.islands = islands; this.madeOn = madeOn;
    this.reload();
    return newly;
  }

  /** The starter types: those that extend nothing, in the packs' order (core's eight first). */
  starters(): ResolvedType[] {
    return [...this.types.values()].filter((t) => t.starter === t.id);
  }

  /** A relation and every relation extending it: what the kernel computes from a root holds for all of them. */
  relationFamily(...roots: string[]): string[] {
    const family = (id: string): string[] => [id, ...[...this.relations.values()].filter((r) => r.extends === id).flatMap((r) => family(r.id))];
    return roots.map(this.canonical).flatMap(family);
  }

  /** Whether a type is the ancestor or a flavour of it; given a capability end (has:owned), whether it declares that capability. */
  isA(typeId: string, ancestor: string): boolean {
    return ancestor !== '*' && holds(capabilityOf(ancestor) ? ancestor : this.canonical(ancestor), this.types.get(this.canonical(typeId)));
  }

  /** What a picture says a thing is: its type nearest the starter (root) and its starter. */
  ancestry(typeId: string): { root: string; starter: string } {
    const type = this.types.get(typeId);
    return { root: type?.base ?? typeId, starter: type?.starter ?? typeId };
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

  /** The type and every flavour of it; for a capability end (has:owned), every type that declares it. */
  family(typeId: string): string[] {
    return [...this.types.values()].filter((t) => this.isA(t.id, typeId)).map((t) => t.id);
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
    if (fits(rel.from, fromType) && fits(rel.to, toType)) return undefined;
    // What does join these two, so the refusal says what to use instead.
    const instead = [...this.relations.values()].filter((r) => !r.dormant && !r.retired && fits(r.from, fromType) && fits(r.to, toType)).map((r) => r.id);
    const use = instead.length ? `; from ${fromType} to ${toType}, use ${instead.slice(0, 6).join(', ')}` : '';
    if (!fits(rel.from, fromType)) return `"${relId}" must start from ${rel.from.join(' or ')}, not ${fromType}${use}`;
    return `"${relId}" must point to ${rel.to.join(' or ')}, not ${toType}${use}`;
  }

  /** Problems with a proposed new type. Empty means it can be defined. */
  checkNewType(def: TypeDef): string[] {
    const problems: string[] = [];
    if (!/^local\.[a-z][a-z0-9_]*$/.test(def.id)) problems.push(`new type id must look like "local.my_type", got "${def.id}"`);
    if (this.types.has(def.id)) problems.push(`type "${def.id}" already exists`);
    const starters = this.starters().filter((t) => !t.system && !t.dormant).map((t) => t.id).join(', ');
    if (!def.extends) problems.push(`a new type extends one of the starter types (${starters}) or a type of one`);
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
  /** The folder a pack's files are in: where it was found, or the first folder for one not found. */
  folderOf(pack: string): string { return join(this.where.get(pack) ?? this.dir, pack); }
  /** A registry like this one with these type items in place of its own: what a change that makes or changes one is checked against. */
  trial(items: TypeItem[], on: string[] = [], swap?: PackVersion): Registry { const r = new Registry(this.given ?? this.dirs, this.only, this.local); r.swap = swap; r.turnedOff = this.turnedOff.filter((p) => !on.includes(p)); r.madeOn = new Set([...this.madeOn, ...on]); r.islands = this.islands; r.kept = this.kept; r.takeItems(items); return r; }
  /** Take up the types defined here by another server on the same database. Returns whether any were new. */
  followLocal(defs: TypeDef[]): boolean {
    const added = defs.filter((t) => !this.local.some((l) => l.id === t.id));
    if (!added.length) return false;
    this.local = [...this.local, ...added];
    this.reload();
    return true;
  }

  describe() {
    const kernel = sharedOf(this.packs.filter((p) => KERNEL_PACKS.includes(p.id))), shared = { ...kernel, actors: actorsOf(this.packs, kernel.actors) };
    return { // each pack with its kind (src/islands.ts): an island pack speaks on an island, a map pack brings the rest to the whole map
      packs: this.packs.map((p) => ({ id: p.id, version: p.version, title: p.title, description: p.description, kind: packKind(p, shared) })),
      // The head every item has; status, owner, confidence and source are each type's columns, as its starter declares them.
      common_fields: { title: 'Required. A short name.', body: 'Free-form markdown detail.', visibility: 'private (default) or shared.' },
      types: [...this.types.values()].map((t) => ({
        id: t.id,
        pack: t.pack,
        title: t.title,
        description: t.description,
        flavour_of: t.lineage[1],
        starter: t.starter,
        statuses: t.statuses,
        fields: t.fields,
        columns: t.columns,
        ...(t.deliverable && { deliverable: true }), ...(t.altitude && { altitude: t.altitude }),
        ...(t.public && { public: true }), ...(t.system && { system: true }),
        ...(t.belongs_with && { belongs_with: t.belongs_with }),
        ...(Object.keys(t.capabilities).length && { capabilities: t.capabilities }),
        ...(t.dormant && { dormant: true }), ...(t.retired && { retired: true }),
      })),
      relations: [...this.relations.values()],
      trees: [...this.trees.values()],
      verbs: this.verbs.map((v) => ({ ...v, kernel_tools: Object.keys(KERNEL_VERBS).filter((t) => KERNEL_VERBS[t] === v.id) })),
      pack_tools: [...this.tools].map(([tool, { pack, call, def }]) => ({ tool, pack, [call]: def.id, ...('verb' in def ? { verb: def.verb, title: def.title, on: def.on, item: def.item, input: def.input } : { shape: def.shape }) })),
      screens: screensOf(this.packs), styles: stylesOf(this.packs), canvases: presetsOf(this.packs, 'lens'), shapes: this.packs.flatMap((p) => (p.layouts ?? []).map((d) => ({ shape: d.shape, title: d.title }))),
    };
  }
}
