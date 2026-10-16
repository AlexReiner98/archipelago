// What the time pack reads of the map, through what the kernel hands it (ctx.read): time entries with the work each
// is for, the client a piece of work bills, and the project it counts toward. Every item read says what it is (is:
// its type and those it extends), so the pack asks of that rather than of a type's name alone. One Reader per call,
// so what it has read once it does not read again.

import { blockHours } from './days.js';

export const isA = (item, type) => Boolean(item?.is?.includes(type));

export class Reader {
  constructor(ctx) {
    this.ctx = ctx;
    this.items = new Map();
    this.clients = new Map();
    this.projects = new Map();
  }

  read(query) {
    return this.ctx.read(query);
  }

  /** One item, read once. */
  async get(id) {
    if (!id) return null;
    if (!this.items.has(id)) this.items.set(id, await this.read({ get: id }));
    return this.items.get(id);
  }

  async title(id) {
    return id ? ((await this.get(id))?.title ?? id) : null;
  }

  /**
   * Time entries with the work each is part of and the link that ties it there. A block's hours are the time from its
   * start to its end. Void entries are left out, and planned ones unless asked for.
   */
  async entries({ status = ['logged', 'invoiced'], from, to } = {}) {
    const rows = await this.read({ items: { type: 'time.entry', status, ...((from || to) && { between: { field: 'date', from, to } }) } });
    const out = [];
    for (const e of rows) {
      const [part] = await this.read({ related: e.id, relation: 'part_of' });
      const p = e.props ?? {};
      out.push({
        id: e.id,
        title: e.title,
        body: e.body ?? '',
        status: e.status,
        date: p.date ?? (typeof p.start === 'string' ? p.start.slice(0, 10) : null),
        hours: blockHours(p.start, p.end) ?? Number(p.hours ?? 0),
        start: p.start ?? null,
        end: p.end ?? null,
        billable: p.billable !== false,
        rate: typeof p.rate === 'number' ? p.rate : null,
        work: part?.id ?? null,
        link: part?.link ?? null,
      });
      if (part) this.items.set(part.id, part);
    }
    return out.sort((a, b) => String(a.date).localeCompare(String(b.date)) || String(a.start ?? '').localeCompare(String(b.start ?? '')));
  }

  /** The client of a piece of work: the company it, or the nearest thing it sits in, involves; a company is its own. */
  async clientOf(id) {
    if (!id) return undefined;
    if (this.clients.has(id)) return this.clients.get(id);
    let found;
    const self = await this.get(id);
    if (isA(self, 'company')) found = self;
    else {
      const trail = await this.read({ trail: id });
      for (const at of [id, ...trail.map((t) => t.id).reverse()]) {
        const companies = (await this.read({ related: at, relation: 'involves' })).filter((e) => isA(e, 'company')).sort((a, b) => a.title.localeCompare(b.title));
        if (companies.length) {
          found = companies[0];
          break;
        }
      }
    }
    this.clients.set(id, found);
    return found;
  }

  /**
   * What a piece of work counts toward: the outermost project it sits in (or is); failing that, the project that lives
   * in the place (a repository) it sits in or lives in; failing that, that place. Work in neither counts toward nothing.
   */
  async projectOf(id) {
    if (!id) return null;
    if (this.projects.has(id)) return this.projects.get(id);
    const self = await this.get(id);
    // Work that has been archived counts toward nothing.
    if (!self || self.archived_at) return this.projects.set(id, null), null;
    const chain = [...(await this.read({ trail: id })), self];
    let project = chain.find((c) => isA(c, 'project'))?.id ?? null;
    if (!project) {
      // A place it sits in comes before one it only lives in.
      const places = chain.filter((c) => isA(c, 'place')).reverse();
      for (const c of [...chain].reverse()) for (const p of await this.read({ related: c.id, relation: 'lives_in' })) if (isA(p, 'place') && !places.some((x) => x.id === p.id)) places.push(p);
      for (const place of places) {
        const living = (await this.read({ related: place.id, relation: 'lives_in', direction: 'in' })).filter((e) => isA(e, 'project')).sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)));
        if (living.length) {
          project = living[0].id;
          break;
        }
      }
      project ??= places[0]?.id ?? null;
    }
    this.projects.set(id, project);
    return project;
  }
}
