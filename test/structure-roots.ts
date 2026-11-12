// What a root pack's code may import (docs/kernel-packs.md, rule 22). The contract is read for who owns what: "The root
// packs" for their order, "Where each module goes" for each module's pack, and the plumbing paragraph. A root module
// may import plumbing, its own pack, and the roots before it. What the roots imported above that when the wave began
// was owed (test/fixtures/root-imports.json); every owed import is cut, the list is empty, and nothing is added to it.

import { posix } from 'node:path';
import { valueImports } from '../packs/anatomy_sync/reader.ts';
import { raw, rawWalk } from './structure-kit.ts';

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
/** Which pack a module is in: where it lives, or where the contract sends one still in src/. */
function packOf(path: string): string | undefined {
  const at = /^packs\/([\w-]+)\/kernel\//.exec(path)?.[1];
  return at ?? (path.startsWith('src/') ? PACK_OF.get(posix.basename(path, '.ts')) : undefined);
}

/** Every value import of a file: static, re-exported, dynamic or bare (for its side effects); `import type` is erased and does not count. */
const imports = (text: string) => valueImports(text).filter((i) => i.kind !== 'require').map((i) => i.spec);

/** The files of each root pack's code: what is under its kernel/, where every module of its row lives. */
function rootFiles(): [string, string][] {
  const out = new Map<string, string>();
  for (const pack of ROOT_ORDER) for (const f of rawWalk(`packs/${pack}/kernel`)) if (f.endsWith('.ts') && !f.endsWith('.test.ts')) out.set(f, pack);
  return [...out];
}

/** Each import of a root pack's code that is not plumbing, its own pack or a root before it: `<module> -> <module>`. */
export function rootImports(): string[] {
  const found: string[] = [];
  for (const [file, pack] of rootFiles()) {
    for (const spec of imports(raw(file))) {
      if (!spec.startsWith('.')) continue; // node: and the four dependencies
      const to = posix.normalize(posix.join(posix.dirname(file), spec));
      const of = packOf(to);
      if (of === 'plumbing' || of === pack || (of !== undefined && rank(of) >= 0 && rank(of) < rank(pack))) continue;
      found.push(`${file} -> ${to}`);
    }
  }
  return [...new Set(found)].sort();
}
