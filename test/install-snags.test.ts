// What a newcomer's agent ran into, installing on a guest map (the guest walk, 15 Nov 2026; four bugs on the map, fixed
// on the owner's word): the installer says which map it reached, a sign-in made in the browser wins over a
// PELAGO_AGENT_TOKEN set for another map, `call` takes a verb's params as words, and an old `pelago` server in
// ~/.mcp.json is taken out when an agent installs, a copy kept.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { pathToFileURL } from 'node:url';
import { serve } from './serve.ts';

const login: any = await import(pathToFileURL(join(import.meta.dirname, '..', 'scripts', 'pelago-login.mjs')).href);

test('call takes a verb’s params as words: all but name, action and actor are its params', () => {
  assert.deepEqual(login.asWords('query', ['name=brief', 'task=e_ab12cd34']), { name: 'brief', params: { task: 'e_ab12cd34' } });
  assert.deepEqual(login.asWords('query', ['name=frontier']), { name: 'frontier' });
  assert.deepEqual(login.asWords('report', ['action=tell', 'run=e_x', 'said=done']), { action: 'tell', params: { run: 'e_x', said: 'done' } });
  assert.deepEqual(login.asWords('query', ['name=search', 'q=island', 'limit=5', 'all']), { name: 'search', params: { q: 'island', limit: 5, all: true } }, 'a number is a number, a word alone true');
  assert.deepEqual(login.asWords('undo', ['changeset=c_1']), { changeset: 'c_1' }, 'change and undo take theirs as they are');
});

test('a sign-in made in the browser wins over PELAGO_AGENT_TOKEN, and the map it reaches is named', async () => {
  // A server that answers with the token it was called with: which one the call carried.
  const heard: string[] = [];
  const server = createServer((req, res) => {
    heard.push(req.headers.authorization ?? '');
    res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ workspace: { id: 'guest-1', name: 'Guest map', guest: true } }));
  });
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
  const origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  const home = mkdtempSync(join(tmpdir(), 'pelago-snags-'));
  const was = { home: process.env.PELAGO_HOME, token: process.env.PELAGO_AGENT_TOKEN };
  Object.assign(process.env, { PELAGO_HOME: home, PELAGO_AGENT_TOKEN: 'from-the-environment' });
  try {
    await login.call(origin, 'query', {});
    assert.equal(heard.at(-1), 'Bearer from-the-environment', 'with no sign-in here, the environment’s token serves');
    writeFileSync(join(home, `signed-in-${new URL(origin).host.replace(/[^\w.-]/g, '_')}.json`), JSON.stringify({ access: 'signed-in-here', refresh: 'r', until: Date.now() + 3_600_000, client: 'c' }));
    await login.call(origin, 'query', {});
    assert.equal(heard.at(-1), 'Bearer signed-in-here', 'a sign-in made here wins');
    assert.equal(await login.mapOf(origin), `“Guest map” (guest-1, a guest map) at ${new URL(origin).host}`);
  } finally {
    Object.assign(process.env, { PELAGO_HOME: was.home ?? '', PELAGO_AGENT_TOKEN: was.token ?? '' });
    if (was.home === undefined) delete process.env.PELAGO_HOME;
    if (was.token === undefined) delete process.env.PELAGO_AGENT_TOKEN;
    server.close();
  }
});

test('an agent’s install takes an old pelago server out of ~/.mcp.json, keeping a copy and the other servers', async () => {
  const { base } = await serve('off');
  const home = mkdtempSync(join(tmpdir(), 'pelago-old-'));
  const servers = { pelago: { type: 'http', url: 'https://example.com/mcp', headers: { Authorization: 'Bearer x' } }, other: { url: 'https://other.example/mcp' } };
  writeFileSync(join(home, '.mcp.json'), JSON.stringify({ mcpServers: servers }));
  mkdirSync(join(home, '.pelago'), { recursive: true });
  const out = await new Promise<string>((done) => {
    const child = spawn(process.execPath, ['-e', `fetch('${base}/connect/install.mjs').then(r=>r.text()).then(t=>import('data:text/javascript,'+encodeURIComponent(t)))`, '--', '--client', 'claude', '--yes'], {
      env: { ...process.env, HOME: home, USERPROFILE: home, PELAGO_HOME: join(home, '.pelago'), PATH: '', PELAGO_AGENT_TOKEN: '' },
    });
    let said = '';
    child.stdout.on('data', (d) => (said += d));
    child.stderr.on('data', (d) => (said += d));
    child.on('close', () => done(said));
    child.stdin.end();
  });
  assert.match(out, /Taken out/, out);
  assert.deepEqual(JSON.parse(readFileSync(join(home, '.mcp.json'), 'utf8')).mcpServers, { other: servers.other });
  assert.ok(existsSync(join(home, '.mcp.json.pelago-old')), 'a copy is kept to put it back');
  assert.match(out, /needs no sign-in/, 'a server that signs nobody in is not asked of');
});
