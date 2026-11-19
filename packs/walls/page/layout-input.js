// What the page hands a drawing beside its answer and style (./layout.js): the words of the types and links it
// holds, and the colours it is drawn in, as this page has them. A drawing has no registry and no page of its own.

import { STYLE_COLORS } from './query-base.js';
import { relations, types as registry } from './words.js';

/** What a drawing is told of the types and links an answer holds, as this page knows them: the values each type's
 * fields may take (`fields`, by type then field) and each link's title (`relations`). A drawing has no registry. */
export function typeWords(answer) {
  const held = [...new Set((answer.items ?? []).map((i) => i.type).filter(Boolean))];
  const fields = Object.fromEntries(held.map((t) => [t, Object.fromEntries(Object.entries(registry.get(t)?.fields ?? {}).filter(([, f]) => Array.isArray(f?.values)).map(([name, f]) => [name, f.values]))]).filter(([, f]) => Object.keys(f).length));
  const kinds = [...new Set((answer.links ?? []).map((l) => l.kind).filter(Boolean))];
  return { fields, relations: Object.fromEntries(kinds.map((k) => [k, relations.get(k)?.title ?? k])) };
}

/** The colours a picture is drawn in, as the page has them now: the page's own (by the theme's names) and the lens's. */
export function colours(host, style) {
  const css = getComputedStyle(host), read = (name) => css.getPropertyValue(name).trim();
  return {
    page: Object.fromEntries(Object.keys(style.theme?.light ?? {}).map((name) => [name, read(`--${name.replaceAll('_', '-')}`)])),
    lens: Object.fromEntries(STYLE_COLORS.map((name) => [name, read(`--ln-${name}`)])),
  };
}
