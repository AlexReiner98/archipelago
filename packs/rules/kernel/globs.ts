// Whether two file globs meet: whether some path could match both (the rule form apart, ./apart.ts). Decided without
// a dependency and conservatively: where a glob says more than this reads (a class [...], a negation), it is read as
// matching more, so two globs said apart here are apart. `*` is any run within one segment, `?` one character, `**`
// a whole segment alone any number of segments, `{a,b}` either. `packs/rules/**` meets `packs/rules/kernel/rules.ts`;
// `ui/*.js` does not meet `src/**`.

/** One character of a segment's pattern: a literal, any one character (`?`, a class), or any run (`*`). */
type Tok = { lit: string } | 'one' | 'run';
/** A path's pattern: its segments, `**` standing for any number of whole segments. */
type Seg = Tok[] | '**';

/** At most this many alternatives a glob's braces open into; past it, the glob is read as `**`, meeting everything. */
const MAX_ALTERNATIVES = 64;

/** A glob's braces opened: `src/{a,b}.ts` is `src/a.ts` and `src/b.ts`. An unpaired brace is a character; too many, and it is `**`. */
export function expand(glob: string): string[] {
  let out = [glob];
  for (let round = 0; round < 16; round++) {
    const next: string[] = [];
    let opened = false;
    for (const g of out) {
      const m = /\{([^{}]*)\}/.exec(g);
      if (!m) { next.push(g); continue; }
      opened = true;
      for (const alt of m[1].split(',')) next.push(g.slice(0, m.index) + alt + g.slice(m.index + m[0].length));
    }
    if (next.length > MAX_ALTERNATIVES) return ['**'];
    out = next;
    if (!opened) return out;
  }
  return ['**'];
}

/** A segment's tokens: a class `[...]` is one character, an escape the character after it. */
function tokens(seg: string): Tok[] {
  const out: Tok[] = [];
  for (let i = 0; i < seg.length; i++) {
    const c = seg[i];
    if (c === '*') { if (out[out.length - 1] !== 'run') out.push('run'); }
    else if (c === '?') out.push('one');
    else if (c === '[') { const end = seg.indexOf(']', i + 2); if (end < 0) out.push({ lit: c }); else { out.push('one'); i = end; } }
    else out.push({ lit: c });
  }
  return out;
}

/** A glob read into segments: `./` and a leading `/` dropped, `\` read as `/`, empty segments gone. */
export function parse(glob: string): Seg[] {
  const path = glob.replace(/\\/g, '/').replace(/^(\.\/)+/, '').replace(/^\/+/, '');
  const segs: Seg[] = [];
  for (const s of path.split('/')) {
    if (!s) continue;
    const seg: Seg = s === '**' ? '**' : tokens(s);
    if (seg === '**' && segs[segs.length - 1] === '**') continue;
    segs.push(seg);
  }
  return segs;
}

/** Whether two token lists share a string: a run absorbs any one token of the other, or ends. */
function tokensMeet(a: Tok[], b: Tok[]): boolean {
  const memo = new Map<number, boolean>();
  const go = (i: number, j: number): boolean => {
    const key = i * (b.length + 1) + j;
    const known = memo.get(key);
    if (known !== undefined) return known;
    let r: boolean;
    if (i === a.length && j === b.length) r = true;
    else if (i < a.length && a[i] === 'run') r = go(i + 1, j) || (j < b.length && go(i, j + 1));
    else if (j < b.length && b[j] === 'run') r = go(i, j + 1) || (i < a.length && go(i + 1, j));
    else if (i === a.length || j === b.length) r = false;
    else {
      const x = a[i], y = b[j];
      r = (x === 'one' || y === 'one' || (x as { lit: string }).lit === (y as { lit: string }).lit) && go(i + 1, j + 1);
    }
    memo.set(key, r);
    return r;
  };
  return go(0, 0);
}

/** Whether two segment lists match some one path: `**` absorbs any one segment of the other, or ends. */
function segsMeet(a: Seg[], b: Seg[]): boolean {
  const memo = new Map<number, boolean>();
  const go = (i: number, j: number): boolean => {
    const key = i * (b.length + 1) + j;
    const known = memo.get(key);
    if (known !== undefined) return known;
    let r: boolean;
    if (i === a.length && j === b.length) r = true;
    else if (i < a.length && a[i] === '**') r = go(i + 1, j) || (j < b.length && go(i, j + 1));
    else if (j < b.length && b[j] === '**') r = go(i, j + 1) || (i < a.length && go(i + 1, j));
    else if (i === a.length || j === b.length) r = false;
    else r = tokensMeet(a[i] as Tok[], b[j] as Tok[]) && go(i + 1, j + 1);
    memo.set(key, r);
    return r;
  };
  return go(0, 0);
}

/** Whether some path could match both globs. A negation (`!x`) is read as meeting everything: what it leaves is not read here. */
export function globsMeet(a: string, b: string): boolean {
  if (a.startsWith('!') || b.startsWith('!')) return true;
  return expand(a).some((x) => expand(b).some((y) => segsMeet(parse(x), parse(y))));
}

/** A field's value as globs: a glob, or a list of them; anything else none. */
export const globsOf = (v: unknown): string[] => (typeof v === 'string' ? (v ? [v] : []) : Array.isArray(v) ? v.filter((g): g is string => typeof g === 'string' && g !== '') : []);

/** The pairs of globs, one of each list, that meet, each said "a ~ b" (the same glob once). */
export function meeting(a: string[], b: string[]): string[] {
  const out: string[] = [];
  for (const x of a) for (const y of b) if (globsMeet(x, y)) out.push(x === y ? x : `${x} ~ ${y}`);
  return [...new Set(out)];
}
