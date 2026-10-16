// A field's value checked against its definition: what a pack file says a field holds.

import type { FieldDef } from './packs.ts';

/** What is wrong with a value for a field, or nothing. */
export function checkValue(field: FieldDef, value: unknown): string | undefined {
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
