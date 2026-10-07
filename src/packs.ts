// Packs: versioned bundles of types and relation types, stored as files.
// A type may extend another (a "flavour"); it inherits the parent's fields and
// statuses, and anything that queries the parent also sees its flavours.

import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export type FieldType = 'string' | 'number' | 'boolean' | 'date' | 'datetime' | 'url' | 'enum' | 'json';

export interface FieldDef {
  type: FieldType;
  values?: string[];
  description?: string;
  default?: unknown;
  /** Maintained by the system; shown but not offered for editing. */
  system?: boolean;
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
  statuses?: Statuses;
  fields?: Record<string, FieldDef>;
}

export interface RelationDef {
  id: string;
  title: string;
  inverse: string;
  from: string[];
  to: string[];
  description: string;
}

export interface PackFile {
  id: string;
  version: string;
  title: string;
  description?: string;
  requires?: string[];
  types?: TypeDef[];
  relations?: RelationDef[];
  /** Extra fields a pack adds to types owned by another pack. */
  extend?: Record<string, { fields: Record<string, FieldDef> }>;
}

export interface ResolvedType {
  id: string;
  pack: string;
  title: string;
  description: string;
  /** This type first, then each ancestor. */
  lineage: string[];
  statuses: Statuses;
  fields: Record<string, FieldDef>;
}

/** The pack that approved type proposals are written to. */
export const LOCAL_PACK = 'local';

export class Registry {
  readonly dir: string;
  readonly only: string[] | undefined;
  /** Where this workspace's own types are kept, when not beside the shared packs. */
  readonly localDir: string | undefined;
  packs: PackFile[] = [];
  types = new Map<string, ResolvedType>();
  relations = new Map<string, RelationDef & { pack: string }>();

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
      if (this.only && !this.only.includes(pack.id) && pack.id !== 'core') continue;
      found.set(pack.id, pack);
    }
    if (!found.has('core')) throw new Error(`No core pack in ${this.dir}`);

    // Load in dependency order.
    const ordered: PackFile[] = [];
    const visit = (pack: PackFile, trail: string[]) => {
      if (ordered.includes(pack)) return;
      if (trail.includes(pack.id)) throw new Error(`Pack dependency cycle: ${[...trail, pack.id].join(' -> ')}`);
      for (const dep of pack.requires ?? []) {
        const required = found.get(dep);
        if (!required) throw new Error(`Pack "${pack.id}" requires "${dep}", which is not enabled`);
        visit(required, [...trail, pack.id]);
      }
      ordered.push(pack);
    };
    visit(found.get('core')!, []);
    for (const pack of [...found.values()].sort((a, b) => a.id.localeCompare(b.id))) visit(pack, []);

    const raw = new Map<string, TypeDef & { pack: string }>();
    const relations = new Map<string, RelationDef & { pack: string }>();
    const owned = (pack: PackFile, id: string) => pack.id === 'core' || id.startsWith(pack.id + '.');
    for (const pack of ordered) {
      for (const type of pack.types ?? []) {
        if (!owned(pack, type.id)) throw new Error(`Type "${type.id}" in pack "${pack.id}" must be named "${pack.id}.<name>"`);
        if (raw.has(type.id)) throw new Error(`Type "${type.id}" is defined twice`);
        raw.set(type.id, { ...type, pack: pack.id });
      }
      for (const rel of pack.relations ?? []) {
        if (!owned(pack, rel.id)) throw new Error(`Relation "${rel.id}" in pack "${pack.id}" must be named "${pack.id}.<name>"`);
        if (relations.has(rel.id)) throw new Error(`Relation "${rel.id}" is defined twice`);
        relations.set(rel.id, { ...rel, pack: pack.id });
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
      const statuses = def.statuses ?? parent?.statuses;
      if (!statuses?.open.length) throw new Error(`Type "${id}" needs at least one open status`);
      const resolved: ResolvedType = {
        id,
        pack: def.pack,
        title: def.title,
        description: def.description,
        lineage: [id, ...(parent?.lineage ?? [])],
        statuses,
        fields: { ...parent?.fields, ...def.fields, ...extra.get(id) },
      };
      types.set(id, resolved);
      return resolved;
    };
    for (const id of raw.keys()) resolve(id, []);

    for (const rel of relations.values()) {
      for (const end of [...rel.from, ...rel.to]) {
        if (end !== '*' && !types.has(end)) throw new Error(`Relation "${rel.id}" refers to unknown type "${end}"`);
      }
    }

    this.packs = ordered;
    this.types = types;
    this.relations = relations;
  }

  type(id: string): ResolvedType | undefined {
    return this.types.get(id);
  }

  isA(typeId: string, ancestor: string): boolean {
    return this.types.get(typeId)?.lineage.includes(ancestor) ?? false;
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
        problems.push(`${typeId} has no field "${key}" (fields: ${known}). Put free-form detail in body.`);
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
    if (def.extends && !this.types.has(def.extends)) problems.push(`cannot extend unknown type "${def.extends}"`);
    if (!def.extends && !def.statuses?.open.length) problems.push('a type that extends nothing needs statuses with at least one open status');
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
        statuses: t.statuses,
        fields: t.fields,
      })),
      relations: [...this.relations.values()],
    };
  }
}

function checkValue(field: FieldDef, value: unknown): string | undefined {
  switch (field.type) {
    case 'string':
      return typeof value === 'string' ? undefined : 'must be a string';
    case 'number':
      return typeof value === 'number' && Number.isFinite(value) ? undefined : 'must be a number';
    case 'boolean':
      return typeof value === 'boolean' ? undefined : 'must be true or false';
    case 'date':
      return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(value))
        ? undefined
        : 'must be a date like 2026-10-07';
    case 'datetime':
      return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(value) && !Number.isNaN(Date.parse(value))
        ? undefined
        : 'must be an ISO date-time like 2026-10-07T14:00:00Z';
    case 'url':
      return typeof value === 'string' && URL.canParse(value) ? undefined : 'must be a URL';
    case 'enum':
      return typeof value === 'string' && (field.values ?? []).includes(value)
        ? undefined
        : `must be one of: ${(field.values ?? []).join(', ')}`;
    case 'json':
      return undefined;
  }
}
