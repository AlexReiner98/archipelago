// A field's value checked against its definition: what a pack file says a field holds.

import type { FieldDef } from './packs.ts';
import { cssProblem } from '../../walls/kernel/css-check.ts';
import { LARGE, sizeOf } from './head.ts';

/** What is wrong with a value for a field, or nothing. */
export function checkValue(field: FieldDef, value: unknown): string | undefined {
  // A large value (code, a stylesheet, a story) is a system item's, in a field declared large: never the work's.
  if (!field.large && sizeOf(value) > LARGE) return `is too large (${sizeOf(value)} characters; a field holds ${LARGE} at most, unless it is a system item's declared large)`;
  switch (field.type) {
    case 'string':
      if (field.files && value && typeof value === 'object') return filesProblem(value);
      if (typeof value !== 'string') return field.files ? 'must be a text, or files by path ({ "index.js": ... })' : 'must be a string';
      // A published page's stylesheet, refused here by the rules the page reads it by, so a page never meets one it would drop.
      return field.css && cssProblem(value, true) ? `is a stylesheet a page refuses: ${cssProblem(value, true)}` : undefined;
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

/** The types a field declared `typed_by` another may be said to hold there: the simple types of a program (text for a string). */
export const SIMPLE_TYPES: Record<string, FieldDef['type']> = { text: 'string', number: 'number', boolean: 'boolean', date: 'date' };

/** Why a field typed by another does not hold a value of the type that one names, with the item as it will be: what it
 * holds already (`held`) and what this op sets (`props`, null clearing). Asked only of what the op touches. */
export function typedProblems(typeId: string, fields: Record<string, FieldDef>, props: Record<string, unknown>, held: Record<string, unknown> = {}): string[] {
  const problems: string[] = [];
  for (const [key, field] of Object.entries(fields)) {
    const by = field.typed_by;
    if (!by || !(key in props || by in props)) continue;
    const value = key in props ? props[key] : held[key];
    const named = by in props ? props[by] : held[by];
    if (value === null || value === undefined) continue;
    const type = typeof named === 'string' ? SIMPLE_TYPES[named] : undefined;
    if (!type) { problems.push(`${typeId}.${key} needs ${by}, one of: ${Object.keys(SIMPLE_TYPES).join(', ')}`); continue; }
    const problem = checkValue({ type }, value);
    if (problem) problems.push(`${typeId}.${key} is said to be ${named} (${by}), and ${problem}`);
  }
  return problems;
}

/** A plain module name a file of code may have: one imports another as './name.js', so no folders. */
const FILE = /^[A-Za-z0-9_][A-Za-z0-9_.-]*\.js$/;
/** What is wrong with code as files by path (a field declared files): each a text, by a plain name, index.js the entry. */
export function filesProblem(value: object): string | undefined {
  if (Array.isArray(value)) return 'must be a text, or files by path ({ "index.js": ... }), not a list';
  const entries = Object.entries(value as Record<string, unknown>);
  const bad = entries.filter(([p, t]) => !FILE.test(p) || typeof t !== 'string').map(([p]) => p);
  if (bad.length) return `holds files by plain names ending .js, each a text (one imports another as './name.js'): not ${bad.join(', ')}`;
  return entries.some(([p]) => p === 'index.js') ? undefined : 'holds files by path with index.js among them: the file that is run';
}
