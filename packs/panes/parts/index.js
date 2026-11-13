// The panes pack's one part, panes.panes (task e_d5ewsvgf, decision e_bn76z5fu): the strip of tabs (slot `tabs`) and
// the panes of the tab in sight (slot `panes`), decided from one model (./model.js) and drawn by the runtime with the
// pane marks (packs/walls/page/part-pane.js). Mounted once in each slot, it keeps one model for both: each mount is
// told which slot it fills (`input.slot`), and a change redraws every mount. The model is kept in the person's browser
// (tools.keep) and handed back as `kept`; nothing of it is on the map.
//
// What waits on the runtime (each a task under e_5fndpcsp): a popstate step and a `go` with no gesture (e_ucm3tppm),
// keep across popped-out windows and the host's events, a show landing among others (e_8c6rgqb8). Until they land the
// host modules in packs/panes/page/ draw the live page.

import * as M from './model.js';
import { strip } from './strip.js';

const KEEP = 'tabs';
let n = 0;
const newId = (prefix) => `${prefix}${Date.now().toString(36)}${(++n).toString(36)}`;

/** The one model, shared by every mount of this part in this worker. */
let m = null;
const mounts = new Set();

/** The model kept, or a fresh one on the address the page opened on. */
function modelOf(input) {
  const kept = input?.kept?.[KEEP];
  const list = Array.isArray(kept?.list) ? kept.list.filter(M.sound) : [];
  if (list.length) return M.model(list, kept.front);
  const at = M.atOf(input?.address?.hash ?? '#/') ?? 'v';
  return M.model([M.freshTab(newId, at)]);
}

/** The panes of the tab in sight, as marks: each its canvas at its address, its strip its name and its own two buttons. */
function panesMarks(t) {
  const focus = M.focusOf(t);
  const pane = (id) => {
    const p = t.panes[id];
    const share = t.sizes[t.groups.indexOf(id)];
    const who = p.slot ?? '';
    return ['pane', { key: `pane:${id}`, at: p.at, share, drag: 'pane', ...(p.ring && { ring: true }), tip: 'Drag its name to dock it elsewhere' },
      ['text', { ...(id === focus && { bold: true }) }, String(p.name ?? 'Canvas').slice(0, 120)],
      ...(who ? [['text', { look: 'mark' }, String(who).slice(0, 40)]] : []),
      ['button', { key: `totab:${id}`, look: 'quiet', tip: 'Move this pane to a new tab' }, '⧉'],
      ...(t.groups.length > 1 ? [['button', { key: `close:${id}`, look: 'quiet', tip: 'Close this pane' }, '×']] : []),
    ];
  };
  return ['panes', { key: 'panes', dir: t.dir ?? 'row' }, ...t.groups.map(pane)];
}

function marksFor(slot) {
  return slot === 'panes' ? panesMarks(M.frontOf(m)) : strip(m);
}

/** Keep the model and redraw every mount: the strip and the panes read the same tabs. */
function changed(tools) {
  tools.keep({ list: m.list, front: m.front }, KEEP);
  tools.state?.('front', m.front);
  for (const mount of mounts) mount.tools.marks(marksFor(mount.slot));
}

/** What a press, a drop or a pane's word does to the model; true when it changed. */
export function act(event) {
  const { key = '', name, value } = event ?? {};
  const [what, a, b] = String(key).split(':');
  const t = M.frontOf(m);
  if (name === 'press' || name === 'close') {
    if (what === 'new') return Boolean(M.openTab(m, newId, M.BLANK));
    if (what === 'front') return M.toFront(m, a);
    if (what === 'tab' && name === 'close') return M.closeTab(m, a);
    if (what === 'close' && a?.startsWith('t')) return M.closeTab(m, a);
    if (what === 'close') return M.closePane(t, a);
    if (what === 'totab') return Boolean(M.paneToTab(m, newId, a));
    if (what === 'follow') return (Object.assign(M.tabOf(m, a) ?? {}, { follows: b }), true);
    if (what === 'keep') return (M.keepTab(M.tabOf(m, a)), true);
    if (what === 'merge') return (M.joinTab(m, M.tabOf(m, a), M.tabOf(m, b)), true);
    return false;
  }
  if (name === 'share' && what === 'panes') return Number.isInteger(value?.index) && value.index + 1 < t.sizes.length && (M.share(t, value.index, Number(value.at)), true);
  if (name === 'focus' && what === 'pane') return t.focus !== a && ((t.focus = a), true);
  if (name === 'named' && what === 'pane') return t.panes[a] && t.panes[a].name !== value && ((t.panes[a].name = String(value ?? '').slice(0, 120)), true);
  if ((name === 'open' || name === 'go') && what === 'pane') return M.goPane(t, a, M.asPane(String(value?.at ?? value ?? '')));
  if (name === 'drop') {
    const [onto, target] = String(value?.onto ?? '').split(':');
    if (what === 'pane' && value?.zone === 'tabs') return onto === 'tab' ? (M.joinTab(m, t, M.tabOf(m, target), [a]), true) : Boolean(M.paneToTab(m, newId, a));
    if (what === 'pane' && onto === 'pane') return M.dropPane(t, a, target, value.zone);
    if (what === 'tab' && value?.zone === 'tabs' && onto === 'tab' && target !== a) return (M.joinTab(m, M.tabOf(m, a), M.tabOf(m, target)), true);
  }
  return false;
}

/** The address the page moved to: the pane in focus draws it, when it draws a canvas. */
function moved(address) {
  const at = M.atOf(address?.hash ?? '');
  if (!at) return false;
  const t = M.frontOf(m);
  return M.goPane(t, M.focusOf(t), at, false);
}

export default function panes(input, tools) {
  m ??= modelOf(input);
  const mount = { slot: (input?.slot ?? input?.piece?.slot) === 'panes' ? 'panes' : 'tabs', tools };
  mounts.add(mount);
  return {
    marks: marksFor(mount.slot),
    update(next) {
      if (moved(next?.address)) changed(tools);
      return marksFor(mount.slot);
    },
    on(event) {
      if (!act(event)) return undefined;
      changed(tools);
      return marksFor(mount.slot);
    },
    end() {
      mounts.delete(mount);
    },
  };
}

/** For tests: start again with this model. */
export const reset = (list = [], front = null) => ((m = list.length ? M.model(list, front) : null), mounts.clear());
