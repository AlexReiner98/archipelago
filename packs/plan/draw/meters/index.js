// A plan's usage drawn as meters: a band for each limit (core's usage view answers them as items, each part part_of
// its limit), its name and how much is used of what the plan allows, a bar filled to that share, warn or bad when
// near or over, and under it what the use is made of. Storage's parts are shares of its bar, each a colour named in
// the key; every other part is a row in a list under its bar (by type, the largest items, the sessions at work, who
// asked), its name, a small bar of its share and its number, leading to its item's page where it stands for one.
// It is laid out by the page, not drawn to a size. Its look is ./look.js.

import { css, hueClass, hueRule } from './look.js';
import { m } from './marks.js';

const HEX = /^#[0-9a-f]{3,8}$/i;
/** A bar as wide as its box, in a thousandth of it: rects need no style to be sized. */
const WIDE = 1000;
const at = (share) => Math.max(0, Math.min(WIDE, Math.round(share * WIDE)));

/** The meters. `answer` is the usage view's: items with `use`, and the part_of links from each part to its limit. */
export function picture({ answer, style = {} }) {
  const items = answer.items ?? [];
  const byId = new Map(items.map((i) => [i.id, i]));
  const limits = items.filter((i) => i.use?.as === 'limit');
  if (!limits.length) return { scene: { message: 'This lens names no usage to draw.' } };
  const partsOf = new Map(limits.map((l) => [l.id, []]));
  for (const k of answer.links ?? []) if (k.type === 'part_of' && partsOf.has(k.to) && byId.has(k.from)) partsOf.get(k.to).push(byId.get(k.from));

  const hues = Array.isArray(style.hues) ? style.hues.filter((h) => typeof h === 'string' && HEX.test(h)) : [];
  const rules = new Set();
  const hueOf = (n) => {
    const hex = hues[n % Math.max(hues.length, 1)];
    if (!hex) return '';
    rules.add(hueRule(hex));
    return hueClass(hex);
  };
  const key = [];

  const said = (u) => (u.of_shown ? [m('strong', {}, u.shown), ` of ${u.of_shown}`] : [m('strong', {}, u.shown)]);
  const tip = (title, u) => `${title}: ${u.shown}${u.of_shown ? ` of ${u.of_shown}` : ''}${u.over ? ', at the limit' : u.near ? ', near the limit' : ''}`;

  const band = (limit) => {
    const u = limit.use;
    const parts = partsOf.get(limit.id);
    const shares = parts.filter((p) => p.use.as === 'share');
    const rows = parts.filter((p) => p.use.as === 'row');
    // The bar: the plan's allowance as its track, filled to what is used, by its shares where it has them.
    let x = 0;
    const fill = shares.length
      ? shares.map((p, n) => {
          const w = at(p.use.share), hue = hueOf(n);
          key.push({ glyph: m('svg', { width: 12, height: 12, viewBox: '0 0 12 12', class: `mt-key-chip ${hue}` }, m('rect', { x: 1, y: 1, width: 10, height: 10, rx: 2 })), label: `${p.title} · ${p.use.shown}` });
          const r = m('rect', { key: `s:${p.id}`, class: `mt-share ${hue}`, x, y: 0, width: w, height: 10 }, m('title', {}, `${p.title}: ${p.use.shown}`));
          x += w;
          return r;
        })
      : [m('rect', { class: 'mt-fill', x: 0, y: 0, width: at(u.share), height: 10 })];
    const lists = [...new Set(rows.map((p) => p.use.list))].map((list) =>
      m(
        'div',
        { class: 'mt-list' },
        m('div', { class: 'mt-list-head' }, list),
        rows.filter((p) => p.use.list === list).map((p) => {
          const hidden = !p.use.item && /:hidden$/.test(p.id);
          const attrs = { key: `r:${p.id}`, class: `mt-row${hidden ? ' hidden-part' : ''}`, title: `${p.title}: ${p.use.shown}` };
          return m(
            p.use.item ? 'a' : 'div',
            p.use.item ? { ...attrs, href: `#/e/${p.use.item}` } : attrs,
            m('span', { class: 'mt-row-name' }, p.title),
            m('svg', { class: 'mt-row-bar', viewBox: `0 0 ${WIDE} 10`, preserveAspectRatio: 'none', 'aria-hidden': 'true' }, m('rect', { class: 'mt-track', x: 0, y: 0, width: WIDE, height: 10 }), m('rect', { class: 'mt-fill', x: 0, y: 0, width: at(p.use.share), height: 10 })),
            m('span', { class: 'mt-row-num' }, p.use.shown),
          );
        }),
      ),
    );
    return m(
      'div',
      { key: `l:${limit.id}`, class: `mt-band${u.over ? ' over' : u.near ? ' near' : ''}` },
      m('div', { class: 'mt-top', title: tip(limit.title, u) }, m('span', { class: 'mt-name' }, limit.title), m('span', { class: 'mt-num' }, said(u))),
      m('svg', { class: 'mt-bar', viewBox: `0 0 ${WIDE} 10`, preserveAspectRatio: 'none', role: 'img', 'aria-label': tip(limit.title, u) }, m('rect', { class: 'mt-track', x: 0, y: 0, width: WIDE, height: 10 }), fill),
      lists,
    );
  };

  const when = answer.as_of ? new Date(answer.as_of) : null;
  const head = m('div', { class: 'mt-head' }, m('span', {}, answer.plan ? `${answer.plan} plan` : 'No plan limits'), when && m('span', { title: when.toISOString() }, `as of ${when.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}`));
  const stage = m('div', { class: 'mt-stage' }, head, limits.map(band));
  return { scene: { css: [css, ...rules].join('\n'), svg: stage, key }, on: () => [] };
}
