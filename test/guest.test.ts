// A guest map from one click, and the link its agent writes to (packs/surface/kernel/guest-route.ts, e_4bsagguk).
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { setControlValue } from '../packs/identity/kernel/control.ts';
import { GUEST_ITEMS, guestKey, guestOf, guestsDue, keepGuest, type Guest } from '../packs/identity/kernel/guests.ts';
import { standingChanged } from '../packs/identity/kernel/standing.ts';
import { serve } from './serve.ts';

const DAY = 86_400_000;

test('one click makes a guest map its agent writes to at once, with the key alone, and it reaches no other map', async () => {
  const { workspaces, call, base } = await serve('tokens');
  const made = await call('/guest', undefined, {});
  assert.equal(made.status, 200, made.error);
  const { workspace, link, prompt, page_token } = made.result;
  assert.match(workspace.id, /^guest-[a-f0-9]{12}$/);
  assert.ok(prompt.includes(link), 'the sentence to paste carries the link');
  const key = link.split('/g/')[1];

  // The link: plain lines with the key, the write address and the first item to make.
  const read = await fetch(link.replace(/^http:\/\/[^/]+/, base));
  assert.equal(read.status, 200);
  assert.match(read.headers.get('content-type') ?? '', /^text\/plain/);
  const words = await read.text();
  for (const part of [`${base}/agent/change`, key, '"type":"work"', '"Setup plan"', 'waits_on']) assert.ok(words.includes(part), part);

  // The agent's first item, then its plan, each applied as sent: a guest approves nothing.
  const first = await call('/agent/change', key, { reason: 'The project', ops: [{ op: 'create', ref: 'p', type: 'work', title: 'Lantern', body: 'A lamp app.' }] });
  assert.equal(first.result?.status, 'applied', first.error);
  const plan = await call('/agent/change', key, { reason: 'Setup plan', ops: [
    { op: 'create', ref: 'you', type: 'person', title: 'You' },
    { op: 'create', ref: 's1', type: 'task', title: 'Sign in to keep this map' },
    { op: 'link', type: 'part_of', from: 's1', to: first.result.created.p },
    { op: 'link', type: 'waits_on', from: 's1', to: 'you', props: { for: 'sign in' } },
  ] });
  assert.equal(plan.result?.status, 'applied', plan.error);

  // The page's token reads and writes nothing, and is no link.
  assert.equal((await call('/agent/query', page_token, { name: 'search', params: { q: 'Lantern' } })).result?.[0]?.title, 'Lantern');
  assert.match((await call('/agent/change', page_token, { reason: 'x', ops: [{ op: 'create', type: 'task', title: 'No' }] })).error, /only reads/);
  assert.equal((await fetch(`${base}/g/${page_token}`)).status, 404);
  assert.equal((await fetch(`${base}/g/pel_guest-000000000000_${'0'.repeat(40)}`)).status, 404);

  // The key reaches its own map alone: not another guest's, not the default.
  const other = (await call('/guest', undefined, {})).result.workspace.id;
  assert.notEqual(other, workspace.id, 'the map made ahead goes to one click');
  for (const asked of [other, 'default']) {
    const res = await fetch(`${base}/agent/query`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${key}`, 'x-pelago-workspace': asked }, body: JSON.stringify({ name: 'search', params: { q: 'a' } }) });
    assert.equal(res.status, 401, asked);
  }
  // Nobody publishes from it: its agent is refused, and it has no person who could allow it.
  assert.match((await call('/agent/revise', key, { action: 'publish', params: { id: first.result.created.p } })).error, /Publishing is the owner/);

  // At most GUEST_ITEMS items.
  const many = Array.from({ length: GUEST_ITEMS }, (_, i) => ({ op: 'create', type: 'task', title: `Step ${i}` }));
  const tooMany = await call("/agent/change", key, { reason: "Too many", ops: many });
  assert.match(tooMany.error ?? JSON.stringify(tooMany).slice(0, 400), new RegExp(`room for ${GUEST_ITEMS} items`));

  // A guest map past its days refuses writes and its link says so; a day later it is due to be deleted.
  const control = await workspaces.control();
  const past = (days: number): Guest => ({ made: new Date(Date.now() - (days + 3) * DAY).toISOString(), expires_at: new Date(Date.now() - days * DAY).toISOString() });
  await setControlValue(control, guestKey(workspace.id), past(0.5));
  standingChanged(workspace.id);
  assert.match((await call('/agent/change', key, { reason: 'Late', ops: [{ op: 'create', type: 'task', title: 'Late' }] })).error, /read-only/);
  assert.equal((await fetch(`${base}/g/${key}`)).status, 410);
  assert.deepEqual(await guestsDue(control), []);
  await setControlValue(control, guestKey(workspace.id), past(2));
  assert.deepEqual(await guestsDue(control), [workspace.id]);

  // Saved, it is a map like any other: written to again, and never due.
  await keepGuest(control, workspace.id);
  standingChanged(workspace.id);
  assert.ok((await guestOf(control, workspace.id))?.saved);
  assert.equal((await call('/agent/change', key, { reason: 'Kept', ops: [{ op: 'create', type: 'task', title: 'Kept' }] })).result?.status, 'applied');
  assert.deepEqual(await guestsDue(control), []);
});

test('a guest map is made only from a JSON request', async () => {
  const { base } = await serve('tokens');
  assert.equal((await fetch(`${base}/guest`, { method: 'POST' })).status, 415);
});
