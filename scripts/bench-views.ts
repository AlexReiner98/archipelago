// How long the heavy reads and a typical write take, end to end, against a running server's /agent tools:
//   node scripts/bench-views.ts [http://127.0.0.1:3100] [runs]
//   node scripts/bench-views.ts <base> --seed 20000      fill an empty throwaway server with a large map first
// Each call is warmed up, then timed RUNS times (20); the median and the 95th percentile are given in ms, with the
// size of the answer. What is read is picked from the map (the largest hub, the repository, the busiest item, an
// open task) unless named: HUB, REPO, BUSY, TASK. The change is undone after each run, untimed.
// Only ever against a scratch map: the dev server's pulled copy, or a throwaway one with its own data folder.
// A database without table statistics plans the scope query badly: on 20,000 items the handoff took over 20 s
// without them and 0.7 s with. The server collects them as it opens, after a restore and after enough writes
// (src/stats.ts); a server that has just started also takes a backup, so let that finish before timing.

const args = process.argv.slice(2);
const seed = args.includes('--seed') ? Number(args[args.indexOf('--seed') + 1]) : 0;
const [base = 'http://127.0.0.1:3100', runsArg = '20'] = args.filter((a, i) => !a.startsWith('--') && args[i - 1] !== '--seed');
const RUNS = Number(runsArg);
const ACTOR = 'bench';

async function call(tool: string, body: Record<string, unknown> = {}): Promise<{ result: any; bytes: number }> {
  const res = await fetch(`${base}/agent/${tool}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ actor: ACTOR, ...body }) });
  const text = await res.text();
  const json = JSON.parse(text);
  if (!res.ok || json.error) throw new Error(`${tool}: ${json.error ?? res.status}`);
  return { result: json.result, bytes: text.length };
}

/** A large map of projects and tasks, in proportions like the live one's: most work part_of a project, some depending on other work, a few waiting on a person. */
async function fill(count: number) {
  const people: string[] = [];
  const made = (await call('change', { reason: 'bench: people', ops: Array.from({ length: 12 }, (_, i) => ({ op: 'create', ref: `p${i}`, type: 'person', title: `Person ${i}` })) })).result.created;
  people.push(...Object.values(made as Record<string, string>));
  const projects = Math.max(1, Math.round(count / 40));
  const ids: string[] = [];
  const parents: string[] = [];
  const word = (i: number) => ['roof', 'wall', 'sun', 'model', 'export', 'render', 'review', 'site', 'sheet', 'grid'][i % 10];
  let done = 0;
  const t0 = performance.now();
  while (done < count) {
    const ops: Record<string, unknown>[] = [];
    const batch = Math.min(500, count - done);
    for (let j = 0; j < batch; j++) {
      const n = done + j;
      const project = n < projects;
      ops.push({ op: 'create', ref: `n${j}`, type: project ? 'work.project' : 'work.task', title: `${project ? 'Project' : 'Task'} ${n}: ${word(n)} ${word(n * 7)}`, status: project ? 'active' : ['todo', 'doing', 'done', 'done', 'todo'][n % 5], body: `About the ${word(n)} of ${word(n * 3)}, for the ${word(n * 11)}.` });
      // A project sits in another one a tenth of the time; a task in a project, or in a task (a subtask) a fifth of the time.
      const parent = project ? (n > 0 && n % 10 === 0 ? parents[n % parents.length] : undefined) : n % 5 === 0 && ids.length > projects ? ids[projects + ((n * 31) % (ids.length - projects))] : parents[n % parents.length];
      if (parent) ops.push({ op: 'link', type: 'part_of', from: `n${j}`, to: parent });
      if (!project && ids.length > projects && n % 3 === 0) ops.push({ op: 'link', type: 'depends_on', from: `n${j}`, to: ids[projects + ((n * 17) % (ids.length - projects))] });
      if (!project && n % 25 === 0) ops.push({ op: 'link', type: 'waits_on', from: `n${j}`, to: people[n % people.length], props: { for: 'An answer' } });
    }
    const created = (await call('change', { reason: `bench: items ${done} to ${done + batch}`, ops })).result.created as Record<string, string>;
    for (let j = 0; j < batch; j++) {
      ids.push(created[`n${j}`]);
      if (done + j < projects) parents.push(created[`n${j}`]);
    }
    done += batch;
    process.stderr.write(`\r${done} items, ${((performance.now() - t0) / 1000).toFixed(0)} s`);
  }
  process.stderr.write('\n');
  await repo(parents.filter((_, i) => i % 4 === 0));
}

/** A repository a quarter of the projects live in, for the handoff to read. */
async function repo(projects: string[]) {
  const ops: Record<string, unknown>[] = [{ op: 'create', ref: 'r', type: 'software.repo', title: 'Bench repo' }];
  for (const id of projects) ops.push({ op: 'link', type: 'software.lives_in', from: id, to: 'r' });
  await call('change', { reason: 'bench: a repository', ops });
}

const percentile = (sorted: number[], p: number) => sorted[Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)];

async function time(label: string, run: () => Promise<{ bytes: number }>, after?: () => Promise<unknown>) {
  // A call that fails (a pack view stopped at its time limit) is reported, once, and the rest go on.
  try {
    await run();
    await after?.();
  } catch (err) {
    console.log(`${label.padEnd(34)} failed: ${(err as Error).message}`);
    return { label, error: (err as Error).message };
  }
  for (let i = 1; i < 3; i++) {
    await run();
    await after?.();
  }
  const ms: number[] = [];
  let bytes = 0;
  for (let i = 0; i < RUNS; i++) {
    const t = performance.now();
    bytes = (await run()).bytes;
    ms.push(performance.now() - t);
    await after?.();
  }
  ms.sort((a, b) => a - b);
  const row = { label, median: Math.round(percentile(ms, 50)), p95: Math.round(percentile(ms, 95)), kb: Math.round(bytes / 1024) };
  console.log(`${label.padEnd(34)} ${String(row.median).padStart(7)} ${String(row.p95).padStart(7)} ${String(row.kb).padStart(7)}`);
  return row;
}

if (seed) await fill(seed);

const view = (name: string, params: Record<string, unknown> = {}) => () => call('view', { name, params });
const hubs = (await call('view', { name: 'hubs' })).result.hubs as { id: string; inside: number }[];
const HUB = process.env.HUB ?? hubs[0]?.id;
const relations = async (id: string) => ((r) => r.incoming.length + r.outgoing.length)((await call('get', { id })).result);
let REPO = process.env.REPO;
if (!REPO) {
  // The repository with the most on it: the one a session's handoff is heaviest for.
  let most = -1;
  for (const { id } of (await call('search', { type: 'software.repo', limit: 20 }).catch(() => ({ result: [] }))).result as { id: string }[]) {
    const n = await relations(id);
    if (n > most) [most, REPO] = [n, id];
  }
}
const TASK = process.env.TASK ?? (await call('search', { type: 'work.task', open: true, limit: 1 })).result[0]?.id;
// A map with no owner set (a throwaway one) has no "me": one person's attention stands in.
const PERSON = process.env.PERSON ?? (await call('view', { name: 'attention', params: { person: 'me', limit: 1 } }).then(() => 'me', async () => (await call('search', { type: 'person', limit: 1 })).result[0]?.id));
let BUSY = process.env.BUSY;
if (!BUSY) {
  let most = -1;
  for (const id of [REPO, ...hubs.slice(0, 5).map((h) => h.id)].filter(Boolean)) {
    const n = await relations(id!);
    if (n > most) [most, BUSY] = [n, id];
  }
}
console.log(`${base}: hub ${HUB} (${hubs[0]?.inside} inside), repo ${REPO ?? 'none'}, busy ${BUSY}, task ${TASK}; ${RUNS} runs after 3 warm-ups`);
console.log(`${'call'.padEnd(34)} ${'median'.padStart(7)} ${'p95'.padStart(7)} ${'KB'.padStart(7)}`);

const rows = [
  await time('view attention (everyone)', view('attention')),
  await time(`view attention (person ${PERSON === 'me' ? 'me' : 'one'})`, view('attention', { person: PERSON })),
  await time('view lens (whole map)', view('lens')),
  await time(`view lens (from hub)`, view('lens', { from: HUB })),
  ...(REPO ? [await time('view handoff (repo)', view('handoff', { repo: REPO }))] : []),
  await time('view brief (task)', view('brief', { task: TASK })),
  await time('get (busiest item)', () => call('get', { id: BUSY })),
  await time('search "model export"', () => call('search', { q: 'model export', limit: 20 })),
  await time('search "review"', () => call('search', { q: 'review', limit: 20 })),
  // Nothing found as typed: titles with a word close to it are taken instead.
  await time('search "rendr" (a slip)', () => call('search', { q: 'rendr', limit: 20 })),
];
// A typical change: a task made inside the hub, linked to the one being briefed, and a note added to that one.
let changeset = '';
rows.push(
  await time(
    'change (create, 2 links, update)',
    async () => {
      const out = await call('change', {
        reason: 'bench: a typical change, undone after',
        ops: [
          { op: 'create', ref: 't', type: 'work.task', title: 'Bench task', body: 'Made by the bench, undone after.' },
          { op: 'link', type: 'part_of', from: 't', to: HUB },
          { op: 'link', type: 'depends_on', from: 't', to: TASK },
          { op: 'update', id: TASK, append: 'Bench: a line added, undone after.' },
        ],
      });
      changeset = out.result.changeset;
      return out;
    },
    () => call('undo', { changeset }),
  ),
);
if (process.env.JSON) console.log(JSON.stringify(rows));
