// An island never drawn bare (lane e_dp3bgymb, packs/walls/page/island-hold.js): seconds after the UI design pack's
// manifest changed on Focus (log 1271-1273, 18 Nov 2026), a view of the study's island was answered once with its
// items on no island, and drawn as a plain map. The picture is kept for that answer and the view asked again; the
// answer then is drawn, whatever it holds. Islands turned off, or a query that moved, draw at once.

import assert from 'node:assert/strict';
import { test } from 'node:test';
// @ts-ignore: a module of the page, plain JavaScript
import { heldBare, holdBare } from '../packs/walls/page/island-hold.js';

const STUDY = 'e_unru8ftt';
/** An answer of the study's island: whole (its items on it, the island named) or bare (as the reload answered it). */
const whole = (ids = ['e_aaaaaaaa', 'e_bbbbbbbb']) => ({ items: ids.map((id) => ({ id, type: 'ui.screen', island: STUDY })), links: [], islands: [{ id: STUDY, title: 'The canvas, by eye' }] });
const bare = (ids = ['e_aaaaaaaa', 'e_bbbbbbbb']) => ({ items: ids.map((id) => ({ id, type: 'ui.screen' })), links: [] });

/** A host as a drawing's is, with a clock that runs its timers when told. */
function hostWithClock() {
  const timers: (() => void)[] = [];
  const realSet = globalThis.setTimeout, realClear = globalThis.clearTimeout;
  globalThis.setTimeout = ((fn: () => void) => (timers.push(fn), timers.length)) as unknown as typeof setTimeout;
  globalThis.clearTimeout = ((n: number) => void (n && (timers[n - 1] = () => {}))) as unknown as typeof clearTimeout;
  return { host: {} as Record<string, unknown>, run: () => timers.splice(0).forEach((fn) => fn()), done: () => ((globalThis.setTimeout = realSet), (globalThis.clearTimeout = realClear)) };
}

test('a bare answer after a whole one keeps the picture and asks again; the whole answer then is drawn', () => {
  const { host, run, done } = hostWithClock();
  try {
    let asked = 0;
    const again = () => asked++;
    assert.equal(heldBare(host, whole(), true, 1500, again), false, 'the first whole answer is drawn');
    assert.equal(heldBare(host, bare(), true, 1500, again), true, 'the bare answer is not drawn');
    assert.equal(asked, 0, 'asked again only after the hold');
    run();
    assert.equal(asked, 1, 'asked again once the hold is over');
    assert.equal(heldBare(host, whole(), true, 1500, again), false, 'the whole answer that comes is drawn');
    assert.equal(heldBare(host, bare(), true, 1500, again), true, 'and a later bare one is held again');
  } finally {
    done();
  }
});

test('a bare answer that comes again after the hold is drawn: a map whose islands went is never held for ever', () => {
  const { host, run, done } = hostWithClock();
  try {
    heldBare(host, whole(), true, 1500, () => {});
    assert.equal(heldBare(host, bare(), true, 1500, () => {}), true);
    run();
    assert.equal(heldBare(host, bare(), true, 1500, () => {}), false, 'the second bare answer is drawn');
  } finally {
    done();
  }
});

test('islands turned off, a query that moved, or a first answer draw at once', () => {
  assert.equal(holdBare(whole(), bare(), false), false, 'the map keeps no islands: drawn at once');
  assert.equal(holdBare(undefined, bare(), true), false, 'nothing drawn before: drawn');
  assert.equal(holdBare(whole(), bare(['e_cccccccc']), true), false, 'other items, none the picture had on its island');
  assert.equal(holdBare(whole(), whole(['e_aaaaaaaa']), true), false, 'fewer items, still on their island');
  assert.equal(holdBare(bare(), bare(), true), false, 'a picture with no islands is no island to keep');
  assert.equal(holdBare(whole(), { ...bare(), islands: [{ id: STUDY }] }, true), false, 'the island still named: drawn');
  assert.equal(holdBare(whole(), bare(), true), true, 'the same items back on no island: held');
});
