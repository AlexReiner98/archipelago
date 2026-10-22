// `npm run diagrams:publish`: the diagrams of this checkout, put on a map, where each page is an item its page draws.
// Run after a push to main (.github/workflows/diagrams.yml), with the map's address in PELAGO_URL and an agent's
// token in PELAGO_TOKEN; --into <id> names what the document is part of. One change says what moved: a page drawn
// differently from the last, a page that is new, a page the code no longer has; a page drawn the same is left alone.
// Each keeps the commit it was drawn from, and a link to its draw.io file at that commit when the file committed there
// is the one just drawn.

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { diagramSets, githubLink, readCheckout } from '../src/diagrams.ts';
import { mxfile, pageData, type PageData } from '../src/diagram-xml.ts';

export const DOCUMENT = 'Architecture diagrams';

/** The same data written the same way whatever order its keys came back in: the map keeps JSON with its keys sorted. */
const same = (a: unknown, b: unknown): boolean => JSON.stringify(sorted(a)) === JSON.stringify(sorted(b));
const sorted = (v: unknown): unknown =>
  Array.isArray(v) ? v.map(sorted) : v && typeof v === 'object' ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, sorted((v as Record<string, unknown>)[k])])) : v;
const TYPE = 'software.diagram';

interface Kept {
  id: string;
  title: string;
  status: string;
  props: { diagram?: { key?: string } };
}

export interface Drawn {
  file: string;
  page: PageData;
  /** The draw.io file at the commit, when the one committed there is the one drawn. */
  url?: string;
}

/**
 * The change that brings the map in line with the pages drawn: each page by its id in its file, found again by
 * props.page. The document's note lists them, each id on a line of its own under the file's title, so it reads them in.
 */
export function diagramChange(drawn: Drawn[], kept: Kept[], doc: { id: string; body: string } | undefined, commit: string, into?: string) {
  const ops: Record<string, unknown>[] = [];
  const docRef = doc?.id ?? 'doc';
  const idOf = new Map<string, string>();
  drawn.forEach((d, i) => {
    const key = `${d.file}#${d.page.id}`;
    const old = kept.find((k) => k.props.diagram?.key === key);
    const diagram = { ...d.page, key, ...(d.url && { drawio: d.url }) };
    const props = { diagram: { ...diagram, commit } };
    if (!old) {
      ops.push({ op: 'create', ref: `p${i}`, type: TYPE, title: d.page.name.slice(0, 60), status: 'current', visibility: 'shared', props });
      ops.push({ op: 'link', type: 'part_of', from: `p${i}`, to: docRef });
      idOf.set(key, `{p${i}}`);
      return;
    }
    idOf.set(key, old.id);
    // Drawn the same, it is left as it is, with the commit it was first drawn at: that commit drew it too.
    const { commit: _, ...was } = (old.props.diagram ?? {}) as Record<string, unknown>;
    if (!same(was, diagram) || old.status !== 'current') ops.push({ op: 'update', id: old.id, title: d.page.name.slice(0, 60), status: 'current', props });
  });
  // A page the code no longer draws is kept, as removed.
  for (const k of kept) if (k.status === 'current' && !drawn.some((d) => `${d.file}#${d.page.id}` === k.props.diagram?.key)) ops.push({ op: 'update', id: k.id, status: 'removed' });
  const sections = [...new Set(drawn.map((d) => d.file))].map((file) => [file.replace(/\.drawio$/, '').replace(/^./, (c) => c.toUpperCase()), ...drawn.filter((d) => d.file === file).map((d) => idOf.get(`${d.file}#${d.page.id}`)!)].join('\n'));
  const body = ['The code drawn: its modules, what uses what, and its types down to the seven kinds. Made by npm run diagrams at each push to main; open a page to move about in it.', ...sections].join('\n\n');
  if (!doc) {
    ops.unshift({ op: 'create', ref: 'doc', type: 'work.document', title: DOCUMENT, status: 'ready', visibility: 'shared', body });
    if (into) ops.splice(1, 0, { op: 'link', type: 'part_of', from: 'doc', to: into });
  } else if (doc.body !== body) ops.push({ op: 'update', id: doc.id, body });
  return { ops, reason: `Diagrams drawn at ${commit.slice(0, 7)}` };
}

/** The pages of this checkout, each with its file's link at the commit when the committed file is the one drawn. */
export function drawnHere(root: string, commit: string): Drawn[] {
  const { files, packs } = readCheckout(root);
  const link = githubLink();
  const repo = link?.('x').match(/github\.com\/([^/]+\/[^/]+)\//)?.[1];
  return Object.entries(diagramSets(files, packs, link)).flatMap(([file, pages]) => {
    const committed = (() => {
      try {
        return readFileSync(join(root, 'docs', 'diagrams', file), 'utf8');
      } catch {
        return undefined;
      }
    })();
    const url = repo && committed === mxfile(pages) ? `https://github.com/${repo}/blob/${commit}/docs/diagrams/${file}` : undefined;
    return pages.map((page) => ({ file, page: pageData(page), ...(url && { url }) }));
  });
}

if (import.meta.main) {
  const root = join(import.meta.dirname, '..');
  const [base, token] = [process.env.PELAGO_URL, process.env.PELAGO_TOKEN];
  if (!base || !token) throw new Error('Set PELAGO_URL to the map and PELAGO_TOKEN to an agent token for it.');
  const into = process.argv.includes('--into') ? process.argv[process.argv.indexOf('--into') + 1] : undefined;
  const commit = process.env.GITHUB_SHA ?? execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
  const call = async (tool: string, input: unknown) => {
    const res = await fetch(`${base.replace(/\/$/, '')}/agent/${tool}`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` }, body: JSON.stringify(input) });
    const answer = (await res.json()) as { result?: unknown; error?: string };
    if (answer.error) throw new Error(`${tool}: ${answer.error}`);
    return answer.result;
  };
  const kept = (await call('search', { type: TYPE, limit: 500, include_archived: false })) as Kept[];
  const docs = (await call('search', { type: 'work.document', q: DOCUMENT, limit: 20 })) as { id: string; title: string }[];
  const found = docs.find((d) => d.title === DOCUMENT);
  const doc = found && ((await call('get', { id: found.id, full: true })) as { entity: { id: string; body: string } }).entity;
  const change = diagramChange(drawnHere(root, commit), kept, doc, commit, into);
  if (!change.ops.length) console.log(`Nothing moved since the diagrams were last drawn (${commit.slice(0, 7)}).`);
  else console.log(JSON.stringify(await call('change', { ...change, authority: { of: 'agent', basis: `npm run diagrams at ${commit}` }, source: { uri: commit, kind: 'commit' } })).slice(0, 400));
}
