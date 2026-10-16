// Packs: versioned bundles of types and relation types, stored as files.
// A type may extend another (a "flavour"); it inherits the parent's fields and
// statuses, and anything that queries the parent also sees its flavours.

import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { capacityOf, checkCapabilities, type Capabilities } from './capabilities.ts';
import { checkDeclared, KERNEL_VERBS, toolName, type ActionDef, type HostDef, type ScheduleDef, type VerbDef, type ViewDef, type WebhookDef } from './declared.ts';
import { checkValue } from './fields.ts';
import { orderPacks, KERNEL_PACKS, type PackState } from './packorder.ts';
import { PACK_TOOLS } from './pack-tools.ts';
import { checkRules, type RuleDef } from './rules.ts';

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
  /** One of the seven kinds every other type extends. Only the core pack declares them. */
  kind?: boolean;
  /** The kernel's own types (a run, a lens), outside the kinds. Only the kernel's packs declare them. */
  tier?: 'system';
  statuses?: Statuses;
  fields?: Record<string, FieldDef>;
  /** What is made for a reader or a customer (a document, a file, a release): named under the title of what it is part of. A flavour inherits it. */
  deliverable?: boolean;
  /** What the kernel computes from it, each naming the field it reads. A flavour inherits them. */
  capabilities?: Capabilities;
}

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
  description: string;
}

/**
 * A tree a pack declares over "is part of": a roadmap, for one. The `tree`
 * view reads it; nothing here is code.
 */
export interface TreeDef {
  id: string;
  title: string;
  description: string;
  /** Types a tree can start from. */
  roots: string[];
  /** Types that make up the tree's levels. */
  branches: string[];
  /** Types counted as the work under a branch: progress is how much of it is closed. */
  work: string[];
  /** The number field that orders branches among their siblings. */
  order: string;
  /** Statuses that mean someone is on it now. */
  active: string[];
}

export interface PackFile {
  id: string;
  version: string;
  title: string;
  description?: string;
  requires?: string[];
  types?: TypeDef[];
  relations?: RelationDef[];
  trees?: TreeDef[];
  /** What tightens writes to the map: holds, refusals, required fields, unique values. */
  rules?: RuleDef[];
  /** The kernel's six verbs, declared by the core pack. */
  verbs?: VerbDef[];
  /** What agents and people can do and read through it, run by its handler. */
  actions?: ActionDef[];
  views?: ViewDef[];
  /** What comes from and goes to the world outside: hosts it may reach, webhooks it receives, what it runs by itself. */
  hosts?: HostDef[];
  webhooks?: WebhookDef[];
  schedules?: ScheduleDef[];
  /** Extra fields a pack adds to types owned by another pack. */
  extend?: Record<string, { fields: Record<string, FieldDef> }>;
}

export interface ResolvedType {
  id: string;
  pack: string;
  title: string;
  description: string;
  /** This type first, then each ancestor, its kind last. */
  lineage: string[];
  /** The kind it falls back to: the last of its lineage. None for the system tier. */
  kind: string | undefined;
  /** The type nearest its kind: what it is, said without the kind (task for an experiment). */
  base: string;
  system: boolean;
  statuses: Statuses;
  fields: Record<string, FieldDef>;
  deliverable: boolean;
  capabilities: Capabilities;
  /** Kept from the type table: its pack is gone, its items are not. */
  dormant?: boolean;
}

/** A relation as loaded: `root` names the root it extends (itself, for a root). */
export type ResolvedRelation = Omit<RelationDef, 'root'> & { pack: string; root: string; dormant?: boolean };

/** The pack that approved type proposals are written to. */
export const LOCAL_PACK = 'local';

export class Registry {
  readonly dir: string;
  readonly only: string[] | undefined;
  /** Where this workspace's own types are kept, when not beside the shared packs. */
  readonly localDir: string | undefined;
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
  /** Packs the owner turned off in this workspace. */
  private turnedOff: string[] = [];
  /** Definitions kept from the type table whose packs are gone, put back after every reload. */
  private kept: { types: ResolvedType[]; relations: ResolvedRelation[] } = { types: [], relations: [] };

  constructor(dir: string, only?: string[], localDir?: string) {
    this.dir = dir;
    this.only = only;
    this.localDir = localDir;
    this.reload();
  }

  reload(): void {
    const found = new Map<string, PackFile>();
    // With its own local folder, a workspace must not pick up the types
    // another workspace defined in the shared one.
    const folders = readdirSync(this.dir)
      .filter((name) => !(this.localDir && name === LOCAL_PACK))
      .map((name) => [name, join(this.dir, name, 'pack.json')]);
    if (this.localDir) folders.push([LOCAL_PACK, join(this.localDir, 'pack.json')]);
    for (const [name, file] of folders) {
      if (!existsSync(file)) continue;
      const pack = JSON.parse(readFileSync(file, 'utf8')) as PackFile;
      if (pack.id !== name) throw new Error(`Pack folder "${name}" contains pack id "${pack.id}"`);
      found.set(pack.id, pack);
    }
    if (!found.has('core')) throw new Error(`No core pack in ${this.dir}`);

    // Load in dependency order what is on and has what it requires; the rest waits or is off.
    const off = new Map([...found.keys()].filter((id) => this.only && !this.only.includes(id) && id !== LOCAL_PACK).map((id) => [id, 'not enabled on this server']));
    for (const id of this.turnedOff) off.set(id, 'turned off here');
    const { ordered, states } = orderPacks(found, off, LOCAL_PACK);

    const raw = new Map<string, TypeDef & { pack: string }>();
    const relations = new Map<string, ResolvedRelation>();
    const declared = new Map<string, RelationDef>();
    const owned = (pack: PackFile, id: string) => pack.id === 'core' || id.startsWith(pack.id + '.');
    for (const pack of ordered) {
      for (const type of pack.types ?? []) {
        if (!owned(pack, type.id)) throw new Error(`Type "${type.id}" in pack "${pack.id}" must be named "${pack.id}.<name>"`);
        if (raw.has(type.id)) throw new Error(`Type "${type.id}" is defined twice`);
        if (type.kind && pack.id !== 'core') throw new Error(`Type "${type.id}": only the core pack declares kinds`);
        if (type.tier && !KERNEL_PACKS.includes(pack.id)) throw new Error(`Type "${type.id}": only the kernel's packs declare the system tier`);
        raw.set(type.id, { ...type, pack: pack.id });
      }
      for (const rel of pack.relations ?? []) {
        if (!owned(pack, rel.id)) throw new Error(`Relation "${rel.id}" in pack "${pack.id}" must be named "${pack.id}.<name>"`);
        if (relations.has(rel.id)) throw new Error(`Relation "${rel.id}" is defined twice`);
        if (rel.root && pack.id !== 'core') throw new Error(`Relation "${rel.id}": only the core pack declares root relations`);
        declared.set(rel.id, rel);
        relations.set(rel.id, { ...rel, pack: pack.id, root: rel.id });
      }
    }
    const extra = new Map<string, Record<string, FieldDef>>();
    for (const pack of ordered) {
      for (const [typeId, ext] of Object.entries(pack.extend ?? {})) {
        if (!raw.has(typeId)) throw new Error(`Pack "${pack.id}" extends unknown type "${typeId}"`);
        extra.set(typeId, { ...extra.get(typeId), ...ext.fields });
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
      if (def.extends && (def.kind || def.tier)) throw new Error(`Type "${id}" is a ${def.kind ? 'kind' : 'system type'} and extends nothing`);
      if (parent?.system) throw new Error(`Type "${id}" cannot extend "${parent.id}", which is the kernel's own`);
      const kind = def.kind ? id : parent?.kind;
      // Every shipped type has a kind; a workspace's own may predate the kinds.
      if (!kind && !def.tier && def.pack !== LOCAL_PACK) throw new Error(`Type "${id}" in pack "${def.pack}" must extend one of the kinds: ${[...raw.values()].filter((t) => t.kind).map((t) => t.id).join(', ')}`);
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
        system: def.tier === 'system',
        statuses,
        fields: { ...parent?.fields, ...def.fields, ...extra.get(id) },
        deliverable: def.deliverable ?? parent?.deliverable ?? false,
        capabilities: { ...parent?.capabilities, ...def.capabilities },
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
      const parent = rel.extends ? declared.get(rel.extends) : undefined;
      if (!parent) throw new Error(`Relation "${rel.id}" must extend one of the root relations${rel.extends ? `, not unknown "${rel.extends}"` : ''}`);
      for (const [side, ends] of [['from', rel.from], ['to', rel.to]] as const) {
        const bad = ends.find((end) => !fits(parent[side], end));
        if (bad) throw new Error(`Relation "${rel.id}" goes ${side} ${bad}, which "${parent.id}" does not`);
      }
      return rootOf(parent, [...trail, rel.id]);
    };
    for (const rel of relations.values()) rel.root = rootOf(declared.get(rel.id)!, []);

    for (const type of types.values()) {
      const problems = checkCapabilities(type.capabilities, type.fields, new Set(relations.keys()));
      if (problems.length) throw new Error(`Type "${type.id}" in pack "${type.pack}": ${problems.join('; ')}`);
    }

    const trees = new Map<string, TreeDef & { pack: string }>();
    for (const pack of ordered) {
      for (const tree of pack.trees ?? []) {
        if (!owned(pack, tree.id)) throw new Error(`Tree "${tree.id}" in pack "${pack.id}" must be named "${pack.id}.<name>"`);
        for (const kind of [...tree.roots, ...tree.branches, ...tree.work]) {
          if (!types.has(kind)) throw new Error(`Tree "${tree.id}" refers to unknown type "${kind}"`);
        }
        trees.set(tree.id, { ...tree, pack: pack.id });
      }
    }

    const verbs = ordered.flatMap((pack) => pack.verbs ?? []);
    const tools = new Map<string, { pack: string; call: 'action' | 'view'; def: ActionDef | ViewDef }>();
    for (const pack of ordered) {
      const folder = pack.id === LOCAL_PACK && this.localDir ? this.localDir : join(this.dir, pack.id);
      const declared = checkDeclared(pack, types, verbs.map((v) => v.id), existsSync(join(folder, 'handler.js')));
      if (declared.length) throw new Error(`Pack "${pack.id}": ${declared.join('; ')}`);
      for (const def of pack.actions ?? []) tools.set(toolName(def.id), { pack: pack.id, call: 'action', def });
      for (const def of pack.views ?? []) tools.set(toolName(def.id), { pack: pack.id, call: 'view', def });
      const problems = checkRules(pack.rules ?? [], { types });
      if (problems.length) throw new Error(`Pack "${pack.id}": ${problems.join('; ')}`);
    }

    this.packs = ordered;
    this.states = states;
    this.found = [...found.values()];
    this.rules = ordered.flatMap((pack) => (pack.rules ?? []).map((rule) => ({ ...rule, pack: pack.id })));
    this.types = types;
    this.relations = relations;
    this.trees = trees;
    this.verbs = verbs;
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

  type(id: string): ResolvedType | undefined {
    return this.types.get(id);
  }

  /** Turn packs off in this workspace (the rest on), and load again. The kernel's packs stay on. */
  turnOff(packs: string[]): void {
    this.turnedOff = packs.filter((p) => !KERNEL_PACKS.includes(p));
    this.reload();
  }

  /** The seven kinds, in the core pack's order. */
  kinds(): ResolvedType[] {
    return [...this.types.values()].filter((t) => t.kind === t.id);
  }

  /** A relation and every relation extending it: what the kernel computes from a root holds for all of them. */
  relationFamily(...roots: string[]): string[] {
    const family = (id: string): string[] => [id, ...[...this.relations.values()].filter((r) => r.extends === id).flatMap((r) => family(r.id))];
    return roots.flatMap(family);
  }

  isA(typeId: string, ancestor: string): boolean {
    return this.types.get(typeId)?.lineage.includes(ancestor) ?? false;
  }

  /** What a picture says a thing is: its type nearest the kind (root) and its kind, or null in the system tier. */
  ancestry(typeId: string): { root: string; kind: string | null } {
    const type = this.types.get(typeId);
    return { root: type?.base ?? typeId, kind: type?.kind ?? null };
  }

  /** How many may hold an item at once: Infinity for any number, undefined when it cannot be held. */
  capacity(item: { type: string; props: Record<string, unknown> }): number | undefined {
    return capacityOf(this.types.get(item.type)?.capabilities, item.props);
  }

  /** Whether a tool is offered: one that is a pack's only while that pack is loaded. */
  offers(tool: string): boolean {
    return Object.entries(PACK_TOOLS).every(([pack, tools]) => !tools.includes(tool) || this.packs.some((p) => p.id === pack));
  }

  /** Every type that has this capability, its own or its parent's. */
  having(capability: keyof Capabilities): string[] {
    return [...this.types.values()].filter((t) => t.capabilities[capability] !== undefined).map((t) => t.id);
  }

  /** The type and every flavour of it. */
  family(typeId: string): string[] {
    return [...this.types.values()].filter((t) => t.lineage.includes(typeId)).map((t) => t.id);
  }

  isOpen(typeId: string, status: string): boolean {
    return this.types.get(typeId)?.statuses.open.includes(status) ?? true;
  }

  /** Problems with a status and props for a type. Empty means valid. */
  check(typeId: string, status: string | undefined, props: Record<string, unknown>): string[] {
    const type = this.types.get(typeId);
    if (!type) return [`unknown type "${typeId}". Known types: ${[...this.types.keys()].join(', ')}`];
    const problems: string[] = [];
    const statuses = [...type.statuses.open, ...type.statuses.closed];
    if (status !== undefined && !statuses.includes(status)) {
      problems.push(`status "${status}" is not valid for ${typeId}. Use one of: ${statuses.join(', ')}`);
    }
    for (const [key, value] of Object.entries(props)) {
      const field = type.fields[key];
      if (!field) {
        const known = Object.keys(type.fields).join(', ') || 'none';
        // The field may be one a flavour of the type has: an issue has no "repro", a software.bug does.
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
    if (!rel) return `unknown relation "${relId}". Known relations: ${[...this.relations.keys()].join(', ')}`;
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
    const kinds = this.kinds().map((t) => t.id).join(', ');
    if (!def.extends) problems.push(`a new type extends one of the kinds (${kinds}) or a type of one`);
    else if (!this.types.has(def.extends)) problems.push(`cannot extend unknown type "${def.extends}"`);
    else if (this.types.get(def.extends)!.system) problems.push(`cannot extend "${def.extends}", which is the kernel's own`);
    return problems;
  }

  /** Add a type to the local pack file and reload. */
  defineLocal(def: TypeDef): void {
    const dir = this.localDir ?? join(this.dir, LOCAL_PACK);
    const file = join(dir, 'pack.json');
    const pack: PackFile = existsSync(file)
      ? JSON.parse(readFileSync(file, 'utf8'))
      : {
          id: LOCAL_PACK,
          version: '0.1.0',
          title: 'Local',
          description: 'Types defined in this workspace.',
          requires: this.packs.map((p) => p.id).filter((id) => id !== LOCAL_PACK),
          types: [],
        };
    pack.types = [...(pack.types ?? []), def];
    mkdirSync(dir, { recursive: true });
    const before = existsSync(file) ? readFileSync(file, 'utf8') : undefined;
    writeFileSync(file, JSON.stringify(pack, null, 2) + '\n');
    try {
      this.reload();
    } catch (err) {
      if (before === undefined) writeFileSync(file, JSON.stringify({ ...pack, types: [] }, null, 2) + '\n');
      else writeFileSync(file, before);
      this.reload();
      throw err;
    }
  }

  describe() {
    return {
      packs: this.packs.map((p) => ({ id: p.id, version: p.version, title: p.title, description: p.description })),
      common_fields: {
        title: 'Required. A short name.',
        body: 'Free-form markdown detail.',
        status: 'One of the type\'s statuses. Open statuses mean unfinished.',
        owner: 'Id of the person or agent responsible.',
        visibility: 'private (default) or shared.',
        confidence: '0 to 1. How sure the author is that this is true.',
      },
      types: [...this.types.values()].map((t) => ({
        id: t.id,
        pack: t.pack,
        title: t.title,
        description: t.description,
        flavour_of: t.lineage[1],
        kind: t.kind,
        statuses: t.statuses,
        fields: t.fields,
        ...(t.deliverable && { deliverable: true }),
        ...(Object.keys(t.capabilities).length && { capabilities: t.capabilities }),
        ...(t.dormant && { dormant: true }),
      })),
      relations: [...this.relations.values()],
      trees: [...this.trees.values()],
      verbs: this.verbs.map((v) => ({ ...v, kernel_tools: Object.keys(KERNEL_VERBS).filter((t) => KERNEL_VERBS[t] === v.id) })),
      pack_tools: [...this.tools].map(([tool, { pack, call, def }]) => ({ tool, pack, [call]: def.id, ...('verb' in def && { verb: def.verb }) })),
    };
  }
}
