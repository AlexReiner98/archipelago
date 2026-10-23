// Marks, as the page is sent them: [tag, attributes, ...what is in it], a string being text. The same as the
// architecture drawing's (a drawing's modules are one folder of its own, so each keeps its copy).

/** A mark: [tag, attributes, ...what is in it]. What is left out (undefined, false, null) is not drawn. */
export const isMark = (v) => Array.isArray(v) && typeof v[0] === 'string';
/** Lists of marks, however deep, as one list: a mark itself is kept whole. */
export const spread = (kids) => kids.flatMap((kid) => (Array.isArray(kid) && !isMark(kid) ? spread(kid) : [kid]));
export const m = (tag, attrs = {}, ...kids) => {
  const kept = {};
  for (const [k, v] of Object.entries(attrs)) if (v !== undefined && v !== false && v !== null) kept[k] = k === 'on' ? v : String(v);
  return [tag, kept, ...spread(kids).filter((kid) => kid !== undefined && kid !== false && kid !== null)];
};
export const titled = (mark, text) => (mark.splice(2, 0, m('title', {}, text)), mark);
/** A class put on a mark, after those it has. */
export const addClass = (mark, name) => (mark[1].class = mark[1].class ? `${mark[1].class} ${name}` : name);
