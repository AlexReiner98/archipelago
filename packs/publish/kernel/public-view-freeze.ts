// What a public view would hold, and where an item's public view stands: the publish pack's half of public views
// (decision e_nwdn7ce6; docs/kernel-packs.md, "Where each module goes"). Making a view public and taking it down are
// ./public-view.ts. A document is frozen as publishing freezes it (./published-freeze.ts), a view or any other item as
// a page of one section, itself, drawn as a document's view is (its picture's answer kept with nothing private in it,
// ./published-pictures.ts). What is private is left out, and the person is told what goes out before it does
// (`sharePlan`). Only a person shares; an agent asks (share_ask, ./share-tools.ts).

import type { KernelContext } from '#pelago/kernel';
import { isKept, itemOf, itemsOf, publishable, sectionIds, shownOf } from './map.ts';
import { publicPath } from './published-data.ts';
import { keptPicture, picturesOf } from './published-pictures.ts';
import { freezeDocument, pathOf } from './published-freeze.ts';

const IDS = /[ \t]*\(?\b(e_[a-z0-9]{8})\b\)?/g;

/** An item of this workspace the one asking can read and is not archived; else it says why not. */
export async function readableItem(ctx: KernelContext, id: string) {
  const item = await itemOf(ctx, id);
  if (!item) throw new Error(`"${id}" is not an item of this workspace you can read.`);
  if (item.archived_at) throw new Error(`"${item.title}" is archived.`);
  return item;
}

/**
 * What a public view of `id` keeps, read as the one sharing it sees the map, with nothing private: a document as
 * publishing freezes it, anything else as a page of one section. The item shared is kept whatever its visibility, since
 * sharing it is choosing that; what it shows only when it is shared with the workspace or public.
 */
export async function freeze(ctx: KernelContext, id: string) {
  const item = await readableItem(ctx, id);
  const props = item.props ?? {};
  if ((await publishable(ctx)).types.includes(item.type)) {
    if (item.private_to) throw new Error(`"${item.title}" is private: share it with the workspace first, and what it brings in goes out with it.`);
    return freezeDocument(ctx, id, true);
  }
  const kept = isKept(ctx, item.type);
  const pictured = ((await ctx.reads({ pictures: [id] })) as string[]).includes(id);
  // Its note names nothing it does not show: an id in it is cut, as a document's is of what it does not bring in.
  const section = { id, type: item.type, title: item.title, status: item.status, body: kept ? '' : (item.body ?? '').replace(IDS, (found, ref) => (ref === id ? found : '')), updated_at: String(item.updated_at), ...(pictured && { picture: true }) };
  const { lenses, types } = await picturesOf(ctx, [section], true);
  return { type: item.type, title: item.title, status: item.status, fields: shownOf(ctx, item.type, props), updated_at: String(item.updated_at), parts: [{ section }], sections: [id], lenses, types, path: pathOf(props.path), menu: typeof props.menu === 'number' ? props.menu : null };
}

type Frozen = Awaited<ReturnType<typeof freeze>>;

/** The items a frozen view shows: its sections and what each picture in it draws. */
export const shownIn = (given: Frozen) => {
  const sections = given.parts.flatMap((p) => ('section' in p ? [{ id: (p.section as { id: string }).id, title: (p.section as { title: string }).title }] : []));
  const drawn = Object.values(given.lenses ?? {}).flatMap((lens) => (lens.items ?? []).map((i) => ({ id: i.id, title: (i as { title?: unknown }).title as string })));
  return [...new Map([...sections, ...drawn].map((i) => [i.id, i])).values()];
};

/**
 * What sharing `id` now would take out, and what it leaves out as private: told to the person before they share, so
 * nothing goes out without their seeing it, and a view whose items are all private (a new map's) is not given as an
 * empty page without their knowing.
 */
export async function sharePlan(ctx: KernelContext, id: string) {
  const item = await readableItem(ctx, id);
  const goes = shownIn(await freeze(ctx, id));
  const asked = isKept(ctx, item.type) ? ((await keptPicture(ctx, id).catch(() => null))?.items ?? []).map((i) => i.id) : sectionIds(item.body ?? '');
  const out = new Set(goes.map((i) => i.id));
  const left = (await itemsOf(ctx, asked.filter((x) => !out.has(x)))).filter((r) => (r.visibility === 'private' || r.private_to != null) && r.archived_at == null);
  return { id, title: item.title, goes, private: left.map((r) => ({ id: r.id, title: r.title })), ...(await sharedState(ctx, id)) };
}

type Shared = { id: string; title: string; path: string | null; shared_by: string; shared_at: Date };

/** Whether an item has a public view, where, when and by whom. */
export async function sharedState(ctx: KernelContext, id: string) {
  const r = ((await ctx.reads({ shared: { id } })) as Shared[])[0];
  return r ? { shared: true, at: r.shared_at, by: r.shared_by, address: publicPath(ctx.workspace, id), ...(r.path && { path: r.path }) } : { shared: false };
}

/** Every public view of this workspace, newest first, or the one of an item. */
export async function sharedViews(ctx: KernelContext, id?: string) {
  const rows = (await ctx.reads({ shared: id === undefined ? {} : { id } })) as Shared[];
  return rows.map((r) => ({ ...r, address: publicPath(ctx.workspace, r.id) }));
}
