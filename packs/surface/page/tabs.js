// The tab in sight, as the page's host reads it (packs/surface/page/live.js says it with its beat): the panes pack's
// part keeps the tabs (packs/panes/parts/index.js) and publishes what the host needs of them on the root, `data-front`,
// `data-front_chat`, `data-front_follows` and `data-lands_in`. Nothing of the tabs is kept here.

/** In a window popped out of the main one, the tab it draws. */
export const poppedTab = window.name.startsWith('pelago-tab:') ? window.name.slice('pelago-tab:'.length) : null;

const published = () => document.documentElement.dataset;

/** The tab in sight: its id, whom it follows, and the chat it is the tab of, if any. */
export const front = () => ({ id: published().front ?? null, follows: published().front_follows ?? 'none', ...(published().front_chat && { chat: published().front_chat }) });

/** The sessions whose next show lands in the tab in sight, as the part works it out. */
export const landsIn = () => (published().lands_in ?? '').split(' ').filter(Boolean);
