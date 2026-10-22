// The push reader's evaluation, in one command: `npm run eval:reader`. It exports the fixtures when there are none
// (or with --export), replays every push on each candidate model, scores the replays and names a default model and
// a fallback. What it found is written beside the fixtures, as results/<time>.json and .md.
//
//   --models none,haiku,sonnet   candidates (scripts/reader-eval/candidates.ts): a short name, scaleway (a spread of
//                                its models, small to large), scw:<model>, or provider:model@in/out (a million
//                                tokens); none is the baseline that changes nothing. One without a key is skipped, and said.
//   --since 2026-10-21           export the pushes read since then (default: 14 days)
//   --runs 2                     replay each push this many times on each model
//   --only main@01e12e6,…        replay only these pushes; --limit 10 the first ten
//   --concurrency 2              replays at once of each model (the models run side by side)
//   --online                     ask GitHub (gh) for what was not recorded, and keep it
//   --rescore results/<time>.json score a run again against the labels as they are now, asking no model
//
// Keys come from the environment, or from a file of KEY=value lines named by READER_EVAL_ENV (default: .env beside, or one folder above,
// the fixtures): ANTHROPIC_API_KEY, OPENAI_API_KEY, SCW_SECRET_KEY (and SCW_API_BASE, with a project), and for
// any other OpenAI-compatible server READER_EVAL_URL and READER_EVAL_KEY.

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { closedOf, exportFixtures } from './export.ts';
import { loadAnswers, saveAnswers, standIn } from './github.ts';
import { countCalls, replay, type Candidate } from './replay.ts';
import { asker } from '../../src/model.ts';
import { choose, judge, summarise, type Fixture, type Summary, type Tally } from './score.ts';
import { report } from './report.ts';
import { candidate, expand } from './candidates.ts';
import { rescore, type Kept } from './rescore.ts';

const ROOT = join(import.meta.dirname, '..', '..');
const { values: args } = parseArgs({
  options: {
    export: { type: 'boolean' },
    since: { type: 'string' },
    models: { type: 'string', default: 'none,scaleway' },
    runs: { type: 'string', default: '1' },
    only: { type: 'string' },
    limit: { type: 'string' },
    concurrency: { type: 'string', default: '2' },
    online: { type: 'boolean' },
    repo: { type: 'string' },
    rescore: { type: 'string' },
  },
});

const dir = process.env.READER_EVAL_DIR ?? join(homedir(), '.archipelago-eval', 'reader');
mkdirSync(dir, { recursive: true });
const envFile = process.env.READER_EVAL_ENV ?? [join(dir, '.env'), join(dir, '..', '.env')].find(existsSync) ?? join(dir, '.env');
if (existsSync(envFile)) for (const line of readFileSync(envFile, 'utf8').split(/\r?\n/)) {
  const m = /^\s*([A-Z_]+)\s*=\s*(.*?)\s*$/.exec(line);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
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

// Scored again: a results file's replays against the labels as they are now, with no model asked.
if (args.rescore) {
  const kept = JSON.parse(readFileSync(args.rescore, 'utf8')) as { summaries: Summary[]; perPush: Record<string, Kept[]>; skipped?: string[] };
  const currencyOf = (model: string) => kept.summaries.find((m) => m.model === model)?.currency ?? 'USD';
  const again = rescore(kept.perPush, new Map(fixtures.map((f) => [f.id, f])), closedOf, currencyOf);
  const read = fixtures.filter((f) => f.id in kept.perPush);
  const chosen = choose(again.filter((m) => m.model !== 'none'));
  const out = args.rescore.replace(/\.json$/, '') + '-rescored';
  writeFileSync(`${out}.json`, JSON.stringify({ summaries: again, chosen: { default: chosen.default?.model, fallback: chosen.fallback?.model, why: chosen.why } }, null, 1));
  const md = report(read, again, chosen, kept.skipped ?? []);
  writeFileSync(`${out}.md`, md);
  console.log(`${md}
Written to ${out}.{json,md}`);
  process.exit(0);
}
const specs = expand(args.models).map((s) => candidate(s, process.env, envFile));
const candidates = specs.filter((c): c is Candidate => typeof c !== 'string');
const skipped = specs.filter((c): c is string => typeof c === 'string');
for (const s of skipped) console.log(`Skipped ${s}.`);
// The baseline "none" sends nothing: what doing nothing scores, at no cost. Every other model is asked for real.
countCalls((key, at) => {
  const real = asker(key, at);
  return (params) => (params.model === 'none' ? Promise.resolve({ content: [{ type: 'text', text: 'Nothing needs changing.' }], stop_reason: 'end_turn', usage: { input_tokens: 0, output_tokens: 0 } }) : real(params));
});
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
/** What a run says when the provider, not the model, stopped it (src/agent-run.ts words these). */
const PASSING = /rate limit|answered (408|409|429|5\d\d)|could not be reached|The run broke/i;
const perPush: Record<string, Record<string, unknown>[]> = {};
// The models run side by side, each a few replays at a time: a provider limits each model on its own.
const summaries: Summary[] = await Promise.all(candidates.map(async (c) => {
  console.log(`${c.model}: ${fixtures.length} pushes × ${runs}`);
  const tally: Tally = { model: c.model, currency: c.currency, runs: 0, failed: 0, good: 0, bad: 0, unjudged: 0, copies: 0, closes: { due: 0, made: 0 }, closesAll: { due: 0, made: 0 }, tokens: 0, usd: 0, ms: 0 };
  const jobs = fixtures.flatMap((f) => Array.from({ length: runs }, () => async () => {
    try {
      let done = await replay(f, c, github);
      // A run cut off by the provider's rate limit or an outage says nothing of the model: it is read again, after a
      // pause, and only the run that finished is counted.
      for (let tries = 1; !done.ok && tries <= 4 && PASSING.test(done.summary); tries++) {
        await new Promise((r) => setTimeout(r, 15_000 * tries));
        done = await replay(f, c, github);
      }
      const judged = judge(f, done.sent, closedOf);
      console.log(`  ${c.model} ${f.id}: ${done.ok ? '' : `FAILED (${done.summary.split('\n')[0].slice(0, 120)}) `}${judged.good} good, ${judged.bad} bad, ${judged.unjudged} unjudged, ${c.currency === 'EUR' ? '€' : '$'}${done.usd.toFixed(4)}, ${(done.ms / 1000).toFixed(0)}s`);
      return { f, done, judged };
    } catch (err) {
      console.log(`  ${c.model} ${f.id}: broke: ${(err as Error).message.slice(0, 200)}`);
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
  return summarise(tally);
}));
saveAnswers(answersFile, answers);

const chosen = choose(summaries.filter((m) => m.model !== 'none'));
const at = new Date().toISOString().replace(/[:.]/g, '-');
mkdirSync(join(dir, 'results'), { recursive: true });
const result = { at, fixtures: fixtures.map((f) => ({ id: f.id, labels: f.labels.length, items: f.items.length })), summaries, chosen: { default: chosen.default?.model, fallback: chosen.fallback?.model, why: chosen.why }, skipped, perPush, misses: github.misses };
writeFileSync(join(dir, 'results', `${at}.json`), JSON.stringify(result, null, 1));
const md = report(fixtures, summaries, chosen, skipped);
writeFileSync(join(dir, 'results', `${at}.md`), md);
console.log(`\n${md}\nWritten to ${join(dir, 'results', at)}.{json,md}`);
