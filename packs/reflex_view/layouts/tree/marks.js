// Layer: marks. Marks as the page is sent them: [tag, attributes, ...what is in it], a string being text. What is left
// out (undefined, false, null) is not drawn.

const isMark = (v) => Array.isArray(v) && typeof v[0] === 'string';
const spread = (kids) => kids.flatMap((kid) => (Array.isArray(kid) && !isMark(kid) ? spread(kid) : [kid]));

export const m = (tag, attrs = {}, ...kids) => {
  const kept = {};
  for (const [k, v] of Object.entries(attrs)) if (v !== undefined && v !== false && v !== null) kept[k] = k === 'on' ? v : String(v);
  return [tag, kept, ...spread(kids).filter((kid) => kid !== undefined && kid !== false && kid !== null)];
};

/** A colour a style may name: a hex of three to eight digits. */
export const HEX = new RegExp('^#[0-9a-f]{3,8}$', 'i');

/** A number kept short in a mark: a tenth of a unit is finer than the eye sees. */
export const at = (v) => Math.round(v * 10) / 10;
