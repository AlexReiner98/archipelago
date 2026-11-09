// The Claude Code plugin (scripts/plugin.ts): its files are what its sources make, and a stranger's machine is
// connected by a sign-in in the browser, with no token copied: the hook asks for it when the server refuses it, keeps
// what the browser comes back with, and registers the session that asked at its next prompt.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { test } from 'node:test';
import { createToken } from '../src/auth.ts';
import { FOLDER, pluginFiles } from '../scripts/plugin.ts';
import { serve } from './serve.ts';

const ROOT = join(import.meta.dirname, '..');

test('the plugin in the repository is what its sources make (npm run plugin writes it)', () => {
  for (const [path, text] of Object.entries(pluginFiles())) assert.equal(existsSync(join(ROOT, path)) && readFileSync(join(ROOT, path), 'utf8'), text, `${path} is behind: run npm run plugin`);
  const hooks = JSON.parse(pluginFiles()[`${FOLDER}/hooks/hooks.json`]).hooks;
  assert.deepEqual(Object.keys(hooks).sort(), ['Notification', 'PostToolUse', 'SessionEnd', 'SessionStart', 'Stop', 'StopFailure', 'UserPromptSubmit']);
  assert.match(pluginFiles()[`${FOLDER}/.mcp.json`], /"pelago": \{\s*"type": "http",\s*"url": "\$\{PELAGO_URL:-https:\/\/app\.archipelago\.tools\}\/mcp"\s*\}/, 'no token in it: Claude Code signs in at /mcp');
});

test('a plugin tool is counted as a map tool, and the items it names as touched', async () => {
  const { callEvents, kindOf }: any = await import(pathToFileURL(join(ROOT, 'scripts', 'pelago-events.mjs')).href);
  assert.equal(kindOf('mcp__plugin_archipelago_pelago__query'), 'map');
  assert.equal(kindOf('mcp__plugin_archipelago_pelago-site__query'), 'map');
  const [ended] = callEvents({ name: 'mcp__plugin_archipelago_pelago__query', input: { params: { task: 'e_abcdefgh' } } }, { content: '' }, 'now', 't');
  assert.deepEqual(ended.items, ['e_abcdefgh']);
});

test('a machine with no token is connected through the browser, and the session that asked is registered at its next prompt', async () => {
  const { workspaces, base, call } = await serve('tokens');
  const pelago = (await workspaces.get('default')).pelago;
  await pelago.init({ kind: 'human', name: 'alex' }, { name: 'Alex' });
  const owner = (await createToken(pelago.db, 'default', { kind: 'human', name: 'alex', admin: true, entity: await pelago.setting<string>('me') })).token;
  const data = mkdtempSync(join(tmpdir(), 'pelago-plugin-'));
  const hook = (name: string, input: unknown) =>
    new Promise<{ out: any; err: string }>((done) => {
      const child = spawn(process.execPath, [join(ROOT, FOLDER, 'scripts', 'pelago-hook.mjs'), name, '--plugin'], { env: { ...process.env, PELAGO_URL: base, PELAGO_AGENT_TOKEN: '', CLAUDE_PLUGIN_DATA: data, PELAGO_LOGIN_QUIET: '1' } });
      let out = '';
      let err = '';
      child.stdout.on('data', (d) => (out += d));
      child.stderr.on('data', (d) => (err += d));
      child.on('close', () => done({ out: out ? JSON.parse(out) : null, err }));
      child.stdin.end(JSON.stringify(input));
    });

  const asked = await hook('session-start', { session_id: 'stranger-1', cwd: data });
  assert.match(asked.out.systemMessage, /Archipelago: .*connect this computer.*\/oauth\/authorize\?/, 'the person is told, in the session, where to sign in');
  assert.match(asked.out.hookSpecificOutput.additionalContext, /not on the Archipelago map yet/);
  const again = await hook('session-start', { session_id: 'stranger-2', cwd: data });
  assert.equal(again.out.systemMessage.match(/http\S+/)[0], asked.out.systemMessage.match(/http\S+/)[0], 'a second session meanwhile is given the same sign-in');

  // The person says Allow in the page; the browser goes back to this machine, where the hook's sign-in is waiting.
  const at = new URL(asked.out.systemMessage.match(/http\S+/)[0]);
  const allowed = await fetch(`${base}/oauth/allow`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${owner}` }, body: JSON.stringify({ query: at.search.slice(1), allow: true }) });
  const back = await (await fetch((await allowed.json()).redirect)).text();
  assert.match(back, /Connected/);
  const kept = join(data, `signed-in-${new URL(base).host.replace(/[^\w.-]/g, '_')}.json`);
  for (let i = 0; i < 50 && !existsSync(kept); i++) await new Promise((r) => setTimeout(r, 100));
  assert.ok(readFileSync(kept, 'utf8').includes('"access"'), 'the token is kept in the plugin\u2019s data folder');

  const prompted = await hook('prompt', { session_id: 'stranger-1', cwd: data, prompt: 'hello' });
  assert.equal(prompted.out.systemMessage, undefined, 'nothing more to sign in to');
  assert.match(prompted.out.hookSpecificOutput.additionalContext, /registered in Archipelago[\s\S]*# Working with Archipelago/, 'registered now, with the working rules a plugin cannot put in CLAUDE.md');
  assert.doesNotMatch(prompted.out.hookSpecificOutput.additionalContext, /older than the server/, 'a plugin is not told to run the setup');
  const open = (await call('/agent/view', owner, { name: 'sessions' })).result.open;
  assert.equal(open.length, 1, 'the session that asked is on the map');

  // A server that is away is said in the session, once, not only to stderr.
  const gone = `away-${process.pid}-${Date.now()}`;
  const away = (name: string) =>
    new Promise<string>((done) => {
      const child = spawn(process.execPath, [join(ROOT, FOLDER, 'scripts', 'pelago-hook.mjs'), name], { env: { ...process.env, PELAGO_URL: 'http://127.0.0.1:9', PELAGO_AGENT_TOKEN: 'x' } });
      let out = '';
      child.stdout.on('data', (d) => (out += d));
      child.on('close', () => done(out));
      child.stdin.end(JSON.stringify({ session_id: gone, cwd: data }));
    });
  assert.match(JSON.parse(await away('stop')).systemMessage, /did not answer/);
  assert.equal(await away('stop'), '', 'said once a session');
});
