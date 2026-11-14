// An edit of a code field: one exact passage replaced, as an agent's text editor does (str_replace), so a one-line fix
// to a long module is a small op. Resolved at the top of the write path into an ordinary update of the whole field
// (props), so the rules judge it, a held change keeps it and the log appends it as any other: no new fact shape.

import { createHash } from 'node:crypto';
import type { Registry } from '../../loader/kernel/packs.ts';
import type { Entity, Op, UpdateOp } from './pelago-types.ts';

/** What an update's edit says: in which code field (and which module of it, for modules by name), what to find, what goes in its place, and the text's hash as it was read. */
export interface Edit { field: string; file?: string; find: string; with: string; base?: string }

/** The hash an edit's base is compared with: sha256 of the text, in hex. */
export const textHash = (text: string): string => createHash('sha256').update(text, 'utf8').digest('hex');

const quoted = (s: string) => JSON.stringify(s.length > 80 ? `${s.slice(0, 80)}…` : s);

/**
 * The text an edit leaves, from the text it is made on (the field's, or its module's). Throws, in the words of the one
 * who sent it, why it cannot: the base moved, the passage is not there, or is there more than once.
 */
export function editAfter(text: string, edit: Edit, what: string): string {
  if (edit.base !== undefined) {
    const base = edit.base.trim().toLowerCase().replace(/^sha256:/, '');
    const now = textHash(text);
    if (base !== now) throw new Error(`edit.base moved: ${what} has changed since it was read (base ${base.slice(0, 12)}…, now ${now.slice(0, 12)}…). Read it again (get) and make the edit on what is there now.`);
  }
  if (!edit.find) throw new Error('edit.find cannot be empty');
  const found = text.split(edit.find).length - 1;
  if (found !== 1) throw new Error(`edit.find must be in ${what} exactly once, and is there ${found === 0 ? 'not at all' : `${found} times`}: ${quoted(edit.find)}. Copy it from ${what} as it is now (get), with more around it if it repeats.`);
  return text.replace(edit.find, () => edit.with);
}

/** Of a field's value, its modules by name, or undefined where it is not that shape. */
const modulesOf = (value: unknown): Record<string, string> | undefined =>
  value && typeof value === 'object' && !Array.isArray(value) && Object.values(value).every((v) => typeof v === 'string') ? (value as Record<string, string>) : undefined;

/**
 * Each update's edit made into the whole field it leaves (props[field]), against the item as the ops before it in the
 * change left it, and the hash of each text it leaves (for the next edit's base). Ops with no edit are given back as
 * they are. Throws "Change rejected" listing what is wrong with each, as the write path does.
 */
export async function editsResolved(reg: Registry, ops: Op[], read: (id: string) => Promise<Entity | null>): Promise<{ ops: Op[]; edited: { id: string; field: string; file?: string; base: string }[] }> {
  if (!ops.some((op) => op.op === 'update' && (op as UpdateOp).edit)) return { ops, edited: [] };
  const errors: string[] = [], edited: { id: string; field: string; file?: string; base: string }[] = [];
  const now = new Map<string, Record<string, unknown>>(); // the props each item has, as the ops before this one left them
  const out: Op[] = [];
  for (const [i, op] of ops.entries()) {
    if (op.op !== 'update' || !op.edit) { if (op.op === 'update' && op.props) now.set(op.id, { ...(now.get(op.id) ?? {}), ...op.props }); out.push(op); continue; }
    const where = `op ${i + 1} (update)`;
    const { edit, ...rest } = op;
    try {
      const item = await read(op.id);
      if (!item) throw new Error(`no entity "${op.id}"`);
      const field = reg.type(item.type)?.fields[edit.field];
      if (!field?.code) {
        const code = Object.entries(reg.type(item.type)?.fields ?? {}).filter(([, f]) => f.code).map(([k]) => k);
        throw new Error(`edit.field "${edit.field}" is not a code field of a ${item.type}: ${code.length ? `edit one of ${code.join(', ')}, or` : 'it has none;'} change other fields with props`);
      }
      if (op.props && edit.field in op.props) throw new Error(`send props.${edit.field} (the whole field) or edit (one passage of it), not both`);
      const props = { ...item.props, ...(now.get(op.id) ?? {}) };
      const value = props[edit.field];
      let after: unknown, text: string;
      // Modules by name, or a layout's code written as files by path: one file of it is edited, by edit.file.
      if (field.type === 'json' || (field.files && value !== null && typeof value === 'object')) {
        const modules = value === undefined || value === null ? {} : modulesOf(value);
        if (!modules) throw new Error(`"${edit.field}" of "${item.title}" is not modules by name`);
        const names = Object.keys(modules).sort();
        if (!edit.file) throw new Error(`"${edit.field}" holds modules by name: say which in edit.file (${names.join(', ') || 'it has none yet'})`);
        if (!(edit.file in modules)) throw new Error(`"${edit.field}" of "${item.title}" has no module "${edit.file}"${names.length ? `: it has ${names.join(', ')}` : ''}. A new module is written whole, with props.${edit.field}`);
        text = editAfter(modules[edit.file], edit, `${edit.file} of "${item.title}"`);
        after = { ...modules, [edit.file]: text };
      } else {
        if (edit.file) throw new Error(`"${edit.field}" is one text, not modules by name: leave edit.file out${field.files ? `, or write it whole as files by path ({ "index.js": ... }) to split it` : ""}`);
        if (typeof value !== 'string') throw new Error(`"${item.title}" has no ${edit.field} yet: write it whole, with props.${edit.field}`);
        after = text = editAfter(value, edit, `${edit.field} of "${item.title}"`);
      }
      now.set(op.id, { ...(now.get(op.id) ?? {}), ...(op.props ?? {}), [edit.field]: after });
      edited.push({ id: op.id, field: edit.field, ...(edit.file && { file: edit.file }), base: textHash(text) });
      out.push({ ...rest, props: { ...(op.props ?? {}), [edit.field]: after } });
    } catch (e) {
      errors.push(`${where}: ${(e as Error).message}`);
    }
  }
  if (errors.length) throw new Error(`Change rejected:\n- ${errors.join('\n- ')}`);
  return { ops: out, edited };
}
