// A drawing as marks, for a view drawn inline in a chat (src/mcp-view.ts, ui/mcp-view.html). The scene is the one the
// sandbox answered with, and it is made here as every scene is, checked by ui/marks.js, into markup and its stylesheet
// with the values it reads; so what leaves the page holds no code of the drawing's and nothing a mark may not say, and
// a host's frame needs no worker and no drawing to show it. It is the still frame a published page shows: all of it,
// its key above it, whatever part of it the canvas has in sight. A scene with a surface or a reader, painted or framed
// by the page, has no marks to hand on; nor has a style's own code, which draws on a canvas: those are a picture.

import { build, cssFor } from './marks.js';

/** The page's own rules for the frame of a picture: read from its stylesheet, so the still frame is the page's. */
const FRAME = /\.lf-|\[data-drawing\]/;
const VARIABLE = /var\((--[\w-]+)/g;

const frameRules = () =>
  [...document.styleSheets].flatMap((sheet) => {
    try {
      return [...sheet.cssRules].filter((rule) => FRAME.test(rule.selectorText ?? '')).map((rule) => rule.cssText);
    } catch {
      return [];
    }
  });

export function marksOf(host) {
  const scene = host?.scene;
  if (!scene?.svg || scene.surface || JSON.stringify(scene.svg).includes('"reader"')) return null;
  const { width, height } = scene.size ?? {};
  const picture = build(scene.svg, new Map(), () => {});
  if (picture instanceof SVGElement) {
    picture.setAttribute('width', width);
    picture.setAttribute('height', height);
    if (!picture.hasAttribute('viewBox')) picture.setAttribute('viewBox', `0 0 ${width} ${height}`);
  }
  const key = host.querySelector('.lf-legend')?.cloneNode(true);
  key?.classList.add('still');
  const stage = document.createElement('div');
  stage.className = 'lf-stage still';
  stage.append(picture);
  const css = [scene.css ? cssFor(host.dataset.drawing, scene.css) : '', ...frameRules()].join('\n');
  // Each value the stylesheet reads, as the page has it now: the theme's and the style's, for this look's scheme.
  const computed = getComputedStyle(host);
  const vars = Object.fromEntries([...new Set([...css.matchAll(VARIABLE)].map((m) => m[1]))].map((name) => [name, computed.getPropertyValue(name).trim()]).filter(([, value]) => value));
  return { id: host.dataset.drawing, html: `${key?.outerHTML ?? ''}${stage.outerHTML}`, css, vars, width, height };
}
