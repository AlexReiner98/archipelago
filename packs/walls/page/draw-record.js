// A canvas that keeps what is painted on it as shapes, for a drawing baked once rather than run on every visit (task
// e_kcbzmp2g). A layout's code paints on it as on any 2D canvas; each fill, stroke and text comes out as numbers, a
// colour and a few words, never as markup, and the page that publishes it writes the picture from those alone. Not a
// module: draw.js hands this function to its worker as text, as it does `inside` (packs/surface/kernel/ui-files.ts
// writes this file in front of draw.js).
'use strict';

/**
 * Canvases that record. `real` is a 2D context of a real canvas, asked only to measure text and to read a colour as the
 * browser does. Answers the canvas class to paint on (a stand-in for OffscreenCanvas, so pictures painted aside and
 * drawn in, as Ridges paints each look, are kept as their shapes) and `shapes(canvas)`, what one holds.
 */
function record(real) {
  // What a canvas starts with, read from the real one before anything is asked of it.
  const start = { fill: real.fillStyle, font: real.font, spacing: real.letterSpacing ?? '' };
  const r2 = (n) => Math.round(n * 100) / 100;
  const ident = () => [1, 0, 0, 1, 0, 0];
  // m · n: n applied first, then m (both [a, b, c, d, e, f] as a canvas's transform).
  const times = (m, n) => [m[0] * n[0] + m[2] * n[1], m[1] * n[0] + m[3] * n[1], m[0] * n[2] + m[2] * n[3], m[1] * n[2] + m[3] * n[3], m[0] * n[4] + m[2] * n[5] + m[4], m[1] * n[4] + m[3] * n[5] + m[5]];
  const at = (m, x, y) => [r2(m[0] * x + m[2] * y + m[4]), r2(m[1] * x + m[3] * y + m[5])];
  const stretch = (m) => Math.sqrt(Math.abs(m[0] * m[3] - m[1] * m[2]));
  // A path is its steps, each a letter and points already where they land: M, L, C (three points), Q (two), Z.
  const moved = (m, path) => path.map(([k, ...p]) => [k, ...p.map(([x, y]) => at(m, x, y))]);
  const colourOf = (said, fallback) => {
    if (typeof said !== 'string') return said?.stops?.[0] ?? fallback;
    // A colour the canvas does not read leaves what was set, as a canvas does.
    real.fillStyle = fallback;
    real.fillStyle = said;
    return real.fillStyle;
  };
  /** Most shapes one picture may hold: past it the code is told, rather than the page made too heavy to send. */
  const most = 200000;

  class Context {
    constructor(canvas) {
      this.canvas = canvas;
      this.reset();
    }
    reset() {
      this.state = { m: ident(), fill: start.fill, stroke: start.fill, width: 1, join: 'miter', cap: 'butt', alpha: 1, font: start.font, align: 'start', baseline: 'alphabetic', spacing: start.spacing, clip: 0 };
      this.stack = [];
      this.path = [];
    }
    get fillStyle() { return this.state.fill; }
    set fillStyle(v) { this.state.fill = colourOf(v, this.state.fill); }
    get strokeStyle() { return this.state.stroke; }
    set strokeStyle(v) { this.state.stroke = colourOf(v, this.state.stroke); }
    get lineWidth() { return this.state.width; }
    set lineWidth(v) { if (Number.isFinite(+v) && +v > 0) this.state.width = +v; }
    get lineJoin() { return this.state.join; }
    set lineJoin(v) { if (['miter', 'round', 'bevel'].includes(v)) this.state.join = v; }
    get lineCap() { return this.state.cap; }
    set lineCap(v) { if (['butt', 'round', 'square'].includes(v)) this.state.cap = v; }
    get globalAlpha() { return this.state.alpha; }
    set globalAlpha(v) { if (Number.isFinite(+v)) this.state.alpha = Math.max(0, Math.min(1, +v)); }
    get font() { return this.state.font; }
    set font(v) { this.state.font = String(v); }
    get textAlign() { return this.state.align; }
    set textAlign(v) { if (['start', 'end', 'left', 'right', 'center'].includes(v)) this.state.align = v; }
    get textBaseline() { return this.state.baseline; }
    set textBaseline(v) { if (['top', 'hanging', 'middle', 'alphabetic', 'ideographic', 'bottom'].includes(v)) this.state.baseline = v; }
    get letterSpacing() { return this.state.spacing; }
    set letterSpacing(v) { this.state.spacing = String(v); }
    save() { this.stack.push({ ...this.state, m: [...this.state.m] }); }
    restore() { if (this.stack.length) this.state = this.stack.pop(); }
    setTransform(a, b, c, d, e, f) { this.state.m = typeof a === 'object' ? [a.a, a.b, a.c, a.d, a.e, a.f] : [a, b, c, d, e, f]; }
    resetTransform() { this.state.m = ident(); }
    transform(a, b, c, d, e, f) { this.state.m = times(this.state.m, [a, b, c, d, e, f]); }
    translate(x, y) { this.transform(1, 0, 0, 1, x, y); }
    scale(x, y) { this.transform(x, 0, 0, y, 0, 0); }
    rotate(t) { this.transform(Math.cos(t), Math.sin(t), -Math.sin(t), Math.cos(t), 0, 0); }
    beginPath() { this.path = []; }
    moveTo(x, y) { this.path.push(['M', at(this.state.m, x, y)]); }
    lineTo(x, y) { this.path.push([this.path.length ? 'L' : 'M', at(this.state.m, x, y)]); }
    bezierCurveTo(a, b, c, d, x, y) { const m = this.state.m; this.path.push(['C', at(m, a, b), at(m, c, d), at(m, x, y)]); }
    quadraticCurveTo(a, b, x, y) { const m = this.state.m; this.path.push(['Q', at(m, a, b), at(m, x, y)]); }
    closePath() { if (this.path.length) this.path.push(['Z']); }
    rect(x, y, w, h) { this.moveTo(x, y); this.lineTo(x + w, y); this.lineTo(x + w, y + h); this.lineTo(x, y + h); this.closePath(); }
    roundRect(x, y, w, h) { this.rect(x, y, w, h); }
    // An arc as short straight steps: fine enough at any size a page shows it.
    arc(cx, cy, rad, a0, a1, ccw = false) { this.ellipse(cx, cy, rad, rad, 0, a0, a1, ccw); }
    ellipse(cx, cy, rx, ry, turn, a0, a1, ccw = false) {
      let sweep = a1 - a0;
      if (!ccw && sweep < 0) sweep = (sweep % (2 * Math.PI)) + 2 * Math.PI;
      if (ccw && sweep > 0) sweep = (sweep % (2 * Math.PI)) - 2 * Math.PI;
      if (Math.abs(a1 - a0) >= 2 * Math.PI) sweep = ccw ? -2 * Math.PI : 2 * Math.PI;
      const n = Math.max(8, Math.ceil((Math.abs(sweep) / (2 * Math.PI)) * 64));
      for (let i = 0; i <= n; i++) {
        const t = a0 + (sweep * i) / n, x = rx * Math.cos(t), y = ry * Math.sin(t);
        this.lineTo(cx + x * Math.cos(turn) - y * Math.sin(turn), cy + x * Math.sin(turn) + y * Math.cos(turn));
      }
    }
    keep(shape) {
      const all = this.canvas.kept;
      if (all.length >= most) throw new Error(`A baked drawing holds at most ${most} outlines`);
      all.push(shape);
    }
    fill() { if (this.path.length) this.keep({ k: 'fill', d: this.path.slice(), c: this.state.fill, a: this.state.alpha, clip: this.state.clip }); }
    stroke() { if (this.path.length) this.keep({ k: 'stroke', d: this.path.slice(), c: this.state.stroke, w: r2(this.state.width * stretch(this.state.m)), j: this.state.join, cap: this.state.cap, a: this.state.alpha, clip: this.state.clip }); }
    clip() {
      const clips = this.canvas.clips;
      clips.push({ d: this.path.slice(), up: this.state.clip });
      this.state.clip = clips.length;
    }
    fillRect(x, y, w, h) { const was = this.path; this.path = []; this.rect(x, y, w, h); this.fill(); this.path = was; }
    strokeRect(x, y, w, h) { const was = this.path; this.path = []; this.rect(x, y, w, h); this.stroke(); this.path = was; }
    // Cleared whole, the picture starts again; a part cleared is not a shape, and a picture on a page has nothing under it to show.
    clearRect(x, y, w, h) {
      const [x0, y0] = at(this.state.m, x, y), [x1, y1] = at(this.state.m, x + w, y + h);
      if (Math.min(x0, x1) <= 0 && Math.min(y0, y1) <= 0 && Math.max(x0, x1) >= this.canvas.width && Math.max(y0, y1) >= this.canvas.height) ((this.canvas.kept.length = 0), (this.canvas.clips.length = 0), (this.state.clip = 0));
    }
    fillText(text, x, y) { this.keep({ k: 'text', s: String(text).slice(0, 500), m: times(this.state.m, [1, 0, 0, 1, x, y]).map(r2), font: this.state.font, align: this.state.align, base: this.state.baseline, sp: this.state.spacing, c: this.state.fill, a: this.state.alpha, clip: this.state.clip }); }
    measureText(text) {
      real.font = this.state.font;
      if ('letterSpacing' in real) real.letterSpacing = this.state.spacing;
      return real.measureText(String(text));
    }
    /** Another recording drawn in: its shapes, moved to where they land here. A picture of pixels cannot be baked. */
    drawImage(image, ...at4) {
      if (!(image instanceof Canvas)) throw new Error('A baked drawing is outlines: it cannot draw an image in');
      const [sx, sy, sw, sh, dx, dy, dw, dh] = at4.length === 8 ? at4 : at4.length === 4 ? [0, 0, image.width, image.height, ...at4] : [0, 0, image.width, image.height, at4[0], at4[1], image.width, image.height];
      const m = times(this.state.m, [dw / sw, 0, 0, dh / sh, dx - (sx * dw) / sw, dy - (sy * dh) / sh]);
      const base = this.canvas.clips.length;
      for (const c of image.clips) this.canvas.clips.push({ d: moved(m, c.d), up: c.up ? c.up + base : this.state.clip });
      for (const s of image.kept) {
        const clip = s.clip ? s.clip + base : this.state.clip, a = r2(s.a * this.state.alpha);
        if (s.k === 'text') this.keep({ ...s, m: times(m, s.m).map(r2), a, clip });
        else this.keep({ ...s, d: moved(m, s.d), ...(s.k === 'stroke' && { w: r2(s.w * stretch(m)) }), a, clip });
      }
    }
    createLinearGradient() { return gradient(); }
    createRadialGradient() { return gradient(); }
    createPattern() { throw new Error('A baked drawing is outlines: it cannot paint with a pattern'); }
    getImageData() { throw new Error('A baked drawing is outlines: it has no pixels to read'); }
    putImageData() { throw new Error('A baked drawing is outlines: it cannot put pixels'); }
    setLineDash() {}
    getLineDash() { return []; }
    isPointInPath() { return false; }
  }
  // A gradient is baked as its first colour: a picture of shapes in flat colours.
  const gradient = () => ({ stops: [], addColorStop(_at, colour) { this.stops.push(colourOf(colour, start.fill)); } });

  class Canvas {
    constructor(width = 300, height = 150) {
      this.kept = [];
      this.clips = [];
      this.w = width;
      this.h = height;
    }
    // A canvas sized again starts empty, as a real one does.
    get width() { return this.w; }
    set width(v) { ((this.w = +v), (this.kept.length = 0), (this.clips.length = 0), this.context?.reset()); }
    get height() { return this.h; }
    set height(v) { ((this.h = +v), (this.kept.length = 0), (this.clips.length = 0), this.context?.reset()); }
    getContext(kind) {
      if (kind !== '2d') throw new Error('A baked drawing is painted on a 2D canvas');
      return (this.context ??= new Context(this));
    }
    transferToImageBitmap() { throw new Error('A baked drawing is outlines: it has no pixels to hand on'); }
    convertToBlob() { return Promise.reject(new Error('A baked drawing is outlines: it has no pixels to hand on')); }
  }

  /** What a canvas holds: its size, its clips (each inside the one before it, `up`, 0 for none) and its shapes, in order. */
  const shapes = (canvas) => ({ width: canvas.width, height: canvas.height, clips: canvas.clips.map((c) => ({ ...c })), shapes: canvas.kept.map((s) => ({ ...s })) });
  return { Canvas, shapes };
}
