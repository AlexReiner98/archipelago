// Types kept as items on the map ("Where do types live?", decided 27 Oct 2026). As a style is how things look, a type
// is what an item is: a pack ships its types and link types as presets, and an item of core's `type` or `link_type`
// with a preset's id (preset) is the owner's version of it, laid over the pack's manifest before the registry reads
// it: its title and note over the preset's, its fields added, and retired, no new item or link made of it. One with a
// name and no preset is the workspace's own, in the local pack. The registry checks the result as it checks any pack;
// what reads the items from the map is packs/loader/kernel/type-items.ts.

import { CELL, CELL_FIELD, CORNER, CORNER_FIELD, FOCUS, FOCUS_FIELD, ISLAND, ISLAND_FIELD, livesOnIsland, mayBeFocus, PACKS_OFF, PACKS_OFF_FIELD } from './island-items.ts';
import type { FieldDef, PackFile, RelationDef, ResolvedType, TypeDef } from './packs.ts';

export const TYPE_ITEM = 'type';
export const LINK_ITEM = 'link_type';

/** An item of `type` or `link_type`, as the registry reads it. */
export interface TypeItem {
  id: string;
  type: string;
  title: string;
  body: string;
  is_open: boolean;
  props: Record<string, unknown>;
}

const text = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : undefined);
const list = (v: unknown) => (Array.isArray(v) && v.length ? v.map(String) : undefined);
const record = <T>(v: unknown) => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, T>) : undefined);
// Neither has flavours: the system kind is the kernel's own.
const isLink = (item: TypeItem) => item.type === LINK_ITEM;

/** The owner's version laid over a pack's type: title, description and fields, and whether it is retired. */
function overType(def: TypeDef, item: TypeItem): TypeDef {
  const fields = record<FieldDef>(item.props.fields);
  return { ...def, title: text(item.title) ?? def.title, description: text(item.body) ?? def.description, ...(fields && { fields: { ...def.fields, ...fields } }), ...(!item.is_open && { retired: true }) };
}

function overLink(def: RelationDef, item: TypeItem): RelationDef {
  return { ...def, title: text(item.title) ?? def.title, description: text(item.body) ?? def.description, ...(!item.is_open && { retired: true }) };
}

/** Each pack with the owner's versions of its types and link types over its own. A version of what no pack declares is left out. */
export function withVersions(packs: PackFile[], items: TypeItem[]): PackFile[] {
  const versions = new Map(items.filter((i) => text(i.props.preset)).map((i) => [`${isLink(i) ? 'link' : 'type'}:${text(i.props.preset)}`, i]));
  if (!versions.size) return packs;
  return packs.map((pack) => {
    const types = pack.types?.map((t) => ('id' in t && versions.has(`type:${t.id}`) ? overType(t as TypeDef, versions.get(`type:${t.id}`)!) : t));
    const links = pack.links?.map((r) => (versions.has(`link:${r.id}`) ? overLink(r, versions.get(`link:${r.id}`)!) : r));
    return { ...pack, ...(types && { types }), ...(links && { links }) } as PackFile;
  });
}

/** The workspace's own types and link types (a name, no preset) as the pack `id`, with those defined before types were items. */
export function ownPack(before: PackFile | undefined, items: TypeItem[], id: string): PackFile | undefined {
  const own = items.filter((i) => (i.type === TYPE_ITEM || isLink(i)) && text(i.props.name) && !text(i.props.preset));
  if (!own.length) return before;
  const types: TypeDef[] = own.filter((i) => !isLink(i)).map((i) => ({
    id: text(i.props.name)!, title: i.title, description: text(i.body) ?? i.title, ...(text(i.props.extends) && { extends: text(i.props.extends) }),
    ...(record(i.props.fields) && { fields: record<FieldDef>(i.props.fields) }), ...(record(i.props.statuses) && { statuses: i.props.statuses as TypeDef['statuses'] }), ...(i.props.deliverable === true && { deliverable: true }), ...(!i.is_open && { retired: true }),
  }));
  const links: RelationDef[] = own.filter(isLink).map((i) => ({
    id: text(i.props.name)!, title: i.title, description: text(i.body) ?? i.title, inverse: text(i.props.inverse) ?? i.title,
    ...(text(i.props.extends) && { extends: text(i.props.extends) }), from: list(i.props.from) ?? ['*'], to: list(i.props.to) ?? ['*'], ...(!i.is_open && { retired: true }),
  }));
  const base = before ?? { id, version: '0.1.0', title: 'Local', description: 'Types defined in this workspace.' };
  return { ...base, types: [...(base.types ?? []), ...types], links: [...(base.links ?? []), ...links] } as PackFile;
}

/**
 * A type's fields as they are laid over it wherever it is written: its own, its columns, and those the islands lay
 * over a type that lives on one (island, cell; a focus's corner and packs_off), whether islands are on yet or not. A
 * rule names a field by these (packs/loader/kernel/rule-check.ts): a registry is first loaded before it knows the map
 * has islands, so a rule on island must hold then too (e_t2tcbw2t). Where islands are off no item has the field.
 */
export function fieldsAsLaidOver(t: Pick<ResolvedType, 'fields' | 'columns' | 'system' | 'lineage' | 'capabilities'>): Record<string, FieldDef> {
  const lives = livesOnIsland(t) || Boolean(t.capabilities?.subject);
  return { ...t.columns, ...t.fields, ...(lives && { [ISLAND]: ISLAND_FIELD, [CELL]: CELL_FIELD, ...(mayBeFocus(t) && { [FOCUS]: FOCUS_FIELD, [CORNER]: CORNER_FIELD, [PACKS_OFF]: PACKS_OFF_FIELD }) }) };
}
