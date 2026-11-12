// The push handler: GitHub tells the map a branch moved, and the island follows. A handler keeps nothing between calls
// and hears an outside answer only as a later call, so the sync is a chain of calls, each asking GitHub one thing:
//
//   push       the webhook: a push to main of a repository the island stands on asks what changed since (compare)
//   compared   the changed files read off the comparison; runOf says what to redo. A run that needs every module or
//              test (roots.json, the slow set) is the full check's, not a push's: the island stays and says so.
//              Otherwise it asks for the files, listing the manifests first when they are to be redone (list)
//   listed     the manifests' blob ids read off the listing; it asks for every file (fetch)
//   fetched    the files in hand, the island read, the plan sent as one change with the sync item moved on
//
// What a step needs of the steps before rides in its GraphQL query as a comment, sent back with GitHub's answer. The
// handler reads the map, never writes it: it answers with a change, which the kernel applies under the map's rules.

import { extract, runOf, type Change } from './extract.ts';
import { keyOf, type Source } from './model.ts';
import { plan, type Held, type Island } from './plan.ts';
import { risen, rose } from './guard.ts';

/** A repository the island stands on: its name on GitHub, the commit synced, and which repository it is to the code. */
export interface Repo { name: string; sha: string; repo: Source['repo'] }
/** What rides from step to step. */
interface State { repos: Repo[]; pushed: string; head: string; changes: Change[]; files?: { alias: string; repo: number; path: string; oid: string }[] }
type Ctx = { read: (q: Record<string, unknown>) => Promise<any> };
type Request = { host: string; method?: string; path: string; body?: unknown; then: string };
const MAIN = 'refs/heads/main';
const MARK = '# anatomy ';
const WHOLE_MANIFESTS = /^(packs|workspace-packs)\/[^/]+\/(pack|bundle)\.json$/;

/** The repositories the sync item says the island stands at, the open core first: `owner/name@sha` a line. */
export const reposOf = (commits: unknown): Repo[] =>
  String(commits ?? '').split('\n').filter(Boolean).map((line, i) => {
    const [name, sha] = line.split('@');
    return { name, sha, repo: i === 0 ? 'open_core' : 'hosted' };
  });

const graphql = (state: State, query: string, then: string): Request => ({ host: 'github', method: 'POST', path: '/graphql', body: { query: `${MARK}${JSON.stringify(state)}\n${query}` }, then });
const stateOf = (input: any): State => JSON.parse(String(input?.request?.body?.query ?? '').split('\n')[0].slice(MARK.length));
const [owner, name] = [(r: Repo) => r.name.split('/')[0], (r: Repo) => r.name.split('/')[1]];
const quote = (s: string) => JSON.stringify(s);

async function syncItem(ctx: Ctx): Promise<Held | undefined> {
  const [item] = await ctx.read({ items: { type: 'anatomy.sync' }, fields: ['commits', 'island', 'full'] });
  return item;
}

/** The webhook: a push to main of a repository the island stands on asks GitHub what changed since the island's commit. */
export async function push(input: { payload: any; headers?: Record<string, string> }, ctx: Ctx) {
  const p = input.payload ?? {};
  if (input.headers?.['x-github-event'] && input.headers['x-github-event'] !== 'push') return { answer: { synced: false, reason: 'Only a push moves the island.' } };
  if (p.ref !== MAIN) return { answer: { synced: false, reason: `Only main moves the island, not ${p.ref}.` } };
  const sync = await syncItem(ctx);
  if (!sync) return { answer: { synced: false, reason: 'The island has no sync item: run scripts/anatomy.ts --full first.' } };
  const repos = reposOf(sync.props.commits);
  const pushed = repos.find((r) => r.name === p.repository?.full_name);
  if (!pushed) return { answer: { synced: false, reason: `The island does not stand on ${p.repository?.full_name}.` } };
  if (pushed.sha === p.after) return { answer: { synced: false, reason: 'The island already stands at this commit.' } };
  const state: State = { repos, pushed: pushed.name, head: p.after, changes: [] };
  // The compare's path carries the state's commits; its answer's request is read back for them.
  return { requests: [{ host: 'github', path: `/repos/${pushed.name}/compare/${pushed.sha}...${p.after}`, then: 'anatomy_sync.compared' }], answer: { synced: 'asked', from: pushed.sha, to: p.after }, reason: `Pack anatomy: ${pushed.name} moved to ${String(p.after).slice(0, 8)}` };
}

/** git's statuses as GitHub's comparison names them. */
export const changesOf = (files: any[]): Change[] =>
  (files ?? []).map((f) => (f.status === 'renamed' ? { status: 'R' as const, path: f.filename, from: f.previous_filename } : { status: (f.status === 'removed' ? 'D' : f.status === 'added' || f.status === 'copied' ? 'A' : 'M') as Change['status'], path: f.filename }));

/** The comparison is in: what to redo, and the files to ask for. */
export async function compared(input: any, ctx: Ctx) {
  if (input.status !== 200) return { answer: { synced: false, reason: `GitHub answered the comparison with ${input.status}.` } };
  const sync = await syncItem(ctx);
  const repos = reposOf(sync?.props.commits);
  const path = String(input.request.path);
  const [, pushedName, , head] = /^\/repos\/([^/]+\/[^/]+)\/compare\/([0-9a-f]+)\.\.\.([0-9a-f]+)$/.exec(path) ?? [];
  const changes = changesOf(input.body?.files);
  const run = runOf(changes);
  const state: State = { repos, pushed: pushedName, head, changes };
  if (run.extractors.some((e) => !e.only && (e.extractor.id === 'modules' || e.extractor.id === 'tests'))) return { answer: { synced: false, reason: 'This push changes a file every module or test is read with: run scripts/anatomy.ts --full.' } };
  const at = (r: Repo) => (r.name === pushedName ? head : r.sha);
  const wanted = (r: Repo) => (p: string) => run.extractors.some(({ extractor, only }) => extractor.owns(p) && (!only || only.has(p) || !!extractor.whole?.(p)));
  // Each repository's changed files by their blob id, and the checks' and roots' files by path where those runs need them.
  const files: State['files'] = [];
  let n = 0;
  for (const [i, r] of repos.entries()) {
    if (r.name !== pushedName) continue;
    for (const f of input.body?.files ?? []) if (f.status !== 'removed' && wanted(r)(f.filename)) files.push({ alias: `f${n++}`, repo: i, path: f.filename, oid: f.sha });
  }
  const byPath = (p: string) => repos.flatMap((r, i) => (r.repo === 'open_core' && wanted(r)(p) && !files.some((f) => f.path === p) ? [{ alias: `f${n++}`, repo: i, path: p, oid: '' }] : []));
  files.push(...byPath('test/structure.test.ts'), ...byPath('packs/roots.json'), ...byPath('test/sets.ts'));
  const manifests = run.extractors.some((e) => e.extractor.id === 'manifests');
  if (!manifests) return { requests: [graphql({ ...state, files }, fetchQuery(repos, files, at), 'anatomy_sync.fetched')] };
  // The manifests are redone in whole: list each repository's pack folders first, for their manifests' blob ids.
  const list = repos.map((r, i) => `r${i}: repository(owner: ${quote(owner(r))}, name: ${quote(name(r))}) { ${['packs', 'workspace-packs'].map((top) => `${top.replace('-', '_')}: object(expression: ${quote(`${at(r)}:${top}`)}) { ... on Tree { entries { name object { ... on Tree { entries { name oid } } } } } }`).join(' ')} }`).join('\n');
  return { requests: [graphql({ ...state, files }, `query {\n${list}\n}`, 'anatomy_sync.listed')] };
}

/** The GraphQL that fetches files: by blob id, or by commit and path where the id is not known. */
function fetchQuery(repos: Repo[], files: NonNullable<State['files']>, at: (r: Repo) => string): string {
  const blocks = repos.map((r, i) => {
    const mine = files.filter((f) => f.repo === i);
    if (!mine.length) return '';
    const objects = mine.map((f) => `${f.alias}: object(${f.oid ? `oid: ${quote(f.oid)}` : `expression: ${quote(`${at(r)}:${f.path}`)}`}) { ... on Blob { oid text } }`).join(' ');
    return `r${i}: repository(owner: ${quote(owner(r))}, name: ${quote(name(r))}) { ${objects} }`;
  });
  return `query {\n${blocks.filter(Boolean).join('\n')}\n}`;
}

/** The pack folders are listed: every manifest joins the files to fetch. */
export async function listed(input: any) {
  const state = stateOf(input);
  if (input.status !== 200 || input.body?.errors) return { answer: { synced: false, reason: `GitHub answered the listing with ${input.status}: ${JSON.stringify(input.body?.errors ?? '').slice(0, 300)}` } };
  const files = [...(state.files ?? [])];
  let n = files.length;
  for (const [i] of state.repos.entries()) {
    const data = input.body?.data?.[`r${i}`] ?? {};
    for (const top of ['packs', 'workspace-packs']) for (const folder of data[top.replace('-', '_')]?.entries ?? []) for (const f of folder.object?.entries ?? []) {
      const path = `${top}/${folder.name}/${f.name}`;
      if (WHOLE_MANIFESTS.test(path) && !files.some((x) => x.repo === i && x.path === path)) files.push({ alias: `f${n++}`, repo: i, path, oid: f.oid });
    }
  }
  const at = (r: Repo) => (r.name === state.pushed ? state.head : r.sha);
  return { requests: [graphql({ ...state, files }, fetchQuery(state.repos, files, at), 'anatomy_sync.fetched')] };
}

/** The island as the map holds it, read in one flat read with every field, keyed as the extractors key it. */
export async function islandOf(ctx: Ctx, island: string): Promise<Island> {
  const flat = await ctx.read({ flat: { find: [{ sort: 'island', end: island, as: `island ${island}`, at: [island] }], only: [], not: [], walk: { over: [], steps: 0 }, limit: 2000, whole: 'all' } });
  const items = new Map<string, Held>((flat.items ?? []).map((i: any) => [i.id, { id: i.id, type: i.type, title: i.title, body: i.body ?? '', props: i.props ?? {} }]));
  const links = (flat.links ?? []).map((l: any) => ({ id: l.id, type: l.type, from: l.from_id ?? l.from, to: l.to_id ?? l.to }));
  const packOf = new Map<string, string>();
  for (const l of links) if (l.type === 'part_of' && items.get(l.to)?.type === 'anatomy.pack') packOf.set(l.from, String(items.get(l.to)!.props.pack_id));
  const byKey = new Map<string, Held>(), keyById = new Map<string, string>();
  for (const i of items.values()) { const k = keyOf(i.type, i.props, packOf.get(i.id)); if (k && !byKey.has(k)) { byKey.set(k, i); keyById.set(i.id, k); } }
  return { island, byKey, keyById, links };
}

/** The files are in: the island brought to the pushed commit, as one change. */
export async function fetched(input: any, ctx: Ctx) {
  const state = stateOf(input);
  if (input.status !== 200 || input.body?.errors) return { answer: { synced: false, reason: `GitHub answered the files with ${input.status}: ${JSON.stringify(input.body?.errors ?? '').slice(0, 300)}` } };
  const sync = await syncItem(ctx);
  if (!sync) return { answer: { synced: false, reason: 'The island has no sync item.' } };
  const files: Source[] = (state.files ?? []).flatMap((f) => {
    const blob = input.body?.data?.[`r${f.repo}`]?.[f.alias];
    return blob?.text !== undefined ? [{ path: f.path, text: blob.text, blob: blob.oid ?? f.oid, repo: state.repos[f.repo].repo }] : [];
  });
  const island = await islandOf(ctx, String(sync.props.island));
  const run = runOf(state.changes);
  const want = extract(files, run, new Set(island.byKey.keys()));
  const commits = state.repos.map((r) => `${r.name}@${r.name === state.pushed ? state.head : r.sha}`).join('\n');
  // CI lets a ratchet list grow (the structure test takes it as the allowance), so the handler keeps the guard too: the
  // island stays at its commit, and a later push still compares from there, until the code is fixed or a forced full run.
  const rises = risen(want, island);
  if (rises.length) return { answer: { synced: false, reason: rose(rises) } };
  want.items.push({ key: 'sync', type: 'anatomy.sync', title: 'Where the island stands', body: '', props: { commits, full: false } });
  const { ops, counts } = plan(want, island, run);
  const reason = `Pack anatomy: ${state.pushed} brought to ${state.head.slice(0, 8)} (${Object.entries(counts).filter(([, n]) => n).map(([k, n]) => `${k} ${n}`).join(', ') || 'only the commit'})`;
  // A chained answer's ops are what the kernel applies (packs/loader/kernel/outside.ts, answer), as one change.
  return { ops, reason, answer: { synced: true, counts } };
}
