import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { createToken } from '../src/auth.ts';
import { serve } from './serve.ts';

// The session running these tests has an id of its own: no commit made here is to be taken for one of its.
delete process.env.CLAUDE_CODE_SESSION_ID;

test('a commit a session makes names its run, and one made by anybody else does not; the setup puts the hook in and takes it out', async () => {
  const { workspaces, base } = await serve('tokens');
  const robot = (await createToken((await workspaces.get('default')).pelago.db, 'default', { kind: 'agent', name: 'robot' })).token;
  const checkout = () => {
    const at = mkdtempSync(join(tmpdir(), 'pelago-commits-'));
    for (const args of [['init', '-q'], ['config', 'user.name', 'A Person'], ['config', 'user.email', 'person@example.test'], ['config', 'commit.gpgsign', 'false']]) execFileSync('git', args, { cwd: at });
    return at;
  };
  const repo = checkout();
  const run = (args: string[], cwd: string, env: Record<string, string> = {}, input?: unknown) =>
    new Promise<{ out: string; code: number | null }>((done) => {
      const child = spawn(process.execPath, args, { cwd, env: { ...process.env, PELAGO_AGENT_TOKEN: '', PELAGO_SETUP_PROFILE: join(cwd, '.profile-for-test'), ...env } });
      let out = '';
      child.stdout.on('data', (d) => (out += d));
      child.stderr.on('data', (d) => (out += d));
      child.on('close', (code) => done({ out, code }));
      child.stdin.end(input === undefined ? '' : JSON.stringify(input));
    });
  const setup = (cwd: string, flags: string[]) => run(['-e', `fetch('${base}/connect/setup.mjs').then(r=>r.text()).then(t=>import('data:text/javascript,'+encodeURIComponent(t)))`, '--', ...flags], cwd);
  const hook = (name: string, input: unknown) => run([join(repo, '.claude', 'pelago-hook.mjs'), name], repo, { PELAGO_URL: base, PELAGO_AGENT_TOKEN: robot }, input);
  /** Commits, as a session when one is named, and answers the runs the commit names. */
  const commit = (session?: string) => {
    execFileSync('git', ['commit', '-q', '--allow-empty', '-m', 'A change'], { cwd: repo, env: { ...process.env, ...(session && { CLAUDE_CODE_SESSION_ID: session }) } });
    return execFileSync('git', ['log', '-1', '--format=%(trailers:key=Archipelago-Run,valueonly,separator=%x2C)'], { cwd: repo, encoding: 'utf8' }).trim();
  };
  const kept = (session: string) => join(repo, '.git', 'pelago-runs', session);

  const installed = await setup(repo, ['--yes']);
  assert.equal(installed.code, 0, installed.out);
  assert.match(installed.out, /written {4}\.git\/hooks\/commit-msg/);
  assert.match(readFileSync(join(repo, '.git/hooks/commit-msg'), 'utf8'), /Archipelago: names the run/);

  // Two sessions in one checkout: each is told its run at the start, and the hook keeps it in the git folder.
  for (const session of ['desk-7', 'desk-8']) assert.equal((await hook('session-start', { session_id: session, cwd: repo })).code, 0);
  const [seven, eight] = ['desk-7', 'desk-8'].map((session) => readFileSync(kept(session), 'utf8'));
  assert.match(seven, /^e_\w+$/);
  assert.notEqual(seven, eight);

  assert.equal(commit('desk-7'), seven, 'a commit names the run of the session that made it');
  assert.equal(commit('desk-8'), eight, 'and the other session in the same checkout its own');
  assert.equal(commit(), '', 'a commit made by a person names none');
  assert.equal(commit('a-session-archipelago-never-heard-of'), '', 'nor does one from a session with no run kept');

  // A session in a worktree of the checkout: Claude Code copies in what .worktreeinclude names, so it has the hooks,
  // and its run is kept in the git folder the worktrees share, for a commit made there.
  assert.deepEqual(readFileSync(join(repo, '.worktreeinclude'), 'utf8').split('\n').slice(1, -1), ['.mcp.json', '.claude/settings.json', '.claude/pelago-hook.mjs', '.claude/pelago.md', '.claude/skills/pelago-bump/references/home.md']);
  execFileSync('git', ['commit', '-q', '--allow-empty', '-m', 'The start'], { cwd: repo });
  const tree = join(repo, '.claude', 'worktrees', 'side');
  execFileSync('git', ['worktree', 'add', '-q', '-b', 'side', tree], { cwd: repo });
  assert.equal((await hook('session-start', { session_id: 'desk-9', cwd: tree })).code, 0);
  const nine = readFileSync(kept('desk-9'), 'utf8');
  execFileSync('git', ['commit', '-q', '--allow-empty', '-m', 'In a worktree'], { cwd: tree, env: { ...process.env, CLAUDE_CODE_SESSION_ID: 'desk-9' } });
  assert.equal(execFileSync('git', ['log', '-1', '--format=%(trailers:key=Archipelago-Run,valueonly)'], { cwd: tree, encoding: 'utf8' }).trim(), nine, 'a commit in a worktree names its session\'s run');
  execFileSync('git', ['worktree', 'remove', '--force', tree], { cwd: repo });

  // A session that has ended leaves no run behind to be named by.
  await hook('session-end', { session_id: 'desk-7', cwd: repo, reason: 'exit' });
  assert.ok(!existsSync(kept('desk-7')));
  assert.equal(commit('desk-7'), '');

  // Run again, it is as it was; taken out, the hook and the runs kept for it go, and commits name nothing. What the
  // project names in .worktreeinclude itself is left.
  writeFileSync(join(repo, '.worktreeinclude'), `.env\n\n${readFileSync(join(repo, '.worktreeinclude'), 'utf8')}`);
  const again = await setup(repo, ['--yes']);
  assert.match(again.out, /as it was {2}\.git\/hooks\/commit-msg/);
  assert.match(again.out, /as it was {2}\.worktreeinclude/);
  const removed = await setup(repo, ['--remove', '--yes']);
  assert.equal(removed.code, 0, removed.out);
  assert.match(removed.out, /deleted {4}\.git\/hooks\/commit-msg[\s\S]*deleted {4}\.git\/pelago-runs\//);
  assert.ok(!existsSync(join(repo, '.git/hooks/commit-msg')) && !existsSync(join(repo, '.git/pelago-runs')));
  assert.equal(readFileSync(join(repo, '.worktreeinclude'), 'utf8'), '.env\n');
  assert.equal(commit('desk-8'), '');

  // A project's own commit-msg hook is never written over, nor taken out.
  const theirs = checkout();
  mkdirSync(join(theirs, '.git', 'hooks'), { recursive: true });
  writeFileSync(join(theirs, '.git/hooks/commit-msg'), '#!/bin/sh\nexit 0\n');
  assert.match((await setup(theirs, ['--yes'])).out, /kept {7}\.git\/hooks\/commit-msg {2}\(the project's own commit-msg hook/);
  await setup(theirs, ['--remove', '--yes']);
  assert.equal(readFileSync(join(theirs, '.git/hooks/commit-msg'), 'utf8'), '#!/bin/sh\nexit 0\n');
});
