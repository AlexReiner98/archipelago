// A guest map from one click, and the link its agent writes to (packs/surface/kernel/guest-route.ts, e_4bsagguk).
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { setControlValue } from '../packs/identity/kernel/control.ts';
import { GUEST_ITEMS, guestKey, guestOf, guestsDue, keepGuest, type Guest } from '../packs/identity/kernel/guests.ts';
import { standingChanged } from '../packs/identity/kernel/standing.ts';
import { createToken } from '../packs/identity/kernel/auth.ts';
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
  // The map belongs to a person, You, whom the steps only the guest can do wait on.
  const owner = /"to":"(e_[a-z0-9]{8})","props":{"for":"sign in"}/.exec(words)?.[1];
  assert.equal((await call('/agent/query', key, { name: 'get', params: { id: owner } })).result?.entity?.title, 'You');
  const plan = await call('/agent/change', key, { reason: 'Setup plan', ops: [
    { op: 'create', ref: 's1', type: 'task', title: 'Sign in to keep this map' },
    { op: 'link', type: 'part_of', from: 's1', to: first.result.created.p },
    { op: 'link', type: 'waits_on', from: 's1', to: owner, props: { for: 'sign in' } },
  ] });
  assert.equal(plan.result?.status, 'applied', plan.error);

  // The page's token is the guest's own, as the map's owner: it reads, writes, and is no link.
  assert.equal((await call('/api/search', page_token, { q: 'Lantern' })).result?.[0]?.title, 'Lantern');
  assert.equal((await call('/api/change', page_token, { reason: 'x', ops: [{ op: 'create', type: 'task', title: 'Mine' }] })).result?.status, 'applied');
  assert.equal((await fetch(`${base}/g/${page_token}`)).status, 404);
  assert.equal((await fetch(`${base}/g/pel_guest-000000000000_${'0'.repeat(40)}`)).status, 404);

  // The key reaches its own map alone: not another guest's, not the default.
  const other = (await call('/guest', undefined, {})).result.workspace.id;
  assert.notEqual(other, workspace.id, 'the map made ahead goes to one click');
  for (const asked of [other, 'default']) {
    const res = await fetch(`${base}/agent/query`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${key}`, 'x-pelago-workspace': asked }, body: JSON.stringify({ name: 'search', params: { q: 'a' } }) });
    assert.equal(res.status, 401, asked);
  }
  // Its agent shapes the map as its owner would: a type of its own, a style, a pack turned off and on, a setting.
  const shaped = await call('/agent/change', key, { reason: 'Shape it', ops: [
    { op: 'define_type', type: { id: 'local.lamp', title: 'Lamp', description: 'A lamp.', extends: 'work' } },
    { op: 'create', ref: 's', type: 'style', title: 'Warm', status: 'current', props: { shape: 'map' } },
  ] });
  assert.equal(shaped.result?.status, 'applied', shaped.error ?? JSON.stringify(shaped.result));
  const types = (await call('/agent/query', key, { name: 'search', params: { q: 'Lamp' } })).result ?? [];
  assert.ok(types.some((i: { type: string; title: string }) => i.type === 'type' && i.title === 'Lamp'), JSON.stringify(types).slice(0, 300));
  for (const on of [false, true]) {
    const set = await call('/agent/pack_set', key, { pack: 'sessions', on });
    assert.ok(!set.error, set.error);
  }
  assert.ok(!(await call('/agent/workspace_set', key, { name: 'Lantern map' })).error);

  // What would have the server act outward for an anonymous person waits for sign-in, and says so.
  const SIGN_IN = /A guest map cannot .*: sign in to keep this map/;
  assert.match((await call('/agent/revise', key, { action: 'publish', params: { id: first.result.created.p } })).error, SIGN_IN);
  assert.match((await call('/api/publish', page_token, { id: first.result.created.p })).error, SIGN_IN, 'the guest in the page too');
  assert.match((await call('/api/share_create', page_token, { id: first.result.created.p })).error, SIGN_IN);
  assert.match((await call('/api/member_add', page_token, { email: 'friend@example.test' })).error, SIGN_IN);
  assert.match((await call('/agent/pack_set', key, { pack: 'anatomy_sync', on: true })).error, /reaches outside the map: sign in/);
  assert.match((await call('/agent/workspace_set', key, { drawings_open: true })).error, SIGN_IN);

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

test('Make it yours: a guest map starts as a copy of what a shared map shows, and nothing private', async () => {
  const { workspaces, call } = await serve('tokens');
  const main = await workspaces.get('default');
  const owner = (await createToken(main.pelago.db, 'default', { kind: 'human', name: 'owner', admin: true })).token;
  const made = await call('/api/change', owner, { reason: 'test', ops: [
    { op: 'create', ref: 'n', type: 'task', title: 'Call IRAP', body: 'Call first.', visibility: 'shared' },
    { op: 'create', ref: 'd', type: 'shared_document', title: 'Funding', body: 'Intro.\n\n{n}', visibility: 'shared' },
    { op: 'create', ref: 'x', type: 'task', title: 'Kept to myself', visibility: 'private' },
    { op: 'link', type: 'part_of', from: 'n', to: 'd' },
  ] });
  assert.ok(made.result, made.error);
  const { d } = made.result.created;
  const shared = (await call('/api/share_create', owner, { id: d })).result;
  assert.equal((await call('/guest', undefined, { from: '/p/default/e_00000000' })).status, 404);
  const copy = await call('/guest', undefined, { from: `https://example.test${shared.address}` });
  assert.equal(copy.status, 200, copy.error);
  assert.ok(copy.result.copied >= 1);
  const titles = (await call('/api/search', copy.result.page_token, { q: '' })).result.map((i: { title: string }) => i.title);
  assert.ok(titles.includes('Funding'), titles.join(', '));
  assert.ok(!titles.includes('Kept to myself'));
});
