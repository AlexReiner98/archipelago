// A view's drawing as a published page keeps it: its answer frozen, with nothing private in it and nothing that names
// a person or a session (src/published.ts, and src/published-share.ts for a document another workspace shares).

import type { Archipelago } from './pelago.ts';
import { isKept, keptPicture } from './lens-saved.ts';
import { stepsShown } from './lens-steps.ts';
import { framesFor } from './published-frames.ts';

const IDS = /[ \t]*\(?\b(e_[a-z0-9]{8})\b\)?/g;

/** An item's first sentence, or as much of its first paragraph as reads in a line: what a reader is told of a part. */
export function gist(body: string, most = 160): string {
  const first = body.split(/\n[ \t]*\n/).map((p) => p.replace(IDS, '').replace(/\s+/g, ' ').trim()).find(Boolean) ?? '';
  const sentence = /^(.+?[.!?])(\s|$)/.exec(first)?.[1] ?? first;
  return sentence.length <= most ? sentence : `${sentence.slice(0, most - 1).replace(/\s+\S*$/, '')}…`;
}

type Answer = Awaited<ReturnType<typeof keptPicture>>;

/**
 * A view's picture as a reader may have it: its items and the links among them, each item with its first line and
 * the counts a drawing reads all nothing, each link's type as its kind; nothing about who or which session.
 */
export function freezeLens(answer: Answer, bodies: Map<string, string>, partOf: string[] = ['part_of']) {
  const { code: _code, ...style } = (answer.style ?? {}) as Record<string, unknown>;
  // What each is inside, for the drawings that nest: what it is part of, where that is drawn too, said by inside and not by a link as well.
  const ids = new Set(answer.items.map((i) => i.id));
  const inside = new Map<string, (typeof answer.links)[number]>();
  for (const k of answer.links) if (partOf.includes(k.type) && ids.has(k.to) && k.from !== k.to && !inside.has(k.from)) inside.set(k.from, k);
  const nothing = { items: 0, needs_you: 0, blocked: 0, work: 0, sessions: 0 };
  return {
    lens: answer.lens,
    style,
    // How it came to be, naming only what it shows.
    ...(answer.steps && { steps: stepsShown(answer.steps, new Set(bodies.keys())) }),
    items: answer.items.map(({ owner: _owner, body: _body, ...item }) => ({ ...item, inside: inside.get(item.id)?.to ?? null, state: { needs_you: false, blocked: false, sessions: 0, waits_on: [] }, within: nothing, size: { work: 0 }, gist: gist(bodies.get(item.id) ?? '') })),
    links: answer.links.filter((k) => inside.get(k.from) !== k).map((k) => ({ kind: k.type, ...k })),
  };
}

/**
 * The picture of each view kept on the map among a document's sections, as a page draws it, and the title of each
 * type they hold. `shared` keeps to what the whole workspace may see, as anything public must; without it, to what
 * the one asking may see, for a draft read before it is published.
 */
export async function picturesOf(l: Archipelago, sections: { id: string; type: string }[], shared: boolean) {
  const lenses: Record<string, ReturnType<typeof freezeLens>> = {};
  const types: Record<string, string> = {};
  for (const section of sections.filter((s) => isKept(l, s.type))) {
    const answer = await keptPicture(l, section.id).catch(() => null);
    if (!answer) continue;
    const { rows } = await l.db.query<{ id: string; body: string }>(
      `select id, body from entity where id = any($1::text[])${shared ? ` and visibility <> 'private' and private_to is null` : ''}`,
      [answer.items.map((i) => i.id)],
    );
    const shown = new Map(rows.map((r) => [r.id, r.body]));
    const kept = { ...answer, items: answer.items.filter((i) => shown.has(i.id)), links: answer.links.filter((k) => shown.has(k.from) && shown.has(k.to)) };
    lenses[section.id] = freezeLens(kept, shown, l.registry.relationFamily('part_of'));
    for (const i of kept.items) types[i.type] = l.registry.type(i.type)?.title ?? i.type;
  }
  // Each picture's first frame, so a reader's page has it on screen with the text.
  await framesFor(l, lenses);
  return { lenses, types };
}
