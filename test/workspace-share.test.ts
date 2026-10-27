import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createToken } from '../src/auth.ts';
import { serve } from './serve.ts';

// A one-pixel PNG.
const PIXEL = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

test('a document shared with another workspace is read there once accepted, and by nobody else', async () => {
  const { workspaces, call } = await serve('tokens');
  const operator = (await workspaces.ensureOperator())!;
  const mine = (await createToken((await workspaces.get('default')).pelago.db, 'default', { kind: 'human', name: 'alex', admin: true })).token;
  const theirs = (await call('/operator/workspaces', operator, { id: 'acme', name: 'Acme' })).result.owner_token as string;
  const elsewhere = (await call('/operator/workspaces', operator, { id: 'other', name: 'Other' })).result.owner_token as string;
  const api = async (token: string, tool: string, input: unknown = {}) => {
    const answer = await call(`/api/${tool}`, token, input);
    if (answer.error) throw new Error(answer.error);
    return answer.result;
  };

  const made = (
    await api(mine, 'change', {
      reason: 'test',
      ops: [
        { op: 'create', ref: 'd', type: 'work.document', title: 'Proposal for Acme', visibility: 'shared', body: 'Why us.\n\n{s}\n\nNot for them: {x}' },
        { op: 'create', ref: 's', type: 'work.note', title: 'Costs', visibility: 'shared', body: 'Twenty an hour.' },
        { op: 'create', ref: 'x', type: 'work.note', title: 'Our margin', visibility: 'shared', body: 'Secret.' },
        { op: 'link', type: 'part_of', from: 's', to: 'd' },
      ],
    })
  ).created;
  await api(mine, 'picture_put', { result: made.s, data: PIXEL, content_type: 'image/png' });
  const doc = made.d;

  // Only an admin, a human, and only to a workspace that accepts shares from this one: the same answer if there is none.
  const member = (await api(mine, 'token_create', { kind: 'human', name: 'sam' })).token;
  const agent = (await api(mine, 'token_create', { kind: 'agent', name: 'bot' })).token;
  await assert.rejects(api(member, 'share_workspace', { id: doc, workspace: 'acme' }), /Only an admin/);
  await assert.rejects(api(agent, 'share_workspace', { id: doc, workspace: 'acme' }), /humans only/);
  await assert.rejects(api(mine, 'share_workspace', { id: doc, workspace: 'acme' }), /does not accept shares from "default"/);
  await assert.rejects(api(mine, 'share_workspace', { id: doc, workspace: 'nowhere' }), /does not accept shares from "default"/);
  await assert.rejects(api(mine, 'share_workspace', { id: made.s, workspace: 'acme' }), /not a document/);

  await api(theirs, 'workspace_set', { accepts_from: ['default'] });
  const shared = await api(mine, 'share_workspace', { id: doc, workspace: 'acme' });
  assert.equal(shared.workspace, 'acme');
  assert.deepEqual((await api(mine, 'share_list', { id: doc })).map((s: any) => [s.id, s.to_workspace]), [[shared.share, 'acme']]);

  // It arrives as an offer, with a notification about it; it cannot be read until it is accepted.
  const [offer] = await api(theirs, 'search', { type: 'sys.shared_document' });
  assert.deepEqual([offer.title, offer.status, offer.props.from_workspace], ['Proposal for Acme', 'offered', 'default']);
  assert.ok((await api(theirs, 'view', { name: 'notifications' })).some((n: any) => n.title === '"Proposal for Acme" was shared with this workspace'));
  await assert.rejects(api(theirs, 'document', { id: offer.id }), /accept it to read it here/);
  // Everyone there sees it, until someone there makes it private.
  const rosa = (await api(theirs, 'token_create', { kind: 'human', name: 'rosa' })).token;
  assert.deepEqual((await api(rosa, 'search', { type: 'sys.shared_document' })).map((s: any) => s.id), [offer.id]);

  await api(theirs, 'change', { reason: 'test', ops: [{ op: 'update', id: offer.id, status: 'accepted' }] });
  const read = await api(theirs, 'document', { id: offer.id });
  assert.equal(read.title, 'Proposal for Acme');
  assert.equal(read.from, 'default');
  assert.equal((await api(rosa, 'document', { id: offer.id })).title, 'Proposal for Acme');
  const section = read.parts.find((p: any) => p.section).section;
  assert.deepEqual([section.id, section.title, section.body, section.via, section.picture], [made.s, 'Costs', 'Twenty an hour.', offer.id, true]);
  assert.ok(!JSON.stringify(read).includes(made.x), 'an item the document does not bring in is not named');
  assert.equal((await api(theirs, 'share_figure', { via: offer.id, id: made.s })).content_type, 'image/png');
  assert.equal(await api(theirs, 'share_figure', { via: offer.id, id: made.x }), null, 'only the figures of what it brings in');
  // It is read live: a change in the sender's map is what the receiver reads next.
  await api(mine, 'change', { reason: 'test', ops: [{ op: 'update', id: made.s, body: 'Twenty-five an hour.' }] });
  assert.equal((await api(theirs, 'document', { id: offer.id })).parts.find((p: any) => p.section).section.body, 'Twenty-five an hour.');

  // The receiver cannot pass it on as a link, and nobody can read it through a share made out to someone else.
  await assert.rejects(api(theirs, 'share_create', { id: offer.id }), /not a document of this workspace/);
  await api(elsewhere, 'workspace_set', { accepts_from: ['default'] });
  const forged = await call('/api/change', elsewhere, {
    reason: 'test',
    ops: [{ op: 'create', ref: 'f', type: 'sys.shared_document', title: 'Forged', status: 'accepted', props: { from_workspace: 'default', share: shared.share } }],
  });
  // Its fields can be written by hand there, but the sender's database gives a share only to the workspace it was made out to.
  await assert.rejects(api(elsewhere, 'document', { id: forged.result.created.f }), /no longer shared/);

  // The sender revokes it: it stops at once, and the receiver's item says it has ended.
  await api(mine, 'share_revoke', { id: shared.share });
  await assert.rejects(api(theirs, 'document', { id: offer.id }), /no longer shared/);
  assert.equal((await api(theirs, 'get', { id: offer.id })).entity.status, 'ended');
  assert.equal(await api(theirs, 'share_figure', { via: offer.id, id: made.s }), null);
  assert.ok((await api(mine, 'events', { limit: 10 })).some((e: any) => e.action === 'share.workspace' && e.detail.to === 'acme'), "the sender's log records it");
});

test('the receiver ends a share on its side, and the sender can share again', async () => {
  const { workspaces, call } = await serve('tokens');
  const operator = (await workspaces.ensureOperator())!;
  const mine = (await createToken((await workspaces.get('default')).pelago.db, 'default', { kind: 'human', name: 'alex', admin: true })).token;
  const theirs = (await call('/operator/workspaces', operator, { id: 'acme', name: 'Acme' })).result.owner_token as string;
  const api = async (token: string, tool: string, input: unknown = {}) => {
    const answer = await call(`/api/${tool}`, token, input);
    if (answer.error) throw new Error(answer.error);
    return answer.result;
  };
  const doc = (await api(mine, 'change', { reason: 'test', ops: [{ op: 'create', ref: 'd', type: 'work.document', title: 'Plan', body: 'The plan.' }] })).created.d;
  await api(theirs, 'workspace_set', { accepts_from: ['default'] });
  await api(mine, 'share_workspace', { id: doc, workspace: 'acme' });
  const [item] = await api(theirs, 'search', { type: 'sys.shared_document' });
  await api(theirs, 'change', { reason: 'test', ops: [{ op: 'update', id: item.id, status: 'accepted' }] });
  assert.match((await api(theirs, 'document', { id: item.id })).parts[0].text, /The plan/);
  await api(theirs, 'change', { reason: 'test', ops: [{ op: 'update', id: item.id, status: 'ended' }] });
  await assert.rejects(api(theirs, 'document', { id: item.id }), /no longer shared/);
});

test('a shared document is published where it is read only if its sender says so, as the sender gives it, until the share ends', async () => {
  const { workspaces, call, base } = await serve('tokens');
  const operator = (await workspaces.ensureOperator())!;
  const mine = (await createToken((await workspaces.get('default')).pelago.db, 'default', { kind: 'human', name: 'alex', admin: true })).token;
  const theirs = (await call('/operator/workspaces', operator, { id: 'acme', name: 'Acme' })).result.owner_token as string;
  const api = async (token: string, tool: string, input: unknown = {}) => {
    const answer = await call(`/api/${tool}`, token, input);
    if (answer.error) throw new Error(answer.error);
    return answer.result;
  };
  const made = (
    await api(mine, 'change', {
      reason: 'test',
      ops: [
        { op: 'create', ref: 'p', type: 'work.document', title: 'A principle', visibility: 'shared', body: 'Held by what serves it.\n\n{l}' },
        { op: 'create', ref: 'e', type: 'work.document', title: 'The principles', visibility: 'shared', body: 'Read {p} first.' },
        { op: 'create', ref: 'f', type: 'software.feature', title: 'The rule', visibility: 'shared', body: 'Holds a change.' },
        { op: 'create', ref: 't', type: 'work.task', title: 'A test of it', visibility: 'shared', body: 'Checks it.' },
        { op: 'create', ref: 'x', type: 'work.task', title: 'Not for them', visibility: 'private', body: 'Secret.' },
        { op: 'create', ref: 'l', type: 'lens', title: 'What holds it', visibility: 'shared', status: 'current', props: { filter: { types: ['work.task', 'software.feature'] } } },
        { op: 'link', type: 'part_of', from: 't', to: 'f' },
        { op: 'link', type: 'part_of', from: 'x', to: 'f' },
        { op: 'link', type: 'about', from: 'l', to: 'f' },
      ],
    })
  ).created;
  await api(theirs, 'workspace_set', { accepts_from: ['default'] });
  const accept = async (title: string) => {
    const item = (await api(theirs, 'search', { type: 'sys.shared_document' })).find((s: any) => s.title === title && s.status === 'offered');
    await api(theirs, 'change', { reason: 'test', ops: [{ op: 'update', id: item.id, status: 'accepted' }] });
    return item.id as string;
  };

  // Shared to be read, it is not published there.
  const readOnly = await api(mine, 'share_workspace', { id: made.e, workspace: 'acme' });
  assert.equal(readOnly.publish, false);
  const entryRead = await accept('The principles');
  await assert.rejects(api(theirs, 'publish', { id: entryRead }), /to be read here, not published/);
  assert.equal((await api(theirs, 'get', { id: entryRead })).entity.visibility, 'shared', 'nothing made public by the refusal');
  await api(mine, 'share_revoke', { id: readOnly.share });

  // Shared to be published, it is: as the sender gives it, its view drawn there with nothing private.
  const shared = await api(mine, 'share_workspace', { id: made.p, workspace: 'acme', publish: true });
  assert.equal((await api(mine, 'share_list', { id: made.p }))[0].publishable, true);
  const page = await accept('A principle');
  assert.equal((await api(theirs, 'publish', { id: page })).published, page);
  const read = async (id: string) => (await (await fetch(`${base}/p/acme/${id}/data`)).json()) as any;
  const published = await read(page);
  assert.match(published.parts[0].text, /Held by what serves it/);
  assert.deepEqual(published.lenses[made.l].items.map((i: any) => i.title).sort(), ['A test of it', 'The rule']);
  assert.ok(!JSON.stringify(published).includes(made.x) && !JSON.stringify(published).includes('Secret'), 'nothing private of the sender');

  // A page it shares names another it shares by the sender's id: published here, it names it by this map's.
  const entryShare = await api(mine, 'share_workspace', { id: made.e, workspace: 'acme', publish: true });
  const entry = await accept('The principles');
  await api(theirs, 'publish', { id: entry });
  assert.equal((await read(entry)).links?.[page], 'A principle');
  assert.match((await read(entry)).parts[0].text, new RegExp(page));

  // The sender changes it: nothing public changes until it is published here again.
  await api(mine, 'change', { reason: 'test', ops: [{ op: 'update', id: made.p, body: 'Rewritten.\n\n' + made.l }] });
  assert.match((await read(page)).parts[0].text, /Held by what serves it/);
  assert.equal((await api(theirs, 'published', { id: page })).changed, true);

  // The sender stops sharing it: it is taken down there at once.
  await api(mine, 'share_revoke', { id: shared.share });
  assert.equal((await fetch(`${base}/p/acme/${page}/data`)).status, 404);
  assert.equal((await api(theirs, 'get', { id: page })).entity.visibility, 'shared');
  await assert.rejects(api(theirs, 'publish', { id: page }), /no longer shared/);
  await api(mine, 'share_revoke', { id: entryShare.share });
});
