// A released schema step is history (the owner, 12 Nov 2026, e_2tmdv4p9): its SQL is never edited (a database's schema
// is named by a hash of the steps' SQL: packs/database/kernel/migrate.ts, schemaKey), so what a rule would count in it
// could never go. The rules that read SQL read a kernel file with the SQL of every released step blanked: the constants
// a root's kernel/steps.ts names in a step at or below RELEASED, and what only they use in their file.

import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { migrations } from '../packs/database/kernel/migrate.ts';
import { read, ROOT, rootPacks, target } from './structure-kit.ts';

/** The latest step main has released (e4df2e8f, 12 Nov 2026). Raise it when a newer step reaches main, with its key below. */
export const RELEASED = 47;
/** The released steps' SQL, hashed: a step at or below RELEASED that changes changes this, and the structure test says so. */
export const RELEASED_KEY = '112d481a2f33';
export const releasedKey = async () =>
  createHash('sha256').update((await migrations()).filter((m) => m.version <= RELEASED).map((m) => `${m.version}\n${m.sql}\n${m.server ?? ''}`).join('\n')).digest('hex').slice(0, 12);

/** Where a statement that starts at `i` ends: past its `;`, outside every string, template and bracket. */
function statementEnd(text: string, i: number): number {
  const stack: string[] = [];
  for (; i < text.length; i++) {
    const c = text[i], top = stack.at(-1);
    if (top === '`') {
      if (c === '\\') i++;
      else if (c === '`') stack.pop();
      else if (c === '$' && text[i + 1] === '{') (stack.push('}'), i++);
    } else if (top === "'" || top === '"') {
      if (c === '\\') i++;
      else if (c === top) stack.pop();
    } else if (c === '/' && text[i + 1] === '/') i = text.indexOf('\n', i) < 0 ? text.length : text.indexOf('\n', i);
    else if (c === '`' || c === "'" || c === '"') stack.push(c);
    else if (c === '(' || c === '[' || c === '{') stack.push(c === '(' ? ')' : c === '[' ? ']' : '}');
    else if (c === top) stack.pop();
    else if (c === ';' && !stack.length) return i + 1;
  }
  return text.length;
}

/** The span of a top-level `const name = ...;` in a file, if it declares one. */
const declared = (text: string, name: string): [number, number] | undefined => {
  const m = new RegExp(`^(?:export\\s+)?const\\s+${name}\\b[^=\\n]*=`, 'm').exec(text);
  return m ? [m.index, statementEnd(text, m.index + m[0].length)] : undefined;
};

/** Every file's released spans: the step lines of each root's steps.ts, and the constants they name where they are declared. */
function releasedSpans(): Map<string, [number, number][]> {
  const names = new Map<string, Set<string>>(), spans = new Map<string, [number, number][]>();
  const add = (f: string, s: [number, number]) => spans.set(f, [...(spans.get(f) ?? []), s]);
  for (const root of rootPacks) {
    const f = `packs/${root}/kernel/steps.ts`;
    if (!existsSync(join(ROOT, f))) continue;
    const text = read(f), from = new Map<string, string>();
    for (const m of text.matchAll(/import\s*\{([^}]*)\}\s*from\s*['"]([^'"]+)['"]/g)) for (const n of m[1].split(',').map((s) => s.trim()).filter(Boolean)) from.set(n, target(f, m[2]));
    for (const m of text.matchAll(/^[ \t]*\{\s*version:\s*(\d+)\b.*$/gm)) {
      if (Number(m[1]) > RELEASED) continue;
      add(f, [m.index, m.index + m[0].length]);
      for (const n of m[0].match(/\b[A-Z][A-Z0-9_]+\b/g) ?? []) names.set(from.get(n) ?? f, new Set([...(names.get(from.get(n) ?? f) ?? []), n]));
    }
  }
  for (const [f, named] of names) {
    const text = read(f), inside = (at: number) => (spans.get(f) ?? []).some(([a, b]) => at >= a && at < b);
    for (const n of named) { const s = declared(text, n); if (s) add(f, s); }
    // What only released SQL uses in its file (a helper a step's text is made with) is released too.
    const consts = [...text.matchAll(/^(?:export\s+)?const\s+(\w+)/gm)].map((m) => m[1]);
    for (let more = true; more; ) {
      more = false;
      for (const n of consts) {
        const s = declared(text, n);
        if (!s || inside(s[0])) continue;
        const uses = [...text.matchAll(new RegExp(`\\b${n}\\b`, 'g'))].map((m) => m.index).filter((at) => at < s[0] || at >= s[1]);
        if (uses.length && uses.every(inside)) (add(f, s), (more = true));
      }
    }
  }
  return spans;
}

let spans: Map<string, [number, number][]> | undefined;
/** A file's text with the SQL of released steps blanked (its lines kept), for the rules that count what SQL says. */
export function history(f: string): string {
  const text = read(f), own = (spans ??= releasedSpans()).get(f);
  if (!own) return text;
  const chars = text.split('');
  for (const [a, b] of own) for (let i = a; i < b; i++) if (chars[i] !== '\n') chars[i] = ' ';
  return chars.join('');
}
