// A code change as a line diff (task e_vc5tpunk): the walk finds a shortest edit, the hunks keep a little context and
// leave the rest out, modules are diffed by name, and the text an agent reads says the same in a few lines.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { codeDiff, diffText, editScript, textDiff } from '../packs/surface/kernel/line-diff.ts';

/** Play a script over a and b: what it keeps and adds must be b, what it keeps and takes out must be a. */
const play = (a: string[], b: string[], script: string[]) => {
  const olds: string[] = [], news: string[] = [];
  let i = 0, j = 0;
  for (const m of script) {
    if (m === '=') assert.equal(a[i], b[j], 'a kept line is the same in both'), olds.push(a[i++]), news.push(b[j++]);
    else if (m === '-') olds.push(a[i++]);
    else news.push(b[j++]);
  }
  assert.deepEqual(olds, a);
  assert.deepEqual(news, b);
  return script.filter((m) => m !== '=').length;
};

test('the walk finds a shortest edit, whatever the texts', () => {
  assert.equal(play(['a', 'b', 'c'], ['a', 'b', 'c'], editScript(['a', 'b', 'c'], ['a', 'b', 'c'])), 0);
  assert.equal(play([], ['x'], editScript([], ['x'])), 1);
  assert.equal(play(['x'], [], editScript(['x'], []))  , 1);
  // The classic: ABCABBA to CBABAC takes five.
  const a = [...'ABCABBA'], b = [...'CBABAC'];
  assert.equal(play(a, b, editScript(a, b)), 5);
  // Random texts over a small alphabet, against a plain LCS: the edit is as short as can be.
  let seed = 7;
  const rand = (n: number) => ((seed = (seed * 1103515245 + 12345) % 2 ** 31), seed % n);
  for (let t = 0; t < 200; t++) {
    const x = Array.from({ length: rand(12) }, () => 'abc'[rand(3)]), y = Array.from({ length: rand(12) }, () => 'abc'[rand(3)]);
    const L = Array.from({ length: x.length + 1 }, () => Array(y.length + 1).fill(0));
    for (let i = 1; i <= x.length; i++) for (let j = 1; j <= y.length; j++) L[i][j] = x[i - 1] === y[j - 1] ? L[i - 1][j - 1] + 1 : Math.max(L[i - 1][j], L[i][j - 1]);
    assert.equal(play(x, y, editScript(x, y)), x.length + y.length - 2 * L[x.length][y.length], `${x.join('')} → ${y.join('')}`);
  }
});

test('a hunk keeps three lines of context, and what is far from a change is left out', () => {
  const was = Array.from({ length: 40 }, (_, i) => `line ${i + 1}`);
  const now = [...was];
  now[9] = 'line ten';
  now.splice(30, 0, 'new line');
  const d = textDiff(`${was.join('\n')}\n`, `${now.join('\n')}\n`);
  assert.equal(d.add, 2);
  assert.equal(d.del, 1);
  assert.equal(d.hunks.length, 2, 'two changes far apart are two hunks');
  assert.deepEqual(d.hunks[0], { a: 7, b: 7, lines: [' line 7', ' line 8', ' line 9', '-line 10', '+line ten', ' line 11', ' line 12', ' line 13'] });
  assert.deepEqual(d.hunks[1].lines, [' line 28', ' line 29', ' line 30', '+new line', ' line 31', ' line 32', ' line 33']);
  assert.equal(d.hunks[1].b, 28);
  // Two changes close together are one hunk.
  const close = [...was];
  close[9] = 'x';
  close[13] = 'y';
  assert.equal(textDiff(was.join('\n'), close.join('\n')).hunks.length, 1);
});

test('modules are diffed by name: new, gone and changed, the same left out', () => {
  const d = codeDiff({ 'index.js': 'a\nb\n', 'same.js': 's\n', 'gone.js': 'g\n' }, { 'index.js': 'a\nB\n', 'same.js': 's\n', 'new.js': 'n\n' })!;
  assert.deepEqual(d.files.map((f) => [f.file, f.was ?? 'changed', f.add, f.del]), [['gone.js', 'removed', 0, 1], ['index.js', 'changed', 1, 1], ['new.js', 'added', 1, 0]]);
  assert.equal(d.add, 2);
  assert.equal(d.del, 2);
  assert.equal(codeDiff({ 'a.js': 'x' }, { 'a.js': 'x' }), null, 'nothing changed is no diff');
  assert.equal(codeDiff(3, 'x'), null, 'what is not code is no diff');
  assert.equal(codeDiff(null, 'x\ny')!.files[0].was, 'added');
  assert.equal(codeDiff('a\r\nb\r\n', 'a\nb\n'), null, 'line endings are not a change');
});

test('a whole rewrite is cut past the most lines a diff carries, and says how many', () => {
  const big = (p: string) => Array.from({ length: 3000 }, (_, i) => `${p}${i}`).join('\n');
  const started = Date.now();
  const d = codeDiff(big('a'), big('b'), 100)!;
  assert.ok(Date.now() - started < 3000, 'a rewrite of 3000 lines is diffed quickly');
  assert.equal(d.add, 3000);
  assert.equal(d.del, 3000);
  assert.equal(d.files[0].hunks.length, 0, 'the one hunk is over the cap');
  assert.equal(d.cut, 6000);
  assert.match(diffText(d), /6000 more lines of diff/);
});

test('an agent reads the diff as a few lines of text', () => {
  const d = codeDiff({ 'index.js': 'a\nb\nc\n' }, { 'index.js': 'a\nB\nc\n' })!;
  assert.equal(diffText(d), 'index.js +1 -1\n@@ -1 +1 @@\n a\n-b\n+B\n c');
  assert.equal(diffText(codeDiff('x\n', 'y\n')!), '@@ -1 +1 @@\n-x\n+y');
});
