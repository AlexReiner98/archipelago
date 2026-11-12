// What a root pack's code may import while the kernel moves into packs (docs/kernel-packs.md, "Moving in the wave
// (as built)"). The contract is read for who owns what: "The root packs" for their order, "Where each module goes" for
// each module's pack, and the plumbing paragraph. A root module may import plumbing, its own pack, and the roots
// before it, at their new place or through their shims; anything else it imported when the wave began is owed
// (test/fixtures/root-imports.json), and nothing is added to that.

import { posix } from 'node:path';
import { MOVED, raw, rawWalk, SHIMS } from './structure-kit.ts';

const CONTRACT = raw('docs/kernel-packs.md').replace(/\r\n/g, '\n');
/** A section by its heading: the whole heading line, or up to its first comma ("### Plumbing, kept in `src/`"). */
const section = (title: string) => CONTRACT.split(/\n(?=#{2,3} )/).find((s) => { const head = s.split('\n')[0]; return head === title || head.startsWith(`${title},`); }) ?? '';
const rows = (text: string) => text.split('\n').filter((l) => /^\| *[\w#]/.test(l) && !/^\| *(?:#|Pack|Tier) *\|/.test(l)).map((l) => l.split('|').slice(1, -1).map((c) => c.trim()));
const names = (cell: string) => cell.replace(/\([^)]*\)/g, '').split(/[,;]/).map((s) => s.trim()).filter((s) => /^[a-z][\w-]*$/.test(s));

/** The roots in the order they start, core first. */
export const ROOT_ORDER = rows(section('## The root packs')).map(([, pack]) => pack);
/** Each module of the contract, with the pack it goes to; plumbing as `plumbing`. */
export const PACK_OF = new Map<string, string>([
  ...['### Root', '### Service'].flatMap((t) => rows(section(t)).flatMap(([pack, cell]) => names(cell).map((m) => [m, names(pack)[0]] as const))),
  ...names(section('### Plumbing').split('\n').slice(1).join(' ').split(':')[0]).map((m) => [m, 'plumbing'] as const),
]);

const rank = (pack: string) => ROOT_ORDER.indexOf(pack);
/** A path under src/ or a pack's kernel/, as the module it is: its old path while the wave lasts. */
const known = (path: string) => MOVED.get(path) ?? path;
/** Which pack a module is in: where it was moved to, or where the contract sends it. */
function packOf(path: string): string | undefined {
  const at = /^packs\/([\w-]+)\/kernel\//.exec(SHIMS.get(path) ?? path)?.[1];
  return at ?? (path.startsWith('src/') ? PACK_OF.get(posix.basename(path, '.ts')) : undefined);
}

/** Every value import of a file: static, re-exported, dynamic or bare (for its side effects); `import type` is erased and does not count. */
const imports = (text: string) =>
  [...text.matchAll(/(?:^|;)[ 	]*(?:import|export)\s+(?!type\b)[^;]*?from\s+['"]([^'"]+)['"]|\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)|(?:^|;)[ 	]*import\s+['"]([^'"]+)['"]/gm)].map((m) => m[1] ?? m[2] ?? m[3]);

/** The files of each root pack's code: its row's modules wherever they are, and what is under its kernel/. */
function rootFiles(): [string, string][] {
  const out = new Map<string, string>();
  for (const [m, pack] of PACK_OF) {
    if (rank(pack) < 0) continue;
    const path = `src/${m}.ts`;
    if (SHIMS.has(path) || rawWalk('src').includes(path)) out.set(SHIMS.get(path) ?? path, pack);
  }
  for (const pack of ROOT_ORDER) for (const f of rawWalk(`packs/${pack}/kernel`)) if (f.endsWith('.ts') && !f.endsWith('.test.ts')) out.set(f, pack);
  return [...out];
}

/** Each import of a root pack's code that is not plumbing, its own pack or a root before it: `<module> -> <module>`. */
export function rootImports(): string[] {
  const found: string[] = [];
  for (const [file, pack] of rootFiles()) {
    for (const spec of imports(raw(file))) {
      if (!spec.startsWith('.')) continue; // node: and the four dependencies
      const to = known(posix.normalize(posix.join(posix.dirname(file), spec)));
      const of = packOf(to);
      if (of === 'plumbing' || of === pack || (of !== undefined && rank(of) >= 0 && rank(of) < rank(pack))) continue;
      found.push(`${known(file)} -> ${to}`);
    }
  }
  return [...new Set(found)].sort();
}
