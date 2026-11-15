// A drawing's pictures, baked once, as one SVG (packs/publish/kernel/baked.ts): the same shapes in other colours become
// slots, the SVG is written from checked numbers, colours and words alone, and its own stylesheet turns the colours.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { bakedSvg, slotted } from '../packs/publish/kernel/baked.ts';

const square = (c: string, line = '#000000') => ({
  width: 100,
  height: 50,
  clips: [{ d: [['M', [0, 0]], ['L', [100, 0]], ['L', [100, 50]], ['Z']], up: 0 }],
  shapes: [
    { k: 'fill', d: [['M', [10, 10]], ['L', [30, 10]], ['L', [30, 30]], ['Z']], c, a: 1, clip: 1 },
    { k: 'stroke', d: [['M', [10, 10]], ['L', [30, 10]], ['L', [30, 30]], ['Z']], c: line, a: 1, w: 1.5, j: 'round', cap: 'butt', clip: 1 },
    { k: 'text', s: 'A <name> & "more"', m: [1, 0, 0, 1, 50, 25], font: 'italic 400 20px Georgia, "Times New Roman", serif', align: 'center', base: 'alphabetic', sp: '4px', c: '#ece8e0', a: 1, clip: 1 },
  ],
});

test('pictures of the same shapes in other colours become one, each shape naming its slot', () => {
  const b = slotted({ red: square('#ff0000'), blue: square('#0000ff') }, { every: 2 });
  assert.deepEqual(b.names, ['red', 'blue']);
  assert.deepEqual(b.slots, [['#ff0000', '#0000ff'], ['#000000', '#000000'], ['#ece8e0', '#ece8e0']]);
  assert.deepEqual(b.shapes.map((s) => s.slot), [0, 1, 2]);
  assert.deepEqual(b.timing, { every: 2, fade: false });
  const moved = square('#0000ff');
  moved.shapes[0].d = [['M', [11, 10]], ['L', [30, 10]], ['L', [30, 30]], ['Z']];
  assert.throws(() => slotted({ red: square('#ff0000'), blue: moved }), /turns its colours alone/);
});

test('what the code sent is checked: colours a canvas says, numbers, and steps it knows', () => {
  assert.throws(() => slotted({ a: square('red') }), /colour/);
  assert.throws(() => slotted({ a: square('#ff0000;}</style><script>') }), /colour/);
  const odd = square('#ff0000');
  (odd.shapes[0].d![1] as unknown[])[0] = 'X';
  assert.throws(() => slotted({ a: odd }), /letter and points/);
  const far = square('#ff0000');
  far.shapes[0].d![1][1] = [Infinity, 0];
  assert.throws(() => slotted({ a: far }), /letter and points/);
});

test('the SVG is one shape per outline, its words escaped and clipped round, and its colours turned by its stylesheet', () => {
  const svg = bakedSvg(slotted({ red: square('#ff0000'), blue: square('#0000ff') }, { every: 2 }));
  assert.match(svg, /^<svg xmlns="http:\/\/www.w3.org\/2000\/svg" viewBox="0 0 100 50">/);
  assert.equal((svg.match(/<path class=/g) ?? []).length, 1, 'a fill and the line round it are one shape');
  assert.match(svg, /<path class="f0 l1" d="M10 10l20 0l0 20z" stroke-width="1.5" stroke-linejoin="round" clip-path="url\(#c1\)"\/>/);
  assert.match(svg, /<g clip-path="url\(#c1\)"><text class="f2" transform="matrix\(1 0 0 1 50 25\)" text-anchor="middle"/);
  assert.match(svg, />A &lt;name&gt; &amp; "more"<\/text>/);
  assert.match(svg, /style="font:italic 400 20px Georgia, &quot;Times New Roman&quot;, serif;letter-spacing:4px"/);
  assert.match(svg, /@keyframes f0\{0%\{fill:#ff0000\}50%\{fill:#0000ff\}\}\.f0\{fill:#ff0000;animation:f0 4s step-end infinite\}/);
  assert.match(svg, /\.l1\{stroke:#000000\}/, 'a slot that keeps its colour does not turn');
  assert.match(svg, /prefers-reduced-motion:reduce/);
  assert.doesNotMatch(svg, /<script|on\w+=/);
  const faded = bakedSvg(slotted({ red: square('#ff0000'), blue: square('#0000ff') }, { every: 1, fade: true }));
  assert.match(faded, /@keyframes f0\{0%,30%\{fill:#ff0000\}50%,80%\{fill:#0000ff\}100%\{fill:#ff0000\}\}/);
});
