// Islands drawn by looks of their own (feature e_6efhubbz; decisions e_3c3wr7jv, e_r4emvndv): an answer's island names
// the layout that draws it (`look`, core's link draws; packs/loader/kernel/island-look.ts), and the drawing that draws islands imports
// each island's look from its module `island-looks.js` (packs/canvas/layouts/map/island-looks.js, none by default). Here
// that module is written again for the islands this answer holds, and each look's files are put beside the drawing's
// under names of their own, so a look imports only its own files. The code stays in the drawing's worker, behind the
// same walls, and the set is named by its drawing's hash and its looks, so a picture is kept by what drew it. Only where the page has
// the drawing's modules in hand; elsewhere (a published page) islands are drawn as any other.

import { api } from './base.js';

/** The drawing's module that names each island's look. */
const LOOKS = 'island-looks.js';

/** Each look's files as fetched, by its id and when it last changed. */
const fetched = new Map();

/** The islands of an answer that a layout draws, in a steady order. */
const lookedOf = (answer) => (answer?.islands ?? []).filter((i) => i.look?.kind === 'layout' && i.look.coded !== false && typeof i.look.id === 'string').sort((a, b) => (a.id < b.id ? -1 : 1));

/**
 * The drawing to draw `answer` with: `drawing` itself, or, where islands have looks and the drawing takes them (it has
 * the module), the same with a hash of its own and what it needs to write its modules (`looks`). `have(hash)` is the
 * modules the page keeps for a hash.
 */
export function withLooks(drawing, answer, have, plain = false) {
  const looked = plain ? [] : lookedOf(answer), base = drawing?.modules ?? have(drawing?.hash);
  if (!looked.length || !base || typeof base[LOOKS] !== 'string') return drawing;
  const said = looked.map((i) => `${i.id}${i.look.id}${String(i.look.at ?? '').replace(/\D/g, '')}`).join('');
  const { modules: _m, ...rest } = drawing;
  return { ...rest, hash: `${drawing.hash}-${said}`, looks: { base, looked } };
}

/** A look's files: one text is its index.js. */
const filesOf = (code) => (typeof code === 'string' ? { 'index.js': code } : code && typeof code === 'object' ? Object.fromEntries(Object.entries(code).filter(([, v]) => typeof v === 'string')) : {});

/** A look's code and its settings (what a look that paints reads as its style), fetched once for each time it changed. */
const codeOf = (look) => {
  const key = `${look.id}@${look.at ?? ''}`;
  if (!fetched.has(key)) fetched.set(key, api('get', { id: look.id }).then((r) => ({ files: filesOf(r?.entity?.props?.code), settings: r?.entity?.props?.settings ?? {} })).catch(() => ({ files: {}, settings: {} })));
  return fetched.get(key);
};

/** The modules of a drawing `withLooks` answered: the drawing's, each look's files under its own names, and the module naming them. */
export async function looksModules({ base, looked }) {
  const out = { ...base }, lines = [], entries = [];
  const codes = await Promise.all(looked.map((i) => codeOf(i.look)));
  codes.forEach(({ files, settings }, k) => {
    if (typeof files['index.js'] !== 'string') return;
    const own = (name) => `look.${k}.${name}`;
    for (const [name, text] of Object.entries(files)) out[own(name)] = text.replace(/(\bfrom\s*|\bimport\s*\(?\s*)(['"])\.\/([\w.-]+\.js)\2/g, (_, before, q, dep) => `${before}${q}./${own(dep)}${q}`);
    lines.push(`import * as l${k} from './${own('index.js')}';`);
    entries.push(`[${JSON.stringify(looked[k].id)}, { ...l${k}, settings: ${JSON.stringify(settings && typeof settings === 'object' ? settings : {})} }]`);
  });
  out[LOOKS] = `${lines.join('\n')}\nexport const looks = new Map([${entries.join(', ')}]);\n`;
  return out;
}
