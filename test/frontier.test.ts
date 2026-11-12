// The frontier: a session starts placed on the map, not handed a note. On a bare map, one session plans and ends;
// the owner corrects a step and adds one; a second session in the same checkout (or a worktree of it) is handed the
// open plan, the undecided question and the owner's correction, strongest first, though nobody wrote a summary. A
// session elsewhere is handed nothing of it.

import assert from 'node:assert/strict';
import { cpSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { folderKey, frontierText } from '../packs/runs/kernel/frontier.ts';
import * as frontierPack from '../packs/runs/kernel/frontier.ts';
import { type Actor } from '../packs/write/kernel/pelago.ts';
import { Registry } from '../packs/loader/kernel/packs.ts';
import * as sessionsPack from '../packs/sessions/kernel/sessions.ts';
import { callTool } from '../packs/surface/kernel/tools.ts';
import { freshWith, human } from './map.ts';
import { kernelContext, ownContext } from '../packs/loader/kernel/kernel-context.ts';

const agent: Actor = { kind: 'agent', name: 'test' };

test('a worktree is read as the checkout it was made from', () => {
  assert.equal(folderKey('C:\\Work\\App\\.claude\\worktrees\\login-a1\\'), 'c:/work/app');
  assert.equal(folderKey('/home/me/app'), '/home/me/app');
});

test('a second session is placed where the first worked: the owner’s correction first, then what waits, then what is open', async () => {
  const packs = mkdtempSync(join(tmpdir(), 'pelago-frontier-'));
  cpSync(join(import.meta.dirname, '..', 'packs'), packs, { recursive: true });
  const l = await freshWith(new Registry(packs));
  await callTool(l, human, 'init', { name: 'Alex' });
  await l.db.query(`insert into setting (key, value) values ('agent_changes', '"apply"') on conflict (key) do update set value = excluded.value`);

  // The first session plans the work and ends; it writes no summary for anyone.
  const first = await sessionsPack.sessionStart(ownContext(l, 'sessions'), agent as sessionsPack.Actor, ({ session_id: 'one', cwd: 'C:/work/todo' }));
  const made = ((await l.change(agent, {
    run: first.run,
    reason: 'Plan login',
    ops: [
      { op: 'create', ref: 'hub', type: 'task', title: 'Add login' },
      { op: 'create', ref: 'table', type: 'task', title: 'User table' },
      { op: 'create', ref: 'form', type: 'task', title: 'Login form' },
      { op: 'create', ref: 'hash', type: 'decision', title: 'Which hashing library?' },
      { op: 'link', type: 'part_of', from: 'table', to: 'hub' },
      { op: 'link', type: 'part_of', from: 'form', to: 'hub' },
      { op: 'link', type: 'part_of', from: 'hash', to: 'hub' },
      { op: 'link', type: 'depends_on', from: 'form', to: 'table' },
    ],
  })) as { created: Record<string, string> }).created;
  await sessionsPack.sessionEnd(ownContext(l, 'sessions'), agent as sessionsPack.Actor, ({ run: first.run, outcome: 'finished' }));

  // The owner corrects a step and adds one of their own to the plan.
  await l.change(human, { reason: 'Rename', ops: [{ op: 'update', id: made.table, title: 'User table, with email unique' }] });
  const added = ((await l.change(human, { reason: 'Add', ops: [{ op: 'create', ref: 'reset', type: 'task', title: 'Password reset' }, { op: 'link', type: 'part_of', from: 'reset', to: made.hub }] })) as { created: Record<string, string> }).created.reset;

  // A second session, in a worktree of the same checkout.
  const second = await sessionsPack.sessionStart(ownContext(l, 'sessions'), agent as sessionsPack.Actor, ({ session_id: 'two', cwd: 'C:\\work\\todo\\.claude\\worktrees\\next' }));
  const f = await frontierPack.frontier(kernelContext(l, 'runs'), ({ run: second.run }));
  assert.equal(f.before.sessions, 1, 'the first session is found by its folder');
  const why = new Map(f.items.map((i) => [i.id, i.reasons.map((r) => r.why)]));
  assert.ok(why.get(made.table)?.includes('corrected'), 'the owner’s edit is on the frontier');
  assert.ok(why.get(added)?.includes('corrected'), 'what the owner added to the plan is on it too');
  assert.ok(why.get(made.hash)?.includes('unsettled'), 'the undecided question is on it');
  assert.ok(why.get(made.form)?.includes('blocked'), 'the step that waits on another says so');
  assert.equal(f.items[0].reasons[0].why, 'corrected', 'what the owner corrected comes first');
  const text = frontierText(f).join('\n');
  assert.match(text, /changed by .* since an agent last did \(title\)/);
  assert.match(text, /added by .*, not yet seen by an agent/);
  assert.ok(!f.items.some((i) => i.id === made.hub), 'a hub with open parts is not itself next');

  // Once an agent has touched what the owner corrected, it is no longer a correction.
  await l.change(agent, { run: second.run, reason: 'Seen', ops: [{ op: 'update', id: made.table, status: 'doing' }] });
  const after = await frontierPack.frontier(kernelContext(l, 'runs'), ({ run: second.run }));
  assert.ok(!after.items.find((i) => i.id === made.table)?.reasons.some((r) => r.why === 'corrected'));

  // A session somewhere else is handed nothing of this.
  const elsewhere = await sessionsPack.sessionStart(ownContext(l, 'sessions'), agent as sessionsPack.Actor, ({ session_id: 'three', cwd: 'C:/work/other' }));
  const none = await frontierPack.frontier(kernelContext(l, 'runs'), ({ run: elsewhere.run }));
  assert.equal(none.before.sessions, 0);
  assert.match(frontierText(none)[0], /No session has worked here before/);

  // A chat with no folder (ChatGPT, Grok Bot) is the person's, wherever they worked: it is handed the open work too.
  const chat = await sessionsPack.sessionStart(ownContext(l, 'sessions'), agent as sessionsPack.Actor, ({ session_id: 'four', title: 'A chat', surface: 'chatgpt' }));
  const theirs = await frontierPack.frontier(kernelContext(l, 'runs'), ({ run: chat.run }));
  assert.ok(theirs.before.sessions >= 1 && theirs.items.some((i) => i.id === made.hash), 'the undecided question reaches a chat');

  // And the same answer is a view anyone may ask, the agent's start and the person's alike.
  const asked = (await callTool(l, human, 'view', { name: 'frontier', params: { cwd: 'C:/work/todo' } })) as { items: { id: string }[] };
  assert.ok(asked.items.some((i) => i.id === made.hash));
  // It says once how an item is linked to, so an agent names an item to a person by a link, not by its id.
  assert.equal((asked as unknown as { link: string }).link, `http://127.0.0.1:3100/i/${l.workspace}/{id}`);
});

test('capture session_start answers with where the session stands', async () => {
  const packs = mkdtempSync(join(tmpdir(), 'pelago-frontier-'));
  cpSync(join(import.meta.dirname, '..', 'packs'), packs, { recursive: true });
  const l = await freshWith(new Registry(packs));
  await l.db.query(`insert into setting (key, value) values ('agent_changes', '"apply"') on conflict (key) do update set value = excluded.value`);
  const first = (await callTool(l, agent, 'session_start', { session_id: 'a', cwd: '/srv/app' })) as { run: string; link: string; frontier: { before: { sessions: number } } };
  assert.equal(first.frontier.before.sessions, 0);
  assert.equal(first.link, `http://127.0.0.1:3100/i/${l.workspace}/{id}`, 'the answer carries the pattern of an item’s link once');
  await l.change(agent, { run: first.run, reason: 'Plan', ops: [{ op: 'create', type: 'task', title: 'Ship it' }] });
  const second = (await callTool(l, agent, 'session_start', { session_id: 'b', cwd: '/srv/app' })) as { frontier: { items: { title: string; reasons: { why: string }[] }[] } };
  assert.deepEqual(second.frontier.items.map((i) => [i.title, i.reasons[0].why]), [['Ship it', 'open']]);
});

test('the first thing the owner asks narrows the start to what is settled on it, once', async () => {
  const { answerHook } = await import('./claude-hook.ts');
  const { askedBy } = await import('../packs/runs/kernel/frontier-prompt.ts');
  const packs = mkdtempSync(join(tmpdir(), 'pelago-frontier-'));
  cpSync(join(import.meta.dirname, '..', 'packs'), packs, { recursive: true });
  const l = await freshWith(new Registry(packs));
  await l.db.query(`insert into setting (key, value) values ('agent_changes', '"apply"') on conflict (key) do update set value = excluded.value`);
  const made = ((await l.change(human, {
    reason: 'Plan',
    ops: [
      { op: 'create', ref: 'hub', type: 'task', title: 'Login for the todo app' },
      { op: 'create', ref: 'lib', type: 'decision', title: 'Which hashing library?', status: 'decided', props: { outcome: 'argon2', rationale: 'Memory-hard, and the default in the framework' } },
      { op: 'create', ref: 'mail', type: 'decision', title: 'Send reset mail ourselves?' },
      { op: 'link', type: 'part_of', from: 'lib', to: 'hub' },
      { op: 'link', type: 'part_of', from: 'mail', to: 'hub' },
    ],
  })) as { created: Record<string, string> }).created;
  const hook = (event: string, body: Record<string, unknown>) => answerHook(event, { whole: l.db, pelago: l, within: [], body, running: { started: new Date(0).toISOString() }, origin: 'http://127.0.0.1' }) as Promise<{ hookSpecificOutput?: { additionalContext?: string } } | undefined>;
  await hook('session-start', { session_id: 'n1', cwd: '/srv/todo' });
  const first = (await hook('prompt', { session_id: 'n1', prompt: 'Carry on with the login' }))?.hookSpecificOutput?.additionalContext ?? '';
  assert.match(first, /Settled: Which hashing library\? .*argon2.*Why: Memory-hard/);
  assert.ok(first.includes(`Still open: Send reset mail ourselves? (${made.mail})`), first);
  const again = (await hook('prompt', { session_id: 'n1', prompt: 'And the login form' }))?.hookSpecificOutput?.additionalContext ?? '';
  assert.doesNotMatch(again, /Settled:/, 'said once, on the first prompt');
  assert.equal(askedBy('<task-notification>done</task-notification>'), undefined, 'an event is not the owner asking');
  assert.equal(askedBy('Another Claude session sent a message: hi'), undefined);
});

test('Home reads the frontier of the whole workspace, each item with why; a session is read for what it worked on', async () => {
  const packs = mkdtempSync(join(tmpdir(), 'pelago-frontier-'));
  cpSync(join(import.meta.dirname, '..', 'packs'), packs, { recursive: true });
  const l = await freshWith(new Registry(packs));
  await callTool(l, human, 'init', { name: 'Alex' });
  await l.db.query(`insert into setting (key, value) values ('agent_changes', '"apply"') on conflict (key) do update set value = excluded.value`);
  const run = (await sessionsPack.sessionStart(ownContext(l, 'sessions'), agent as sessionsPack.Actor, ({ session_id: 'plan', cwd: '/srv/todo' }))).run;
  const made = ((await l.change(agent, {
    run,
    reason: 'Plan',
    ops: [
      { op: 'create', ref: 'hub', type: 'task', title: 'Add login' },
      { op: 'create', ref: 'form', type: 'task', title: 'Login form' },
      { op: 'create', ref: 'hash', type: 'decision', title: 'Which hashing library?' },
      { op: 'link', type: 'part_of', from: 'form', to: 'hub' },
      { op: 'link', type: 'part_of', from: 'hash', to: 'hub' },
    ],
  })) as { created: Record<string, string> }).created;
  await sessionsPack.sessionEnd(ownContext(l, 'sessions'), agent as sessionsPack.Actor, ({ run, outcome: 'finished' }));

  // Asked from no place (a person's Home), the frontier is every recent session's.
  const f = await frontierPack.frontier(kernelContext(l, 'runs'), ({}));
  assert.equal(f.before.sessions, 1);
  assert.ok(f.items.some((i) => i.id === made.hash));

  // The same, as a term of the flat query Home draws: each item with its reasons, the strongest first.
  type Flat = { items: { id: string; reasons?: { why: string; said: string }[] }[] };
  const home = (await callTool(l, human, 'view', { name: 'flat', params: { filter: { find: ['frontier', 'waits_on me'] } } })) as Flat;
  const hash = home.items.find((i) => i.id === made.hash);
  assert.equal(hash?.reasons?.[0].why, 'unsettled');
  assert.equal(hash?.reasons?.[0].said, 'not decided');
  assert.ok(home.items.some((i) => i.id === made.form && i.reasons?.some((r) => r.why === 'open')));

  // A session's page draws what it worked on: all it made, open or not.
  const worked = (await callTool(l, human, 'view', { name: 'flat', params: { filter: { find: [`worked ${run}`] } } })) as Flat;
  assert.deepEqual(new Set(worked.items.map((i) => i.id)), new Set(Object.values(made)));
  assert.ok(worked.items.every((i) => !i.reasons), 'only the frontier says why');
});
