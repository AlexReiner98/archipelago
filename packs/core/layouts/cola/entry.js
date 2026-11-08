// The cola drawing's entry (task e_x7kwbu3e): WebCola loaded once from the drawing's tools (`tools.cola()`, the vendored
// ui/cola.module.min.js, in the sandboxed worker), handed to the layout, then the flow's own scene (./scene.js, the
// flow's index.js under that name) drawn as for every flow layout.
// Layer: marks.

import { picture as scene } from './scene.js';
import { useCola } from './layout.js';

export { stages } from './layout.js';

export async function picture(input, tools) {
  if (typeof tools?.cola !== 'function') throw new Error('The cola layout needs WebCola, which the drawing gives as tools.cola()');
  useCola(await tools.cola());
  return scene(input, tools);
}
