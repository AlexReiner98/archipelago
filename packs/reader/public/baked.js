// A baked home view's page (packs/reader/baked-site.js): opened at a stop's address (/<id>), it starts at that stop;
// as the walk reaches each stop the address becomes that stop's, so a link copied or a reload lands there; and each
// stop reached is told once to /go/seen/<id>, with the tag the reader came by, to be counted. Nothing else is sent.

/** The stop whose middle crosses the middle of the screen, watched for each stop in `root`. */
export function arrivals(root, win, arrive) {
  const stops = [...root.querySelectorAll('.rails-stop')];
  const sight = new win.IntersectionObserver((seen) => {
    for (const e of seen) if (e.isIntersecting) arrive(e.target.dataset.item);
  }, { rootMargin: '-50% 0px -50% 0px' });
  for (const li of stops) sight.observe(li);
  return () => sight.disconnect();
}

/** The address of stop `id`, keeping the page's query (the tag the reader came by). */
export const addressOf = (id, search = '') => `/${id ?? ''}${search}`;

if (typeof document !== 'undefined') {
  const root = document.querySelector('.rails');
  if (root) {
    const told = new Set();
    // Opened at a stop, start there, once rails.js has laid the walk out.
    const start = root.dataset.start && document.getElementById(`s-${root.dataset.start}`);
    if (start && !location.hash) requestAnimationFrame(() => requestAnimationFrame(() => start.scrollIntoView({ block: 'center' })));
    arrivals(root, window, (id) => {
      if (!id) return;
      if (`/${id}` !== location.pathname) history.replaceState(null, '', addressOf(id, location.search));
      if (told.has(id)) return;
      told.add(id);
      fetch(`/go/seen/${id}${root.dataset.ref ? `?ref=${encodeURIComponent(root.dataset.ref)}` : ''}`, { keepalive: true, credentials: 'omit' }).catch(() => null);
    });
  }
}
