// One bench part, the same code in every way of walling it: its state, what it draws (marks), and the renderer the
// host keeps. Only where each runs differs between the ways (scripts/walls-bench.ts).

export const ROWS = 8;

export const state = (i, packs) => ({ id: i, pack: i % packs, title: `Part ${i}`, value: '', zoom: 1 });

/** What a part draws: marks, plain data a host can check and render. */
export function render(s) {
  const rows = [];
  for (let r = 0; r < ROWS; r++) rows.push({ k: 'text', t: `${s.title} · row ${r} · ${s.value.length} chars · zoom ${s.zoom.toFixed(2)}` });
  return { k: 'box', c: [{ k: 'text', t: `${s.title}, pack v${s.pack}` }, ...rows, { k: 'input', v: s.value }, { k: 'button', t: 'Save' }] };
}

/** The renderer: marks into DOM under el, an input's edits handed to onInput. */
export function mount(el, m, onInput) {
  const make = (n) => {
    if (n.k === 'box') {
      const d = document.createElement('div');
      d.className = 'box';
      for (const c of n.c) d.append(make(c));
      return d;
    }
    if (n.k === 'text') {
      const s = document.createElement('div');
      s.textContent = n.t;
      return s;
    }
    if (n.k === 'input') {
      const i = document.createElement('input');
      i.value = n.v;
      i.oninput = () => onInput(i.value);
      return i;
    }
    const b = document.createElement('button');
    b.textContent = n.t;
    return b;
  };
  el.replaceChildren(make(m));
  void el.offsetHeight;
}
