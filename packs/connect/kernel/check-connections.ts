// Whether each connection (an external tool the map names, core's `connection`) is reachable: the connect pack's, since
// it calls out (docs/kernel-packs.md, "The root packs": checkConnections to the connect pack). It pings each one's URL
// through its context, whose reach names the connections' own URLs (reach.hosts, `items`), and hands what it saw to
// the write root (root.observe, the owner, 12 Nov 2026, e_gc8stacv), which keeps it as it kept it before: an
// observation by whoever asked for the check, and the status with a line in the activity when it changed.
// It fills the surface's slot surface.act as check_connections (its manifest's hooks).

import type { KernelContext } from '#pelago/kernel';

interface Row { id: string; title: string; status: string | null; is_open: boolean; props?: Record<string, unknown> }
type Page = { rows: Row[]; next?: string };

/** Every open connection, a page at a time. */
async function connections(ctx: KernelContext): Promise<Row[]> {
  const out: Row[] = [];
  let after: string | undefined;
  do {
    const page = (await ctx.reads({ items: { type: 'connection' }, fields: ['url'], page: after === undefined ? {} : { after } })) as Page;
    out.push(...page.rows.filter((r) => r.is_open));
    after = page.next;
  } while (after !== undefined);
  return out;
}

/** Ping every open connection's URL and record whether it is reachable, as `by` (who asked for the check, kind:name). */
export async function checkConnections(ctx: KernelContext, by: string) {
  const out = [];
  for (const conn of await connections(ctx)) {
    const url = conn.props?.url as string | undefined;
    if (!url) continue;
    // Any HTTP answer, even an error status, means something is listening; asked through the walls (src/outbound.ts).
    const reachable = await Promise.resolve().then(() => ctx.fetch(url, { signal: AbortSignal.timeout(2000) })).then(() => true, () => false);
    const status = reachable ? 'available' : 'unavailable';
    await ctx.call('root.observe', { id: conn.id, status, by });
    out.push({ id: conn.id, title: conn.title, url, status });
  }
  return out;
}

/** The surface's check_connections action (surface.act): who asked is the caller the surface names. */
export const check_connections = (ctx: KernelContext, _input: unknown, caller: { name: string }) => checkConnections(ctx, caller.name);
