import assert from 'node:assert/strict';
import { test } from 'node:test';
import { svgRefused } from '../src/svg-figure.ts';

const DRAWN = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10" width="10" height="10" stroke-linejoin="round"><rect width="10" height="10" fill="#161614"/><path d="M1 1h8l-4 7Z" fill="#7a3" fill-opacity="0.9" stroke="#222" stroke-width=".6"/></svg>';

test('an SVG of shapes alone is kept as a figure; one that scripts, styles, links or fetches is refused', () => {
  assert.equal(svgRefused(DRAWN), null);
  assert.equal(svgRefused(`<?xml version="1.0" encoding="UTF-8"?>\n${DRAWN}`), null);
  assert.equal(svgRefused('<svg xmlns="http://www.w3.org/2000/svg"><defs><linearGradient id="a"><stop offset="0" stop-color="#fff"/></linearGradient></defs><rect fill="url(#a)" width="1" height="1"/><text x="1" y="1">A &amp; B</text></svg>'), null);
  for (const [bad, why] of [
    ['<svg><script>alert(1)</script></svg>', /<script>/],
    ['<svg onload="alert(1)"></svg>', /onload/],
    ['<svg><a href="https://x.test"><rect/></a></svg>', /<a>/],
    ['<svg><image href="https://x.test/p.png"/></svg>', /<image>/],
    ['<svg><use xlink:href="#a"/></svg>', /<use>/],
    ['<svg><style>rect{fill:red}</style></svg>', /<style>/],
    ['<svg><rect style="fill:red"/></svg>', /style/],
    ['<svg><rect fill="url(https://x.test/a#b)"/></svg>', /outside/],
    ['<svg><foreignObject><div/></foreignObject></svg>', /foreignObject/],
    ['<!DOCTYPE svg [<!ENTITY a "b">]><svg/>', /begin/],
    ['<svg><!-- a --></svg>', /<!/],
    ['<svg><rect fill="red" onclick=alert(1)/></svg>', /cannot read/],
    ['<svg xmlns="http://www.w3.org/1999/xhtml"></svg>', /xmlns/],
    ['<html><svg/></html>', /begin/],
  ] as const)
    assert.match(svgRefused(bad) ?? 'kept', why, bad);
});

test('a figure may fade its parts on a clock, and an animation may do nothing else', () => {
  const moves = (attrs: string) => `<svg xmlns="http://www.w3.org/2000/svg"><g opacity="0"><animate ${attrs}/></g></svg>`;
  assert.equal(svgRefused(moves('attributeName="opacity" begin="1.5s" dur="1.60s" fill="freeze" values="0;1"')), null);
  assert.equal(svgRefused(moves('attributeName="display" begin="1.5s" dur="0.01s" fill="freeze" calcMode="discrete" values="none;none"')), null);
  for (const [attrs, why] of [
    ['attributeName="href" values="https://x.test"', /attributeName/],
    ['attributeName="opacity" begin="click" values="0;1"', /begin/],
    ['attributeName="opacity" to="1"', /to on/],
    ['attributeName="display" values="block"', /values/],
    ['attributeName="opacity" values="url(https://x.test)"', /values/],
    ['dur="1s"', /no attribute/],
  ] as const)
    assert.match(svgRefused(moves(attrs)) ?? 'kept', why, attrs);
  assert.match(svgRefused('<svg><set attributeName="href" to="x"/></svg>') ?? 'kept', /<set>/);
});
