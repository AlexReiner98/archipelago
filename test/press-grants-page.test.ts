// An admin's press, on the page's side (packs/surface/page/part-bridge.js, packs/walls/page/part-render.js; decision
// e_ssrawn4v): a button tells the host whether the person pressed it (a trusted event) or a script did, and the bridge
// asks for a grant only on a trusted press of an admin's, keeps it from the part, and sends it with the one admin's
// action after. The server's side is test/press-grants.test.ts.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { chrome, open, pageModule } from './browser.ts';
import { serve } from './serve.ts';

const browser = chrome();

test('in a browser, a button says a person’s press from a script’s', { skip: !browser && 'no Chrome here (set CHROME)' }, async () => {
  const { base } = await serve('off');
  const page = await open(`${base}/`);
  try {
    await page.evaluate(`(async () => {
      const { mountPart } = await ${pageModule('part-render.js')};
      const { checkMarks } = await ${pageModule('part-check.js')};
      const root = document.createElement('div');
      Object.assign(root.style, { position: 'fixed', left: '0', top: '0', zIndex: 99999, background: '#fff' });
      document.body.append(root);
      window.told = [];
      const r = mountPart(root, { tell: (event, mark, trusted) => window.told.push([event.name, trusted === true]) });
      r.draw(checkMarks(['button', { key: 'go' }, 'Go'], { kinds: ['button'] }));
      window.pressMe = root.querySelector('button');
      window.pressMe.click();
    })()`);
    const at: { x: number; y: number } = await page.evaluate(`(() => { const b = window.pressMe.getBoundingClientRect(); return { x: b.x + b.width / 2, y: b.y + b.height / 2 }; })()`);
    for (const type of ['mousePressed', 'mouseReleased']) await page.send('Input.dispatchMouseEvent', { type, x: at.x, y: at.y, button: 'left', clickCount: 1 });
    assert.ok(await page.until('window.told.length === 2'));
    assert.deepEqual(await page.evaluate('window.told'), [['press', false], ['press', true]], 'a script’s click is no person’s press; a real one is');
  } finally {
    await page.close();
  }
});

test('in a browser, an admin’s action goes with the grant of a trusted press, once, and never without one', { skip: !browser && 'no Chrome here (set CHROME)' }, async () => {
  const { base } = await serve('off');
  const page = await open(`${base}/`);
  try {
    const got: any = await page.evaluate(`(async () => {
      await (await import('/base.js')).loadMay();
      const { partBridge } = await import('/part-bridge.js');
      // The server answered from here: a grant each time one is asked, and the admin's action recording what it carried.
      const fetched = window.fetch, minted = [], carried = [];
      window.fetch = async (url, init) => {
        const path = new URL(String(url), location.href).pathname;
        const json = (v) => new Response(JSON.stringify({ result: v }), { headers: { 'content-type': 'application/json' } });
        if (path === '/api/press_grant') return (minted.push(JSON.parse(init.body).part), json({ grant: 'g' + minted.length }));
        if (path === '/api/desk_boss') return (carried.push(JSON.parse(init.body).part.grant ?? null), json({ status: 'applied' }));
        return fetched(url, init);
      };
      const part = { id: 'desk.row', title: 'Row', hash: 'a'.repeat(64), sends: ['desk.boss'], admin: ['desk.boss'] };
      const answered = [];
      const bridge = partBridge({ postMessage: (m) => answered.push(m) }, { partOf: (id) => (id === 'a' ? part : null) });
      let asked = 0;
      const act = async () => { const n = ++asked; bridge.heard({ type: 'act', id: 'a', asked: n, action: 'desk.boss', params: {} }); for (let i = 0; i < 200 && !answered.some((m) => m.asked === n); i++) await new Promise((r) => setTimeout(r, 10)); return answered.find((m) => m.asked === n); };
      // A person's press: a grant is asked as they press, and goes with the action after.
      bridge.trusted('a');
      bridge.send({ type: 'event', id: 'a', event: { name: 'press' } });
      const pressed = await act();
      // The same press again: its grant is spent.
      const again = await act();
      // A press a script made: no grant is asked, and the action is refused before it goes.
      bridge.send({ type: 'event', id: 'a', event: { name: 'press' } });
      const scripted = await act();
      // Of the part's own accord, after a person's press long gone: refused too.
      const own = await act();
      window.fetch = fetched;
      return { pressed, again, scripted, own, minted, carried };
    })()`);
    assert.equal(got.pressed.status, 'applied');
    assert.deepEqual(got.minted, [{ id: 'desk.row', hash: 'a'.repeat(64) }], 'one grant, for the part pressed, asked by the host');
    assert.deepEqual(got.carried, ['g1'], 'the action carried it, once');
    for (const refused of [got.again, got.scripted, got.own]) assert.match(refused.error, /only on an admin's own press/);
  } finally {
    await page.close();
  }
});
