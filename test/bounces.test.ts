// Addresses that bounced for good are sent nothing for a while: the relay hands over its failure notices, and the
// server reads which addresses failed for good from them (src/bounces.ts).
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createToken } from '../src/auth.ts';
import { failedFor } from '../src/bounces.ts';
import { mailbox, serve } from './serve.ts';

// A delivery status notification as Postfix writes one (RFC 3464): two recipients failed, one only delayed.
const DSN = [
  'From: MAILER-DAEMON@mail.archipelago.tools (Mail Delivery System)',
  'Subject: Undelivered Mail Returned to Sender',
  'Content-Type: multipart/report; report-type=delivery-status; boundary="B"',
  '',
  '--B',
  'Content-Description: Notification',
  '',
  'This is the mail system at host mail.archipelago.tools.',
  '',
  '--B',
  'Content-Type: message/delivery-status',
  '',
  'Reporting-MTA: dns; mail.archipelago.tools',
  'Arrival-Date: Tue, 10 Nov 2026 15:49:45 +0000',
  '',
  'Final-Recipient: rfc822; Gone@Example.com',
  'Original-Recipient: rfc822;gone@example.com',
  'Action: failed',
  'Status: 5.1.1',
  'Diagnostic-Code: smtp; 550 5.1.1 The email account that you tried to reach does not exist.',
  '',
  'Final-Recipient: rfc822; full@example.org',
  'Action: failed',
  'Status: 5.2.2',
  '',
  'Final-Recipient: rfc822; slow@example.net',
  'Action: delayed',
  'Status: 4.4.1',
  '',
  'Final-Recipient: rfc822; maybe@example.net',
  'Action: failed',
  'Status: 4.7.0',
  '',
  '--B--',
].join('\r\n');

test('a failure notice names the addresses that failed for good: not a delay, not a failure that may pass', () => {
  assert.deepEqual(failedFor(DSN), ['gone@example.com', 'full@example.org']);
  assert.deepEqual(failedFor('Hello, this is not a notice.'), []);
});

test('the relay hands over a bounce with its secret, and the address is sent nothing after', async () => {
  process.env.PELAGO_BOUNCE_SECRET = 'relay-secret-for-tests';
  try {
    const { workspaces, call, base } = await serve('tokens');
    const db = (await workspaces.get('default')).pelago.db;
    const alex = (await createToken(db, 'default', { kind: 'human', name: 'alex', admin: true })).token;
    const hand = (secret: string) => fetch(`${base}/connect/bounce`, { method: 'POST', headers: { authorization: `Bearer ${secret}`, 'content-type': 'message/rfc822' }, body: DSN }).then(async (r) => ({ status: r.status, ...(await r.json()) }));

    assert.equal((await hand('wrong')).status, 403, 'only the relay');
    assert.deepEqual(await hand('relay-secret-for-tests'), { status: 200, kept: 2 });

    const before = mailbox.length;
    await call('/api/member_add', alex, { email: 'gone@example.com' });
    await call('/api/member_add', alex, { email: 'kept@example.com' });
    assert.deepEqual(mailbox.slice(before).map((m) => m.to), ['kept@example.com'], 'a bounced address is sent nothing; another is');
  } finally {
    delete process.env.PELAGO_BOUNCE_SECRET;
  }
});

test('with no secret set on the server, no bounce is taken', async () => {
  const { base } = await serve('tokens');
  const res = await fetch(`${base}/connect/bounce`, { method: 'POST', headers: { authorization: 'Bearer ' }, body: DSN });
  assert.equal(res.status, 403);
});
