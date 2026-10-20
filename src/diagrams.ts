// `npm run diagrams`: the architecture and type diagrams, made from the code as draw.io files under docs/diagrams/
// (or the folder given). Reads src/, ui/ and packs/ and writes two files, each of pages: modules.drawio and
// types.drawio. The drawing is done by the pure modules beside this; here is only the reading
// and the writing.

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { moduleDiagram, type SourceFile } from './diagram-modules.ts';
import { typeDiagram, type PackFile } from './diagram-types.ts';
import { mxfile, type Page } from './diagram-xml.ts';

/** Every diagram file, by name, from the sources and pack files given. */
export function diagrams(files: SourceFile[], packs: PackFile[], link?: (path: string) => string | undefined): Record<string, string> {
  const sets: Record<string, Page[]> = { 'modules.drawio': moduleDiagram(files, link), 'types.drawio': typeDiagram(packs) };
  return Object.fromEntries(Object.entries(sets).map(([name, pages]) => [name, mxfile(pages)]));
}

const ROOT = join(import.meta.dirname, '..');
const walk = (dir: string): string[] =>
  !existsSync(dir) ? [] : readdirSync(dir).flatMap((n) => (statSync(join(dir, n)).isDirectory() ? walk(join(dir, n)) : [join(dir, n)]));

/** Where a module's source can be read on GitHub, when the checkout came from there. */
function githubLink(): ((path: string) => string) | undefined {
  try {
    const remote = execFileSync('git', ['remote', 'get-url', 'origin'], { cwd: ROOT, encoding: 'utf8' }).trim();
    const m = remote.match(/github\.com[:/]([^/]+\/[^/.]+)/);
    return m ? (path) => `https://github.com/${m[1]}/blob/main/${path}` : undefined;
  } catch {
    return undefined;
  }
}

if (import.meta.main) {
  const out = join(ROOT, process.argv[2] ?? 'docs/diagrams');
  const files = ['src', 'ui', 'packs'].flatMap((d) => walk(join(ROOT, d))).map((f) => ({ path: relative(ROOT, f).split('\\').join('/'), text: readFileSync(f, 'utf8') }));
  const packs = readdirSync(join(ROOT, 'packs')).filter((p) => existsSync(join(ROOT, 'packs', p, 'pack.json'))).map((p) => JSON.parse(readFileSync(join(ROOT, 'packs', p, 'pack.json'), 'utf8')) as PackFile);
  mkdirSync(out, { recursive: true });
  for (const [name, xml] of Object.entries(diagrams(files, packs, githubLink()))) {
    writeFileSync(join(out, name), xml);
    console.log(`${relative(ROOT, join(out, name)).split('\\').join('/')}: ${(xml.match(/<diagram /g) ?? []).length} pages, ${Math.round(xml.length / 1024)} KB`);
  }
}
