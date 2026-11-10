// What a session may do on the page (src/may.ts, decision e_qpaqnmrc axis D): /whoami answers it, and the page draws a
// control only where it may. A person may everything they could; a look reads; a token that only reports writes nothing
// from the page; a dev page may try a narrower session, never a wider one.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { pageMay } from '../src/may.ts';

test('a person may read and write, and an admin also manage the workspace', () => {
  assert.deepEqual(pageMay({ kind: 'human', name: 'ann' }, false), ['read', 'write']);
  assert.deepEqual(pageMay({ kind: 'human', name: 'local', admin: true }, false), ['read', 'write', 'admin']);
  assert.deepEqual(pageMay({ kind: 'agent', name: 'a', may: 'propose' }, false), ['read', 'write']);
});

test('a look, and a token that only reports, only read', () => {
  assert.deepEqual(pageMay({ kind: 'human', name: 'local', admin: true }, true), ['read']);
  assert.deepEqual(pageMay({ kind: 'agent', name: 'm', may: 'report' }, false), ['read']);
});

test('a narrower session asked for is only ever narrower', () => {
  const owner = { kind: 'human' as const, name: 'local', admin: true };
  assert.deepEqual(pageMay(owner, false, 'read'), ['read']);
  assert.deepEqual(pageMay(owner, false, 'read,write'), ['read', 'write']);
  assert.deepEqual(pageMay({ kind: 'human', name: 'ann' }, false, 'read,write,admin'), ['read', 'write']);
});
