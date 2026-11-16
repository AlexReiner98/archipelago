// A picture's name: what it was drawn from, said short, so a picture drawn before is found again (packs/walls/page/layout.js)
// and kept by it in this browser (./pictures-kept.js). Two pictures drawn from anything different are named apart; the
// same, alike. Naming comes before every drawing, so it is cheap: the style (most of what a drawing is handed, and the
// same picture after picture) is named once per text, the rest hashed. Imports nothing: tested without a page.

const encoder = new TextEncoder();
let bytes = new Uint8Array(1 << 16);
/**
 * A long text's name: two 32-bit hashes (cyrb53's mixing) of its UTF-8 bytes, taken four at a time, and their count.
 * The browser encodes the text, so the loop here runs a quarter as many times as there are characters. Not for
 * secrets: for telling pictures apart.
 */
export function nameOf(text) {
  if (bytes.length < text.length * 3 + 4) bytes = new Uint8Array((text.length * 3 + 4) * 2);
  const { written } = encoder.encodeInto(text, bytes);
  const words = new Int32Array(bytes.buffer, 0, written >> 2);
  let a = 0x9e3779b9 ^ written, b = 0x85ebca6b ^ written;
  for (let i = 0; i < words.length; i++) {
    const c = words[i];
    a = Math.imul(a ^ c, 2654435761);
    b = Math.imul(b ^ c, 1597334677);
  }
  for (let i = words.length * 4; i < written; i++) {
    a = Math.imul(a ^ bytes[i], 2654435761);
    b = Math.imul(b ^ bytes[i], 1597334677);
  }
  a = Math.imul(a ^ (a >>> 16), 2246822507) ^ Math.imul(b ^ (b >>> 13), 3266489909);
  b = Math.imul(b ^ (b >>> 16), 2246822507) ^ Math.imul(a ^ (a >>> 13), 3266489909);
  return `${(b >>> 0).toString(16).padStart(8, '0')}${(a >>> 0).toString(16).padStart(8, '0')}:${written}`;
}

/**
 * The names of the texts named lately, by the text itself: a text met again is found by the browser's own comparison
 * of strings, far quicker than hashing it again, and never mistaken for another, since a Map compares the whole text.
 */
function remembered(most, weight) {
  const names = new Map();
  let held = 0;
  return (text) => {
    let name = names.get(text);
    if (name === undefined) ((name = nameOf(text)), (held += text.length));
    else names.delete(text);
    names.set(text, name);
    for (const old of names.keys()) {
      if (names.size <= most && held <= weight) break;
      names.delete(old);
      held -= old.length;
    }
    return name;
  };
}
const styleName = remembered(8, 2 ** 23);
const answerName = remembered(32, 2 ** 23);

/**
 * What a picture was drawn from, named: the drawing's code (its hash), its style (`styleText`, the style as it is
 * handed to the drawing, said as JSON), and all else it is handed, but the log position its answer was read at
 * (`pos`), which says when, not what: no drawing reads it. `weight` is how much it was drawn from, in characters.
 */
export function pictureKey(hash, input, styleText) {
  const { pos: _pos, ...answer } = input.answer ?? {};
  const { style: _style, answer: _answer, ...rest } = input;
  const text = JSON.stringify({ ...rest, answer });
  return { key: `${hash}|${styleName(styleText)}|${answerName(text)}`, weight: text.length + styleText.length };
}
