// What the page part says of names, times and kinds, out of the words it is handed (decision e_fx62gsjb: words are
// data, handed from the island's registry). It reads no page and fetches nothing: run without a browser in tests.

/** A field's or a link's name as a person reads it: no underscores, its first letter up. */
export const label = (name) => {
  const s = String(name ?? '').replaceAll('_', ' ').trim();
  return s ? s[0].toUpperCase() + s.slice(1) : s;
};

/** How long ago a time was, in the fewest words: now, 5 min, 3 h, 2 d, then the day. */
export function ago(iso, now = Date.now()) {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return '';
  const s = Math.max(0, (now - t) / 1000);
  if (s < 60) return 'now';
  if (s < 3600) return `${Math.round(s / 60)} min`;
  if (s < 86400) return `${Math.round(s / 3600)} h`;
  if (s < 86400 * 14) return `${Math.round(s / 86400)} d`;
  return String(iso).slice(0, 10);
}

/** A type's words, and each it is a flavour of, nearest first. */
export function lineage(words, type) {
  const out = [];
  for (let t = type; t && words?.types?.[t] && !out.some((x) => x.id === t); t = words.types[t].of) out.push({ id: t, ...words.types[t] });
  return out;
}

/** What a type declares, read through its lineage: the nearest says. */
export function typeOf(words, type) {
  const line = lineage(words, type);
  const pick = (k) => line.find((t) => t[k] !== undefined)?.[k];
  const fields = Object.assign({}, ...line.slice().reverse().map((t) => t.fields ?? {}));
  return { id: type, title: line[0]?.title ?? label(type), open: pick('open') ?? [], closed: pick('closed') ?? [], fields, capabilities: pick('capabilities') ?? {}, starter: line.at(-1)?.id };
}

/** A link type's name as read from one end: forward from the item, or back to it. */
export function linkSaid(words, type, back) {
  const w = words?.links?.[type];
  return (back ? w?.back ?? w?.reverse : w?.title) ?? label(type);
}
