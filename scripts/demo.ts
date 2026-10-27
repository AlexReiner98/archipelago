// The demo: `npm run demo`. A server of its own (port 3200, its data in demo/,
// never data/), filled the first time with a small map of Archipelago itself:
// the project, its features, a release and what it waits for, decisions open and
// made, a view drawn by a style of its own, and an agent session that told its story and left one change for you.
// Everything goes in through the tools, as you and as an agent, the way a real
// map is made. `npm run demo -- --fresh` throws the demo's map away and makes it again.

import { spawn } from 'node:child_process';
import { mkdirSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(import.meta.dirname, '..');
const DIR = join(ROOT, 'demo');
const PORT = 3200;
const BASE = `http://127.0.0.1:${PORT}`;

if (process.argv.includes('--fresh')) rmSync(DIR, { recursive: true, force: true });
mkdirSync(DIR, { recursive: true });

const server = spawn(process.execPath, [join(ROOT, 'src', 'server.ts')], {
  cwd: ROOT,
  stdio: 'inherit',
  env: { ...process.env, PELAGO_DATA: join(DIR, 'data'), PELAGO_PORT: String(PORT), PELAGO_HOST: '127.0.0.1', PELAGO_AUTH: 'off', PELAGO_DEV: '0' },
});
server.on('exit', (code) => process.exit(code ?? 0));
for (const signal of ['SIGINT', 'SIGTERM'] as const) process.on(signal, () => server.kill(signal));

async function call<T = any>(surface: 'api' | 'agent', tool: string, input: unknown = {}): Promise<T> {
  const res = await fetch(`${BASE}/${surface}/${tool}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(input) });
  const body = (await res.json()) as { result?: T; error?: string };
  if (!res.ok) throw new Error(`${tool}: ${body.error}`);
  return body.result as T;
}
const human = <T = any>(tool: string, input?: unknown) => call<T>('api', tool, input);
const agent = <T = any>(tool: string, input?: unknown) => call<T>('agent', tool, { actor: 'claude-code', ...(input as object) });

async function ready(): Promise<void> {
  for (let i = 0; i < 120; i++) {
    try {
      if ((await fetch(`${BASE}/health`)).ok) return;
    } catch {}
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error('The demo server did not start.');
}

const REMOTE = 'https://github.com/AlexReiner98/archipelago.git';
const source = { uri: 'scripts/demo.ts', kind: 'file', title: 'The Archipelago demo' };

async function fill(): Promise<void> {
  const { me } = await human('init', { name: 'You' });

  // The map, as you would make it by hand or approve it from an agent.
  const { created: m } = await human('change', {
    reason: 'The demo: Archipelago described in its own map',
    source,
    ops: [
      {
        op: 'create', ref: 'p', type: 'project', title: 'Archipelago', status: 'active',
        body: 'A shared workspace for people and AI agents, described in its own map. Open any item to see what it waits on and what waits on it.\n\nHow to read it\nHome shows this project\'s open questions and its next release. Each item has one page: its fields, its note, and a picture of what it is tied to. Changes holds what an agent sent that waits for you.',
      },
      { op: 'create', ref: 'repo', type: 'repo', title: 'archipelago', status: 'active', props: { remote: REMOTE, default_branch: 'main' } },
      { op: 'link', type: 'lives_in', from: 'p', to: 'repo' },
      { op: 'create', ref: 'cc', type: 'agent', title: 'Claude Code', status: 'active' },
      { op: 'link', type: 'involves', from: 'p', to: 'cc' },

      // The project's first view: drawn by a style of its own (examples/demo/overview.js).
      { op: 'create', ref: 'lens', type: 'lens', title: 'Overview', status: 'current', props: { place: 0, far: 2, fold: ['system', 'unlinked'] } },
      { op: 'link', type: 'about', from: 'lens', to: 'p' },
      { op: 'create', ref: 'style', type: 'style', title: 'Overview', status: 'current', props: { code: readFileSync(join(ROOT, 'examples', 'demo', 'overview.js'), 'utf8') } },
      { op: 'link', type: 'about', from: 'style', to: 'lens' },

      // What it does, in the order it was built.
      { op: 'create', ref: 'f1', type: 'feature', title: 'A map of work and what waits on what', status: 'shipped', props: { order: 1 }, body: 'Projects, tasks, decisions, people and resources, with typed links. What is blocked is worked out from the links each time, so it cannot go stale.' },
      { op: 'create', ref: 'f2', type: 'feature', title: 'Agents change it through the same tools', status: 'shipped', props: { order: 2 }, body: 'Over MCP, agents call the tools the web page calls. What an agent changes waits for your yes, or is applied and can be undone.' },
      { op: 'create', ref: 'f3', type: 'feature', title: 'Sessions register and tell their story', status: 'built', props: { order: 3 }, body: 'An agent session says what it took on, tells what it concluded as it works, and leaves the map true when it ends.' },
      { op: 'create', ref: 'f4', type: 'feature', title: 'Pushes read against the open work', status: 'built', props: { order: 4 }, body: 'Each push to GitHub is read by an agent against what was open, and what it settles is changed.' },
      { op: 'create', ref: 'f5', type: 'feature', title: 'Pictures you can shape', status: 'building', props: { order: 5 }, body: 'A lens says what a picture holds; a style says how it looks. Both are items on the map.' },
      { op: 'create', ref: 'f6', type: 'feature', title: 'Works with any agent', status: 'planned', props: { order: 6 }, body: 'Not only Claude Code: Codex, Cursor and Gemini CLI connected the way Claude Code is.' },
      ...['f1', 'f2', 'f3', 'f4', 'f5', 'f6'].map((f) => ({ op: 'link', type: 'part_of', from: f, to: 'p' })),

      // Work under them.
      { op: 'create', ref: 't1', type: 'task', title: 'Undo any change set', status: 'done' },
      { op: 'link', type: 'part_of', from: 't1', to: 'f2' },
      { op: 'create', ref: 't2', type: 'task', title: 'Show the session at work on its item', status: 'todo' },
      { op: 'link', type: 'part_of', from: 't2', to: 'f3' },
      { op: 'create', ref: 't3', type: 'task', title: 'Re-check old items on a schedule', status: 'done' },
      { op: 'link', type: 'part_of', from: 't3', to: 'f4' },
      { op: 'create', ref: 't4', type: 'task', title: 'Draw a project as islands', status: 'doing' },
      { op: 'link', type: 'part_of', from: 't4', to: 'f5' },
      { op: 'create', ref: 't5', type: 'task', title: 'Say where each item sits in a picture', status: 'done' },
      { op: 'link', type: 'part_of', from: 't5', to: 'f5' },
      { op: 'link', type: 'depends_on', from: 't4', to: 't5' },
      { op: 'create', ref: 't6', type: 'task', title: 'Set up Codex and Cursor', status: 'todo' },
      { op: 'link', type: 'part_of', from: 't6', to: 'f6' },
      { op: 'create', ref: 'bug', type: 'issue', title: 'A two-word search misses what one word finds', status: 'open' },
      { op: 'link', type: 'part_of', from: 'bug', to: 'p' },

      // What is decided, and what is still open.
      { op: 'create', ref: 'd1', type: 'decision', title: 'Which licence?', status: 'decided', props: { options: ['MIT', 'Apache-2.0', 'AGPL-3.0'], outcome: 'MIT', rationale: 'Short, and the one firms accept without asking a lawyer.' } },
      { op: 'create', ref: 'd2', type: 'decision', title: 'Where does the data live?', status: 'decided', props: { options: ['One embedded database per workspace', 'A shared Postgres server'], outcome: 'One embedded database per workspace', rationale: 'Nothing to install, and nothing shared between customers to filter wrongly.' } },
      { op: 'create', ref: 'd3', type: 'decision', title: 'Which agent after Claude Code?', status: 'open', props: { options: ['Codex', 'Cursor', 'Gemini CLI'] }, body: 'The setup and the hooks are written for Claude Code. The next agent decides what gets generalised first.' },
      { op: 'create', ref: 'd4', type: 'decision', title: 'Offer hosting, set up for you?', status: 'open', props: { options: ['Yes, as a paid tier', 'Not now: self-host only'] } },
      ...['d1', 'd2', 'd3', 'd4'].map((d) => ({ op: 'link', type: 'part_of', from: d, to: 'p' })),
      { op: 'link', type: 'depends_on', from: 'f6', to: 'd3' },
      { op: 'link', type: 'waits_on', from: 'd4', to: me, props: { for: 'whether to run a hosted tier' } },

      // The release and its gate.
      { op: 'create', ref: 'r', type: 'release', title: 'Open source release', status: 'upcoming', props: { version: '0.1.0' }, body: 'The code made public. It waits for what it ships to be built and for one first run on a clean machine; the rest can follow.' },
      { op: 'link', type: 'ships', from: 'r', to: 'p' },
      { op: 'link', type: 'part_of', from: 'r', to: 'p' },
      { op: 'create', ref: 'run', type: 'task', title: 'A first run on a clean machine', status: 'todo', body: 'Someone who has never seen it follows the README from a fresh clone.' },
      { op: 'link', type: 'part_of', from: 'run', to: 'p' },
      { op: 'link', type: 'waits_on', from: 'run', to: me, props: { for: 'running it once on a clean machine' } },
      ...['f1', 'f2', 'f3', 'f4', 'd1', 'run'].map((x) => ({ op: 'link', type: 'depends_on', from: 'r', to: x })),
      ...['f5', 'f6', 'd4', 'bug'].map((x) => ({ op: 'link', type: 'defers', from: 'r', to: x })),
    ],
  });

  // An agent session: it takes on the release, says what it found, and leaves one answer for you to confirm.
  const session = await agent('session_start', { title: 'Ready the open source release', task: m.r, surface: 'claude-code', remote: REMOTE });
  const run = session.run;
  await agent('tell', {
    run,
    said: 'Everything the release ships is built; what is left is a first run on a clean machine, and only you can do it.',
    about: [m.r, m.run, me],
    links: [{ from: m.r, to: m.run, says: 'waits for' }, { from: m.run, to: me, says: 'waits on' }],
  });
  await agent('tell', {
    run,
    said: 'Codex comes before Cursor: its CLI takes the same MCP config, so the setup changes least.',
    about: [m.d3, m.f6, m.t6],
    links: [{ from: m.d3, to: m.f6, says: 'is why' }],
  });
  await agent('change', {
    reason: 'Codex first: its CLI reads the same MCP config, so the setup changes least',
    authority: { of: 'agent', basis: 'Read the setup script and the Codex CLI docs' },
    source,
    // The agent asks for a look: the choice is put to you on Changes, whatever the workspace lets agents do.
    hold: true,
    ops: [{ op: 'update', id: m.d3, status: 'decided', props: { outcome: 'Codex', rationale: 'Its CLI reads the same MCP config as Claude Code, so the setup changes least.' } }],
  });
  await agent('tell', {
    run,
    finding: true,
    said: 'The release is ready but for one first run on a clean machine, which waits on you. I proposed Codex as the next agent; it is on Changes for your yes.',
    about: [m.r, m.run, m.d3, me],
    links: [{ from: m.r, to: m.run, says: 'waits for' }, { from: m.run, to: me, says: 'waits on' }],
  });
  await agent('session_end', { run, outcome: 'finished', summary: 'Checked the release gate; proposed the next agent.', cannot_tell_rest: true });
}

await ready();
const info = await human('workspace_info');
if (!info.owner) {
  await fill();
  console.log('\nThe demo map is made.');
}
console.log(`\nArchipelago demo: open ${BASE}\nIts data is in demo/; npm run demo -- --fresh starts it again from nothing. Ctrl+C stops it.\n`);
