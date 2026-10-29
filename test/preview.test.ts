// A document's preview (src/published-preview.ts): what publishing it now would give, read before it is published,
// on both sides of a share, with the site's header, for someone signed in. Nothing is published by reading it.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createToken } from '../src/auth.ts';
import { serve } from './serve.ts';

test('a document is previewed as publishing it would give it, before it is public, on both sides of a share', async () => {
  const { workspaces, call, base } = await serve('tokens');
  const operator = (await workspaces.ensureOperator())!;
  const mine = (await createToken((await workspaces.get('default')).pelago.db, 'default', { kind: 'human', name: 'alex', admin: true })).token;
  const theirs = (await call('/operator/workspaces', operator, { id: 'acme', name: 'Acme' })).result.owner_token as string;
  const api = async (token: string, tool: string, input: unknown = {}) => {
    const answer = await call(`/api/${tool}`, token, input);
    if (answer.error) throw new Error(answer.error);
    return answer.result;
  };
  const preview = (token: string, id: string) => call(`/preview/${id}/data`, token, {});
  const made = (
    await api(mine, 'change', {
      reason: 'test',
      ops: [
        { op: 'create', ref: 'd', type: 'document', title: 'A page', visibility: 'shared', body: 'Opening words.\n\n{s}\n\n{l}\n\n{x}' },
        { op: 'create', ref: 's', type: 'note', title: 'Costs', visibility: 'shared', body: 'Twenty an hour.' },
        { op: 'create', ref: 't', type: 'task', title: 'Write it', visibility: 'shared' },
        { op: 'create', ref: 'x', type: 'note', title: 'Our margin', visibility: 'private', body: 'Secret.' },
        { op: 'create', ref: 'l', type: 'lens', title: 'What it holds', visibility: 'shared', status: 'current', props: { filter: { types: ['task'] } } },
        { op: 'link', type: 'part_of', from: 's', to: 'd' },
        { op: 'link', type: 'part_of', from: 'l', to: 'd' },
        { op: 'link', type: 'part_of', from: 'x', to: 'd' },
      ],
    })
  ).created;

  // The sender's draft, not yet public: its text, what it holds, its view drawn, nothing private, and the site around it.
  const own = (await preview(mine, made.d)).result;
  assert.equal(own.title, 'A page');
  assert.deepEqual(own.sections, [made.s, made.l]);
  assert.ok(own.lenses[made.l].items.some((i: any) => i.id === made.t), 'its view drawn as publishing keeps it');
  assert.ok(!JSON.stringify(own).includes('Secret.') && !JSON.stringify(own).includes(made.x), 'nothing private');
  assert.equal(own.site.name, 'Default');
  assert.ok(own.theme, "the workspace's look");
  // Reading a preview publishes nothing and makes nothing public.
  assert.equal((await api(mine, 'published', { id: made.d })).published, false);
  assert.equal((await api(mine, 'get', { id: made.d })).entity.visibility, 'shared');
  assert.ok((await call(`/preview/${made.d}/data`, undefined, {})).error, 'only for someone signed in');
  // Its page may be framed by this server's own page alone, to read the draft on the canvas (ui/reader-frame.js).
  assert.match((await fetch(`${base}/preview/${made.d}`)).headers.get('content-security-policy') ?? '', /frame-ancestors 'self'/);

  // The receiver's, shared to publish: as the sender gives it, its view drawn on the sender's map, in the receiver's site.
  await api(theirs, 'workspace_set', { accepts_from: ['default'] });
  await api(mine, 'share_workspace', { id: made.d, workspace: 'acme', publish: true });
  const [offer] = await api(theirs, 'search', { type: 'shared_document' });
  await api(theirs, 'change', { reason: 'test', ops: [{ op: 'update', id: offer.id, status: 'accepted' }] });
  const there = (await preview(theirs, offer.id)).result;
  assert.deepEqual([there.title, there.from, there.site.name], ['A page', 'default', 'Acme']);
  assert.ok(there.lenses[made.l].items.some((i: any) => i.id === made.t));
  assert.ok(there.sections.includes(made.s));
  // The sheet reads its views as well, as publishing would draw them.
  assert.ok((await api(theirs, 'document', { id: offer.id, drawn: true })).lenses[made.l]);
});

test('a document shared only to be read is previewed nowhere, and its views are not drawn through the share', async () => {
  const { workspaces, call } = await serve('tokens');
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
        { op: 'create', ref: 'd', type: 'document', title: 'A page', visibility: 'shared', body: 'Words.\n\n{l}' },
        { op: 'create', ref: 'l', type: 'lens', title: 'What it holds', visibility: 'shared', status: 'current', props: { filter: { types: ['document'] } } },
        { op: 'link', type: 'part_of', from: 'l', to: 'd' },
      ],
    })
  ).created;
  await api(theirs, 'workspace_set', { accepts_from: ['default'] });
  await api(mine, 'share_workspace', { id: made.d, workspace: 'acme' });
  const [offer] = await api(theirs, 'search', { type: 'shared_document' });
  await api(theirs, 'change', { reason: 'test', ops: [{ op: 'update', id: offer.id, status: 'accepted' }] });
  assert.match((await call(`/preview/${offer.id}/data`, theirs, {})).error, /to be read here, not published/);
  assert.equal((await api(theirs, 'document', { id: offer.id, drawn: true })).lenses, undefined);
});
