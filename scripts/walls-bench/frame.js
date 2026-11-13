// The walled frame of the bench: every part (mode frame), one part (mode part), or the workers of each pack version
// (mode workers), as the host page asks (scripts/walls-bench/host.js). Its origin is opaque: it reaches the server only
// for its own files, which the bench serves to any origin.

import { mount, render, state } from '/part.js';

const q = new URLSearchParams(location.search);
const mode = q.get('mode');
const packs = Number(q.get('packs'));
const tell = (m, transfer) => parent.postMessage(m, '*', transfer);

/** Parts drawn here in the frame's own DOM, as a frame with every part or a frame per part does. */
function local(ids) {
  const parts = new Map();
  for (const i of ids) {
    const el = document.createElement('div');
    el.className = 'slot';
    document.body.append(el);
    const s = state(i, packs);
    const draw = () => mount(el, render(s), (v) => ((s.value = v), draw()));
    parts.set(i, { s, el, draw });
    draw();
  }
  tell({ op: 'drawn', ids });
  onmessage = (e) => {
    const d = e.data;
    if (d.op === 'key') {
      // A keystroke lands in the frame itself: timed where it lands, from the edit to the part drawn again.
      const input = parts.get(d.id).el.querySelector('input');
      const t0 = performance.now();
      input.value += 'a';
      input.dispatchEvent(new Event('input'));
      tell({ op: 'keyed', ms: performance.now() - t0, seq: d.seq });
    }
    if (d.op === 'zoom') {
      const t0 = performance.now();
      for (const p of parts.values()) ((p.s.zoom = d.zoom), p.draw());
      tell({ op: 'zoomed', ms: performance.now() - t0, seq: d.seq });
    }
  };
}

// What each pack version's worker runs: its parts' state, answering every edit or zoom with their marks.
const LOOP = `
const parts = new Map();
onmessage = (e) => {
  const port = e.ports[0];
  port.onmessage = ({ data: d }) => {
    if (d.op === 'init') for (const i of d.ids) parts.set(i, state(i, d.packs));
    if (d.op === 'input') parts.get(d.id).value = d.value;
    if (d.op === 'zoom') for (const s of parts.values()) s.zoom = d.zoom;
    const ids = d.op === 'input' ? [d.id] : [...parts.keys()];
    port.postMessage({ seq: d.seq, marks: ids.map((i) => [i, render(parts.get(i))]) });
  };
};`;

if (mode === 'frame') local(Array.from({ length: Number(q.get('n')) }, (_, i) => i));
if (mode === 'part') local([Number(q.get('i'))]);
if (mode === 'workers') {
  const code = (await (await fetch('/part.js')).text()).replace(/^export /gm, '') + LOOP;
  const url = URL.createObjectURL(new Blob([code], { type: 'text/javascript' }));
  // Each worker's port goes to the host itself: the host knows which pack version answers, and nothing relays.
  for (let v = 0; v < packs; v++) {
    const channel = new MessageChannel();
    new Worker(url).postMessage(null, [channel.port1]);
    tell({ op: 'port', pack: v }, [channel.port2]);
  }
}
