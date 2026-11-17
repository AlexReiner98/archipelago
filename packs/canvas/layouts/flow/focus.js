// How each island treats its focus (decision e_up4wjd94, the owner, 17 Nov 2026: look.focus): the style's `focus`, the
// island's own layer over the view's, says where the focus stands (`at`: its cell, the corner before the rest, or over
// them at the top), its outline (`shape`) and how much bigger than an item it is drawn (`scale`). Layer: graph. Pure:
// the answer's islands and the style in, what the layout and the steps read out.

const AT = ['cell', 'corner', 'top'];
const record = (v) => (v && typeof v === 'object' && !Array.isArray(v) ? v : {});

/**
 * The focus of each island that is one, as the style says to treat it: `at` (island id → where it stands), `shapes`
 * (its id → outline) and `scales` (its id → how much bigger). `shapes` is the list of outlines the steps draw.
 */
export function focusOf(islands = [], style = {}, outlines = []) {
  const at = new Map(), shapes = {}, scales = {};
  for (const isle of islands) {
    if (!isle?.focus) continue;
    const said = { ...record(style.focus), ...record(record(isle.style).focus) };
    if (AT.includes(said.at)) at.set(isle.id, said.at);
    if (outlines.includes(said.shape)) shapes[isle.id] = said.shape;
    if (typeof said.scale === 'number' && Number.isFinite(said.scale) && said.scale > 0) scales[isle.id] = said.scale;
  }
  return { at, shapes, scales };
}
