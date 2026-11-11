// The email channel, run without a database: a notification made and the person's channels go in, a mail or nothing
// comes out. Where it goes is the kernel's (test/notify-mail.test.ts).

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { isQuiet, mailFor, minutesOf } from './channel.js';
import handler from './handler.js';

const P = 'e_person01', N = 'e_notice01';
const made = (level = 'info', title = 'The build broke', body = 'main is red') => ({ action: 'notification.made', pack: 'kernel', target: N, detail: { for: P, title, body, level } });
const NOON = '2026-11-11T12:00:00Z', NIGHT = '2026-11-11T23:30:00Z';

test('nobody is mailed who has not turned mail on', () => {
  assert.equal(mailFor(made(), [], NOON, 'UTC'), undefined, 'no channel');
  assert.equal(mailFor(made(), [{ props: {} }], NOON, 'UTC'), undefined, 'a channel left as made is off');
  assert.equal(mailFor(made(), [{ props: { on: false } }], NOON, 'UTC'), undefined);
  assert.equal(mailFor(made(), [{ props: { on: 'yes' } }], NOON, 'UTC'), undefined, 'on is true, nothing else');
});

test('a channel that is on is mailed the notification, its level in the subject', () => {
  assert.deepEqual(mailFor(made(), [{ props: { on: true } }], NOON, 'UTC'), { notification: N, subject: 'The build broke', text: 'main is red' });
  assert.equal(mailFor(made('urgent'), [{ props: { on: true } }], NOON, 'UTC')?.subject, 'Urgent: The build broke');
  assert.equal(mailFor(made('warning', 'Late', ''), [{ props: { on: true } }], NOON, 'UTC')?.text, 'Late', 'with no note, the title is the text');
  assert.ok(mailFor(made(), [{ props: { on: false } }, { props: { on: true } }], NOON, 'UTC'), 'any channel that is on');
});

test('a notification with no note carries the note of what it is about; its own note comes first', () => {
  const on = [{ props: { on: true } }];
  const post = { title: 'Post for 12 Nov', body: '## Facts\n- the mail landed' };
  assert.equal(mailFor(made('info', "Today's post", ''), on, NOON, 'UTC', post)?.text, "Today's post\n\nPost for 12 Nov\n\n## Facts\n- the mail landed");
  assert.equal(mailFor(made(), on, NOON, 'UTC', post)?.text, 'main is red', 'its own note wins');
  assert.equal(mailFor(made('info', 'Late', ''), on, NOON, 'UTC', { title: 'X', body: '' })?.text, 'Late', 'a subject with no note adds nothing');
});

test('the handler reads what a notification is about only when it has no note and mail is on', async () => {
  const asked: { get?: string }[] = [];
  const event = { ...made('info', "Today's post", ''), detail: { ...made().detail, title: "Today's post", body: '', about: 'e_post0001' } };
  const ctx = (on: boolean) => ({ now: NOON, zone: 'UTC', read: async (q: { get?: string }) => (asked.push(q), q.get ? { title: 'Post for 12 Nov', body: '- a fact' } : [{ props: { on } }]) });
  const got = await handler['notification.made']({ event }, ctx(true));
  assert.equal(got.mail[0].text, "Today's post\n\nPost for 12 Nov\n\n- a fact");
  assert.deepEqual(asked.at(-1), { get: 'e_post0001' });
  asked.length = 0;
  await handler['notification.made']({ event }, ctx(false));
  assert.equal(asked.some((q) => q.get), false, 'mail off: nothing more is read');
  await handler['notification.made']({ event: made() }, ctx(true));
  assert.equal(asked.some((q) => q.get), false, 'a note of its own: nothing more is read');
});

test('below the least level, nothing', () => {
  const ch = [{ props: { on: true, least: 'warning' } }];
  assert.equal(mailFor(made('info'), ch, NOON, 'UTC'), undefined);
  assert.ok(mailFor(made('warning'), ch, NOON, 'UTC'));
  assert.ok(mailFor(made('urgent'), ch, NOON, 'UTC'));
});

test('quiet hours hold all but what is urgent, in the channel’s zone or the workspace’s', () => {
  const ch = { on: true, quiet_from: '22:00', quiet_to: '07:00' };
  assert.equal(mailFor(made(), [{ props: ch }], NIGHT, 'UTC'), undefined, 'past midnight’s quiet hours, at 23:30');
  assert.ok(mailFor(made('urgent'), [{ props: ch }], NIGHT, 'UTC'), 'urgent goes through');
  assert.ok(mailFor(made(), [{ props: ch }], NOON, 'UTC'));
  // 12:00 UTC is 21:00 in Tokyo: quiet from 20:00 there.
  assert.equal(mailFor(made(), [{ props: { on: true, quiet_from: '20:00', quiet_to: '23:00' } }], NOON, 'Asia/Tokyo'), undefined, 'the workspace’s zone');
  assert.ok(mailFor(made(), [{ props: { on: true, quiet_from: '20:00', quiet_to: '23:00', zone: 'Europe/London' } }], NOON, 'Asia/Tokyo'), 'the channel’s own zone first');
  assert.equal(isQuiet({ quiet_from: '09:00', quiet_to: '09:00' }, NOON, 'UTC'), false, 'equal ends are no quiet hours');
  assert.equal(isQuiet({ quiet_from: '9am', quiet_to: '17:00' }, NOON, 'UTC'), false, 'an end that is no time is none');
  assert.equal(minutesOf('07:05'), 425);
  assert.equal(minutesOf('24:00'), undefined);
});

test('the handler reads the person’s channels and answers one mail, or nothing', async () => {
  const asked: unknown[] = [];
  const ctx = (channels: unknown[]) => ({ now: NOON, zone: 'UTC', read: async (q: unknown) => (asked.push(q), channels) });
  const on = await handler['notification.made']({ event: made() }, ctx([{ id: 'e_chan0001', props: { on: true } }]));
  assert.deepEqual(on.mail, [{ notification: N, subject: 'The build broke', text: 'main is red' }]);
  assert.deepEqual(asked[0], { related: P, relation: 'part_of', direction: 'in', types: ['email.channel'], fields: ['on', 'least', 'quiet_from', 'quiet_to', 'zone'] });
  assert.deepEqual(await handler['notification.made']({ event: made() }, ctx([])), {});
  const nobody = await handler['notification.made']({ event: { ...made(), detail: { title: 'x' } } }, ctx([{ props: { on: true } }]));
  assert.deepEqual(nobody, {}, 'a notification for nobody is mailed to nobody');
});
