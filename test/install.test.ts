// Installing Archipelago by one line or by asking an agent (src/install.ts, scripts/pelago-install.mjs): the page says
// each client's step, the line fetches the installer with this server's address in it, and the installer connects the
// clients it is told to, keeping what was there.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { promptTitle } from '../src/session-name.ts';
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
  const wrong = await runInstaller(base, home, ['--client', 'chatgpt']);
  assert.equal(wrong.code, 2);
  assert.match(wrong.out, /set up in their own apps/);
});

test('a first prompt names a session by its opening words, cut at a word', () => {
  assert.equal(promptTitle('\n  fix the   login bug\nand more'), 'fix the login bug');
  const long = promptTitle('make the install one command end to end, so a stranger pastes one line and signs in once');
  assert.ok(long.length <= 60 && long.endsWith('…') && !long.includes('  '), long);
  assert.equal(promptTitle(''), '');
});
