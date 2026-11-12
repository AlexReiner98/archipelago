import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';
import { alertOwner, resetAlerts } from '../src/alert.ts';
import { setMailer, type Mail } from '../src/mail.ts';
import '../packs/loader/kernel/server-slots.ts'; // the mailer fills the walls' slot walls.mail, as when the server starts
import { VIEWS } from '../src/views.ts';
import { fresh, make } from './map.ts';

const mailbox: Mail[] = [];
setMailer(async (mail) => void mailbox.push(mail));

test('a failure tells the owner on the map and by mail, once an hour', async (t) => {
  t.after(() => delete process.env.PELAGO_ALERT_TO);
  process.env.PELAGO_ALERT_TO = 'Owner@Example.com';
  resetAlerts();
  mailbox.length = 0;
  const l = await fresh();
  assert.equal(l.workspace, 'default');
  const { tidy } = await make(l, [{ op: 'create', ref: 'tidy', type: 'task', title: 'Nightly tidy' }]);
  // As the clock tells the owner its pass failed: the same key twice in an hour is said once.
  const failed = { key: 'clock', title: 'The automation "Nightly tidy" failed', body: 'No connection e_nowhere', level: 'warning' as const, from: 'pelago', about: tidy };
  await alertOwner(l, failed);
  await alertOwner(l, failed);
  const told = ((await VIEWS.notifications.run(l, {})) as any[]).filter((n) => n.title.includes('Nightly tidy'));
  assert.equal(told.length, 1, 'said once, not on every pass');
  assert.deepEqual([told[0].title, told[0].level, told[0].about_title], ['The automation "Nightly tidy" failed', 'warning', 'Nightly tidy']);
  assert.equal(mailbox.length, 1);
  assert.equal(mailbox[0].to, 'owner@example.com');
  assert.equal(mailbox[0].subject, 'Archipelago: The automation "Nightly tidy" failed');
});

test('without an address, or on a map that is not the server’s own, only the map is told', async (t) => {
  t.after(() => delete process.env.PELAGO_ALERT_TO);
  resetAlerts();
  mailbox.length = 0;
  const l = await fresh();
  await alertOwner(l, { key: 'k', title: 'Something broke', body: 'Details', from: 'pelago' });
  assert.equal(mailbox.length, 0, 'no PELAGO_ALERT_TO: no mail');
  process.env.PELAGO_ALERT_TO = 'owner@example.com';
  await alertOwner(Object.assign(Object.create(l), { workspace: 'customer' }), { key: 'k', title: 'Theirs broke', body: 'Details', from: 'pelago' });
  assert.equal(mailbox.length, 0, 'a customer’s map is not the server owner’s to hear of');
  const titles = ((await VIEWS.notifications.run(l, {})) as any[]).map((n) => n.title);
  assert.ok(titles.includes('Something broke'));
});

test('a crash is mailed to the owner before the process exits', () => {
  const alert = new URL('../src/alert.ts', import.meta.url).href;
  const mail = new URL('../src/mail.ts', import.meta.url).href;
  const script = `
    const { setMailer } = await import(${JSON.stringify(mail)});
    const { alertOnCrash } = await import(${JSON.stringify(alert)});
    setMailer(async (m) => { console.log('MAILED ' + JSON.stringify(m)); });
    alertOnCrash('test-host');
    setTimeout(() => { throw new Error('boom in a timer'); }, 10);
    setTimeout(() => console.log('STILL ALIVE'), 5000);`;
  const run = spawnSync(process.execPath, ['--input-type=module', '-e', script], { env: { ...process.env, PELAGO_ALERT_TO: 'owner@example.com' }, encoding: 'utf8', timeout: 20_000 });
  assert.equal(run.status, 1, 'it still exits');
  const line = run.stdout.split('\n').find((s) => s.startsWith('MAILED '));
  assert.ok(line, `mailed: ${run.stdout} ${run.stderr}`);
  const sent = JSON.parse(line.slice(7));
  assert.equal(sent.subject, 'Archipelago: the server on test-host crashed');
  assert.match(sent.text, /uncaught exception[\s\S]*boom in a timer/);
  assert.ok(!run.stdout.includes('STILL ALIVE'));
});
