// Installing Archipelago by one line or by asking an agent (packs/connect/kernel/install.ts, scripts/pelago-install.mjs): the page says
// each client's step, the line fetches the installer with this server's address in it, and the installer connects the
// clients it is told to, keeping what was there.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { promptTitle } from '../packs/sessions/kernel/session-name.ts';
import { serve } from './serve.ts';

const runInstaller = (base: string, home: string, flags: string[]) =>
  new Promise<{ code: number | null; out: string }>((done) => {
    const child = spawn(process.execPath, ['-e', `fetch('${base}/connect/install.mjs').then(r=>r.text()).then(t=>import('data:text/javascript,'+encodeURIComponent(t)))`, '--', ...flags], {
      env: { ...process.env, HOME: home, USERPROFILE: home, PELAGO_HOME: join(home, '.pelago'), PATH: '' },
    });
    let out = '';
    child.stdout.on('data', (d) => (out += d));
    child.stderr.on('data', (d) => (out += d));
    child.on('close', (code) => done({ code, out }));
    child.stdin.end();
  });

test('the install page gives each client its step, and its line fetches an installer for this server', async () => {
  const { base } = await serve('off');
  const page = await (await fetch(`${base}/connect/install`)).text();
  for (const said of ['### Claude Code', '### Codex', '### Cursor', '### Grok Bot', '### ChatGPT', `irm ${base}/connect/install.ps1 | iex`, `curl -fsSL ${base}/connect/install.sh | sh`, `${base}/mcp`])
    assert.ok(page.includes(said), `the page says ${said}`);
  assert.match(await (await fetch(`${base}/connect/install.ps1`)).text(), new RegExp(`${base}/connect/install\\.mjs`));
  assert.match(await (await fetch(`${base}/connect/install.sh`)).text(), /<\/dev\/tty/, 'sh reads answers from the terminal, not the pipe it came in on');
  const script = await (await fetch(`${base}/connect/install.mjs`)).text();
  assert.ok(script.startsWith(`const ORIGIN = ${JSON.stringify(base)};`));
  assert.ok(script.includes(`const DEFAULT = \\"${base}\\"`), 'the sign-in it writes signs in to this server');
  assert.ok(script.includes(`(process.env.PELAGO_URL || \\"${base}\\")`), 'and so does the hook it writes for Codex and Cursor');
});

test('an agent that lands on the root finds the install: /install is the page, /llms.txt points at it', async () => {
  const { base } = await serve('off');
  assert.equal(await (await fetch(`${base}/install`)).text(), await (await fetch(`${base}/connect/install`)).text());
  assert.match(await (await fetch(`${base}/install.ps1`)).text(), /connect\/install\.mjs/);
  const llms = await fetch(`${base}/llms.txt`);
  assert.match(llms.headers.get('content-type') ?? '', /^text\/plain/);
  const text = await llms.text();
  assert.ok(text.startsWith('# Archipelago'), 'llms.txt opens on its name');
  assert.ok(text.includes(`${base}/connect/install`), 'and names the install');
  assert.match(await (await fetch(`${base}/`)).text(), /<noscript>.*href="\/install"/s, 'the page itself links there for a reader without scripts');
});

test('the installer connects Cursor, keeping its other servers, and names an unknown client', async () => {
  const { base } = await serve('off');
  const home = mkdtempSync(join(tmpdir(), 'pelago-install-'));
  mkdirSync(join(home, '.cursor'));
  writeFileSync(join(home, '.cursor', 'mcp.json'), JSON.stringify({ mcpServers: { other: { url: 'https://example.com/mcp' } } }));
  const dry = await runInstaller(base, home, ['--client', 'cursor', '--dry-run']);
  assert.match(dry.out, /\(would write\) mcpServers\.pelago/);
  assert.equal(JSON.parse(readFileSync(join(home, '.cursor', 'mcp.json'), 'utf8')).mcpServers.pelago, undefined, 'a dry run writes nothing');
  const real = await runInstaller(base, home, ['--client', 'cursor', '--yes']);
  assert.equal(real.code, 0, real.out);
  assert.deepEqual(JSON.parse(readFileSync(join(home, '.cursor', 'mcp.json'), 'utf8')).mcpServers, { other: { url: 'https://example.com/mcp' }, pelago: { url: `${base}/mcp` } });
  writeFileSync(join(home, '.cursor', 'hooks.json'), JSON.stringify({ version: 1, hooks: { stop: [{ command: 'echo mine' }] } }));
  const again = await runInstaller(base, home, ['--client', 'cursor', '--yes']);
  assert.equal(again.code, 0, again.out);
  const cursorHooks = JSON.parse(readFileSync(join(home, '.cursor', 'hooks.json'), 'utf8'));
  assert.equal(cursorHooks.version, 1);
  assert.deepEqual(Object.keys(cursorHooks.hooks).sort(), ['beforeSubmitPrompt', 'sessionEnd', 'sessionStart', 'stop']);
  assert.equal(cursorHooks.hooks.stop.length, 2, 'its own hook is kept beside ours, and ours is not doubled by a second run');
  assert.match(cursorHooks.hooks.sessionStart[0].command, /pelago-cursor\.mjs" session-start$/);
  for (const file of ['bin/pelago-hook.mjs', 'bin/pelago-events.mjs', 'bin/pelago-cursor.mjs', 'bin/pelago-login.mjs', 'pelago.md']) assert.ok(existsSync(join(home, '.pelago', file)), `${file} is kept in ~/.pelago`);

  // Codex: not on this PATH, so its MCP step says what to run; its hooks, Claude Code's in all but place, are written.
  const codex = await runInstaller(base, home, ['--client', 'codex', '--yes']);
  assert.match(codex.out, /codex mcp add pelago --url/);
  const codexHooks = JSON.parse(readFileSync(join(home, '.codex', 'hooks.json'), 'utf8')).hooks;
  assert.deepEqual(Object.keys(codexHooks).sort(), ['SessionEnd', 'SessionStart', 'Stop', 'UserPromptSubmit']);
  assert.match(codexHooks.SessionStart[0].hooks[0].command, /pelago-hook\.mjs" session-start --plugin$/);

  // A Cursor session, through the adapter: registered, with the map's word handed to its agent at the start.
  const cursor = await new Promise<string>((done) => {
    const child = spawn(process.execPath, [join(home, '.pelago', 'bin', 'pelago-cursor.mjs'), 'session-start'], { env: { ...process.env, PELAGO_URL: base, PELAGO_HOME: join(home, '.pelago'), PELAGO_AGENT_TOKEN: '' } });
    let out = '';
    child.stdout.on('data', (d) => (out += d));
    child.on('close', () => done(out));
    child.stdin.end(JSON.stringify({ conversation_id: 'cursor-1', workspace_roots: [home], hook_event_name: 'sessionStart' }));
  });
  assert.match(JSON.parse(cursor).additional_context, /registered in Archipelago/, cursor.slice(0, 400));

  const wrong = await runInstaller(base, home, ['--client', 'chatgpt']);
  assert.equal(wrong.code, 2);
  assert.match(wrong.out, /set up in their own apps/);
});

test('the clients that sign in from their makers’ clouds, and Cursor, can register', async () => {
  const { base } = await serve('tokens');
  for (const redirect of ['https://chatgpt.com/connector_platform_oauth_redirect', 'cursor://anysphere.cursor-mcp/oauth/callback', 'http://127.0.0.1:8787/callback']) {
    const res = await fetch(`${base}/oauth/register`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ client_name: 'A client', redirect_uris: [redirect] }) });
    const said = (await res.json()) as { client_id?: string; error?: string };
    assert.ok(res.ok && said.client_id, `${redirect}: ${JSON.stringify(said)}`);
  }
});

test('a first prompt names a session by its opening words, cut at a word', () => {
  assert.equal(promptTitle('\n  fix the   login bug\nand more'), 'fix the login bug');
  const long = promptTitle('make the install one command end to end, so a stranger pastes one line and signs in once');
  assert.ok(long.length <= 60 && long.endsWith('…') && !long.includes('  '), long);
  assert.equal(promptTitle(''), '');
});
