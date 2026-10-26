// Painting a ridges picture onto a 2D canvas, shared by the tool and the study, so both draw alike.

import { waterOf, landOf } from './palettes.js';

/**
 * A colour for a shape's number: in proportion to the palette's weights (when it has them and weighted is on),
 * else evenly. With a tone (0 dark to 1 light), colours near that lightness are favoured: palettes run dark to light.
 */
export function colourOf(p, i, tone = null, weighted = true, small = false) {
  const n = p.colours.length;
  let w = p.weights && weighted ? [...p.weights] : p.colours.map(() => 1);
  // A species' accent is a pop of colour: kept off the large shapes, and favoured on the small ones.
  if (p.accent) w = w.map((x, k) => (p.accent[k] ? (small ? x * 5 : 0) : x));
  if (tone !== null) w = w.map((x, k) => x * Math.exp(-((k / (n - 1) - tone) ** 2) / 0.06));
  const total = w.reduce((a, b) => a + b, 0);
  let t = ((Math.imul(i, 2654435761) >>> 0) / 4294967296) * total;
  for (let k = 0; k < n; k++) if ((t -= w[k]) < 0) return p.colours[k];
  return p.colours[n - 1];
}

/** A shape's fill: shallows in its archipelago's water, land in its land colours (never its blues). */
export const fillOf = (s, palOf, weighted = true) => ('sea' in s ? waterOf(palOf(s.group)).shallows[s.sea] : colourOf(landOf(palOf(s.group)), s.fill, s.tone, weighted, s.small));

/** The row lines on the deep water: the paper's colour, faint, so they read as swell, not as ink. */
export const swell = (p) => p.paper + '4d';

/**
 * Paint a picture: the background, then every shape in order. base is the palette that gives ink, paper and the
 * deep water (unless background is given); palOf gives each archipelago's palette.
 */
export function paint(g, pic, { base, palOf = () => base, background = waterOf(base).deep, weighted = true }) {
  g.fillStyle = background;
  g.fillRect(0, 0, pic.width, pic.height);
  g.lineJoin = 'round';
  g.lineCap = 'round';
  for (const s of pic.shapes) {
    g.beginPath();
    s.points.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y)));
    if (s.line) {
      g.strokeStyle = swell(base);
      g.lineWidth = Math.max(0.6, pic.line * 0.8);
      g.stroke();
      continue;
    }
    g.closePath();
    g.fillStyle = fillOf(s, palOf, weighted);
    g.fill();
    // Shallows are drawn with a finer line, so the land stays the subject.
    if (pic.line) {
      g.strokeStyle = base.ink;
      g.lineWidth = 'sea' in s ? pic.line * 0.5 : pic.line;
      g.stroke();
    }
  }
}
