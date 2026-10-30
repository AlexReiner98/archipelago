// Writing documents beside their drafts, in a real browser (skipped where there is no Chrome): the Pages view with an
// item's page open reads the draft on the left and its words on the right. Saving keeps the place and reads again only
// the document changed; the sheet follows the document scrolled to, unless words wait to be saved; and a document
// shared by a map this browser is signed in to is written there, by the person (the owner, 30 Oct 2026).

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createToken } from '../src/auth.ts';
import { chrome, open } from './browser.ts';
import { serve } from './serve.ts';

const browser = chrome();
const long = (word: string) => Array.from({ length: 60 }, (_, i) => `${word} paragraph ${i}.`).join('\n\n');

test('in a browser, a document is written beside its draft, shared or not', { skip: !browser && 'no Chrome here (set CHROME)' }, async () => {
  const { workspaces, call, base } = await serve('tokens');
  const operator = (await workspaces.ensureOperator())!;
  const mine = (await createToken((await workspaces.get('default')).pelago.db, 'default', { kind: 'human', name: 'alex', admin: true })).token;
  const theirs = (await call('/operator/workspaces', operator, { id: 'acme', name: 'Acme' })).result.owner_token as string;
  const api = async (token: string, tool: string, input: unknown = {}) => {
    const answer = await call(`/api/${tool}`, token, input);
    if (answer.error) throw new Error(answer.error);
    return answer.result;
  };
  const home = (await api(mine, 'change', { reason: 'test', ops: [{ op: 'create', ref: 's', type: 'document', title: 'Shared page', visibility: 'shared', body: long('shared') }] })).created.s as string;
  await api(theirs, 'workspace_set', { accepts_from: ['default'] });
  await api(mine, 'share_workspace', { id: home, workspace: 'acme', publish: true });
  const [offer] = await api(theirs, 'search', { type: 'shared_document' });
  const site = (await api(theirs, 'change', {
    reason: 'test',
    ops: [
      { op: 'update', id: offer.id, status: 'accepted', props: { path: 'shared' } },
      { op: 'create', ref: 'a', type: 'document', title: 'Own page', visibility: 'shared', status: 'draft', body: long('first'), props: { path: 'own', menu: 1 } },
      { op: 'create', ref: 'b', type: 'document', title: 'Next page', visibility: 'shared', status: 'draft', body: long('second'), props: { path: 'next', menu: 2 } },
    ],
  })).created as Record<string, string>;
  const ids = [site.a, site.b, offer.id].map((id) => `find=id+${id}`).join('&');

  const page = await open(`${base}/`);
  const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
  const until = async (expression: string) => {
    for (const end = Date.now() + 20000; Date.now() < end; await wait(100)) if (await page.evaluate(expression)) return true;
    return false;
  };
  const view = `document.querySelector('#canvas .lens-view.beside-sheet')`;
  const frame = (id: string) => `document.querySelector('.rd.draft[data-item="${id}"] iframe:not(.rd-next)')`;
  const reads = (id: string, words: string) => `Boolean(${frame(id)}?.contentDocument?.body?.textContent.includes(${JSON.stringify(words)}))`;
  const area = `document.querySelector('#sheet textarea.draft-body')`;
  const write = (words: string) => page.evaluate(`(() => { const a = ${area}; a.value = ${JSON.stringify(words)} + a.value; a.dispatchEvent(new Event('input', { bubbles: true })); })()`);
  const save = () => page.evaluate(`[...document.querySelectorAll('#sheet .draft-bar:not([hidden]) button')].find((b) => b.textContent === 'Save').click()`);
  const scrollTo = (id: string) => page.evaluate(`(() => { const v = ${view}; const r = document.querySelector('.rd.draft[data-item="${id}"]').getBoundingClientRect(); v.scrollTop += r.top - v.getBoundingClientRect().top + 40; })()`);
  try {
    await page.evaluate(`(localStorage.setItem('pelago-token', ${JSON.stringify(theirs)}), localStorage.setItem('pelago-workspaces', ${JSON.stringify(JSON.stringify({ default: { name: 'Default', token: mine }, acme: { name: 'Acme', token: theirs } }))}))`);
    await page.go(`${base}/#/e/${site.a}?${ids}&shape=pages`);
    assert.ok(await until(`Boolean(${view}) && ${reads(site.a, 'first paragraph 3')}`), `the draft is read: ${page.logs().join('\n')}`);

    // Beside the sheet: the words open to write, the scrollbar in sight, what is published out of the way.
    assert.ok(await until(`Boolean(${area}) && !${area}.hidden`), 'the note opens as words to write');
    assert.ok(await page.evaluate(`${view}.getBoundingClientRect().right <= document.getElementById('sheet').getBoundingClientRect().left + 1`), 'the view stops where the sheet starts');
    assert.equal(await page.evaluate(`getComputedStyle(document.querySelector('.rd.published')).display`), 'none');

    // Saving keeps the place and the other documents' frames, and reads the one changed.
    await page.evaluate(`(${view}.scrollTop = 500, window.other = ${frame(site.b)}, 0)`);
    await wait(500);
    await write('Written here. ');
    await page.evaluate(`${area}.setSelectionRange(7, 7)`);
    const place = await page.evaluate<number>(`${view}.scrollTop`);
    await save();
    assert.ok(await until(reads(site.a, 'Written here.')), 'the draft reads what was saved');
    await wait(500);
    assert.equal(await page.evaluate(`${view}.scrollTop`), place, 'the place is kept');
    assert.ok(await page.evaluate(`window.other === ${frame(site.b)} && window.other.isConnected`), 'the other documents are not read again');
    assert.ok(await page.evaluate(`document.activeElement === ${area} && ${area}.selectionStart === 7`), 'the cursor stays where it was');
    assert.ok(await page.evaluate(`document.getElementById('sheet').scrollTop < 300`), 'and the sheet with it');

    // The sheet follows what is scrolled to, but not away from words not saved.
    await scrollTo(site.b);
    assert.ok(await until(`location.hash.startsWith('#/e/${site.b}')`), `the sheet moves on: ${await page.evaluate('location.hash')}`);
    assert.ok(await until(`${area}?.value.startsWith('second')`), 'to its words');
    assert.ok(await until(`document.querySelector('.pg-row.here .pg-title')?.textContent === 'Next page'`), 'the page open is lit');
    // Saved from a page the sheet followed to, as well as one it opened on: the place stays.
    await page.evaluate(`(window.first = ${frame(site.a)}, 0)`);
    await write('Second words. ');
    await save();
    assert.ok(await until(reads(site.b, 'Second words.')), 'the draft it moved to reads what was saved');
    assert.ok(await page.evaluate(`window.first === ${frame(site.a)}`), 'and nothing else is read again');
    await write('Waiting. ');
    await scrollTo(site.a);
    await wait(600);
    assert.ok(await page.evaluate(`location.hash.startsWith('#/e/${site.b}')`), 'words not saved hold the sheet');
    await page.evaluate(`[...document.querySelectorAll('#sheet .draft-bar:not([hidden]) button')].find((b) => b.textContent === 'Discard').click()`);

    // A shared document is written on the map it lives on, by the person, and its draft reads that.
    await page.evaluate(`document.querySelector('#canvas .lens-view').dispatchEvent(new Event('scroll'))`);
    await scrollTo(offer.id);
    assert.ok(await until(`location.hash.startsWith('#/e/${offer.id}')`), `the sheet moves to the shared page: ${await page.evaluate('location.hash')}`);
    assert.ok(await until(`${area}?.value.startsWith('shared')`), 'its words, as they stand on its own map');
    await write('From the site. ');
    await save();
    assert.ok(await until(reads(offer.id, 'From the site.')), `its draft reads what was saved: ${page.logs().join('\n')}`);
    const written = (await api(mine, 'get', { id: home })).entity;
    assert.ok(written.body.startsWith('From the site. '), 'written on its own map');
    assert.ok((await api(theirs, 'get', { id: offer.id })).entity.body.startsWith('From the workspace'), 'the share itself is as it was');
  } finally {
    await page.close();
  }
});
