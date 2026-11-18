// A screen's rounds on its page (packs/sheet/page/rounds.js, the rounds piece): drawn from a fixture without a browser,
// newest first, each its wide and narrow pictures side by side, its commit and when as one line, its failed checks as
// marks with what they said in the tooltip; and the piece as a screen declares it (packs/loader/kernel/declared.ts).

import assert from 'node:assert/strict';
import { test } from 'node:test';
// @ts-expect-error: a plain module of the page, with no types of its own.
import { failed, roundsOf, roundsStrip } from '../packs/sheet/page/rounds.js';
import { checkDeclared } from '../packs/loader/kernel/declared.ts';
import type { PackFile, ResolvedType } from '../packs/loader/kernel/packs.ts';

interface El { tag: string; attrs: Record<string, unknown>; kids: (El | string)[]; removed?: boolean; src?: string; onclick?: () => void; remove(): void; append(...k: El[]): void }
/** How an element is made, as plain objects: what the page's h would make, without a document. */
const h = (tag: string, attrs: Record<string, unknown> = {}, ...kids: unknown[]): El => ({
  tag,
  attrs,
  kids: (kids.flat(Infinity) as (El | string)[]).filter((k) => k != null && (k as unknown) !== false),
  remove() { this.removed = true; },
  append(...k: El[]) { this.kids.push(...k); },
});
const ago = (ts: string) => h('span', { class: 'ago' }, `ago:${ts}`);
const all = (el: El | string, out: El[] = []): El[] => (typeof el === 'string' ? out : (out.push(el), el.kids.forEach((k) => all(k, out)), out));
const text = (el: El | string): string => (typeof el === 'string' ? el : el.kids.map(text).join(' '));

const rounds = [
  { wide: { id: 'k_one_w', url: '/a-wide.png' }, narrow: { id: 'k_one_n', url: '/a-narrow.png' }, commit: 'aaaaaaa1111', at: '2026-11-18T10:00:00Z', checks: [{ rule: 'one line per row', said: 'fine', ok: true }] },
  { wide: { id: 'k_two_w' }, narrow: { id: 'k_two_n' }, commit: 'bbbbbbb2222', at: '2026-11-18T12:00:00Z', checks: [{ rule: 'no pills', said: 'The filter terms sit in capsules' }, { rule: 'one line per row', said: 'fine', ok: true }] },
];

test('rounds are read newest first, numbered from the oldest; what is not a round is left out', () => {
  const read = roundsOf([...rounds, null, { commit: 'no pictures' }]);
  assert.deepEqual(read.map((r: { n: number }) => r.n), [2, 1]);
  assert.deepEqual(roundsOf(undefined), []);
  assert.deepEqual(failed(read[0]).map((c: { rule: string }) => c.rule), ['no pills']);
});

test('each round is a row: its line, then its wide and narrow pictures side by side at the style\'s lengths', async () => {
  const asked: string[] = [];
  const strip = roundsStrip(rounds, { h, ago, src: (s: { id: string }) => (asked.push(s.id), Promise.resolve(`data:${s.id}`)) });
  assert.equal(strip.count, 2);
  await strip.at();
  const rows = all(strip.node).filter((e) => e.tag === 'li');
  assert.deepEqual(rows.map((r) => r.attrs['data-round']), [2, 1], 'newest first');
  const [newest, oldest] = rows;
  const figures = all(newest).filter((e) => e.tag === 'figure');
  assert.deepEqual(figures.map((f) => f.attrs['data-side']), ['wide', 'narrow']);
  for (const f of figures) assert.match(String(f.attrs.style), /var\(--round-(wide|narrow)\)/, 'its share is a length on the style');
  // A kept look is asked for by its id; a round that has an address loads it as it is.
  assert.deepEqual(asked, ['k_two_w', 'k_two_n']);
  assert.deepEqual(all(newest).filter((e) => e.tag === 'img').map((i) => i.src), ['data:k_two_w', 'data:k_two_n']);
  assert.deepEqual(all(oldest).filter((e) => e.tag === 'img').map((i) => i.src), ['/a-wide.png', '/a-narrow.png']);
  // Its line: the number, the commit cut to seven with the whole in the tooltip, when, and a mark per failed check.
  const line = text(newest.kids[0] as El);
  for (const s of ['#2', 'bbbbbbb', 'ago:2026-11-18T12:00:00Z', 'no pills']) assert.ok(line.includes(s), s);
  assert.ok(!line.includes('bbbbbbb2222'));
  const marks = all(newest).filter((e) => String(e.attrs.class ?? '').startsWith('mark'));
  assert.deepEqual(marks.map((m) => [m.attrs.class, m.attrs.title]), [['mark bad', 'The filter terms sit in capsules']]);
  // A round whose checks all held reads as one quiet mark.
  assert.deepEqual(all(oldest).filter((e) => String(e.attrs.class ?? '').startsWith('mark')).map((m) => [m.attrs.class, text(m)]), [['mark ok', '1 ✓']]);
});

test('no length in the drawing is a number of its own: each is a variable of the style', () => {
  const strip = roundsStrip(rounds, { h, ago, src: () => null });
  for (const e of all(strip.node)) if (e.attrs.style) assert.ok(!/\d+(px|em|rem|vw|vh)/.test(String(e.attrs.style)), String(e.attrs.style));
});

test('a picture with no address is left out, and a click on one opens it whole', async () => {
  const strip = roundsStrip([rounds[1]], { h, ago, src: (s: { id: string }) => Promise.resolve(s.id === 'k_two_n' ? null : 'data:w') });
  await strip.at();
  const [wide, narrow] = all(strip.node).filter((e) => e.tag === 'img');
  assert.ok(narrow.removed && !wide.removed);
  const opened: El[] = [];
  Object.assign(wide, { ownerDocument: { body: { append: (b: El) => opened.push(Object.assign(b, { showModal() { (b as El & { open?: boolean }).open = true; } })) } } });
  wide.onclick!();
  assert.equal(opened[0].tag, 'dialog');
  assert.equal((opened[0].kids[0] as El).attrs.src, 'data:w');
});

test('a limit shows the newest rounds, the rest a click away', () => {
  const strip = roundsStrip(rounds, { h, ago, src: () => null, limit: 1 });
  const list = all(strip.node).find((e) => e.tag === 'ul')!;
  assert.equal(list.kids.length, 1);
  const more = all(strip.node).find((e) => e.tag === 'button')!;
  assert.equal(text(more), '1 older');
  (more.attrs.onclick as () => void)();
  assert.equal(list.kids.length, 2);
  assert.ok(more.removed);
});

test('a screen declares rounds from a json field of every type it is on', () => {
  const types = new Map([['ui.screen', { fields: { rounds: { type: 'json' }, title_note: { type: 'string' } } }]]) as unknown as Map<string, ResolvedType>;
  const pack = (pieces: unknown[]) => ({ id: 'ui', version: '1', views: [{ id: 'ui.rounds', form: 'screen', title: 'Rounds', on: ['ui.screen'], pieces }] }) as unknown as PackFile;
  assert.deepEqual(checkDeclared(pack([{ piece: 'rounds', field: 'rounds' }]), types, [], false), []);
  assert.ok(checkDeclared(pack([{ piece: 'rounds' }]), types, [], false).some((m) => /a rounds piece names its field/.test(m)));
  assert.ok(checkDeclared(pack([{ piece: 'rounds', field: 'title_note' }]), types, [], false).some((m) => /json field of every type/.test(m)));
});
