// What an op does to what is there, worked out without the database: the note an update leaves, and the ops left
// when a reviewer excludes some. Used by the write path (src/pelago.ts) and by what checks a change before it.

import type { Op, UpdateOp } from './pelago.ts';

/**
 * The note an update leaves: a whole new one (`body`), or the one that is
 * there with one passage replaced and a paragraph added, so a long note is
 * changed without being sent again. Throws saying what is wrong with the op.
 */
export function bodyAfter(before: string, op: UpdateOp): string {
  if (op.body !== undefined && (op.append !== undefined || op.replace)) throw new Error('send body (the whole note) or append and replace (parts of it), not both');
  let body = op.body ?? before;
  if (op.replace) {
    const { find } = op.replace;
    if (!find) throw new Error('replace.find cannot be empty');
    const found = body.split(find).length - 1;
    if (found !== 1) throw new Error(`replace.find must be in the note exactly once, and is there ${found === 0 ? 'not at all' : `${found} times`}: ${JSON.stringify(find.length > 80 ? `${find.slice(0, 80)}…` : find)}. Copy it from the note as it is now (get), with more around it if it repeats.`);
    body = body.replace(find, () => op.replace!.with);
  }
  if (op.append?.trim()) body = [body.trimEnd(), op.append.trim()].filter(Boolean).join('\n\n');
  return body;
}

/**
 * Remove the ops a reviewer excluded. An exclusion is a create's ref or "#n"
 * for the nth op. Ops that depend on an excluded create go with it.
 */
export function dropExcepted(ops: Op[], except: string[]): Op[] {
  if (!except.length) return ops;
  const skip = new Set(except);
  const gone = new Set<string>();
  const dropped = new Set<number>();
  for (let changed = true; changed; ) {
    changed = false;
    for (const [i, op] of ops.entries()) {
      if (dropped.has(i)) continue;
      const excluded =
        skip.has(`#${i + 1}`) ||
        (op.op === 'create' && ((op.ref !== undefined && skip.has(op.ref)) || (op.owner !== undefined && gone.has(op.owner)))) ||
        (op.op === 'link' && (gone.has(op.from) || gone.has(op.to)));
      if (!excluded) continue;
      dropped.add(i);
      if (op.op === 'create' && op.ref) gone.add(op.ref);
      changed = true;
    }
  }
  return ops.filter((_, i) => !dropped.has(i));
}
