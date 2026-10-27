// Fixtures from the map's history: each push the reader read, with the open items as they stood, GitHub's answers
// for it, and the labels its read earned (scripts/reader-eval/history.ts). Read from the map this machine is
// connected to (PELAGO_URL, with its agent token), through the same tools an agent has; GitHub through gh.
//
// The fixtures hold the map's own titles, so they are written outside the repository (READER_EVAL_DIR, or
// ~/.archipelago-eval/reader), never into it.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { Registry } from '../../src/packs.ts';
import { gh, loadAnswers, saveAnswers, type Answers } from './github.ts';
import { commitCloses, readerLabels, rewind, settle, type Ev, type Label, type Now, type ReaderChange } from './history.ts';
import type { Fixture } from './score.ts';

const ROOT = join(import.meta.dirname, '..', '..');
/** A path or ref as part of an address, as the reader writes it (packs/reader/github.js), so a recorded answer is found by the same key. */
const within = (path: unknown) => String(path ?? '').split('/').map(encodeURIComponent).join('/');
const registry = new Registry(join(ROOT, 'packs'));
const WORK = ['task', 'decision', 'issue'].flatMap((t) => registry.family(t));
/** A type the packs here do not know (a workspace's own) is closed by the words most types use. */
const CLOSED = ['done', 'dropped', 'resolved', 'wontfix', 'decided', 'cancelled', 'superseded', 'shipped', 'closed'];
export const closedOf = (type: string): string[] => registry.type(type)?.statuses?.closed ?? CLOSED;

/** One of the map's tools, as an agent calls it over HTTP. */
async function ask<T>(tool: string, input: Record<string, unknown>): Promise<T> {
  const url = process.env.PELAGO_URL?.replace(/\/$/, '');
  const token = process.env.PELAGO_AGENT_TOKEN;
  if (!url || !token) throw new Error('PELAGO_URL and PELAGO_AGENT_TOKEN name the map to read: the setup sets both.');
  const res = await fetch(`${url}/agent/${tool}`, { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify({ actor: 'reader-eval', ...input }) });
  const body = (await res.json().catch(() => ({}))) as { result?: T; error?: string };
  if (!res.ok || body.result === undefined) throw new Error(`${tool}: ${body.error ?? `HTTP ${res.status}`}`);
  return body.result;
}

/** Every event since a moment, oldest first. */
async function eventsSince(since: string): Promise<Ev[]> {
  const out: Ev[] = [];
  let before: number | undefined;
  for (;;) {
    const page = await ask<Ev[]>('events', { since, limit: 500, full: true, ...(before && { before }) });
    out.push(...page);
    if (page.length < 500) break;
    before = page.at(-1)!.seq;
  }
  return out.sort((a, b) => a.seq - b.seq);
}

interface Got {
  entity: { id: string; type: string; title: string; status: string; body?: string; created_at: string; archived_at: string | null };
  outgoing?: { type: string; id: string }[];
}

export interface Exported {
  dir: string;
  fixtures: number;
  labels: number;
  skipped: string[];
}

/** Export the pushes to one repository since a moment. `repo` is its GitHub name, "owner/name". */
export async function exportFixtures(opts: { repo: string; since: string; dir: string; log?: (s: string) => void }): Promise<Exported> {
  const log = opts.log ?? (() => {});
  mkdirSync(join(opts.dir, 'pushes'), { recursive: true });
  const work = await ask<{ repo: { id: string; title: string }; ready: { id: string }[]; blocked: { id: string }[] }>('view', { name: 'repo_work', params: { repo: opts.repo, full: true } });
  const repoId = work.repo.id;
  const repoEntity = (await ask<Got>('get', { id: repoId })).entity;
  log(`Reading the log since ${opts.since}…`);
  const events = await eventsSince(opts.since);
  const proposals = (await Promise.all(['approved', 'rejected', 'superseded', 'pending'].map((status) => ask<any[]>('proposals', { status })))).flat().filter((p) => p.actor === 'agent:reader');

  // Every item that is the repository's now, or was while these events happened: by what it lives in or is part of.
  const got = new Map<string, Got | null>();
  const fetchItem = async (id: string) => {
    if (!got.has(id)) got.set(id, await ask<Got>('get', { id }).catch(() => null));
    return got.get(id)!;
  };
  const belongs = new Map<string, boolean>();
  const isOurs = async (id: string, depth = 0): Promise<boolean> => {
    if (id === repoId) return true;
    if (belongs.has(id) || depth > 6) return belongs.get(id) ?? false;
    belongs.set(id, false);
    const g = await fetchItem(id);
    const up = (g?.outgoing ?? []).filter((r) => /lives_in$|^part_of$/.test(r.type));
    for (const r of up) if (await isOurs(r.id, depth + 1)) return (belongs.set(id, true), true);
    return false;
  };
  const candidates = new Set([...work.ready, ...work.blocked].map((i) => i.id));
  for (const e of events) if (e.target_id && e.target_type && WORK.includes(e.target_type)) candidates.add(e.target_id);
  const now = new Map<string, Now>();
  for (const id of candidates) {
    if (!(await isOurs(id))) continue;
    const e = (await fetchItem(id))!.entity;
    if (!WORK.includes(e.type)) continue;
    now.set(id, { id, type: e.type, title: e.title, status: e.status, created_at: e.created_at, archived: Boolean(e.archived_at), ...(e.body && { body: e.body.slice(0, 800) }) });
  }
  log(`${now.size} items are or were the repository's.`);

  // The pushes the reader read: each run names its branch and head; the push is the latest one heard like it.
  const pushes = events.filter((e) => e.action === 'repo.push' && e.target_id === repoId && e.detail?.after && e.detail?.branch);
  const runs = events
    .filter((e) => e.actor === 'agent:reader' && e.action === 'entity.create' && e.target_type === 'run')
    .flatMap((e) => {
      const m = /^Read the push to (.+) \(([0-9a-f]{7})\)$/.exec(e.detail?.title ?? '');
      const push = m && pushes.filter((p) => p.detail.branch === m[1] && String(p.detail.after).startsWith(m[2]) && p.ts <= e.ts).at(-1);
      return push ? [{ end: e.ts, push }] : [];
    });

  // What the reader sent for each run: proposals by the commit they cite, changes made at once by when they were made.
  const sentFor = new Map<number, ReaderChange[]>(runs.map((_, n) => [n, []]));
  const runOf = (ts: string, after?: string) => {
    const fits = runs.map((r, n) => ({ r, n })).filter(({ r }) => r.push.ts <= ts && r.end >= ts && (!after || r.push.detail.after === after));
    return fits.sort((a, b) => a.r.end.localeCompare(b.r.end))[0]?.n;
  };
  for (const p of proposals) {
    const n = runOf(p.ts, /commit\/([0-9a-f]{40})/.exec(p.source?.uri ?? '')?.[1]);
    if (n !== undefined) sentFor.get(n)!.push({ from: p.id, ts: p.ts, status: p.status, ops: p.ops });
  }
  const applied = new Map<string, ReaderChange>();
  for (const e of events) {
    if (e.actor !== 'agent:reader' || !e.target_id || !e.target_type || e.target_type.startsWith('sys.') || !e.changeset) continue;
    const c = applied.get(e.changeset) ?? { from: e.changeset, ts: e.ts, status: 'applied' as const, ops: [] };
    applied.set(e.changeset, c);
    if (e.action === 'entity.create') c.ops.push({ op: 'create', title: e.detail?.title, made: e.target_id });
    else if (e.action === 'entity.archive') c.ops.push({ op: 'archive', id: e.target_id });
    else if (e.action === 'entity.update') {
      const ch = e.detail?.changes ?? {};
      const op = { op: 'update', id: e.target_id, ...(ch.status && { status: ch.status.to }), ...(ch.title && { title: ch.title.to }), ...(ch.body && { append: '…' }) };
      if (Object.keys(op).length > 2) c.ops.push(op);
    }
  }
  for (const c of applied.values()) {
    const n = runOf(c.ts);
    if (n !== undefined && c.ops.length) sentFor.get(n)!.push(c);
  }

  const answersFile = join(opts.dir, 'github.json');
  const answers: Answers = loadAnswers(answersFile);
  const record = (path: string) => (answers[path] ??= gh(path));
  const overrides = existsSync(join(opts.dir, 'overrides.json')) ? (JSON.parse(readFileSync(join(opts.dir, 'overrides.json'), 'utf8')) as { push: string; label: Label }[]) : [];
  const out: Exported = { dir: opts.dir, fixtures: 0, labels: 0, skipped: [] };
  const all = [...now.values()];
  const defaultBranch = String((record(`/repos/${opts.repo}`) as { default_branch?: string }).default_branch ?? 'main');
  for (const [n, run] of runs.entries()) {
    const d = run.push.detail;
    const id = `${String(d.branch).replace(/[^\w.-]+/g, '-')}@${String(d.after).slice(0, 7)}`;
    const fresh = /^0+$/.test(d.before ?? '0');
    const base = fresh ? defaultBranch : String(d.before);
    const prefix = `/repos/${opts.repo}`;
    let compared: { commits: { sha: string }[] };
    try {
      const asked = `${prefix}/compare/${within(base)}...${within(d.after)}?per_page=100`;
      // A new branch is compared by the reader with the default branch as it was then. Merged since, it would compare
      // as nothing now: so the answer kept for that question is the comparison with the first commit's parent.
      const first = fresh ? (d.commits as { sha: string }[] | undefined)?.[0]?.sha : undefined;
      const parent = first && (record(`${prefix}/commits/${first}`) as { parents: { sha: string }[] }).parents[0]?.sha;
      compared = (parent ? (answers[asked] = record(`${prefix}/compare/${parent}...${within(d.after)}?per_page=100`)) : record(asked)) as typeof compared;
    } catch (err) {
      out.skipped.push(`${id}: GitHub could not compare it (${(err as Error).message.split('\n')[0].slice(0, 120)})`);
      continue;
    }
    const commits = compared.commits.map((c) => c.sha);
    for (const sha of commits) {
      const full = record(`${prefix}/commits/${sha}`);
      answers[`${prefix}/commits/${sha.slice(0, 7)}`] ??= full;
    }
    const open = rewind(all, events, run.push.ts, closedOf);
    const later = events.filter((e) => e.ts > run.push.ts);
    const labels = settle([
      ...readerLabels(sentFor.get(n)!, later, open, now, closedOf),
      ...(d.branch === defaultBranch ? commitCloses(later, commits, open, now, closedOf) : []),
      ...overrides.filter((o) => String(d.after).startsWith(o.push)).map((o) => o.label),
    ]);
    const fixture: Fixture = {
      id,
      repo: { name: opts.repo, entity: { id: repoId, title: repoEntity.title, type: repoEntity.type } },
      push: { branch: d.branch, default_branch: defaultBranch, before: d.before ?? '0'.repeat(40), after: d.after, ts: run.push.ts },
      commits,
      items: open,
      labels,
    };
    writeFileSync(join(opts.dir, 'pushes', `${id}.json`), JSON.stringify(fixture, null, 1));
    out.fixtures++;
    out.labels += labels.length;
    log(`${id}: ${open.length} open items, ${commits.length} commits, ${labels.length} labels`);
  }
  saveAnswers(answersFile, answers);
  return out;
}
