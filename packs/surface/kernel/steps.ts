// The surface root's parts of the schema's numbered steps (packs/database/kernel/migrate.ts): what one request leaves for the next, and
// search.

import type { StepPart } from '../../database/kernel/migrate.ts';
import { TRANSIENT } from '../../database/kernel/transient.ts';
import { SEARCH_ANY, SEARCH_INDEX } from './search.ts';

export const STEPS: StepPart[] = [
  { version: 3, name: 'what one request leaves for the next', sql: TRANSIENT },
  { version: 17, name: 'titles and notes indexed for search', sql: SEARCH_INDEX },
  { version: 30, name: 'search finds an item with any of the words', sql: SEARCH_ANY },
];
