// A notification made is told to the packs that hear it, and the email pack's mail goes to the person it is for, at
// the address they sign in with: never anywhere a pack names (src/notify-mail.ts).

import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { setMailer, type Mail } from '../src/mail.ts';
import { notify } from '../src/notify.ts';
import { mailHeard, ownerOf } from '../src/notify-mail.ts';
import { configureOutbox } from '../src/outbox.ts';
import { hostFor } from '../src/packtools.ts';
import { agent, fresh, human, make } from './map.ts';

const OWNER = 'owner@example.com', OTHER = 'other@example.com';
const sent: Mail[] = [];
let heard: (() => void) | undefined;
setMailer(async (m) => void (sent.push(m), heard?.()));
after(() => setMailer(undefined));

/** Wait for the next mail, a few seconds at most: the packs are told without being waited for. */
const nextMail = () => new Promise<void>((resolve, reject) => {
  const out = setTimeout(() => reject(new Error('no mail came')), 15_000);
  heard = () => (clearTimeout(out), resolve());
});

test('a notification for a person who turned mail on is mailed to their address; one for a person who did not is not', async () => {
  const l = await fresh();
  after(() => hostFor(l.registry).stop());
  configureOutbox(async () => l);
  const { me } = await l.init(human, { name: 'Owner', email: OWNER });
  const { other } = await make(l, [{ op: 'create', ref: 'other', type: 'person', title: 'Other', visibility: 'shared' }]);
  await l.db.query(`insert into member (email, person_id, admin) values ($1, $2, true), ($3, $4, false)`, [OWNER, me, OTHER, other]);
  await make(l, [
    { op: 'create', ref: 'c', type: 'email.channel', title: 'Email', props: { on: true } },
    { op: 'link', type: 'part_of', from: 'c', to: me },
  ]);

  // The other person has no channel: theirs is told to the pack first, and the owner's after it, one call at a time.
  const coming = nextMail();
  await notify(l.as(other), agent, { title: 'For the other', body: 'Not to be mailed.' });
  const { notification } = await notify(l, agent, { title: 'The build broke', body: 'main is red', level: 'urgent' });
  await coming;
  assert.equal(sent.length, 1, 'one mail: the owner turned it on, the other did not');
  assert.equal(sent[0].to, OWNER);
  assert.equal(sent[0].subject, 'Urgent: The build broke');
  assert.match(sent[0].text, /^main is red\n\n.*\/i\/default\/e_\w+\n$/, 'the note, then where it is on the map');
  assert.ok(sent[0].text.includes(notification));
});

test('a pack mails only about the notification it heard made, and only on hearing it', async () => {
  const l = await fresh();
  const heardOne = { event: { action: 'notification.made', pack: 'kernel', target: 'e_aaaaaaaa' } };
  const mail = (notification: string) => [{ notification, subject: 'Hi', text: 'x' }];
  await assert.rejects(mailHeard(l, 'p', undefined, mail('e_aaaaaaaa')), /only on hearing a notification made/);
  await assert.rejects(mailHeard(l, 'p', { event: { ...heardOne.event, pack: 'other' } }, mail('e_aaaaaaaa')), /only on hearing/, 'told by another pack, not the kernel');
  await assert.rejects(mailHeard(l, 'p', heardOne, mail('e_bbbbbbbb')), /about the notification it heard/);
  await assert.rejects(mailHeard(l, 'p', heardOne, [...mail('e_aaaaaaaa'), ...mail('e_aaaaaaaa')]), /mails once/);
  assert.deepEqual(await mailHeard(l, 'p', heardOne, mail('e_aaaaaaaa')), { sent: false, why: 'the person it is for signs in with no address' }, 'no such notification: nobody to mail');
});

test('with no owner set, a notification for nobody in particular is the first admin member’s', async () => {
  const l = await fresh();
  const { a, b } = await make(l, [{ op: 'create', ref: 'a', type: 'person', title: 'A' }, { op: 'create', ref: 'b', type: 'person', title: 'B' }]);
  assert.equal(await ownerOf(l), undefined);
  await l.db.query(`insert into member (email, person_id, admin, added_at) values ('b@example.com', $1, false, now() - interval '1 day'), ('a@example.com', $2, true, now())`, [b, a]);
  assert.equal(await ownerOf(l), a, 'an admin, not merely the first member');
});
