// Code written in the sheet, saved as what changed (task e_pbdxaxdy): the lines that differ between the text as it was
// opened and as it is now, each passage one `edit` (find, with, base), so a one-line fix to a long module is a small op
// and the log holds a small change. The passages are made in the order the server applies them
// (packs/write/kernel/edit.ts), each found exactly once in the text as the ones before it left it, and each carries the
// hash of that text, so a text that moved since it was opened is refused, never written over. Run without a browser in tests.

/** Its lines, each with its line end, so they join back to the text exactly. */
const linesOf = (text) => String(text ?? '').match(/[^\n]*\n|[^\n]+$/g) ?? [];

/** The most cells the middle of two texts is compared in, line by line: past it, the middle is one passage. */
const compared = 4_000_000;

/**
 * Where two texts differ, as runs of lines: each { at, gone, put }, `gone` lines of the old text from line `at`
 * replaced by the lines `put`. Lines the two keep alike are left out; runs are in the old text's order.
 */
export function runsOf(was, now) {
  const a = linesOf(was), b = linesOf(now);
  let head = 0;
  while (head < a.length && head < b.length && a[head] === b[head]) head++;
  let tail = 0;
  while (tail < a.length - head && tail < b.length - head && a[a.length - 1 - tail] === b[b.length - 1 - tail]) tail++;
  const x = a.slice(head, a.length - tail), y = b.slice(head, b.length - tail);
  if (!x.length && !y.length) return [];
  if (x.length * y.length > compared) return [{ at: head, gone: x.length, put: y }];
  // The longest run of lines both keep, by the table of common lengths from the end.
  const n = x.length, m = y.length, w = m + 1;
  const keep = new Uint32Array((n + 1) * w);
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) keep[i * w + j] = x[i] === y[j] ? keep[(i + 1) * w + j + 1] + 1 : Math.max(keep[(i + 1) * w + j], keep[i * w + j + 1]);
  const runs = [];
  let i = 0, j = 0, run = null;
  const close = () => run && (runs.push(run), (run = null));
  while (i < n || j < m) {
    if (i < n && j < m && x[i] === y[j]) (close(), i++, j++);
    else if (j < m && (i === n || keep[i * w + j + 1] >= keep[(i + 1) * w + j])) ((run ??= { at: head + i, gone: 0, put: [] }), run.put.push(y[j++]));
    else ((run ??= { at: head + i, gone: 0, put: [] }), run.gone++, i++);
  }
  close();
  return runs;
}

/** How a text changed, as counts: lines taken out, lines put in, and in how many passages. */
export function changeCount(was, now) {
  const runs = runsOf(was, now);
  return { gone: runs.reduce((s, r) => s + r.gone, 0), put: runs.reduce((s, r) => s + r.put.length, 0), passages: runs.length };
}

/** Whether a passage is in a text once, counting those that overlap: the server replaces the first it finds. */
const once = (text, find) => {
  const i = find ? text.indexOf(find) : -1;
  return i >= 0 && text.indexOf(find, i + 1) < 0;
};

/**
 * The passages that make `now` of `was`, in the order to send them: each { find, with, base }, found exactly once in
 * the text the ones before it left, `base` that text's hash. Grown by the lines around a run until it is found once.
 * Null when there is nothing to find in (the text was empty), so the field is written whole.
 */
export function passagesOf(was, now) {
  if (!String(was ?? '')) return null;
  // From the last run to the first: the lines before each are still as they were opened.
  const runs = runsOf(was, now).reverse();
  let work = linesOf(was);
  const out = [];
  for (const r of runs) {
    let from = r.at, to = r.at + r.gone, before = 0, after = 0;
    const text = work.join('');
    const find = () => work.slice(from - before, to + after).join('');
    // Grown a line at a time, after first, then before, until it is there once.
    while (!once(text, find())) {
      if (to + after < work.length && (after <= before || from - before === 0)) after++;
      else if (from - before > 0) before++;
      else break;
    }
    const passage = { find: find(), with: [...work.slice(from - before, from), ...r.put, ...work.slice(to, to + after)].join(''), base: sha256(text) };
    out.push(passage);
    work = [...work.slice(0, from - before), ...linesOf(passage.with), ...work.slice(to + after)];
  }
  return out;
}

// sha256 of a text's UTF-8 bytes, in hex, as the server hashes a base (packs/write/kernel/edit.ts textHash): a part's
// worker may have no crypto.subtle, so it is worked out here.
const K = Uint32Array.from([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da, 0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);

export function sha256(text) {
  const bytes = new TextEncoder().encode(String(text ?? ''));
  const padded = new Uint8Array((((bytes.length + 8) >> 6) + 1) << 6);
  padded.set(bytes);
  padded[bytes.length] = 0x80;
  const view = new DataView(padded.buffer);
  view.setUint32(padded.length - 8, Math.floor(bytes.length / 0x20000000));
  view.setUint32(padded.length - 4, (bytes.length << 3) >>> 0);
  const h = Uint32Array.from([0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19]);
  const w = new Uint32Array(64);
  const rot = (x, n) => (x >>> n) | (x << (32 - n));
  for (let o = 0; o < padded.length; o += 64) {
    for (let t = 0; t < 16; t++) w[t] = view.getUint32(o + t * 4);
    for (let t = 16; t < 64; t++) w[t] = (w[t - 16] + (rot(w[t - 15], 7) ^ rot(w[t - 15], 18) ^ (w[t - 15] >>> 3)) + w[t - 7] + (rot(w[t - 2], 17) ^ rot(w[t - 2], 19) ^ (w[t - 2] >>> 10))) >>> 0;
    let [a, b, c, d, e, f, g, k] = h;
    for (let t = 0; t < 64; t++) {
      const one = (k + (rot(e, 6) ^ rot(e, 11) ^ rot(e, 25)) + ((e & f) ^ (~e & g)) + K[t] + w[t]) >>> 0;
      const two = ((rot(a, 2) ^ rot(a, 13) ^ rot(a, 22)) + ((a & b) ^ (a & c) ^ (b & c))) >>> 0;
      [k, g, f, e, d, c, b, a] = [g, f, e, (d + one) >>> 0, c, b, a, (one + two) >>> 0];
    }
    [a, b, c, d, e, f, g, k].forEach((v, i) => (h[i] = (h[i] + v) >>> 0));
  }
  return [...h].map((v) => v.toString(16).padStart(8, '0')).join('');
}

/** The language a code field is written in, for the editor's colours: CSS by its field or its module's name, else JavaScript. */
export const langOf = (field, file) => (field?.css || /\.css$/i.test(String(file ?? '')) ? 'css' : 'js');

/** A code field: its text whole, or its modules by name. */
export const modulesOf = (v) => (v && typeof v === 'object' && !Array.isArray(v) && Object.values(v).every((x) => typeof x === 'string') ? v : null);

/**
 * The ops that save the code fields written, as edits of what changed since each was opened (`from`), and the props
 * left to write whole: a field with nothing to find in, a module new or taken out, or one with no text it was opened at.
 */
export function codeOps(id, declared, fields, from, props) {
  const ops = [], whole = {};
  for (const [name, value] of Object.entries(fields)) {
    const was = from?.[name];
    if (!declared?.[name]?.code || was === undefined || JSON.stringify(value) === JSON.stringify(props?.[name] ?? null)) continue;
    const text = typeof value === 'string' && typeof was === 'string';
    const mods = !text && modulesOf(value) && modulesOf(was);
    const names = mods && Object.keys(value);
    if (!text && !(mods && names.length === Object.keys(was).length && names.every((k) => k in was))) {
      whole[name] = value;
      continue;
    }
    const each = text ? [[undefined, was, value]] : names.filter((k) => was[k] !== value[k]).map((k) => [k, was[k], value[k]]);
    const made = each.map(([file, a, b]) => [file, passagesOf(a, b)]);
    if (made.some(([, p]) => !p)) {
      whole[name] = value;
      continue;
    }
    for (const [file, passages] of made) for (const p of passages) ops.push({ op: 'update', id, edit: { field: name, ...(file !== undefined && { file }), find: p.find, with: p.with, base: p.base } });
  }
  return { ops, whole };
}
