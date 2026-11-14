// A guest map from one click, and the link its agent writes to (packs/surface/kernel/guest-route.ts, e_4bsagguk).
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { test } from 'node:test';
import { setControlValue } from '../packs/identity/kernel/control.ts';
import { GUEST_ITEMS, guestKey, guestOf, guestsDue, keepGuest, type Guest } from '../packs/identity/kernel/guests.ts';
import { standingChanged } from '../packs/identity/kernel/standing.ts';
import { createToken } from '../packs/identity/kernel/auth.ts';
import { publicView } from '../packs/surface/kernel/public-views.ts';
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

  // The map starts with its install note, which the visitor reads as it opens: the sentence to paste, in a block to
  // copy. The agent is told it is there, and ties its project to it rather than writing another (the owner, 14 Nov 2026).
  const { install } = made.result;
  const note = (await call('/api/get', page_token, { id: install })).result?.entity;
  assert.ok(note?.body.includes(`\`\`\`\n${prompt}\n\`\`\``), 'the sentence, in a block of its own');
  assert.ok(words.includes(`{"op":"link","type":"about","from":"${install}","to":"p"}`), 'the agent ties its project to the note');
  // Its page opens on its words: a style about it folds the head, over the house style's page (the owner, 14 Nov 2026).
  const page = (await call('/api/view', page_token, { name: 'style', params: { of: install } })).result?.style?.page;
  assert.equal(page?.head, 'closed', JSON.stringify(page));
  const elsewhere = (await call('/api/view', page_token, { name: 'style', params: {} })).result?.style?.page;
  assert.notEqual(elsewhere?.head, 'closed', 'only the note');

  // The agent's first item, then its plan, each applied as sent: a guest approves nothing.
  const first = await call('/agent/change', key, { reason: 'The project', ops: [{ op: 'create', ref: 'p', type: 'work', title: 'Lantern', body: 'A lamp app.' }, { op: 'link', type: 'about', from: install, to: 'p' }] });
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

test('Make it yours brings the shared map’s own type, its view and its style, so the copy looks as it was shared', async () => {
  const { workspaces, call } = await serve('tokens');
  const main = await workspaces.get('default');
  const owner = (await createToken(main.pelago.db, 'default', { kind: 'human', name: 'owner', admin: true })).token;
  const ok = async (path: string, body: unknown) => {
    const done = await call(path, owner, body);
    assert.ok(!done.error, done.error);
    return done.result;
  };
  await ok('/api/workspace_set', { islands: true });
  const RECIPES = { types: [{ id: 'recipes.dish', title: 'Dish', description: 'A dish.', extends: 'record', fields: { serves: { type: 'number' }, secret: { type: 'string', private: true } } }] };
  await ok('/api/change', { reason: 'test', ops: [{ op: 'create', type: 'pack', title: 'Recipes', body: 'What we cook.', props: { name: 'recipes', manifest: RECIPES } }] });
  await ok('/api/pack_set', { pack: 'recipes', on: true });
  const { i: island } = (await ok('/api/change', { reason: 'test', ops: [{ op: 'create', ref: 'i', type: 'island', title: 'Kitchen', props: { pack: 'recipes' } }] })).created;
  const { s: style } = (await ok('/api/change', { reason: 'test', ops: [{ op: 'create', ref: 's', type: 'style', title: 'Warm', status: 'current', props: { shape: 'flow', link_colours: { part_of: '#aa5500' } } }] })).created;
  const made = (await ok('/api/change', { reason: 'test', ops: [
    { op: 'create', ref: 'a', type: 'recipes.dish', title: 'Soup', props: { serves: 4, secret: 'grandma’s stock', island }, visibility: 'shared' },
    { op: 'create', ref: 'b', type: 'recipes.dish', title: 'Bread', props: { island }, visibility: 'shared' },
    { op: 'link', type: 'part_of', from: 'b', to: 'a' },
    { op: 'create', ref: 'l', type: 'lens', title: 'The dishes', props: { filter: { find: ['type recipes.dish'] }, style: { style } }, visibility: 'shared' },
  ] })).created;
  const shared = await ok('/api/share_create', { id: made.l });
  // The frozen view carries a dish's declared fields, never a private one nor where it lives.
  const frozen = (await publicView(main.pelago, made.l)) as { lenses: Record<string, { items: { title: string; fields?: Record<string, unknown> }[] }> };
  assert.deepEqual(frozen.lenses[made.l].items.find((i) => i.title === 'Soup')?.fields, { serves: 4 });

  const copy = await call('/guest', undefined, { from: shared.address });
  assert.equal(copy.status, 200, copy.error);
  const guest = (await workspaces.get(copy.result.workspace.id)).pelago;
  // A dish keeps its fields in the copy, but for the private one.
  const soup = (await guest.db.query<{ props: Record<string, unknown> }>(`select props from entity where type = 'recipes.dish' and title = 'Soup' limit 1`)).rows[0];
  assert.equal(soup?.props.serves, 4);
  assert.equal(soup?.props.secret, undefined);
  // The type is itself, from a pack kept on the guest's map and on there, and its items live on an island that speaks it.
  assert.equal(guest.registry.type('recipes.dish')?.title, 'Dish');
  assert.equal(guest.registry.states.get('recipes')?.state, 'active');
  const dishes = (await guest.db.query<{ id: string; title: string; props: Record<string, unknown> }>(`select id, title, props from entity where type = 'recipes.dish' limit 5`)).rows;
  assert.deepEqual(dishes.map((d) => d.title).sort(), ['Bread', 'Soup']);
  const there = await guest.entity(String(dishes[0].props.island));
  assert.equal(there?.props.pack, 'recipes');
  // The view, its query as it was, drawn by its style, which came too.
  const views = (await guest.db.query<{ id: string; props: Record<string, unknown> }>(`select id, props from entity where type = 'lens' and title = 'The dishes' limit 1`)).rows;
  assert.deepEqual((views[0]?.props.filter as { find: string[] }).find, ['type recipes.dish']);
  const drawnBy = (views[0].props.style as { style: string }).style;
  assert.notEqual(drawnBy, style, 'the copy names its own style');
  const warm = await guest.entity(drawnBy);
  assert.equal(warm?.title, 'Warm');
  assert.deepEqual(warm?.props.link_colours, { part_of: '#aa5500' });
});

test('a type whose pack reaches outside comes as data, and the pack itself waits for sign-in', async () => {
  const { workspaces, call } = await serve('tokens', undefined, undefined, [join(import.meta.dirname, 'fixtures', 'outward')]);
  const main = await workspaces.get('default');
  const owner = (await createToken(main.pelago.db, 'default', { kind: 'human', name: 'owner', admin: true })).token;
  const ok = async (path: string, body: unknown) => {
    const done = await call(path, owner, body);
    assert.ok(!done.error, done.error);
    return done.result;
  };
  // On a map with islands on, a pack that declares types and reaches outside is turned off: such a map has islands off.
  await ok('/api/pack_set', { pack: 'tides', on: true });
  const made = (await ok('/api/change', { reason: 'test', ops: [
    { op: 'create', ref: 'r', type: 'tides.reading', title: 'High water', visibility: 'shared' },
    { op: 'create', ref: 'l', type: 'lens', title: 'Readings', props: { filter: { find: ['type tides.reading'] } }, visibility: 'shared' },
  ] })).created;
  const shared = await ok('/api/share_create', { id: made.l });

  const copy = await call('/guest', undefined, { from: shared.address });
  assert.equal(copy.status, 200, copy.error);
  const guest = (await workspaces.get(copy.result.workspace.id)).pelago;
  assert.notEqual(guest.registry.states.get('tides')?.state, 'active', 'the pack that reaches outside is not turned on');
  assert.equal(guest.registry.type('tides_data.reading')?.title, 'Reading', 'its type came as data');
  const read = (await guest.db.query<{ title: string }>(`select title from entity where type = 'tides_data.reading' limit 1`)).rows;
  assert.equal(read[0]?.title, 'High water');
  const view = (await guest.db.query<{ props: { filter: { find: string[] } } }>(`select props from entity where type = 'lens' and title = 'Readings' limit 1`)).rows[0];
  assert.deepEqual(view?.props.filter.find, ['type tides_data.reading'], 'the view finds the type as it is here');
  const key = copy.result.link.split('/g/')[1];
  assert.match((await call('/agent/pack_set', key, { pack: 'tides', on: true })).error, /reaches outside the map: sign in/);
});
