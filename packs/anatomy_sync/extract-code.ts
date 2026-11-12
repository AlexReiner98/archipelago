// The code's extractors: each module of the packs, src/ and the page (ui/), with what it imports, and each test file
// with the modules it imports. Read with the reader the structure test checks the architecture with (reader.ts), so the
// map and the check read code alike. A module is part of its pack, read off its path; src/ and the page have none yet.

import { headerOf, importsOf } from './reader.ts';
import { gist, title, type Extractor, type Source, type Want, type WantLink } from './model.ts';

const CODE = /\.(ts|js|mjs)$/;
const isTest = (path: string) => /\.test\.(ts|js|mjs)$/.test(path) || path.startsWith('test/');
const packOf = (path: string) => /^(?:packs|workspace-packs)\/([\w-]+)\//.exec(path)?.[1];

/** Where a module sits: a root pack's kernel, another pack's code, src/ or the page. */
export function layerOf(path: string, roots: Set<string>): string | undefined {
  if (path.startsWith('src/')) return 'src';
  if (path.startsWith('ui/')) return 'page';
  const pack = packOf(path);
  if (!pack) return undefined;
  return roots.has(pack) && path.startsWith(`packs/${pack}/kernel/`) ? 'root' : 'pack';
}

/** Each relative import a file makes, as the key of the module it lands on, and whether it brings in types alone. */
function importsFrom(file: Source): { to: string; typeOnly: boolean }[] {
  const out = new Map<string, boolean>();
  for (const i of importsOf(file.text, file.path)) if (i.to) out.set(i.to, (out.get(i.to) ?? true) && i.typeOnly);
  return [...out].map(([to, typeOnly]) => ({ to, typeOnly }));
}

/** The root packs, by roots.json, which the code extractor reads to tell a root's kernel from another pack's code. */
const rootsOf = (files: Source[]) => {
  const f = files.find((x) => x.path === 'packs/roots.json' && x.repo === 'open_core');
  return new Set<string>(f ? JSON.parse(f.text).roots.map((r: { id: string }) => r.id) : []);
};

export const modules: Extractor = {
  id: 'modules',
  owns: (path) => (CODE.test(path) && !isTest(path) && layerOf(path, new Set()) !== undefined) || path === 'packs/roots.json',
  extract(files) {
    const roots = rootsOf(files);
    const items: Want[] = [], links: WantLink[] = [];
    for (const f of files) {
      const layer = CODE.test(f.path) && !isTest(f.path) ? layerOf(f.path, roots) : undefined;
      if (!layer) continue;
      const key = `module:${f.path}`;
      items.push({ key, type: 'anatomy.module', title: title(f.path.split('/').pop()!), body: gist(headerOf(f.text).replace(/\n/g, ' ')), props: { path: f.path, layer, blob: f.blob, lines: f.text.split('\n').length } });
      const pack = packOf(f.path);
      if (pack) links.push({ type: 'part_of', from: key, to: `pack:${pack}` });
      for (const i of importsFrom(f)) links.push({ type: 'anatomy.imports', from: key, to: `module:${i.to}`, ...(i.typeOnly && { props: { type_only: true } }) });
    }
    return { items, links };
  },
};

/** The test files the slow set names (test/sets.ts, SLOW): left out of the local fast run. */
export const slowOf = (text: string) => new Set([...(/SLOW[^=]*=\s*\{([\s\S]*?)\n\};/.exec(text)?.[1] ?? '').matchAll(/['"]([^'"]+\.test\.ts)['"]\s*:/g)].map((m) => m[1]));

export const tests: Extractor = {
  id: 'tests',
  owns: (path) => /\.test\.(ts|js|mjs)$/.test(path) || path === 'test/sets.ts',
  extract(files) {
    const sets = files.find((f) => f.path === 'test/sets.ts' && f.repo === 'open_core');
    const slow = sets ? slowOf(sets.text) : new Set<string>();
    const items: Want[] = [], links: WantLink[] = [];
    for (const f of files) {
      if (!/\.test\.(ts|js|mjs)$/.test(f.path)) continue;
      const key = `test:${f.path}`;
      items.push({ key, type: 'anatomy.test', title: title(f.path.split('/').pop()!), body: gist(headerOf(f.text).replace(/\n/g, ' ')), props: { path: f.path, blob: f.blob, ...(slow.has(f.path) && { slow: true }) } });
      for (const i of importsFrom(f)) links.push({ type: 'anatomy.tests', from: key, to: `module:${i.to}` });
      const pack = packOf(f.path);
      if (pack) links.push({ type: 'anatomy.tests', from: key, to: `pack:${pack}` });
    }
    return { items, links };
  },
};
