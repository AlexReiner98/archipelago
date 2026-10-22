// The pictures a drawing is checked on: two real architecture answers (the landing page's hero and one of its
// documents', as published on 22 Oct 2026) and one made to hold every mark the shape has. Each is drawn as the app
// draws it (at a width that keeps its key open, and one that folds it) and as a published page draws it (still).

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const here = (...p: string[]) => join(import.meta.dirname, ...p);
/** The house style, as the packs ship it, with the shape asked for. */
export const house = (shape: string) => ({ ...JSON.parse(readFileSync(here('..', 'packs', 'core', 'pack.json'), 'utf8')).styles.find((s: { id: string }) => s.id === 'core.house').props, shape });

const quiet = { blocked: false, waits_on: [] as string[], sessions: 0, needs_you: false };
const within = { items: 0, work: 0, blocked: 0, waiting: 0, sessions: 0, tokens: { estimated: 0, used: 0 }, waits_on: {}, needs_you: 0, not_sent: 0 };
const item = (id: string, title: string, inside: string | undefined, place: number, extra: Record<string, unknown> = {}) => ({ id, type: 'software.component', root: 'software.component', kind: 'place', title, status: 'up', open: true, inside, place, size: { work: 0, tokens: { estimated: 0, used: 0 } }, state: quiet, within, ...extra });

/** Every mark: each health, each wire state, what a wire carries, a loop, a store, a client, a question, work on a part, what needs you. */
function variety() {
  const healths = ['up', 'degraded', 'down', 'wiring', 'standby', 'planned', 'mystery'];
  const items = [
    item('e_root0000', 'A system', undefined, 1, { kind: 'work', type: 'work.project' }),
    item('e_placea00', 'The edge', 'e_root0000', 1),
    item('e_placeb00', 'The servers, with a long name that will not fit', 'e_root0000', 2),
    item('e_placec00', 'Stores', 'e_root0000', 3, { status: 'down' }),
    item('e_client00', 'A browser', 'e_placea00', 1, { role: 'client' }),
    item('e_person00', 'Someone', 'e_placea00', 2, { kind: 'actor', state: { ...quiet, needs_you: true } }),
    ...healths.map((status, n) => item(`e_svc${n}0000`.slice(0, 10), `Service ${status} with a name long enough to be cut`, 'e_placeb00', n + 1, { status })),
    item('e_gone0000', 'Retired service', 'e_placeb00', 9, { status: 'retired', open: false }),
    item('e_ask00000', 'Which store?', 'e_placeb00', 10, { kind: 'question', type: 'inquiry.question' }),
    item('e_db000000', 'Database', 'e_placec00', 1, { role: 'data' }),
    item('e_queue000', 'Queue', 'e_placec00', 2, { role: 'queue', state: { ...quiet, blocked: true, waits_on: ['e_person00'] } }),
    item('e_task0000', 'Wire the queue', 'e_queue000', 1, { kind: 'work', type: 'work.task', status: 'doing', state: { ...quiet, sessions: 1, needs_you: true } }),
    item('e_task1000', 'Watch it', 'e_queue000', 2, { kind: 'work', type: 'work.task', status: 'todo' }),
  ];
  const svc = (n: number) => `e_svc${n}0000`.slice(0, 10);
  const links = [
    { kind: 'software.calls', from: 'e_client00', to: svc(0), n: 1, says: 'HTTPS' },
    { kind: 'software.calls', from: 'e_client00', to: svc(1), n: 1 },
    { kind: 'software.calls', from: 'e_person00', to: svc(2), n: 1, state: 'planned', says: 'a very long thing it carries, longer than fits' },
    ...healths.map((_, n) => ({ kind: 'software.calls', from: svc(n), to: n % 2 ? 'e_db000000' : 'e_queue000', n: 1, ...(n === 3 && { state: 'broken' }), ...(n === 0 && { says: 'SQL' }) })),
    { kind: 'software.calls', from: 'e_db000000', to: svc(0), n: 1, says: 'a loop' },
    { kind: 'software.calls', from: 'e_gone0000', to: 'e_db000000', n: 1 },
    { kind: 'software.calls', from: 'e_ask00000', to: 'e_queue000', n: 1 },
    { kind: 'software.calls', from: svc(6), to: 'e_ask00000', n: 1, state: 'wired' },
  ];
  return { lens: { from: 'e_root0000', by: 'part_of', over: ['software.calls'], fold: ['system'] }, items, links, rest: {}, viewer: 'e_person00', controls: ['lit'], views: [] };
}

export interface DrawingCase {
  name: string;
  answer: Record<string, unknown>;
  style: Record<string, unknown>;
  width: number;
}

/** The architecture shape's cases. */
export function architectureCases(): DrawingCase[] {
  const fixture = (name: string) => JSON.parse(readFileSync(here('fixtures', 'drawings', `architecture-${name}.json`), 'utf8'));
  const style = house('architecture');
  const answers = { hero: fixture('hero'), system: fixture('system'), variety: variety() };
  const cases: DrawingCase[] = [];
  for (const [name, answer] of Object.entries(answers)) {
    cases.push({ name: `${name}, wide`, answer, style: { ...style, noLit: name !== 'variety', here: name === 'variety' ? 'e_db000000' : undefined }, width: 1100 });
    cases.push({ name: `${name}, narrow`, answer, style: { ...style, noLit: true }, width: 560 });
    cases.push({ name: `${name}, still`, answer, style: { ...style, noLit: true, still: true }, width: 900 });
  }
  return cases;
}

/** A big system: 12 places of 16 parts, each calling three in the next place. */
export function bigSystem() {
  const hero = architectureCases()[0].answer as any;
  const proto = hero.items.find((i: any) => i.kind === 'place' && i.inside === hero.lens.from);
  const root = hero.items.find((i: any) => i.id === hero.lens.from);
  const id = (p: number, k: number) => `e_p${String(p).padStart(2, '0')}k${String(k).padStart(3, '0')}z`;
  const items = [root, ...Array.from({ length: 12 }, (_, p) => [{ ...proto, id: `e_place${String(p).padStart(3, '0')}`, title: `Place ${p}`, inside: root.id, place: p }, ...Array.from({ length: 16 }, (_, k) => ({ ...proto, id: id(p, k), title: `Part ${p}.${k} with a name`, inside: `e_place${String(p).padStart(3, '0')}`, place: k }))]).flat()];
  const links = Array.from({ length: 11 }, (_, p) => Array.from({ length: 16 }, (_, k) => [0, 3, 7].map((d) => ({ kind: 'software.calls', from: id(p, k), to: id(p + 1, (k + d) % 16), n: 1 })))).flat(2);
  return { ...hero, items, links };
}
