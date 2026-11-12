// The host page of the bench, in one of five modes: none (today: every part in the page), frame (one walled frame
// holding every part), frames (a walled frame per part), workers (a worker per pack version in one walled frame, its
// marks rendered here), blank (nothing, for memory). It answers window.bench, which scripts/walls-bench.ts drives.

import { mount, render, state } from '/part.js';

const q = new URLSearchParams(location.search);
const mode = q.get('mode');
const n = Number(q.get('n'));
const packs = Number(q.get('packs'));
const stage = document.getElementById('stage');
const bench = (window.bench = { mode, drawnAt: null });
const ids = Array.from({ length: n }, (_, i) => i);

let seq = 0;
const waiting = new Map();
/** A promise for the next `count` answers numbered s, with what they said. */
const answers = (s, count = 1) => new Promise((resolve) => waiting.set(s, { count, got: [], resolve }));
const answered = (s, said) => {
  const w = waiting.get(s);
  if (!w) return;
  w.got.push(said);
  if (w.got.length === w.count) (waiting.delete(s), w.resolve(w.got));
};

const frame = (src, cls) => {
  const f = document.createElement('iframe');
  f.setAttribute('sandbox', 'allow-scripts');
  f.className = cls;
  f.src = src;
  stage.append(f);
  return f;
};

/** Pan: the stage moved each frame for `frames` frames, the gaps between them. */
bench.pan = (frames) =>
  new Promise((resolve) => {
    const gaps = [];
    let last = performance.now(), k = 0;
    const step = (t) => {
      gaps.push(t - last);
      last = t;
      stage.style.transform = `translate(${-k * 3}px, ${-k * 2}px)`;
      if (++k < frames) requestAnimationFrame(step);
      else resolve(gaps.slice(1));
    };
    requestAnimationFrame(step);
  });

if (mode === 'blank') bench.drawnAt = performance.now();

if (mode === 'none') {
  const parts = ids.map((i) => {
    const el = document.createElement('div');
    el.className = 'slot';
    stage.append(el);
    const s = state(i, packs);
    const draw = () => mount(el, render(s), (v) => ((s.value = v), draw()));
    draw();
    return { s, el, draw };
  });
  bench.drawnAt = performance.now();
  bench.key = async (i) => {
    const input = parts[i].el.querySelector('input');
    const t0 = performance.now();
    input.value += 'a';
    input.dispatchEvent(new Event('input'));
    return performance.now() - t0;
  };
  bench.zoom = async (z) => {
    const t0 = performance.now();
    for (const p of parts) ((p.s.zoom = z), p.draw());
    return performance.now() - t0;
  };
}

if (mode === 'frame' || mode === 'frames') {
  const frames = mode === 'frame' ? [frame(`/frame.html?mode=frame&n=${n}&packs=${packs}`, 'all')] : ids.map((i) => frame(`/frame.html?mode=part&i=${i}&packs=${packs}`, 'one'));
  let drawn = 0;
  addEventListener('message', (e) => {
    const d = e.data;
    if (d.op === 'drawn' && (drawn += d.ids.length) === n) bench.drawnAt = performance.now();
    if (d.op === 'keyed' || d.op === 'zoomed') answered(d.seq, d.ms);
  });
  // A keystroke lands inside the frame that holds the part, and is timed there.
  bench.key = async (i) => {
    const s = ++seq, f = mode === 'frame' ? frames[0] : frames[i];
    f.contentWindow.postMessage({ op: 'key', id: i, seq: s }, '*');
    return (await answers(s))[0];
  };
  // One frame zooms inside itself, timed there; a frame per part is told by the canvas, and timed here.
  bench.zoom = async (z) => {
    const s = ++seq, t0 = performance.now();
    for (const f of frames) f.contentWindow.postMessage({ op: 'zoom', zoom: z, seq: s }, '*');
    const said = await answers(s, frames.length);
    return mode === 'frame' ? said[0] : performance.now() - t0;
  };
}

if (mode === 'workers') {
  frame(`/frame.html?mode=workers&packs=${packs}`, 'hidden');
  const slots = ids.map(() => {
    const el = document.createElement('div');
    el.className = 'slot';
    stage.append(el);
    return el;
  });
  const ports = [];
  let drawn = 0;
  const send = (port, m) => port.postMessage({ ...m, seq: m.seq ?? ++seq });
  addEventListener('message', (e) => {
    if (e.data.op !== 'port') return;
    const pack = e.data.pack, port = e.ports[0];
    ports[pack] = port;
    // The host knows the sender by its port: an edit is sent to, and answered by, its own pack version alone.
    port.onmessage = ({ data }) => {
      for (const [i, m] of data.marks) mount(slots[i], m, (v) => send(ports[i % packs], { op: 'input', id: i, value: v }));
      if (data.seq === 0 && (drawn += data.marks.length) === n) bench.drawnAt = performance.now();
      answered(data.seq, true);
    };
    send(port, { op: 'init', ids: ids.filter((i) => i % packs === pack), packs, seq: 0 });
  });
  bench.key = async (i) => {
    const input = slots[i].querySelector('input');
    const t0 = performance.now();
    const s = seq + 1;
    const done = answers(s);
    input.value += 'a';
    input.dispatchEvent(new Event('input'));
    await done;
    return performance.now() - t0;
  };
  bench.zoom = async (z) => {
    const s = ++seq, t0 = performance.now();
    const done = answers(s, ports.length);
    for (const port of ports) send(port, { op: 'zoom', zoom: z, seq: s });
    await done;
    return performance.now() - t0;
  };
}
