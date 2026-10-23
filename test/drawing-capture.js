// Run in the page, in a real browser: draws each case with the shape given and records what a person would meet:
// the markup, every element's computed look, and what hovering, the lit switch and the key do. Two drawings of the
// same answer that record the same are the same picture.

/* global window, document, getComputedStyle, MouseEvent */
window.captureDrawings = async (shape, cases) => {
  const { dress } = await import('/lens-base.js');
  const PROPS = ['display', 'visibility', 'position', 'opacity', 'fill', 'fill-opacity', 'stroke', 'stroke-width', 'stroke-dasharray', 'stroke-opacity', 'color', 'background-color', 'border-top-color', 'border-top-width', 'font-family', 'font-size', 'font-weight', 'text-anchor', 'dominant-baseline', 'cursor', 'width', 'height', 'top', 'left', 'flex-direction', 'gap', 'padding-top', 'padding-left', 'white-space', 'pointer-events'];
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  // Settled: nothing in the host has changed for a while.
  const settle = async (host) => {
    let last = '';
    for (let n = 0; n < 60; n++) {
      await wait(25);
      const now = host.innerHTML;
      if (now === last && now && !host.querySelector(':scope > .empty')) return;
      last = now;
    }
  };
  const indexOf = (host, els) => { const all = [...host.querySelectorAll('*')]; return els.map((el) => all.indexOf(el)); };
  const out = {};
  for (const c of cases) {
    const host = document.createElement('div');
    host.className = 'lens-view';
    host.style.width = `${c.width}px`;
    document.body.append(host);
    dress(host, c.style);
    const t0 = performance.now();
    const style = { ...c.style };
    // As the lens view keeps a choice: in the style the shape was given.
    shape(host, c.answer, style, (change) => Object.assign(style, change));
    await settle(host);
    const ms = performance.now() - t0;
    const els = [...host.querySelectorAll('*')];
    // Each element's look, as an index into the looks the case has: most elements share one.
    const looks = [];
    const record = { html: host.innerHTML, styles: els.map((el) => { const cs = getComputedStyle(el); const look = PROPS.map((p) => cs.getPropertyValue(p)).join('|'); if (!looks.includes(look)) looks.push(look); return looks.indexOf(look); }), looks };
    // Hovering a part lights its wires; leaving puts them back.
    record.hover = [];
    for (const part of [...host.querySelectorAll('.ar-part, .lf-step')].slice(0, 4)) {
      part.dispatchEvent(new MouseEvent('mouseenter'));
      await settle(host);
      record.hover.push(indexOf(host, [...host.querySelectorAll('.lit')]));
      part.dispatchEvent(new MouseEvent('mouseleave'));
      await settle(host);
    }
    const hit = host.querySelector('.ar-hit');
    if (hit) {
      hit.dispatchEvent(new MouseEvent('mouseenter'));
      await settle(host);
      record.hover.push(indexOf(host, [...host.querySelectorAll('.lit')]));
      hit.dispatchEvent(new MouseEvent('mouseleave'));
      await settle(host);
    }
    record.after_hover = host.innerHTML === record.html;
    // The lit switch dims what is not lit.
    record.dim = [];
    for (const label of ['Needs you', 'Blocked', 'All']) {
      const button = [...host.querySelectorAll('.switch button')].find((b) => b.textContent === label);
      if (!button) continue;
      button.click();
      await settle(host);
      record.dim.push([label, indexOf(host, [...host.querySelectorAll('.dim')])]);
    }
    // The key opens and closes.
    const key = [...host.querySelectorAll('button')].find((b) => b.textContent === 'Key');
    if (key) {
      key.click();
      await settle(host);
      record.key = [host.querySelector('.lf-legend')?.hidden ?? null, key.className];
      key.click();
      await settle(host);
    }
    record.ms = Math.round(ms);
    out[c.name] = record;
    host.remove();
  }
  return out;
};
