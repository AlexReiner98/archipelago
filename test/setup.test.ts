import assert from 'node:assert/strict';
import { dumpVault } from '../src/vault.ts';
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { request } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, test } from 'node:test';
import { gzipSync } from 'node:zlib';
import { createToken, OPERATOR_RESET_FILE } from '../src/auth.ts';
import { dump } from '../src/backup.ts';
import { loadConfig } from '../src/config.ts';
import { createHttpServer, lenient } from '../src/server.ts';
import { Workspaces } from '../src/workspaces.ts';
import { serve, closers } from './serve.ts';

test('the setup shows what it will change and waits for a yes, keeps a copy of what it changes, and can be taken out again', async () => {
  const { base } = await serve('tokens');
  const project = mkdtempSync(join(tmpdir(), 'pelago-careful-'));
  const at = (path: string) => join(project, path);
  const file = (path: string) => readFileSync(at(path), 'utf8');
  // A project with its own MCP server, its own hook and its own rules, and a machine with its own start-up file.
  const theirs = {
    '.mcp.json': JSON.stringify({ mcpServers: { other: { type: 'http', url: 'https://example.test/mcp' } } }),
    '.claude/settings.json': JSON.stringify({ permissions: { allow: ['Bash(npm test)'] }, hooks: { SessionEnd: [{ hooks: [{ type: 'command', command: 'echo bye' }] }] } }),
    'CLAUDE.md': '# Their project\n\nTheir own rules.\n',
    profile: 'export PATH="$PATH:/opt/bin"\n',
  };
  mkdirSync(at('.claude'));
  for (const [path, text] of Object.entries(theirs)) writeFileSync(at(path), text);
  const untouched = () => assert.deepEqual(Object.fromEntries(Object.keys(theirs).map((path) => [path, file(path)])), theirs);
  const setup = (flags: string[] = [], env: Record<string, string> = {}) =>
    new Promise<{ out: string; code: number | null }>((done) => {
      const child = spawn(process.execPath, ['-e', `fetch('${base}/connect/setup.mjs').then(r=>r.text()).then(t=>import('data:text/javascript,'+encodeURIComponent(t)))`, ...(flags.length ? ['--', ...flags] : [])], {
        cwd: project,
        env: { ...process.env, PELAGO_AGENT_TOKEN: '', PELAGO_SETUP_PROFILE: at('profile'), ...env },
      });
      let out = '';
      child.stdout.on('data', (d) => (out += d));
      child.stderr.on('data', (d) => (out += d));
      child.on('close', (code) => done({ out, code }));
    });
  const first = { PELAGO_AGENT_TOKEN: 'lat_default_secret', PELAGO_SETUP_SAVE: '1' };

  // With nobody to ask and no yes, a first setup is shown and refused.
  const refused = await setup();
  assert.equal(refused.code, 1, refused.out);
  assert.match(refused.out, /this would:[\s\S]*change {5}\.mcp\.json {2}\(adds the pelago tools\) {2}\(a copy is kept: \.mcp\.json\.pelago-backup\)[\s\S]*write {6}\.claude\/pelago-hook\.mjs[\s\S]*add to {5}CLAUDE\.md[\s\S]*Nothing was written[\s\S]*-- --yes/);
  untouched();
  assert.ok(!existsSync(at('.claude/pelago-hook.mjs')));

  // A dry run names what it would keep for the machine, and where, without the token and without writing.
  const dry = await setup(['--dry-run'], first);
  assert.equal(dry.code, 0, dry.out);
  assert.ok(dry.out.includes(`keep       PELAGO_URL and PELAGO_AGENT_TOKEN in ${at('profile')}, outside this folder`), dry.out);
  assert.match(dry.out, /Nothing was written \(--dry-run\)/);
  assert.ok(!dry.out.includes('lat_default_secret'));
  untouched();
  assert.equal((await setup(['--force'])).code, 1, 'an option it does not know stops it');
  untouched();

  // With a yes it writes, and what it changed of theirs has a copy beside it holding what was there.
  const done = await setup(['--yes'], first);
  assert.equal(done.code, 0, done.out);
  assert.ok(!done.out.includes('lat_default_secret'));
  for (const path of Object.keys(theirs)) assert.equal(file(`${path}.pelago-backup`), theirs[path as keyof typeof theirs], `${path} is copied as it was`);
  assert.ok(JSON.parse(file('.mcp.json')).mcpServers.pelago && JSON.parse(file('.mcp.json')).mcpServers.other);
  assert.deepEqual(Object.keys(JSON.parse(file('.claude/pelago-setup.json')).files).sort(), ['.claude/pelago-hook.mjs', '.claude/pelago.md', '.claude/skills/pelago-bump/SKILL.md', '.claude/skills/pelago-bump/references/home.md']);

  // Later, with nobody to ask: what Archipelago wrote is brought up to date; what is theirs is left, and said.
  writeFileSync(at('.claude/pelago.md'), 'rules as an older server handed them out\n');
  writeFileSync(at('.mcp.json'), theirs['.mcp.json']);
  const renewed = await setup();
  assert.equal(renewed.code, 0, renewed.out);
  assert.match(renewed.out, /not done {3}\.mcp\.json {2}\(it needs a yes\)[\s\S]*written {4}\.claude\/pelago\.md[\s\S]*Some of it was left/);
  assert.match(file('.claude/pelago.md'), /query` with name `handoff`/);
  assert.equal(file('.mcp.json'), theirs['.mcp.json']);
  assert.equal((await setup(['--yes'])).code, 0);
  assert.ok(JSON.parse(file('.mcp.json')).mcpServers.pelago);
  assert.equal(file('.mcp.json.pelago-backup'), theirs['.mcp.json'], 'the first copy is not written over');

  // Taking it out needs a yes too. A file of Archipelago's that was changed by hand is kept, and named.
  writeFileSync(at('.claude/skills/pelago-bump/SKILL.md'), file('.claude/skills/pelago-bump/SKILL.md') + '\nOur own note.\n');
  assert.equal((await setup(['--remove'])).code, 1);
  assert.equal((await setup(['--remove', '--dry-run'])).code, 0);
  assert.ok(existsSync(at('.claude/pelago-hook.mjs')), 'neither took anything out');
  const out = await setup(['--remove', '--yes']);
  assert.equal(out.code, 0, out.out);
  assert.match(out.out, /kept {7}\.claude\/skills\/pelago-bump\/SKILL\.md {2}\(changed since the setup wrote it\)[\s\S]*Archipelago is out of[\s\S]*add --machine/);
  assert.deepEqual(JSON.parse(file('.mcp.json')), JSON.parse(theirs['.mcp.json']));
  assert.deepEqual(JSON.parse(file('.claude/settings.json')), JSON.parse(theirs['.claude/settings.json']));
  assert.equal(file('CLAUDE.md'), theirs['CLAUDE.md']);
  assert.deepEqual(readdirSync(at('.claude')).sort(), ['settings.json', 'settings.json.pelago-backup', 'skills']);
  assert.deepEqual(readdirSync(at('.claude/skills/pelago-bump')), ['SKILL.md']);
  assert.match(file('profile'), /PELAGO_AGENT_TOKEN/, 'what is kept for the machine is left unless asked');
  const forgot = await setup(['--remove', '--machine', '--yes']);
  assert.match(forgot.out, /forgot {5}the server’s address and the token, on this machine/);
  assert.equal(file('profile'), theirs.profile);

  // A folder that held nothing before the setup holds nothing after it is taken out.
  const empty = mkdtempSync(join(tmpdir(), 'pelago-empty-'));
  const inEmpty = (flags: string[]) =>
    new Promise<number | null>((done) => {
      const child = spawn(process.execPath, ['-e', `fetch('${base}/connect/setup.mjs').then(r=>r.text()).then(t=>import('data:text/javascript,'+encodeURIComponent(t)))`, '--', ...flags], { cwd: empty, env: { ...process.env, PELAGO_AGENT_TOKEN: '' } });
      child.on('close', done);
    });
  assert.equal(await inEmpty(['--yes']), 0);
  assert.ok(readdirSync(empty).length >= 3);
  assert.equal(await inEmpty(['--remove', '--yes']), 0);
  assert.deepEqual(readdirSync(empty), []);
});

test('the hook script takes a Claude Code hook to whichever server the machine is connected to, with its token', async () => {
  const { workspaces, call, base } = await serve('tokens');
  const db = (await workspaces.get('default')).pelago.db;
  const robot = (await createToken(db, 'default', { kind: 'agent', name: 'robot' })).token;
  const hook = (name: string, input: unknown, env: Record<string, string>) =>
    new Promise<{ out: string; err: string; code: number | null }>((done) => {
      const child = spawn(process.execPath, [join(import.meta.dirname, '..', 'scripts', 'pelago-hook.mjs'), name], { env: { ...process.env, PELAGO_URL: base, PELAGO_AGENT_TOKEN: '', ...env } });
      let out = '';
      let err = '';
      child.stdout.on('data', (d) => (out += d));
      child.stderr.on('data', (d) => (err += d));
      child.on('close', (code) => done({ out, err, code }));
      child.stdin.end(JSON.stringify(input));
    });

  const started = await hook('session-start', { session_id: 'desk-1', cwd: '/nowhere' }, { PELAGO_AGENT_TOKEN: robot });
  assert.match(JSON.parse(started.out).hookSpecificOutput.additionalContext, /registered in Archipelago/, 'the server\u2019s answer comes back for Claude Code to read');
  // A project whose files are not the ones the server now hands out is told so, with the command that brings them up to date.
  const { SETUP_VERSION, setupScript } = await import('../src/connect.ts');
  const behind = /Archipelago files \(hooks, working rules, the bump skill\) are older than the server\u2019s|are older than the server's[^]*connect\/setup\.mjs/;
  assert.match(JSON.parse(started.out).hookSpecificOutput.additionalContext, behind, 'the script in this repository is not a hand-out: it says no version');
  const current = (await call('/hooks/session-start', robot, { session_id: 'desk-1', cwd: '/nowhere', setup: SETUP_VERSION })).hookSpecificOutput.additionalContext;
  assert.doesNotMatch(current, /older than the server/);
  assert.ok(setupScript(base).includes(`const SETUP = '${SETUP_VERSION}';`), 'the hook a project is given says which hand-out it is');
  const open = (await call('/agent/view', robot, { name: 'sessions' })).result.open;
  assert.deepEqual(open.map((s: any) => s.surface), ['claude-code'], 'and the session is on that server\u2019s map');
  // At the end of a turn the session's count so far goes to its run: one long turn is not a session without tokens.
  const transcript = join(mkdtempSync(join(tmpdir(), 'pelago-transcript-')), 'desk-1.jsonl');
  writeFileSync(transcript, JSON.stringify({ type: 'assistant', uuid: 'a1', message: { id: 'm1', usage: { input_tokens: 1200, output_tokens: 300 } } }) + '\n');
  assert.deepEqual([(await hook('stop', { session_id: 'desk-1', transcript_path: transcript }, { PELAGO_AGENT_TOKEN: robot })).out, open.length], ['{}', 1]);
  assert.equal((await call('/agent/get', robot, { id: open[0].id })).result.entity.props.tokens_used, 1500);
  await hook('session-end', { session_id: 'desk-1', reason: 'exit' }, { PELAGO_AGENT_TOKEN: robot });
  assert.equal((await call('/agent/view', robot, { name: 'sessions' })).result.open.length, 0, 'and is closed there');

  // A client with an old tool list sends an input it does not know as a string: it is taken as what it spells.
  const { z } = await import('zod');
  assert.equal(lenient(z.boolean().optional()).parse('true'), true);
  assert.deepEqual(lenient(z.array(z.string()).optional()).parse('["e_1","e_2"]'), ['e_1', 'e_2']);
  assert.deepEqual(lenient(z.array(z.object({ at: z.number() }))).parse('[{"at":2}]'), [{ at: 2 }]);
  assert.equal(lenient(z.string()).parse('true'), 'true', 'a string stays a string');
  assert.equal(lenient(z.number().optional()).parse(undefined), undefined);
  assert.throws(() => lenient(z.boolean()).parse('maybe'));

  // Refused or unreachable, it says so and still lets the session go on.
  const refused = await hook('prompt', { session_id: 'desk-1' }, {});
  assert.deepEqual([refused.code, refused.out, /answered 401/.test(refused.err)], [0, '', true]);
  const away = await hook('prompt', { session_id: 'desk-1' }, { PELAGO_URL: 'http://127.0.0.1:9' });
  assert.deepEqual([away.code, away.out, /did not answer/.test(away.err)], [0, '', true]);
});

test('beyond this machine the server needs tokens, and answers only to the names it is given', async () => {
  const before = { ...process.env };
  after(() => {
    for (const key of ['PELAGO_HOST', 'PELAGO_AUTH', 'PELAGO_DEV', 'PELAGO_PUBLIC_HOST', 'PORT', 'PELAGO_PORT', 'LATTICE_HOST', 'LATTICE_AUTH']) {
      if (before[key] === undefined) delete process.env[key];
      else process.env[key] = before[key];
    }
  });
  for (const key of ['PELAGO_AUTH', 'PELAGO_DEV', 'PELAGO_PORT']) delete process.env[key];
  // A server set up while this was called Lattice is still started with those names, and they are still read.
  process.env.LATTICE_HOST = '0.0.0.0';
  assert.throws(() => loadConfig(), /needs auth "tokens"/);
  process.env.LATTICE_AUTH = 'tokens';
  assert.deepEqual([loadConfig().host, loadConfig().auth], ['0.0.0.0', 'tokens']);
  for (const key of ['LATTICE_HOST', 'LATTICE_AUTH']) delete process.env[key];
  process.env.PELAGO_HOST = '0.0.0.0';
  assert.throws(() => loadConfig(), /needs auth "tokens"/);
  process.env.PELAGO_AUTH = 'tokens';
  process.env.PELAGO_PUBLIC_HOST = 'Pelago.Example.com, other.example.com';
  process.env.PORT = '10000';
  const hosted = loadConfig();
  assert.deepEqual([hosted.host, hosted.port, hosted.publicHosts, hosted.launch], ['0.0.0.0', 10000, ['pelago.example.com', 'other.example.com'], false], 'and it does not launch sessions');

  const workspaces = new Workspaces({ dataDir: null, rootDir: join(mkdtempSync(join(tmpdir(), 'pelago-public-')), 'workspaces'), packsDir: join(import.meta.dirname, '..', 'packs') });
  const server = createHttpServer(workspaces, 0, { auth: 'tokens', publicHosts: hosted.publicHosts });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  closers.push(async () => {
    server.close();
    await workspaces.closeAll();
  });
  const port = (server.address() as AddressInfo).port;
  const owner = await createToken((await workspaces.get('default')).pelago.db, 'default', { kind: 'human', name: 'owner', admin: true });
  const ask = (host: string) =>
    new Promise<number>((done) => {
      const req = request({ port, host: '127.0.0.1', path: '/api/schema', method: 'POST', headers: { host, 'content-type': 'application/json', authorization: `Bearer ${owner.token}` } }, (res) => {
        res.resume();
        done(res.statusCode ?? 0);
      });
      req.end('{}');
    });
  assert.equal(await ask('pelago.example.com'), 200, 'its public name');
  assert.equal(await ask('evil.example.net'), 403, 'any other name');
});

test('the operator can issue a workspace a new owner token, and nobody else can', async () => {
  const { workspaces, call } = await serve('tokens');
  const operator = (await workspaces.ensureOperator())!;
  const made = await call('/operator/workspaces', operator, { id: 'acme', name: 'Acme' });
  assert.equal((await call('/operator/workspaces/acme/owner-token', made.result.owner_token)).status, 401, 'not the workspace\'s own owner');
  assert.equal((await call('/operator/workspaces/nope/owner-token', operator)).status, 404);
  const again = await call('/operator/workspaces/acme/owner-token', operator);
  assert.notEqual(again.result.owner_token, made.result.owner_token);
  const who = await call('/whoami', again.result.owner_token, undefined, 'GET');
  assert.deepEqual([who.workspace.id, who.actor.kind, who.actor.admin], ['acme', 'human', true]);
  assert.equal((await call('/whoami', made.result.owner_token, undefined, 'GET')).workspace.id, 'acme', 'the first token still works');
});

test('the operator can create a workspace from a backup file: the map, its types and its owner arrive', async () => {
  const { workspaces, call } = await serve('tokens');
  const operator = (await workspaces.ensureOperator())!;
  const main = await workspaces.get('default');
  const old = (await createToken(main.pelago.db, 'default', { kind: 'human', name: 'alex', admin: true })).token;
  const me = (await call('/api/init', old, { name: 'Alex' })).result.me as string;
  await call('/api/change', old, { reason: 'x', ops: [{ op: 'define_type', type: { id: 'local.site_visit', title: 'Site visit', description: 'A visit.', extends: 'event' } }] });
  await call('/api/change', old, { reason: 'x', ops: [{ op: 'create', type: 'local.site_visit', title: 'Visit the quarry' }] });

  const taken = await dump(main.pelago.db, { id: 'default', name: 'Default' }, main.pelago.registry.localPack());
  const backup = gzipSync(JSON.stringify(taken)).toString('base64');
  assert.equal((await call('/operator/workspaces', old, { id: 'moved', backup })).status, 401, 'only the operator');
  assert.match((await call('/operator/workspaces', operator, { id: 'moved', backup: 'bm90IGEgYmFja3Vw' })).error, /not an Archipelago backup/);
  assert.match((await call('/operator/workspaces', operator, { id: 'moved', backup: gzipSync(JSON.stringify({ ...taken, tables: { ...taken.tables, relation: [{ id: 'r_x', type: 'part_of', from_id: 'e_nobody', to_id: 'e_nowhere' }] } })).toString('base64') })).error, /./, 'a backup that does not go in');
  assert.deepEqual((await call('/operator/workspaces', operator, undefined, 'GET')).result.map((w: any) => w.id), ['default'], 'a failed one leaves no workspace behind');
  assert.equal(existsSync(join(workspaces.config.rootDir, 'moved')), false);

  const vault = gzipSync(JSON.stringify(await dumpVault(main.pelago.db))).toString('base64');
  assert.match((await call('/operator/workspaces', operator, { id: 'moved', backup })).error, /backup of the key vault/, 'a sealed backup comes with its vault');
  const made = (await call('/operator/workspaces', operator, { id: 'moved', name: 'Alex, moved', backup, vault })).result;
  const logged = new Set(taken.tables.log_entry.map((e) => e.id)); // what a change set did is read from the restored log
  assert.deepEqual([made.restored.entities, made.restored.events, made.restored.from.id], [taken.tables.entity.length, taken.tables.event.filter((e) => !logged.has(e.changeset)).length, 'default']);
  const who = await call('/whoami', made.owner_token, undefined, 'GET');
  assert.deepEqual([who.workspace.id, who.workspace.name, who.actor.admin, who.actor.person], ['moved', 'Alex, moved', true, me], 'the new token is the owner\'s own');
  assert.equal((await call('/api/workspace_info', made.owner_token)).result.owner.title, 'Alex');
  const found = (await call('/api/search', made.owner_token, { type: 'local.site_visit' })).result as any[];
  assert.deepEqual(found.map((e) => e.title), ['Visit the quarry'], 'with the types it defined for itself');
  assert.equal((await call('/whoami', old.replace('pel_default_', 'pel_moved_'), undefined, 'GET')).status, 401, 'tokens from where it came from do not work here');
  const tokens = (await call('/api/token_list', made.owner_token)).result as any[];
  assert.deepEqual(tokens.filter((t) => !t.revoked_at).map((t) => t.name), ['owner']);

  // It carries on from there, and the original is untouched.
  await call('/api/change', made.owner_token, { reason: 'x', ops: [{ op: 'create', type: 'work.note', title: 'Written after the move' }] });
  assert.equal(((await call('/api/search', old, { q: 'Written after the move' })).result as any[]).length, 0);
  assert.match((await call('/operator/workspaces', operator, { id: 'moved', backup })).error, /already exists/);
});

test('a lost operator secret is replaced by whoever can write on the server\'s disk, and by nobody else', async () => {
  const { workspaces, call } = await serve('tokens');
  const lost = (await workspaces.ensureOperator())!;
  const file = join(workspaces.config.rootDir, OPERATOR_RESET_FILE);
  const proof = 'reset_' + 'a'.repeat(48);
  assert.equal((await call('/operator/reset', undefined, { proof })).status, 401, 'nothing was prepared');
  mkdirSync(workspaces.config.rootDir, { recursive: true });
  writeFileSync(file, proof);
  assert.equal((await call('/operator/reset', undefined, { proof: 'reset_' + 'b'.repeat(48) })).status, 401, 'a wrong proof');
  assert.equal(existsSync(file), false, 'and the file is good for one try');
  assert.equal((await call('/operator/reset', undefined, { proof })).status, 401);
  writeFileSync(file, 'short');
  assert.equal((await call('/operator/reset', undefined, { proof: 'short' })).status, 401, 'a guessable proof is not one');

  writeFileSync(file, proof);
  const fresh = (await call('/operator/reset', undefined, { proof })).result.operator_secret as string;
  assert.equal((await call('/operator/workspaces', lost, undefined, 'GET')).status, 401, 'the old secret is finished');
  assert.equal((await call('/operator/workspaces', fresh, undefined, 'GET')).status, 200);
  assert.equal((await (await serve('off')).call('/operator/reset', undefined, { proof })).status, 404, 'no operator without tokens');
});

test('a workspace admin merges a backup into their map; nobody else can, and listeners hear of the import, not of its history', async () => {
  const { workspaces, call, member: join } = await serve('tokens');
  const operator = (await workspaces.ensureOperator())!;
  // Where the file comes from: another map, with a type of its own and things its owner did.
  const there = (await call('/operator/workspaces', operator, { id: 'laptop', name: 'Laptop' })).result.owner_token as string;
  await call('/api/change', there, { reason: 'x', ops: [{ op: 'define_type', type: { id: 'local.site_visit', title: 'Site visit', description: 'A visit.', extends: 'event' } }] });
  await call('/api/change', there, { reason: 'x', ops: [{ op: 'create', type: 'local.site_visit', title: 'Visit the quarry' }, { op: 'create', type: 'work.task', title: 'Order the stone' }] });
  const laptop = await workspaces.get('laptop');
  const taken = await dump(laptop.pelago.db, { id: 'laptop', name: 'Laptop' }, laptop.pelago.registry.localPack());
  const backup = gzipSync(JSON.stringify(taken)).toString('base64');
  const vault = gzipSync(JSON.stringify(await dumpVault(laptop.pelago.db))).toString('base64');

  const main = await workspaces.get('default');
  const admin = (await createToken(main.pelago.db, 'default', { kind: 'human', name: 'alex', admin: true })).token;
  const member = await join(admin, { email: 'sam@example.com', name: 'Sam' });
  const robot = (await createToken(main.pelago.db, 'default', { kind: 'agent', name: 'robot' })).token;
  await call('/api/change', admin, { reason: 'x', ops: [{ op: 'create', type: 'work.note', title: 'Already here', visibility: 'shared' }] });
  assert.match((await call('/api/import_backup', member, { backup })).error, /Only a workspace admin/);
  assert.match((await call('/agent/import_backup', robot, { backup })).error, /humans only/);
  assert.match((await call('/api/import_backup', admin, { backup: 'bm90IGEgYmFja3Vw' })).error, /not an Archipelago backup/);

  const { latest } = (await call('/agent/watch', robot)).result;
  const preview = (await call('/api/import_backup', admin, { backup, vault })).result;
  assert.deepEqual([preview.applied, preview.entities.added, preview.types_added], [false, 2, ['local.site_visit']]);
  const titles = async () => ((await call('/api/search', admin)).result as any[]).map((e) => e.title).sort();
  assert.ok(!(await titles()).includes('Order the stone'), 'looking changes nothing');
  const done = (await call('/api/import_backup', admin, { backup, vault, apply: true })).result;
  assert.deepEqual([done.applied, done.entities.added], [true, 2]);
  assert.deepEqual((await titles()).filter((t) => ['Already here', 'Order the stone', 'Visit the quarry'].includes(t)), ['Already here', 'Order the stone', 'Visit the quarry']);
  assert.equal(((await call('/api/search', admin, { type: 'local.site_visit' })).result as any[]).length, 1, 'with the type it needed');

  const heard = (await call('/agent/watch', robot, { after: latest })).result.changes as any[];
  assert.deepEqual(heard.map((c) => c.action), ['workspace.import'], "what the laptop's owner did there long ago is not news here");
  assert.equal((await call('/api/import_backup', admin, { backup, vault, apply: true })).result.events.added, 0);
});

test('an import can make the owner in the file and the owner here one person, and they keep their token and what is theirs', async () => {
  const { workspaces, call } = await serve('tokens');
  const operator = (await workspaces.ensureOperator())!;
  const there = (await call('/operator/workspaces', operator, { id: 'laptop', name: 'Laptop' })).result.owner_token as string;
  const theirs = (await call('/api/init', there, { name: 'Alex Reiner' })).result.me as string;
  await call('/api/change', there, { reason: 'x', ops: [{ op: 'create', type: 'work.task', title: 'From the laptop', owner: theirs }] });
  const backup = gzipSync(JSON.stringify(await dump((await workspaces.get('laptop')).pelago.db, { id: 'laptop', name: 'Laptop' }))).toString('base64');
  const vault = gzipSync(JSON.stringify(await dumpVault((await workspaces.get('laptop')).pelago.db))).toString('base64');

  const db = (await workspaces.get('default')).pelago.db;
  const alex = (await createToken(db, 'default', { kind: 'human', name: 'alex', admin: true })).token;
  const mine = (await call('/api/init', alex, { name: 'Alex R' })).result.me as string;
  await call('/api/change', alex, { reason: 'x', ops: [{ op: 'create', type: 'work.task', title: 'Mine alone' }] });

  const preview = (await call('/api/import_backup', alex, { backup, vault })).result;
  assert.deepEqual(preview.owners, { here: { id: mine, title: 'Alex R' }, file: { id: theirs, title: 'Alex Reiner' }, made_one: false });
  const apart = (await call('/api/import_backup', alex, { backup, vault, apply: true })).result;
  assert.equal(apart.owners.made_one, false, 'not unless asked');
  assert.equal((await call('/whoami', alex, undefined, 'GET')).actor.person, mine);

  // Asked afterwards, with a file that has nothing else new in it.
  const done = (await call('/api/import_backup', alex, { backup, vault, apply: true, same_owner: true })).result;
  assert.deepEqual([done.owners.made_one, done.entities.added], [true, 0]);
  assert.equal((await call('/whoami', alex, undefined, 'GET')).actor.person, theirs, 'the token is now the person from the file');
  assert.equal((await call('/api/workspace_info', alex)).result.owner.id, theirs, 'who owns the workspace');
  const tasks = ((await call('/api/search', alex, { type: 'work.task' })).result as any[]).map((e) => e.title).sort();
  assert.deepEqual(tasks, ['From the laptop', 'Mine alone'], 'and still sees what was private to them');
  const people = ((await call('/api/search', alex, { type: 'person' })).result as any[]).map((e) => e.title);
  assert.deepEqual(people, ['Alex Reiner'], 'one person, not two');
  assert.equal((await call('/api/import_backup', alex, { backup, vault })).result.owners, undefined, 'and later imports line up');
});

