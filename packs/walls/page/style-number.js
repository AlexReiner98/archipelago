// A number a drawing is drawn by, read off the style: the host's, as the plane a picture moves in (pan-zoom.js) reads
// it, and the app's through ui/query-base.js, which says it again. The house style names every one.

/** A number a drawing's code is drawn by: the style's, named by the house style. */
export const numberOf = (style, name) => {
  const v = style.numbers?.[name];
  if (typeof v !== 'number') throw new Error(`The style names no number "${name}": the house style (core.house, packs/canvas/pack.json) names every one a drawing uses`);
  return v;
};
