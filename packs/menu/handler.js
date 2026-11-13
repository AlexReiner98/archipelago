// The menu pack's handler, run in its own sandboxed process by the kernel's pack host. Its actions are what the view
// band does to a kept view (core's lens type): menu.save_view keeps what is up, into the view up or as a new one, and
// menu.drop_view retires a kept view, so it leaves the bar and Home and can be used again from its page. Each reads
// what it changes and answers with the ops; whether the change applies or waits is the rules' to say. A person's Save
// is their word: what it keeps is kept (task e_gkv58kqb).

/** How long a view's name may be: a name is a few words. */
export const TITLE_MOST = 60;

const plain = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const isLens = (x) => Boolean(x) && (x.type === 'lens' || (x.is ?? []).includes('lens'));

/** The settings a kept view holds beyond the layout and style the bar switches: kept through a Save. */
export const settingsOf = (props) => {
  const { shape: _s, lit: _l, style: _k, ...settings } = plain(props?.style) ? props.style : {};
  return settings;
};

/** How a view is drawn, as a Save keeps it: its shape, its lit terms and its layout, not which view it is. */
export const keptStyle = (style) => Object.fromEntries(['shape', 'lit', 'style'].filter((k) => plain(style) && typeof style[k] === 'string' && style[k]).map((k) => [k, style[k]]));

/**
 * The ops that keep what is up: `input` says its name, query (filter, walk, limit, time, sessions), how it is drawn
 * (style) and, when it is saved into one, the view (`id`), read as `kept`. A view a pack ships saved under its own name
 * is the owner's version of it (`preset`), standing in its place.
 */
export function saveView(input, kept) {
  const title = String(input?.title ?? '').trim();
  if (!title) throw new Error('A view needs a name.');
  if (title.length > TITLE_MOST) throw new Error(`A name is a few words: ${TITLE_MOST} characters at most.`);
  if (!plain(input.filter)) throw new Error('A view keeps a query: its filter is missing.');
  if (input.id && !isLens(kept)) throw new Error('That is not a kept view.');
  const props = {
    filter: input.filter,
    walk: plain(input.walk) ? input.walk : { over: [], steps: 0 },
    limit: Number.isInteger(input.limit) ? input.limit : null,
    time: plain(input.time) ? input.time : null,
    sessions: input.sessions === false ? false : null,
    style: { ...settingsOf(kept?.props), ...keptStyle(input.style) },
    ...(typeof input.preset === 'string' && /^[a-z][a-z0-9_]*\.[a-z][a-z0-9_.-]*$/.test(input.preset) && { preset: input.preset }),
  };
  if (kept) return { ops: [{ op: 'update', id: kept.id, status: 'kept', props }], reason: `“${title}” saved from the view band`, answer: { view: kept.id, title } };
  return { ops: [{ op: 'create', ref: 'view', type: 'lens', title, status: 'kept', props }], reason: `“${title}” saved from the view band`, answer: { title } };
}

/** The ops that retire a kept view: it leaves the bar and Home; what is up stays, no longer saved. */
export function dropView(kept) {
  if (!isLens(kept)) throw new Error('That is not a kept view.');
  if (kept.status === 'retired') return { ops: [], reason: 'Already deleted', answer: { view: kept.id } };
  return { ops: [{ op: 'update', id: kept.id, status: 'retired' }], reason: `“${String(kept.title).slice(0, 60)}” deleted from the view band`, answer: { view: kept.id } };
}

export default {
  'menu.save_view': async (input, ctx) => saveView(input, input?.id ? await ctx.read({ get: String(input.id) }) : null),
  'menu.drop_view': async (input, ctx) => dropView(await ctx.read({ get: String(input?.id ?? '') })),
};
