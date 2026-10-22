// The push reader's evaluation, in one command: `npm run eval:reader`. It exports the fixtures when there are none
// (or with --export), replays every push on each candidate model, scores the replays and names a default model and
// a fallback. What it found is written beside the fixtures, as results/<time>.json and .md.
//
//   --models haiku,sonnet,opus   candidates: a short name, or provider:model@in/out (US$ a million tokens)
//   --since 2026-10-21           export the pushes read since then (default: 14 days)
//   --runs 2                     replay each push this many times on each model
//   --only main@01e12e6,…        replay only these pushes; --limit 10 the first ten
//   --concurrency 4              replays at once
//   --online                     ask GitHub (gh) for what was not recorded, and keep it
//
// Keys come from the environment, or from a file of KEY=value lines named by READER_EVAL_ENV (default: .env beside
// the fixtures): ANTHROPIC_API_KEY, OPENAI_API_KEY, and for any OpenAI-compatible server READER_EVAL_URL and
// READER_EVAL_KEY.

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { closedOf, exportFixtures } from './export.ts';
import { loadAnswers, saveAnswers, standIn } from './github.ts';
import { replay, type Candidate } from './replay.ts';
import { choose, judge, summarise, type Fixture, type Summary, type Tally } from './score.ts';
import { report } from './report.ts';

const ROOT = join(import.meta.dirname, '..', '..');
const { values: args } = parseArgs({
  options: {
    export: { type: 'boolean' },
    since: { type: 'string' },
    models: { type: 'string', default: 'haiku,sonnet,opus' },
    runs: { type: 'string', default: '1' },
    only: { type: 'string' },
    limit: { type: 'string' },
    concurrency: { type: 'string', default: '4' },
    online: { type: 'boolean' },
    repo: { type: 'string' },
  },
});

const dir = process.env.READER_EVAL_DIR ?? join(homedir(), '.archipelago-eval', 'reader');
mkdirSync(dir, { recursive: true });
const envFile = process.env.READER_EVAL_ENV ?? join(dir, '.env');
if (existsSync(envFile)) for (const line of readFileSync(envFile, 'utf8').split(/\r?\n/)) {
  const m = /^\s*([A-Z_]+)\s*=\s*(.*?)\s*$/.exec(line);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
}

/** The candidates by short name, priced as Anthropic lists them (US$ a million tokens). */
const KNOWN: Record<string, Omit<Candidate, 'key'>> = {
  haiku: { model: 'claude-haiku-5-5', provider: 'anthropic', price: { input: 0.1, output: 0.5 } },
  sonnet: { model: 'claude-sonnet-5-5', provider: 'anthropic', price: { input: 2, output: 10 } },
  opus: { model: 'claude-opus-5-5', provider: 'anthropic', price: { input: 4, output: 20 } },
  fable: { model: 'claude-fable-5-1', provider: 'anthropic', price: { input: 10, output: 50 } },
};

function candidate(spec: string): Candidate {
  const known = KNOWN[spec];
  const m = known ? undefined : /^(anthropic|openai|compatible):([^@]+)@([\d.]+)\/([\d.]+)$/.exec(spec);
  if (!known && !m) throw new Error(`"${spec}" is no candidate: give ${Object.keys(KNOWN).join(', ')}, or provider:model@in/out.`);
  const c: Omit<Candidate, 'key'> = known ?? { model: m![2], provider: m![1] as Candidate['provider'], price: { input: Number(m![3]), output: Number(m![4]) } };
  const key = c.provider === 'anthropic' ? process.env.ANTHROPIC_API_KEY : c.provider === 'openai' ? process.env.OPENAI_API_KEY : process.env.READER_EVAL_KEY;
  if (!key && c.provider !== 'compatible') throw new Error(`No key for ${c.model}: set ${c.provider === 'anthropic' ? 'ANTHROPIC_API_KEY' : 'OPENAI_API_KEY'} (or put it in ${envFile}).`);
  return { ...c, key, ...(c.provider === 'compatible' && { url: process.env.READER_EVAL_URL }) };
}

const repoName = args.repo ?? /github\.com[:/]+([^/\s]+\/[^/\s]+?)(?:\.git)?\s*$/.exec(execFileSync('git', ['-C', ROOT, 'remote', 'get-url', 'origin'], { encoding: 'utf8' }))?.[1];
const pushesDir = join(dir, 'pushes');
if (args.export || !existsSync(pushesDir) || !readdirSync(pushesDir).length) {
  if (!repoName) throw new Error('Name the repository with --repo owner/name.');
  const since = args.since ?? new Date(Date.now() - 14 * 86_400_000).toISOString().slice(0, 10);
  const done = await exportFixtures({ repo: repoName, since, dir, log: (s) => console.log(s) });
  console.log(`Exported ${done.fixtures} pushes with ${done.labels} labels to ${done.dir}.${done.skipped.length ? `\nSkipped:\n  ${done.skipped.join('\n  ')}` : ''}`);
}

const only = args.only?.split(',');
let fixtures = readdirSync(pushesDir)
  .filter((f) => f.endsWith('.json'))
  .map((f) => JSON.parse(readFileSync(join(pushesDir, f), 'utf8')) as Fixture)
  .filter((f) => !only || only.includes(f.id))
  .sort((a, b) => a.push.ts.localeCompare(b.push.ts));
if (args.limit) fixtures = fixtures.slice(0, Number(args.limit));
const candidates = args.models.split(',').map((s) => candidate(s.trim()));
const answersFile = join(dir, 'github.json');
const answers = loadAnswers(answersFile);
const github = standIn(answers, { checkout: ROOT, online: args.online });

/** Run jobs a few at a time. */
async function pool<T>(jobs: (() => Promise<T>)[], width: number): Promise<T[]> {
  const out: T[] = new Array(jobs.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(width, jobs.length) }, async () => {
    while (next < jobs.length) {
      const n = next++;
      out[n] = await jobs[n]();
    }
  }));
  return out;
}

const runs = Number(args.runs);
const perPush: Record<string, Record<string, unknown>[]> = {};
const summaries: Summary[] = [];
for (const c of candidates) {
  console.log(`\n${c.model}: ${fixtures.length} pushes × ${runs}`);
  const tally: Tally = { model: c.model, runs: 0, failed: 0, good: 0, bad: 0, unjudged: 0, copies: 0, closes: { due: 0, made: 0 }, closesAll: { due: 0, made: 0 }, tokens: 0, usd: 0, ms: 0 };
  const jobs = fixtures.flatMap((f) => Array.from({ length: runs }, () => async () => {
    try {
      const done = await replay(f, c, github);
      const judged = judge(f, done.sent, closedOf);
      console.log(`  ${f.id}: ${done.ok ? '' : 'FAILED '}${judged.good} good, ${judged.bad} bad, ${judged.unjudged} unjudged, $${done.usd.toFixed(4)}, ${(done.ms / 1000).toFixed(0)}s`);
      return { f, done, judged };
    } catch (err) {
      console.log(`  ${f.id}: broke: ${(err as Error).message.slice(0, 200)}`);
      return { f, error: (err as Error).message };
    }
  }));
  for (const r of await pool(jobs, Number(args.concurrency))) {
    tally.runs++;
    (perPush[r.f.id] ??= []).push({ model: c.model, ...('error' in r ? { error: r.error } : { ok: r.done.ok, usd: r.done.usd, ms: r.done.ms, turns: r.done.turns, usage: r.done.usage, judged: r.judged, summary: r.done.summary.slice(0, 400) }) });
    if ('error' in r || !r.done.ok) tally.failed++;
    if ('error' in r) continue;
    const { done, judged } = r;
    tally.good += judged.good;
    tally.bad += judged.bad;
    tally.unjudged += judged.unjudged;
    tally.copies += judged.copies;
    for (const k of ['closes', 'closesAll'] as const) (tally[k].due += judged[k].due), (tally[k].made += judged[k].made);
    tally.tokens += done.usage.input + done.usage.output + done.usage.cache_write;
    tally.usd += done.usd;
    tally.ms += done.ms;
  }
  summaries.push(summarise(tally));
}
saveAnswers(answersFile, answers);

const chosen = choose(summaries);
const at = new Date().toISOString().replace(/[:.]/g, '-');
mkdirSync(join(dir, 'results'), { recursive: true });
const result = { at, fixtures: fixtures.map((f) => ({ id: f.id, labels: f.labels.length, items: f.items.length })), summaries, chosen: { default: chosen.default?.model, fallback: chosen.fallback?.model, why: chosen.why }, perPush, misses: github.misses };
writeFileSync(join(dir, 'results', `${at}.json`), JSON.stringify(result, null, 1));
const md = report(fixtures, summaries, chosen);
writeFileSync(join(dir, 'results', `${at}.md`), md);
console.log(`\n${md}\nWritten to ${join(dir, 'results', at)}.{json,md}`);
