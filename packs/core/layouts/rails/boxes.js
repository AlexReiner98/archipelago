// How big each stop's box is: its name in lines no wider than rails_box_most, at most rails_lines_most of them, the
// last cut with an ellipsis. Layer: metrics. Pure: a name, the measure and the sizes in, its lines and size out.

const ELLIPSIS = '…';

/** A text cut to fit `room` at `px`, an ellipsis at its end. */
function cutTo(text, room, px, measure) {
  if (measure(text, px) <= room) return text;
  let s = text;
  while (s.length > 1 && measure(`${s}${ELLIPSIS}`, px) > room) s = s.slice(0, -1);
  return `${s.trimEnd()}${ELLIPSIS}`;
}

/** A name's lines, filled word by word to `room`, kept to `most` lines. */
export function wrap(text, room, px, measure, most) {
  const words = String(text ?? '').split(/\s+/).filter(Boolean), lines = [];
  let line = '';
  for (const word of words) {
    const next = line ? `${line} ${word}` : word;
    if (!line || measure(next, px) <= room) line = next;
    else (lines.push(line), (line = word));
  }
  if (line) lines.push(line);
  if (lines.length > most) {
    const kept = lines.slice(0, Math.max(1, most));
    kept[kept.length - 1] = cutTo(`${kept[kept.length - 1]} ${lines.slice(kept.length).join(' ')}`, room, px, measure);
    return kept;
  }
  return lines.map((l) => cutTo(l, room, px, measure));
}

/** A stop's box: its lines, and the width and height its name needs. */
export function boxOf(item, measure, sizes, most) {
  const px = sizes.rails_text, room = sizes.rails_box_most - 2 * sizes.rails_box_pad;
  const lines = wrap(item.title, room, px, measure, most);
  const text = Math.max(0, ...lines.map((l) => measure(l, px)));
  return {
    lines,
    w: Math.max(sizes.rails_box_least, text + 2 * sizes.rails_box_pad),
    h: Math.max(1, lines.length) * sizes.rails_line + 2 * sizes.rails_box_pad_y,
  };
}
