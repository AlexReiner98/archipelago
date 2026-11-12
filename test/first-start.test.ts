// The first start's operator secret reaches a person at a terminal, and with nobody at one a file, never the log; the
// owner is named by their address and mailed a code to sign in, never handed a token to paste.
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { FIRST_START_FILE, firstStart } from '../packs/surface/kernel/first-start.ts';
import { setMailer, type Mail } from '../packs/mailer/kernel/mail.ts';
import { adminEmails } from '../packs/identity/kernel/members.ts';
import { Workspaces } from '../packs/identity/kernel/workspaces.ts';

async function started(run: (workspaces: Workspaces, root: string, logged: string[]) => Promise<void>) {
  const root = mkdtempSync(join(tmpdir(), 'pelago-first-'));
  const workspaces = new Workspaces({ dataDir: null, rootDir: join(root, 'workspaces'), packsDir: join(import.meta.dirname, '..', 'packs') });
  const logged: string[] = [];
  const log = console.log;
  console.log = (...said: unknown[]) => void logged.push(said.join(' '));
  try {
    await run(workspaces, root, logged);
  } finally {
    console.log = log;
    setMailer(undefined);
    delete process.env.PELAGO_OWNER_EMAIL;
    await workspaces.closeAll();
    rmSync(root, { recursive: true, force: true });
  }
}

test('with nobody at a terminal, the first start writes the operator secret to a file and mails the owner a sign-in code', () =>
  started(async (workspaces, root, logged) => {
    const sent: Mail[] = [];
    setMailer(async (mail) => void sent.push(mail));
    process.env.PELAGO_OWNER_EMAIL = 'Owner@Example.test';
    const main = await workspaces.get('default');
    const file = await firstStart(workspaces, main, root, false);
    assert.equal(file, join(root, FIRST_START_FILE));
    const held = readFileSync(file!, 'utf8');
    assert.match(held, /pelop_[0-9a-f]+/, 'the operator secret is in the file');
    assert.doesNotMatch(held, /pel_default_/, 'and no token to paste');
    assert.deepEqual(await adminEmails(main.pelago), ['owner@example.test'], 'the owner is the first admin');
    assert.deepEqual(sent.map((m) => m.to), ['owner@example.test']);
    const code = /^Default: ([0-9A-Z]{4}-[0-9A-Z]{4})$/m.exec(sent[0].text)?.[1];
    assert.ok(code, 'mailed a code to sign in');
    assert.doesNotMatch(logged.join('\n'), new RegExp(`pelop_|pel_default_|${code}`), 'the log holds no secret');
    assert.equal(await firstStart(workspaces, main, root, false), undefined, 'given once: a second start has nothing to give');
    assert.equal(sent.length, 1, 'nor mails again');
  }));

test('a first start without the owner’s address, or without mail, does not set the server up', () =>
  started(async (workspaces, root) => {
    const main = await workspaces.get('default');
    await assert.rejects(firstStart(workspaces, main, root, false), /PELAGO_OWNER_EMAIL/);
    process.env.PELAGO_OWNER_EMAIL = 'owner@example.test';
    await assert.rejects(firstStart(workspaces, main, root, false), /sends no mail/);
    assert.deepEqual(await adminEmails(main.pelago), [], 'and nobody was made its owner');
  }));
