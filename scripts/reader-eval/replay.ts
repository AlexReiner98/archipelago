// One push read again, offline: a throwaway map in memory holding the repository and its open items as they stood,
// the stand-in GitHub, and the reader pack itself, unchanged, hearing the push and run by the kernel on the candidate
// model. What it would have sent is what is held for the owner at the end, said back in the fixture's ids.

import { AsyncLocalStorage } from 'node:async_hooks';
import { cpSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDb } from '../../src/db.ts';
import { ACCOUNT, configureModels, type ModelAccount } from '../../src/model-account.ts';
import { asker, type Ask } from '../../src/model.ts';
import { Archipelago, type Op } from '../../src/pelago.ts';
import { Registry } from '../../src/packs.ts';
import { livesInFor } from '../../src/places.ts';
import { hostFor } from '../../src/packtools.ts';
import { setReach } from '../../src/pack-reach.ts';
import '../../src/agent-run.ts';
import { syncTypes } from '../../src/typetable.ts';
import type { StandIn } from './github.ts';
import type { Fixture, Sent } from './score.ts';

export interface Candidate {
  /** As the provider names it. */
  model: string;
  provider: ModelAccount['provider'];
  /** A million tokens, in the currency below. */
  price: { input: number; output: number };
  currency: 'USD' | 'EUR';
  url?: string;
  key?: string;
}

export interface Replayed {
  ok: boolean;
  summary: string;
  sent: Sent[];
  turns: number;
  usage: { input: number; output: number; cache_read: number; cache_write: number };
  /** What it cost, in the candidate's currency. */
  usd: number;
  ms: number;
}

const ROOT = join(import.meta.dirname, '..', '..');
const HUMAN = { kind: 'human' as const, name: 'eval' };

// Every model call of a replay is counted against that replay, however many run at once.
const meter = new AsyncLocalStorage<Replayed['usage']>();
let wrapped = false;
/** Count what each call used. `make` builds the real asker; tests hand in a scripted one. */
export function countCalls(make: (key: string | undefined, at: Parameters<typeof asker>[1]) => Ask = (key, at) => asker(key, at)) {
  wrapped = true;
  configureModels({
    ask: (key, at) => {
      const ask = make(key, at);
      return async (params) => {
        const answer = await ask(params);
        const used = meter.getStore();
        if (used) {
          used.input += answer.usage.input_tokens;
          used.output += answer.usage.output_tokens;
          used.cache_read += answer.usage.cache_read_input_tokens ?? 0;
          used.cache_write += answer.usage.cache_creation_input_tokens ?? 0;
        }
        return answer;
      };
    },
  });
}

/** A map in memory with its own copy of the packs, as the tests make one. */
async function throwaway(): Promise<{ l: Archipelago; done: () => Promise<void> }> {
  const packs = mkdtempSync(join(tmpdir(), 'reader-eval-packs-'));
  cpSync(join(ROOT, 'packs'), packs, { recursive: true });
  const db = await openDb();
  const l = new Archipelago(db, new Registry(packs));
  await syncTypes(l);
  return { l, done: async () => (await db.close(), rmSync(packs, { recursive: true, force: true })) };
}

/** The repository and its open items, in the throwaway map; the ids they were given there, by the fixture's. */
async function seed(l: Archipelago, f: Fixture): Promise<{ repo: string; ids: Map<string, string> }> {
  const known = (t: string) => Boolean(l.registry.type(t));
  const ops: Op[] = [{ op: 'create', ref: 'repo', type: f.repo.entity.type, title: f.repo.entity.title, props: { remote: `https://github.com/${f.repo.name}` } }];
  const lives = livesInFor(l, f.repo.entity.type);
  f.items.forEach((item, n) => {
    // A type this checkout's packs do not have (a workspace's own) is read as a task: the reader only sees its name.
    const type = known(item.type) ? item.type : 'work.task';
    const statuses = l.registry.type(type)?.statuses;
    const status = statuses && [...statuses.open, ...statuses.closed].includes(item.status) ? item.status : undefined;
    ops.push({ op: 'create', ref: `i${n}`, type, title: item.title.slice(0, 200), ...(status && { status }), ...(item.body && { body: item.body }) });
    ops.push({ op: 'link', type: lives, from: `i${n}`, to: 'repo' });
  });
  const done = await l.change(HUMAN, { ops, reason: 'The push as it landed (evaluation)' });
  if (done.status !== 'applied') throw new Error(`The map refused the fixture: ${JSON.stringify(done).slice(0, 500)}`);
  const created = (done as { created: Record<string, string> }).created;
  return { repo: created.repo, ids: new Map(f.items.map((item, n) => [item.id, created[`i${n}`]])) };
}

/** What was held for the owner, in the fixture's ids. */
async function heldBack(l: Archipelago, back: Map<string, string>): Promise<Sent[]> {
  const sent: Sent[] = [];
  for (const p of await l.proposals({ status: 'pending' })) {
    for (const op of p.ops as Record<string, any>[]) {
      if (op.op === 'create') sent.push({ op: 'create', title: String(op.title ?? '') });
      else if (op.op === 'archive') sent.push({ op: 'archive', id: back.get(op.id) ?? op.id });
      else if (op.op === 'update') sent.push({ op: 'update', id: back.get(op.id) ?? op.id, ...(op.status && { status: op.status }), ...(op.title && { title: op.title }), ...(op.append && { append: op.append }) });
    }
  }
  return sent;
}

/** The commits a push carries, as the GitHub pack records them: each its short id and first line. */
function commitsOf(f: Fixture, github: StandIn): Promise<{ sha: string; subject: string }[]> {
  return Promise.all(
    f.commits.map(async (sha) => {
      const c = (await github.asInstallation('eval', `/repos/${f.repo.name}/commits/${sha}`).catch(() => undefined)) as { commit?: { message?: string } } | undefined;
      return { sha: sha.slice(0, 7), subject: String(c?.commit?.message ?? '').split(/\r?\n/)[0] };
    }),
  );
}

// The reader reaches GitHub through the github_app server pack, which the server lends; here the stand-in answers
// in its place, the same for every throwaway map (each asks only about its own push).
let lent: StandIn | undefined;
function lend(github: StandIn, repo: string) {
  if (lent === github) return;
  lent = github;
  setReach({
    hold: () => () => {},
    connection: async () => ({ id: 'eval', account: 'eval' }),
    via: async (_workspace, _pack, _host, path) => {
      if (path.startsWith('/installation/repositories')) return { status: 200, body: { repositories: [{ full_name: repo }] } };
      try {
        return { status: 200, body: await github.asInstallation('eval', path) };
      } catch (err) {
        return { status: 404, body: { message: (err as Error).message } };
      }
    },
  });
}

/** The run the push started, once it is recorded: a run records itself when it ends, well or not. */
async function runOf(l: Archipelago, most = 30 * 60_000): Promise<{ status: string; body: string | null; props: Record<string, unknown> } | undefined> {
  for (const until = Date.now() + most; Date.now() < until; await new Promise((r) => setTimeout(r, 500))) {
    const { rows } = await l.db.query<{ status: string; body: string | null; props: Record<string, unknown> }>(`select status, body, props from entity where type = any($1::text[]) limit 1`, [l.registry.family('sys.run')]);
    if (rows[0]) return rows[0];
  }
  return undefined;
}

export async function replay(f: Fixture, c: Candidate, github: StandIn): Promise<Replayed> {
  if (!wrapped) countCalls();
  lend(github, f.repo.name);
  const { l, done } = await throwaway();
  const usage = { input: 0, output: 0, cache_read: 0, cache_write: 0 };
  try {
    const { repo, ids } = await seed(l, f);
    const account: ModelAccount = { provider: c.provider, key: c.key ?? '', model: c.model, price: c.price, ...(c.url && { url: c.url }) };
    await l.setSecret(ACCOUNT, JSON.stringify(account));
    const event = { action: 'repo.push', target: repo, pack: 'github', detail: { repo: f.repo.name.toLowerCase(), branch: f.push.branch, before: f.push.before, after: f.push.after, commits: await commitsOf(f, github) } };
    const started = Date.now();
    // The push as the GitHub pack tells of it: the reader pack hears it, and asks the kernel for a run, unchanged.
    const heard = (await meter.run(usage, () => hostFor(l.registry).act(l, { kind: 'agent', name: 'pack:reader' }, 'reader', 'repo.push', { event }, 30_000, 'event'))) as { runs?: { started: boolean; reason?: string }[]; answer?: { reason?: string } };
    const start = heard.runs?.[0];
    if (!start?.started) return { ok: false, summary: start?.reason ?? heard.answer?.reason ?? 'The reader started no run.', sent: [], turns: 0, usage, usd: 0, ms: Date.now() - started };
    const run = await meter.run(usage, () => runOf(l));
    const back = new Map([...ids].map(([fixture, here]) => [here, fixture]));
    const usd = (usage.input * c.price.input + usage.output * c.price.output + usage.cache_read * c.price.input * 0.1 + usage.cache_write * c.price.input * 1.25) / 1e6;
    return { ok: run?.status === 'finished', summary: run ? String(run.body ?? '') : 'The run did not end in time.', sent: await heldBack(l, back), turns: Number(run?.props.turns ?? 0), usage, usd, ms: Date.now() - started };
  } finally {
    hostFor(l.registry).stop();
    await done();
  }
}
