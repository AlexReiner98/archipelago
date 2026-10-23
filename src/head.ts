// An item is a small head and its fields (Rule 3 of the model). The head is what the store needs to hold any item:
// id, kind, type, title, body, visibility, and when it was made, changed and archived. Everything else is a field its
// kind or type declares, checked on write.
//
// Four of those fields are kept in columns of their own, not in props: status (with is_open, which the store keeps
// beside it), owner, confidence and source. The store indexes them, row-level security and the foreign keys read
// them, and the app before this one reads them during a switch (src/migrate.ts). They are fields all the same: a kind
// declares them in the core pack ("column": true), a flavour inherits them, and a write that sets one its type does
// not declare is refused like any other undeclared field.

import type { FieldDef, ResolvedType, TypeDef } from './packs.ts';

/** The kind of the app's own configuration (views, styles, screens, runs), which views of the work leave out. */
export const SYSTEM = 'system';

/** The head: what every item has, whatever its kind. */
export const HEAD = ['id', 'kind', 'type', 'title', 'body', 'visibility', 'created_at', 'updated_at', 'archived_at'] as const;

/** The fields a kind may keep in a column of the item's row, each with its column. */
export const COLUMNS = { status: 'status', owner: 'owner', confidence: 'confidence', source: 'source_id' } as const;
export type ColumnField = keyof typeof COLUMNS;
const columnNames = Object.keys(COLUMNS) as ColumnField[];

/** How long a field's value may be, as JSON, unless the field is declared large: only a system item holds more. */
export const LARGE = 4000;

/** The size of a value as it is stored. */
export const sizeOf = (value: unknown) => JSON.stringify(value)?.length ?? 0;

/**
 * A type's fields split into those kept in props and those kept in columns. A column field's values, for status,
 * are the type's statuses.
 */
export function headOf(merged: Record<string, FieldDef>, statuses: { open: string[]; closed: string[] }): { fields: Record<string, FieldDef>; columns: Partial<Record<ColumnField, FieldDef>> } {
  const fields: Record<string, FieldDef> = {};
  const columns: Partial<Record<ColumnField, FieldDef>> = {};
  for (const [name, field] of Object.entries(merged)) {
    if (!field.column) fields[name] = field;
    else columns[name as ColumnField] = name === 'status' ? { ...field, type: 'enum', values: [...statuses.open, ...statuses.closed] } : field;
  }
  return { fields, columns };
}

/** What is wrong with the fields a type declares: a column only on a kind and of the four, large only on the system kind. */
export function checkFieldDecls(type: ResolvedType, def: TypeDef | undefined, extra: Record<string, FieldDef> = {}): string[] {
  const problems: string[] = [];
  for (const [name, field] of Object.entries({ ...def?.fields, ...extra })) {
    const isColumn = (columnNames as string[]).includes(name);
    if (field.column && !isColumn) problems.push(`field "${name}" cannot be kept in a column: only ${columnNames.join(', ')} are`);
    else if (isColumn && !(def?.kind && field.column && !extra[name])) problems.push(`field "${name}" is one a kind declares, kept in the item's row`);
    if (field.large && !type.system) problems.push(`field "${name}" is declared large, which only a type of the system kind may be`);
  }
  if (def?.kind && !type.columns.status) problems.push('a kind declares the status field ("column": true)');
  return problems;
}

/** The column fields an op sets that its type does not declare. A type kept from before the kinds declared them has them all. */
export function undeclaredColumns(type: ResolvedType | undefined, op: Partial<Record<ColumnField, unknown>>): string[] {
  if (!type?.columns) return [];
  return columnNames.filter((name) => op[name] !== undefined && op[name] !== null && !type.columns[name]).map((name) => `${type.id} has no field "${name}" (its kind, ${type.kind}, declares none)`);
}

/**
 * Step 15 (src/migrate.ts): the kind as a column of the item's row. The app writes it with the item; the database
 * fills it from the type table for a row written without one (the app before this one, a backup restored) or whose
 * type changes; rows made before the column are filled when the workspace opens (fillKinds, in src/pelago.ts).
 */
export const ITEM_KIND = `
alter table entity add column if not exists kind text;
create index if not exists entity_kind on entity(kind);
create or replace function pelago_entity_kind() returns trigger language plpgsql security definer set search_path = public as $fn$
begin
  if new.kind is null or (tg_op = 'UPDATE' and new.type is distinct from old.type) then
    new.kind := coalesce((select def->>'kind' from type_def where id = new.type), new.kind);
  end if;
  return new;
end $fn$;
drop trigger if exists entity_kind on entity;
create trigger entity_kind before insert or update on entity for each row execute function pelago_entity_kind();
grant select (kind) on entity to pelago_public;
`;
