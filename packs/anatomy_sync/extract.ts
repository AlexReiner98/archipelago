// The extractors, one per kind of source, and what they want of the island together. A sync hands each extractor every
// file it owns; which extractors a change reaches is read off the files it touched (`reached`).

import { checks } from './extract-checks.ts';
import { modules, tests } from './extract-code.ts';
import { manifests } from './extract-manifests.ts';
import { merge, type Extractor, type Model, type Source } from './model.ts';

export const EXTRACTORS: Extractor[] = [manifests, modules, tests, checks];

/** Whether any extractor reads this file. */
export const read = (path: string) => EXTRACTORS.some((e) => e.owns(path));

/** The extractors a change to these paths reaches. */
export const reached = (paths: string[]) => EXTRACTORS.filter((e) => paths.some((p) => e.owns(p)));

/** What the extractors want of the island, from the files each owns. */
export const extract = (files: Source[], only: Extractor[] = EXTRACTORS): Model => merge(only.map((e) => e.extract(files.filter((f) => e.owns(f.path)))));
