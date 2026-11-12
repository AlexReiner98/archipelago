// The mailer on a fake context: what bounced kept in a store in memory (root.transient), and the mail a member
// notice is, sent through a mailer put in the place of sending.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { KernelContext } from '#pelago/kernel';
import { failedFor, hasBounced, noteBounced } from './bounces.ts';
import { setMailer, type Mail } from './mail.ts';
import { invited, memberMail } from './member-mail.ts';

test('an address that bounced is kept as bounced, in the store of the map it is handed', async () => {
  const store = new Map<string, unknown>();
  const ctx = {
    call: async (name: string, ask: { keep?: { key: string; value: unknown; ms: number }; kept?: string }) => {
      assert.equal(name, 'root.transient');
      if (ask.keep) return void store.set(ask.keep.key, ask.keep.value);
      return store.get(ask.kept!);
    },
  } as unknown as KernelContext;
  assert.equal(await hasBounced(ctx, 'gone@example.com'), false);
  await noteBounced(ctx, failedFor('Final-Recipient: rfc822; Gone@Example.com\nAction: failed\nStatus: 5.1.1'));
  assert.equal(await hasBounced(ctx, 'gone@example.com'), true);
  assert.deepEqual([...store.keys()], ['bounced:gone@example.com']);
});

test('a member notice is a mail, sent by the filling of identity.invited', async () => {
  const code = memberMail({ kind: 'sign_in_code', to: 'kim@example.com', codes: ['123456'], minutes: 15, days: 30 });
  assert.equal(code.subject, 'Your Archipelago sign-in code');
  assert.match(code.text, /123456/);
  const invite = memberMail({ kind: 'invite_issued', to: 'kim@example.com', replyTo: 'alex@example.com', by: 'Alex', workspace: 'Acme', signIn: 'sign in at https://x.example.' });
  assert.equal(invite.subject, 'Alex invited you to Acme on Archipelago');
  assert.equal(invite.replyTo, 'alex@example.com');
  const sent: Mail[] = [];
  setMailer(async (m) => void sent.push(m));
  try {
    const filled = invited({} as KernelContext);
    assert.equal(filled.sends(), true, 'a mailer sends');
    await filled.send({ kind: 'sign_in_code', to: 'kim@example.com', codes: ['654321'], minutes: 15, days: 30 });
    assert.deepEqual(sent.map((m) => m.to), ['kim@example.com']);
  } finally {
    setMailer(undefined);
  }
});
