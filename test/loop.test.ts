// The core loop, end to end, as a stranger meets it (the gate, e_2wz3kdks): a server with core alone, a Claude Code
// session played by the plugin's own hook script with what Claude Code hands it, the map's tools over HTTP, and the
// page in a real browser (skipped where there is no Chrome). Each of the six steps is a check: install, write, read,
// correct, remember, share. No model is in it, so it says the same each run; a run with a real agent is e_aj5bh4yj.

import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { chrome, open } from './browser.ts';
import { serve } from './serve.ts';

const browser = chrome();
const ROOT = join(import.meta.dirname, '..');
const PLUGIN = join(ROOT, 'plugins', 'archipelago');

/** A Claude Code hook event, run as Claude Code runs the plugin's: its script, the event's input on stdin, its output parsed. */
function hookOf(base: string, data: string) {
  return (event: string, body: Record<string, unknown>) =>
    new Promise<{ context: string; raw: string }>((resolve, reject) => {
      const env: NodeJS.ProcessEnv = { ...process.env, PELAGO_URL: base, CLAUDE_PLUGIN_DATA: data, CLAUDE_PLUGIN_ROOT: PLUGIN };
      delete env.PELAGO_AGENT_TOKEN;
      const child = spawn(process.execPath, [join(PLUGIN, 'scripts', 'pelago-hook.mjs'), event, '--plugin'], { env, cwd: String(body.cwd ?? ROOT), stdio: ['pipe', 'pipe', 'pipe'] });
      let out = '';
      let err = '';
      child.stdout.on('data', (c) => (out += c));
      child.stderr.on('data', (c) => (err += c));
      child.on('error', reject);
      child.on('close', () => {
        let context = '';
        try {
          const said = JSON.parse(out || '{}');
          context = [said.hookSpecificOutput?.additionalContext, said.systemMessage].filter(Boolean).join('\n');
        } catch {
          context = out;
        }
        resolve({ context, raw: out + err });
      });
      child.stdin.end(JSON.stringify({ hook_event_name: event, ...body }));
    });
}

test('the core loop, as a stranger meets it: install, write, read, correct, remember, share', { skip: !browser && 'no Chrome here (set CHROME)' }, async () => {
  // A map with core alone, as a new workspace starts.
  const packs = mkdtempSync(join(tmpdir(), 'pelago-loop-packs-'));
  cpSync(join(ROOT, 'packs', 'core'), join(packs, 'core'), { recursive: true });
  const { base, call } = await serve('off', undefined, undefined, packs);
  const work = mkdtempSync(join(tmpdir(), 'pelago-loop-'));
  const project = join(work, 'todo');
  const worktree = join(project, '.claude', 'worktrees', 'next');
  mkdirSync(worktree, { recursive: true });
  execFileSync('git', ['init', '-q', project]);
  const hook = hookOf(base, join(work, 'plugin-data'));
  const agent = (tool: string, input: Record<string, unknown>) => call(`/agent/${tool}`, undefined, input).then((r) => r.result ?? r);
  const person = (tool: string, input: Record<string, unknown>) => call(`/api/${tool}`, undefined, input).then((r) => r.result ?? r);

  // 1. Install: the plugin is whole (its manifest, the marketplace that lists it, its hooks), and its session-start
  // hook registers the session on the map.
  for (const file of ['.claude-plugin/plugin.json', 'hooks/hooks.json', '.mcp.json', 'pelago.md']) assert.ok(existsSync(join(PLUGIN, file)), `the plugin has ${file}`);
  const market = JSON.parse(readFileSync(join(ROOT, '.claude-plugin', 'marketplace.json'), 'utf8')) as { plugins: { source: string }[] };
  assert.ok(market.plugins.some((p) => p.source === './plugins/archipelago'), 'the marketplace lists it');
  const first = await hook('session-start', { session_id: 'loop-1', cwd: project, source: 'startup' });
  const run1 = /as run (e_[a-z0-9]{8})/.exec(first.context)?.[1];
  assert.ok(run1, `the session is registered: ${first.raw.slice(0, 400)}`);
  assert.match(first.context, /No session has worked here before/);
  assert.match(first.context, new RegExp(`Archipelago-Run: ${run1}`), `with no commit-msg hook, the session is asked to name its run in its commits: ${first.raw.slice(-900)}`);

  // Before any agent work, an empty Home says how to bring one, and For you is in the menu.
  const empty = await open(`${base}/`);
  try {
    assert.ok(await empty.until(`[...document.querySelectorAll('a')].some((a) => a.textContent === 'Connect an agent')`, 20000), 'an empty map points at connecting an agent');
    assert.ok(await empty.evaluate<boolean>(`Boolean(document.querySelector('#menu-pages a[href="#/you"]'))`), 'For you is in the menu');
  } finally {
    await empty.close();
  }

  // 2. Write: the agent plans as it works, with the map's tools.
  const made = (await agent('change', {
    run: run1,
    reason: 'Plan the login',
    ops: [
      { op: 'create', ref: 'hub', type: 'task', title: 'Add login', visibility: 'shared' },
      { op: 'create', ref: 'table', type: 'task', title: 'User table', visibility: 'shared' },
      { op: 'create', ref: 'form', type: 'task', title: 'Login form', visibility: 'shared' },
      { op: 'create', ref: 'hash', type: 'decision', title: 'Which hashing library?', visibility: 'shared' },
      { op: 'create', ref: 'auth', type: 'decision', title: 'Sessions or tokens?', status: 'decided', visibility: 'shared', props: { outcome: 'Signed cookie sessions', rationale: 'One server, nothing to revoke elsewhere' } },
      ...['table', 'form', 'hash', 'auth'].map((ref) => ({ op: 'link', type: 'part_of', from: ref, to: 'hub' })),
      { op: 'link', type: 'depends_on', from: 'form', to: 'table' },
    ],
  })) as { status: string; created: Record<string, string> };
  assert.equal(made.status, 'applied', 'an agent writes on a new map without being refused');
  const ids = made.created;
  await agent('report', { action: 'tell', params: { run: run1, said: 'Cookie sessions are enough: one server.', about: [ids.auth] } });

  // 3. Read: Home draws the open work the agent left, each with why it needs attention, in a real browser.
  const page = await open(`${base}/`);
  try {
    const drawn = (title: string) => `document.body.innerText.includes(${JSON.stringify(title)}) || [...document.querySelectorAll('svg text, svg title')].some((t) => t.textContent.includes(${JSON.stringify(title)}))`;
    assert.ok(await page.until(drawn('Which hashing library?'), 20000), `Home draws the agent's open work: ${page.logs().join('\n').slice(0, 600)}`);
    assert.ok(await page.until(drawn('Login form')), 'every open step');
    assert.ok(await page.until(drawn('Undecided')), 'with why it needs attention, as a mark');
    assert.ok(!(await page.evaluate<boolean>(drawn('Nothing to draw'))), 'not an empty Home');
  } finally {
    await page.close();
  }

  // 4. Correct: the person edits a step and adds one; a change the agent held is approved. The agent hears all of it.
  await person('change', { reason: 'Email must be unique', ops: [{ op: 'update', id: ids.table, title: 'User table, email unique' }] });
  const added = ((await person('change', { reason: 'Add a step', ops: [{ op: 'create', ref: 'reset', type: 'task', title: 'Password reset', visibility: 'shared' }, { op: 'link', type: 'part_of', from: 'reset', to: ids.hub }] })) as { created: Record<string, string> }).created.reset;
  const held = (await agent('change', { run: run1, reason: 'Start the table', hold: true, ops: [{ op: 'update', id: ids.table, status: 'doing' }] })) as { status: string; proposal: string };
  assert.equal(held.status, 'proposed');
  await person('decide', { proposal: held.proposal, approve: true });
  const heard = await hook('prompt', { session_id: 'loop-1', cwd: project, prompt: 'go on' });
  assert.match(heard.context, /owner did this in the map/, `the agent hears the person: ${heard.context.slice(0, 600)}`);
  assert.match(heard.context, /approved/, 'and that its held change was approved');
  await hook('session-end', { session_id: 'loop-1', cwd: project, reason: 'exit' });
  // The person corrects the table again after the agent's approved change touched it, so it is news to the next session.
  await person('change', { reason: 'Unique index', ops: [{ op: 'update', id: ids.table, title: 'User table, unique email index' }] });

  // 5. Remember: a second session, in a worktree of the same checkout, starts placed where the first left off: the
  // person's corrections first, then what is undecided; its first prompt is told what is settled on what it is asked.
  const second = await hook('session-start', { session_id: 'loop-2', cwd: worktree, source: 'startup' });
  assert.match(second.context, /1 earlier session worked here/, second.context.slice(0, 800));
  const listed = second.context.split('\n').filter((line) => /^- .*\(e_[a-z0-9]{8}\)/.test(line));
  const at = (id: string) => listed.findIndex((line) => line.includes(id));
  assert.ok(at(ids.table) >= 0 && at(added) >= 0 && at(ids.hash) >= 0, `the plan is there: ${listed.join('\n')}`);
  assert.match(listed[at(ids.table)], /changed by .* since an agent last did/);
  assert.match(listed[at(added)], /added by .*, not yet seen by an agent/);
  assert.ok(Math.max(at(ids.table), at(added)) < at(ids.hash), 'what the person corrected comes before what is undecided');
  const asked = await hook('prompt', { session_id: 'loop-2', cwd: worktree, prompt: 'Carry on with the login' });
  assert.match(asked.context, /Settled: Sessions or tokens\? .*Signed cookie sessions.*Why: One server/, asked.context.slice(0, 800));
  assert.match(asked.context, /Still open: Which hashing library\?/);

  // 6. Share: a view of the plan, as a link anyone opens with no login, drawn live in the sandbox, with a way to start
  // a map of their own.
  const lens = ((await person('change', { reason: 'A view to share', ops: [{ op: 'create', ref: 'v', type: 'lens', title: 'The login plan', visibility: 'shared', props: { filter: { find: [`in ${ids.hub}`], not: [] }, walk: { over: [], steps: 0 } } }] })) as { created: Record<string, string> }).created.v;
  const link = (await person('share_create', { id: lens })) as { path: string };
  assert.match(link.path, /^\/s\//);
  const reader = await open(`${base}${link.path}`);
  try {
    const shown = (text: string) => `[document, ...[...document.querySelectorAll('iframe')].flatMap((f) => { try { return f.contentDocument ? [f.contentDocument] : []; } catch { return []; } })].some((d) => d.body?.innerText.includes(${JSON.stringify(text)}) || [...d.querySelectorAll('svg text')].some((t) => t.textContent.includes(${JSON.stringify(text)})))`;
    assert.ok(await reader.until(shown('The login plan'), 20000), `the link opens with no login: ${reader.logs().join('\n').slice(0, 600)}`);
    assert.ok(await reader.until(shown('Login form'), 20000), `the view is drawn: ${reader.logs().join('\n').slice(0, 600)} | ${await reader.evaluate<string>(`JSON.stringify({ text: document.body.innerText.slice(0, 400), frames: [...document.querySelectorAll('iframe')].map((f) => [f.src, f.getAttribute('sandbox'), f.offsetWidth, f.offsetHeight]), svgs: document.querySelectorAll('svg').length, html: document.body.innerHTML.slice(0, 1200) })`)}`);
    assert.ok(await reader.until(`[...document.querySelectorAll('a')].some((a) => a.textContent.includes('Start a map of your own'))`), 'with a way to start your own');
    assert.ok(!reader.logs().some((line) => /Uncaught|TypeError|ReferenceError/.test(line)), `no errors: ${reader.logs().join('\n').slice(0, 600)}`);
  } finally {
    await reader.close();
  }
});
