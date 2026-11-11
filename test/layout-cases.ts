// What the browser tests of the drawings share: the house style as the packs ship it. The pictures the retired
// drawings were checked on are at git tag archive/layouts-2026-11-09 (test/layout-cases.ts, test/fixtures/layouts).

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const here = (...p: string[]) => join(import.meta.dirname, ...p);
/** The house style, as the packs ship it, with the shape asked for. */
export const house = (shape: string) => ({ ...JSON.parse(readFileSync(here('..', 'packs', 'canvas', 'pack.json'), 'utf8')).styles.find((s: { id: string }) => s.id === 'core.house').props, shape });
