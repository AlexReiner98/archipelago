// What a public view would hold, and where an item's public view stands: the publish pack's half of public views
// (decision e_nwdn7ce6; docs/kernel-packs.md, "Where each module goes"). Making a view public and taking it down stay
// the kernel's (src/public-view.ts). A document is frozen as publishing freezes it (./published-freeze.ts), a view or
// any other item as a page of one section, itself, drawn as a document's view is (its picture's answer kept with
// nothing private in it, ./published-pictures.ts). What is private is left out, and the person is told what goes out
// before it does (`sharePlan`). Only a person shares; an agent asks (`shareAsk`).

import { sectionIds, shownOf } from '../../../src/documents.ts';
import { notify } from '../../../src/notify.ts';
import type { Actor, Archipelago } from '../../../src/pelago.ts';
import { readable } from '../../../src/public-document.ts';
import { publicPath } from './published-data.ts';
import { picturesOf } from './published-pictures.ts';
import { freezeDocument, pathOf } from './published-freeze.ts';
import { isKept, keptPicture } from '../../../src/query-saved.ts';

const ID = /^e_[a-z0-9]{8}$/;
const IDS = /[ \t]*\(?\b(e_[a-z0-9]{8})\b\)?/g;

async function itemOf(l: Archipelago, id: string) {
  const item = ID.test(id) ? await l.entity(id) : null;
  if (!item) throw new Error(`"${id}" is not an item of this workspace you can read.`);
  if (item.archived_at) throw new Error(`"${item.title}" is archived.`);
  return item;
}

const isDocument = (l: Archipelago, type: string) => readable(l).includes(type);

/**
 * What a public view of `id` keeps, read as the one sharing it sees the map, with nothing private: a document as
 * publishing freezes it, anything else as a page of one section. The item shared is kept whatever its visibility, since
 * sharing it is choosing that; what it shows only when it is shared with the workspace or public.
 */
export async function freeze(l: Archipelago, id: string) {
  const item = await itemOf(l, id);
  const props = item.props ?? {};
  if (isDocument(l, item.type)) {
    if (item.private_to) throw new Error(`"${item.title}" is private: share it with the workspace first, and what it brings in goes out with it.`);
    return freezeDocument(l, id, true);
  }
  const kept = isKept(l, item.type);
  const { rows } = await l.db.query<{ picture: boolean }>(`select exists (select 1 from picture where entity_id = $1) as picture`, [id]);
  // Its note names nothing it does not show: an id in it is cut, as a document's is of what it does not bring in.
  const section = { id, type: item.type, title: item.title, status: item.status, body: kept ? '' : (item.body ?? '').replace(IDS, (found, ref) => (ref === id ? found : '')), updated_at: String(item.updated_at), ...(rows[0]?.picture && { picture: true }) };
  const { lenses, types } = await picturesOf(l, [section], true);
  return { type: item.type, title: item.title, status: item.status, fields: shownOf(l, item.type, props), updated_at: String(item.updated_at), parts: [{ section }], sections: [id], lenses, types, path: pathOf(props.path), menu: typeof props.menu === 'number' ? props.menu : null };
}

type Frozen = Awaited<ReturnType<typeof freeze>>;

/** The items a frozen view shows: its sections and what each picture in it draws. */
export const shownIn = (given: Frozen) => {
  const sections = given.parts.flatMap((p) => ('section' in p ? [{ id: p.section.id, title: p.section.title }] : []));
  const drawn = Object.values(given.lenses ?? {}).flatMap((lens) => (lens.items ?? []).map((i) => ({ id: i.id, title: i.title })));
  return [...new Map([...sections, ...drawn].map((i) => [i.id, i])).values()];
};

/**
 * What sharing `id` now would take out, and what it leaves out as private: told to the person before they share, so
 * nothing goes out without their seeing it, and a view whose items are all private (a new map's) is not given as an
 * empty page without their knowing.
 */
export async function sharePlan(l: Archipelago, id: string) {
  const item = await itemOf(l, id);
  const goes = shownIn(await freeze(l, id));
  const asked = isKept(l, item.type) ? ((await keptPicture(l, id).catch(() => null))?.items ?? []).map((i) => i.id) : sectionIds(item.body ?? '');
  const out = new Set(goes.map((i) => i.id));
  const { rows } = await l.db.query<{ id: string; title: string }>(
    `select id, title from entity where id = any($1::text[]) and (visibility = 'private' or private_to is not null) and archived_at is null`,
    [asked.filter((x) => !out.has(x))],
  );
  return { id, title: item.title, goes, private: rows, ...(await sharedState(l, id)) };
}

/** Whether an item has a public view, where, when and by whom. */
export async function sharedState(l: Archipelago, id: string) {
  const { rows } = await l.db.query<{ shared_by: string; shared_at: Date; path: string | null }>(`select shared_by, shared_at, path from public_view where entity_id = $1`, [id]);
  const r = rows[0];
  return r ? { shared: true, at: r.shared_at, by: r.shared_by, address: publicPath(l.workspace, id), ...(r.path && { path: r.path }) } : { shared: false };
}

/** Every public view of this workspace, newest first, or the one of an item. */
export async function sharedViews(l: Archipelago, id?: string) {
  const { rows } = await l.db.query<{ id: string; title: string; path: string | null; shared_by: string; shared_at: Date }>(
    `select entity_id as id, given ->> 'title' as title, path, shared_by, shared_at from public_view where $1::text is null or entity_id = $1 order by shared_at desc limit 500`,
    [id ?? null],
  );
  return rows.map((r) => ({ ...r, address: publicPath(l.workspace, r.id) }));
}

/** An agent asks the person to make a view or an item public: a notification about it, which they share from its page. */
export async function shareAsk(l: Archipelago, actor: Actor, id: string, reason?: string) {
  const item = await itemOf(l, id);
  await notify(l, actor, { title: `Make "${item.title}" public`.slice(0, 200), body: reason ?? '', about: id });
  return { asked: true, note: 'The person is notified; making it public is theirs.' };
}
