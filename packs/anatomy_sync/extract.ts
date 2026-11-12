// The extractors, one per kind of source, and what they want of the island together. A full run hands each extractor
// every file it owns. A run on a change (`runOf`) reads off the files the change touched which extractors it reaches,
// and how: an extractor whose items come file by file redoes only the touched files, unless a file it reads for all of
// them changed; any other redoes all its files. What a deleted file made may be archived, and a moved file's item follows it.

import { checks } from './extract-checks.ts';
import { modules, tests } from './extract-code.ts';
import { manifests } from './extract-manifests.ts';
import { kindOfKey, merge, type Extractor, type Model, type Source } from './model.ts';

export const EXTRACTORS: Extractor[] = [manifests, modules, tests, checks];

/** Whether any extractor reads this file. */
export const read = (path: string) => EXTRACTORS.some((e) => e.owns(path));

/** The extractors a change to these paths reaches. */
export const reached = (paths: string[]) => EXTRACTORS.filter((e) => paths.some((p) => e.owns(p)));

/** A file a change touched, as git's diff names it: added, modified, deleted, or renamed from another path. */
export interface Change { path: string; status: 'A' | 'M' | 'D' | 'R'; from?: string }

/** What a run reads and may change: per extractor all its files, or only some; the keys it may archive; the moves. */
export interface Run { extractors: { extractor: Extractor; only?: Set<string> }[]; mayArchive: (key: string) => boolean; renames: [string, string][] }

/** A full run: every extractor, every file, and anything of their kinds the files no longer make may be archived. */
export const fullRun = (): Run => {
  const kinds = new Set(EXTRACTORS.flatMap((e) => e.kinds));
  return { extractors: EXTRACTORS.map((extractor) => ({ extractor })), mayArchive: (key) => kinds.has(kindOfKey(key)), renames: [] };
};

/** The run a change asks for. */
export function runOf(changes: Change[]): Run {
  const extractors: Run['extractors'] = [], archivable = new Set<string>(), wholeKinds = new Set<string>(), renames: [string, string][] = [];
  for (const e of EXTRACTORS) {
    const mine = changes.filter((c) => e.owns(c.path) || (c.from !== undefined && e.owns(c.from)));
    if (!mine.length) continue;
    if (!e.perFile || !e.keyOfFile || mine.some((c) => e.whole?.(c.path))) { extractors.push({ extractor: e }); e.kinds.forEach((k) => wholeKinds.add(k)); continue; }
    const only = new Set<string>();
    for (const c of mine) {
      if (c.status !== 'D' && e.owns(c.path)) only.add(c.path);
      const gone = c.status === 'D' ? c.path : c.status === 'R' ? c.from : undefined;
      const goneKey = gone !== undefined ? e.keyOfFile(gone) : undefined;
      if (c.status === 'R' && goneKey && e.keyOfFile(c.path)) renames.push([goneKey, e.keyOfFile(c.path)!]);
      else if (goneKey) archivable.add(goneKey);
    }
    extractors.push({ extractor: e, only });
  }
  return { extractors, mayArchive: (key) => wholeKinds.has(kindOfKey(key)) || archivable.has(key), renames };
}

/** The files a run reads: those it names, of the extractors it runs. */
export const readsIn = (run: Run) => (path: string) => run.extractors.some(({ extractor, only }) => extractor.owns(path) && (!only || only.has(path) || !!extractor.whole?.(path)));

/** What the extractors of a run want of the island, from the files they read; `known` keys may end a link all the same. */
export const extract = (files: Source[], run: Run = fullRun(), known: ReadonlySet<string> = new Set()): Model =>
  merge(run.extractors.map(({ extractor, only }) => extractor.extract(files.filter((f) => extractor.owns(f.path) && (!only || only.has(f.path) || !!extractor.whole?.(f.path))))), known);
