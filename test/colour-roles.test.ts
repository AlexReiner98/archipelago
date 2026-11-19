// The colour roles a drawing is given are the ones a style declares (round 6, the palette): the walls keep no list of their own.

import assert from 'node:assert/strict';
import test from 'node:test';

// @ts-ignore a page module, untyped
import { colourRoles } from '../packs/walls/page/colour-roles.js';

test('a style’s roles are its drawing’s colour names, and only well-formed names count', () => {
  assert.deepEqual(colourRoles({}), [], 'no style, no roles');
  assert.deepEqual(colourRoles({ roles: { sea: 'bg', land_3: 'land_3', 'Bad Name': 'x', active: '#2f7d6b' } }), ['sea', 'land_3', 'active']);
});
