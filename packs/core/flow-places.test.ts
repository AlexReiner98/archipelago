// The flow drawing shows a place that holds parts as a colour on them, not as a step (e_cp7hq4dv), where the style
// gives places colours (place_hues, as core's house style does): no tie from each part to where it is, each part
// outlined in its place's colour, and the key naming the place. Without place_hues a place is a step as before.

import assert from 'node:assert/strict';
import { copyFileSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { pathToFileURL } from 'node:url';

const pack = JSON.parse(readFileSync(join(import.meta.dirname, 'pack.json'), 'utf8'));
const house = { ...pack.styles.find((s: any) => s.id === 'core.house').props, shape: 'flow' };
const laid = mkdtempSync(join(tmpdir(), 'flow-places-'));
for (const [name, file] of Object.entries(pack.drawings.find((d: any) => d.id === 'core.flow').modules)) copyFileSync(join(import.meta.dirname, file as string), join(laid, name));
const { picture } = await import(pathToFileURL(join(laid, 'index.js')).href);
const measure = (t: string, px: number) => t.length * px * 0.55;
const state = { blocked: false, waits_on: [], sessions: 0, needs_you: false };
const item = (id: string, title: string, kind = 'place') => ({ id, kind, type: 'part', title, place: 0, open: true, status: 'works', state, fields: {} });
const answer = {
  items: [item('e_hostzzzz', 'Machine'), item('e_cloudzzz', 'Cloud'), item('e_hookzzzz', 'Hook'), item('e_toolzzzz', 'Tool'), item('e_storezzz', 'Store'), item('e_taskzzzz', 'A task', 'work')],
  links: [
    { type: 'part_of', from: 'e_hookzzzz', to: 'e_hostzzzz' },
    { type: 'part_of', from: 'e_toolzzzz', to: 'e_hostzzzz' },
    { type: 'part_of', from: 'e_storezzz', to: 'e_cloudzzz' },
    { type: 'calls', from: 'e_hookzzzz', to: 'e_storezzz' },
    { type: 'part_of', from: 'e_taskzzzz', to: 'e_hookzzzz' },
  ],
};
const draw = (style: any) => picture({ answer, style, reduced: true }, { measure, patch: () => {}, frame: () => Promise.resolve(0), open: () => {} }).scene;
const steps = (scene: any) => (JSON.stringify(scene.svg).match(/"key":"s:e_[a-z]+"/g) ?? []).map((k) => k.slice(9, -1)).sort();

test('a place that holds parts is no step: its parts are outlined in its colour and the key names it', () => {
  const scene = draw(house);
  assert.deepEqual(steps(scene), ['e_hookzzzz', 'e_storezzz', 'e_taskzzzz', 'e_toolzzzz'], 'the machine and the cloud are not drawn');
  const svg = JSON.stringify(scene.svg);
  const [machine, cloud] = house.place_hues.map((h: string) => `lf-p-${h.slice(1)}`);
  assert.equal((svg.match(new RegExp(`placed ${machine}`, 'g')) ?? []).length, 2, 'the hook and the tool are in the machine\'s colour');
  assert.equal((svg.match(new RegExp(`placed ${cloud}`, 'g')) ?? []).length, 1, 'the store is in the cloud\'s');
  assert.ok(scene.css.includes(`.${machine} { --lf-place: ${house.place_hues[0]}; }`), 'the colour is a rule, not a style on the mark');
  const labels = scene.key.map((e: any) => e.label);
  assert.ok(labels.includes('Machine') && labels.includes('Cloud'), `the key names each place: ${labels.join(', ')}`);
  // The calls are still drawn; the ties to the places are not. A hook that holds a task is no place's step: it stays.
  assert.ok(labels.includes('Calls') && labels.includes('Part of'), 'the call and the task\'s tie to its hook are drawn');
});

test('without place_hues a place is a step tied to its parts', () => {
  const scene = draw({ ...house, place_hues: [] });
  assert.ok(steps(scene).includes('e_hostzzzz') && steps(scene).includes('e_cloudzzz'));
  assert.ok(!JSON.stringify(scene.svg).includes('placed'));
});

test('the place the picture was opened from stays a step', () => {
  assert.ok(steps(draw({ ...house, here: 'e_hostzzzz' })).includes('e_hostzzzz'));
});
