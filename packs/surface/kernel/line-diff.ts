// A change to code, as a line diff (task e_vc5tpunk): what a held change or an item's history says of a field its type
// marks `code`, in place of a from and a to cut off at their start. Only the hunks that changed, with a little context,
// each line marked as kept, added or taken out; a field of modules by name is diffed module by module. Myers' O(ND)
// walk on lines, written here (no dependency): a person reads it folded on the page, an agent as compact text.

/** One stretch that changed: where it starts in the old text and the new (from 1), and its lines, each led by ' ', '-' or '+'. */
export interface Hunk {
  a: number;
  b: number;
  lines: string[];
}

/** One text's change: the module it is (for a field of modules), whether it is new or gone, its counts and its hunks. */
export interface FileDiff {
  file?: string;
  was?: 'added' | 'removed';
  add: number;
  del: number;
  hunks: Hunk[];
}

/** A field's change: each text that changed, the counts over all of them, and how many lines were left out past the cap. */
export interface CodeDiff {
  files: FileDiff[];
  add: number;
  del: number;
  cut?: number;
}

/** Lines of context around each change. */
export const CONTEXT = 3;
/** The most lines a diff carries, over all its hunks: past it the rest are counted, not given. */
export const MOST_LINES = 400;
/** The most characters of one line a diff carries. */
export const LINE_CHARS = 300;
/** Past this many edits the walk stops and the stretch between the common start and end is taken as replaced whole. */
const MOST_EDITS = 2000;

const linesOf = (text: string) => (text === '' ? [] : text.replace(/\r\n/g, '\n').replace(/\n$/, '').split('\n'));

/**
 * The edit script from `a` to `b`, as a list of ' ', '-' and '+' marks, one per line of the longer walk: Myers'
 * greedy walk, keeping each round's frontier (2d+1 numbers) to walk back. Lines are numbered first, so a compare is
 * of numbers, and a common start and end are taken off before the walk.
 */
export function editScript(a: string[], b: string[]): ('=' | '-' | '+')[] {
  const ids = new Map<string, number>();
  const id = (s: string) => ids.get(s) ?? (ids.set(s, ids.size), ids.size - 1);
  const A = a.map(id), B = b.map(id);
  let start = 0;
  while (start < A.length && start < B.length && A[start] === B[start]) start++;
  let endA = A.length, endB = B.length;
  while (endA > start && endB > start && A[endA - 1] === B[endB - 1]) endA--, endB--;
  const head: ('=' | '-' | '+')[] = Array(start).fill('=');
  const tail: ('=' | '-' | '+')[] = Array(A.length - endA).fill('=');
  const x0 = A.slice(start, endA), y0 = B.slice(start, endB);
  const n = x0.length, m = y0.length;
  if (!n || !m) return [...head, ...Array(n).fill('-'), ...Array(m).fill('+'), ...tail];
  const max = Math.min(n + m, MOST_EDITS);
  const trace: Int32Array[] = [];
  let v = new Int32Array(3); // v[k + d + 1] is the furthest x on diagonal k after round d
  let found = -1;
  for (let d = 0; d <= max && found < 0; d++) {
    const next = new Int32Array(2 * d + 3);
    for (let k = -d; k <= d; k += 2) {
      const at = (kk: number) => v[kk + d]; // the round before was sized for d - 1: offset d - 1 + 1
      let x = d === 0 ? 0 : k === -d || (k !== d && at(k - 1) < at(k + 1)) ? at(k + 1) : at(k - 1) + 1;
      let y = x - k;
      while (x < n && y < m && x0[x] === y0[y]) x++, y++;
      next[k + d + 1] = x;
      if (x >= n && y >= m) {
        found = d;
        break;
      }
    }
    trace.push(next);
    v = next;
  }
  if (found < 0) return [...head, ...Array(n).fill('-'), ...Array(m).fill('+'), ...tail];
  // Walk back from the end, round by round.
  const middle: ('=' | '-' | '+')[] = [];
  let x = n, y = m;
  for (let d = found; d > 0; d--) {
    const before = trace[d - 1];
    const at = (kk: number) => before[kk + d]; // round d - 1, offset (d - 1) + 1
    const k = x - y;
    const down = k === -d || (k !== d && at(k - 1) < at(k + 1));
    const pk = down ? k + 1 : k - 1;
    const px = at(pk), py = px - pk;
    while (x > px + (down ? 0 : 1) && y > py + (down ? 1 : 0)) middle.push('='), x--, y--;
    if (down) middle.push('+'), y--;
    else middle.push('-'), x--;
  }
  while (x > 0 && y > 0) middle.push('='), x--, y--;
  return [...head, ...middle.reverse(), ...tail];
}

const cutLine = (s: string) => (s.length > LINE_CHARS ? `${s.slice(0, LINE_CHARS)}… (${s.length} characters)` : s);

/** The hunks of one text's change, with `context` lines around each, and its counts. */
export function textDiff(from: string, to: string, context = CONTEXT): Omit<FileDiff, 'file' | 'was'> {
  const a = linesOf(from), b = linesOf(to);
  const script = editScript(a, b);
  const rows: { mark: '=' | '-' | '+'; i: number; j: number }[] = [];
  let i = 0, j = 0, add = 0, del = 0;
  for (const mark of script) {
    rows.push({ mark, i, j });
    if (mark === '=') i++, j++;
    else if (mark === '-') i++, del++;
    else j++, add++;
  }
  const hunks: Hunk[] = [];
  let r = 0;
  while (r < rows.length) {
    if (rows[r].mark === '=') {
      r++;
      continue;
    }
    // A hunk runs from `context` before the first change to `context` after the last one that comes within 2 * context of it.
    const first = Math.max(0, r - context);
    let last = r;
    for (let s = r; s < rows.length; s++) {
      if (rows[s].mark !== '=') last = s;
      else if (s - last > 2 * context) break;
    }
    const end = Math.min(rows.length, last + context + 1);
    const lines = rows.slice(first, end).map((row) => (row.mark === '=' ? ` ${cutLine(a[row.i])}` : row.mark === '-' ? `-${cutLine(a[row.i])}` : `+${cutLine(b[row.j])}`));
    hunks.push({ a: rows[first].i + 1, b: rows[first].j + 1, lines });
    r = end;
  }
  return { add, del, hunks };
}

/** Modules by name, when that is what a value is. */
const modulesOf = (v: unknown): Record<string, string> | null =>
  v && typeof v === 'object' && !Array.isArray(v) && Object.values(v).every((t) => typeof t === 'string') ? (v as Record<string, string>) : null;

/**
 * A code field's change from `from` to `to`, as a line diff: a text as one, modules by name module by module (each
 * new, gone or changed; one the same left out). Null when either is neither a text nor modules, or nothing changed.
 * Past `most` lines the rest are counted in `cut`.
 */
export function codeDiff(from: unknown, to: unknown, most = MOST_LINES): CodeDiff | null {
  const none = (v: unknown) => v === null || v === undefined;
  let files: FileDiff[];
  if ((typeof from === 'string' || none(from)) && (typeof to === 'string' || none(to)) && !(none(from) && none(to))) {
    files = [{ ...(none(from) ? { was: 'added' as const } : none(to) ? { was: 'removed' as const } : {}), ...textDiff((from as string) ?? '', (to as string) ?? '') }];
  } else {
    const was = none(from) ? {} : modulesOf(from), now = none(to) ? {} : modulesOf(to);
    if (!was || !now) return null;
    const names = [...new Set([...Object.keys(was), ...Object.keys(now)])].sort();
    files = names
      .filter((f) => was[f] !== now[f])
      .map((file) => ({ file, ...(!(file in was) ? { was: 'added' as const } : !(file in now) ? { was: 'removed' as const } : {}), ...textDiff(was[file] ?? '', now[file] ?? '') }));
  }
  files = files.filter((f) => f.add || f.del || f.was);
  if (!files.length) return null;
  let left = most, cut = 0;
  for (const f of files)
    f.hunks = f.hunks.filter((h) => {
      if (h.lines.length <= left) return (left -= h.lines.length), true;
      cut += h.lines.length;
      left = 0;
      return false;
    });
  return { files, add: files.reduce((n, f) => n + f.add, 0), del: files.reduce((n, f) => n + f.del, 0), ...(cut && { cut }) };
}

/** A diff as compact text, as an agent reads it: a head line per module with its counts, then each hunk as a unified diff does. */
export function diffText(d: CodeDiff): string {
  const out: string[] = [];
  for (const f of d.files) {
    if (f.file || d.files.length > 1) out.push(`${f.file ?? ''}${f.was ? ` (${f.was})` : ''} +${f.add} -${f.del}`.trim());
    for (const h of f.hunks) out.push(`@@ -${h.a} +${h.b} @@`, ...h.lines);
  }
  if (d.cut) out.push(`… ${d.cut} more lines of diff; full: true has the field whole`);
  return out.join('\n');
}
