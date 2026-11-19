// The reflex tree drawing, without a page: an answer in, the tree, its places, its film and its patches out.

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { placeOfBough, treeOf } from './tree.js';
import { radial } from './radial.js';
import { rulesOf, storyOf, toldFrom, weekTo } from './story.js';
import { filmOf } from './film.js';
import { picture } from './index.js';
import { namesShown, overlap } from './names.js';

const pack = JSON.parse(readFileSync(join(import.meta.dirname, '..', '..', 'pack.json'), 'utf8'));
const style = pack.styles.find((s: any) => s.id === 'reflex_view.tree').props.style;
const z = (name: string) => style.sizes[name], n = (name: string) => style.numbers[name];
const id = (i: number) => `e_${String(i).padStart(8, 'a')}`;
const hour = 3600000;
const node = (i: number, extra: Record<string, unknown> = {}) => ({ id: id(i), type: 'instruction', title: `Rule ${i}`, created_at: new Date(Date.UTC(2026, 10, 1) + i * hour).toISOString(), ...extra });
const partOf = (a: number, b: number) => ({ id: `l${a}`, type: 'part_of', from: id(a), to: id(b) });
const answer = (count = 12, links = [partOf(4, 1), partOf(5, 1), partOf(6, 4), partOf(9, 2)]) => ({ lens: { find: ['type instruction'] }, items: Array.from({ length: count }, (_, i) => node(i)), links });

test('the tree hangs each node from what it is part of, and the loose ones from the root', () => {
  const tree = treeOf(answer())!;
  assert.equal(tree.root.id, '~root');
  assert.equal(tree.nodes.get(id(6))!.parent!.id, id(4));
  assert.equal(tree.nodes.get(id(4))!.depth, 2);
  assert.equal(tree.nodes.get(id(3))!.parent, tree.root);
  assert.equal(tree.written.length, 12);
  // Born in the order made, each after what it grows from.
  for (const one of tree.born) if (one.parent && one.parent !== tree.root) assert.ok(tree.born.indexOf(one.parent) < tree.born.indexOf(one));
});

test('a ring of part_of is cut where it closes, a node said somewhere hangs from that bough, and the view’s item is the root', () => {
  const ring = treeOf(answer(4, [partOf(1, 2), partOf(2, 1)]))!;
  assert.equal(ring.nodes.size, 5);
  const said = treeOf({ ...answer(3, []), items: [node(0, { fields: { for: ['file:src/**'] } }), node(1, { fields: { for: ['file:ui/*'] } }), node(2)] }, undefined, n)!;
  assert.equal(said.nodes.get(id(0))!.parent!.id, '~for:file:src/');
  assert.equal(said.nodes.get(id(0))!.parent!.parent!.id, '~for:file');
  assert.equal(said.nodes.get(id(1))!.parent!.parent, said.nodes.get(id(0))!.parent!.parent, 'two folders under one file bough');
  const hub = { id: 'e_hubhubhu', type: 'task', title: 'Hub', created_at: node(0).created_at };
  const of = treeOf({ lens: { from: hub.id }, items: [hub, node(1), node(2)], links: [partOf(1, 2)] })!;
  assert.equal(of.root.id, hub.id);
  assert.equal(treeOf({ items: [hub], links: [] }), null);
});

test('it is placed the same each time, each child within its parent’s share of the circle', () => {
  const measure = (text: string, px: number) => text.length * px * 0.55;
  const a = radial(treeOf(answer())!, z, n, measure), b = radial(treeOf(answer())!, z, n, measure);
  assert.deepEqual([...a.place], [...b.place]);
  assert.equal(a.labels.size, a.place.size - 1, 'every node but the root has a name laid out');
  assert.deepEqual([a.centre.x * 2, a.centre.y * 2], [a.width, a.height], 'the root stands at the middle');
  assert.ok(a.width > 0 && a.height > 0);
  for (const p of a.place.values()) assert.ok(p.x >= 0 && p.y >= 0 && p.x <= a.width && p.y <= a.height);
  assert.ok(a.branch.get(id(6))!.startsWith('M'));
  assert.equal(a.along.get(id(6))!.length, n('reflex_curve_steps') + 1);
});

/** A story as the pack tells it: a core preset, a trial grown from a miss, a gap, and sayings of every verdict. */
const told = (items: any[]) => {
  const day = (k: number) => new Date(Date.UTC(2026, 10, 1) + k * 864e5).toISOString();
  return {
    from: day(0), to: day(28),
    nodes: [{ id: 'core.say_authority', tier: 'core', status: 'current', for: ['tool:change'], title: 'Say on whose authority' }, ...items.map((i, k) => ({ id: i.id, tier: k === 0 ? 'learned' : 'owner', status: k === 0 ? 'trial' : 'current' }))],
    misses: [{ at: day(10), where: 'tool:change', grew: items[0].id }, { at: day(20), where: 'tool:change' }],
    said: [{ id: items[1].id, at: day(12), verdict: 'held' }, { id: items[2].id, at: day(14), verdict: 'came_back' }, { id: items[3].id, at: day(15), verdict: 'quiet' }, { id: 'core.say_authority', at: day(16), verdict: 'held' }],
  };
};

test('over real dates: the trunk stands, a miss sparks where it happened or grows its trial, sayings light by verdict', () => {
  const a = answer(6, []);
  const came = told(a.items), story = storyOf(a, came, null, n);
  assert.equal(story.schematic, false);
  const tree = treeOf(a, (item: any) => item.fields?.for ?? story.nodes.get(item.id)?.for, n, [...story.nodes].filter(([, x]) => x.tier === 'core').map(([id, x]) => ({ id, ...x })))!;
  assert.ok(tree.nodes.get('core.say_authority')!.preset, 'core\u2019s preset stands in the tree');
  const film = filmOf(tree, story, n);
  assert.equal(film.born.get('core.say_authority'), 0, 'the trunk is there from the start');
  const kinds = film.events.map((e: any) => e.kind);
  assert.deepEqual(kinds, ['miss', 'held', 'failed', 'held', 'held', 'miss'], 'a quiet saying (its miss never showed) lights as held');
  const [grew, , , , , gap] = film.events;
  assert.equal(grew.node.id, a.items[0].id);
  assert.equal(film.born.get(a.items[0].id), grew.t, 'the trial is born of its miss');
  assert.equal(gap.grew, false);
  assert.equal(gap.node.id, '~for:tool:change', 'a miss that grew nothing sparks on the bough of its place');
  assert.deepEqual(weekTo(story, Date.parse(came.to)), { misses: 0, held: 0 }, "the gap is eight days before the end: out of that week");
  assert.deepEqual(weekTo(story, Date.parse(came.from) + 21 * 864e5), { misses: 1, held: 2 });
  assert.deepEqual(weekTo(story, Date.parse(came.from) + 16 * 864e5), { misses: 1, held: 3 });
});

test('until the pack tells the story, it is made from the map and its counts, and says so', () => {
  const a = answer(4, []);
  const story = storyOf(a, null, new Map([[a.items[1].id, 3]]), n, Date.UTC(2026, 10, 19));
  assert.equal(story.schematic, true);
  assert.equal(story.said.length, 3);
  assert.ok(story.said.every((one: any) => one.verdict === 'held' && one.at >= story.from && one.at <= story.to));
  assert.equal(story.misses.length, 0, 'no miss is made up');
});

test('played, it patches the tree in as it grows; under reduced motion it stands whole and still', async () => {
  const patches: any[] = [];
  let frames = 0;
  const tools = { frame: () => new Promise((r) => setTimeout(r, 1)).then(() => frames++), patch: (p: any[]) => patches.push(...p), open() {}, surface: async () => null };
  const played = await picture({ answer: answer(), style, reduced: false }, tools);
  assert.ok(played.scene.surface, 'a played tree is never mounted from a picture kept still');
  await new Promise((r) => setTimeout(r, 60));
  assert.ok(frames > 2);
  assert.ok(patches.some((p) => p.key === 'cam' && p.set?.transform));
  assert.ok(played.on({ name: 'click', key: 'rt:replay' }).some((p: any) => p.toggle?.on === false));
  played.end();
  const still = await picture({ answer: { ...answer(), lens: { find: ['still'] } }, style, reduced: true }, tools);
  assert.equal(still.scene.surface, undefined);
  assert.equal(JSON.stringify(still.scene.svg).match(/rt-node rt-\w+ on/g)?.length, 12);
  assert.ok((await picture({ answer: answer(), style: { shape: 'reflex_tree' }, reduced: true }, tools)).scene.message);
});

test('the story the pack answers draws the tiers, the standing and the gaps', async () => {
  const a = { ...answer(6, []), lens: { find: ['story'] } };
  const asked: string[] = [];
  const act = async (name: string, params: any) => (asked.push(name), name === 'story' ? { answer: told(a.items) } : { answer: params.ids.map((one: string) => ({ id: one, said: 1, for: ['tool:change'] })) });
  const drawn = await picture({ answer: a, style: { ...style, sends: { ...style.sends, story: 'story' } }, reduced: true }, { frame: () => new Promise(() => {}), patch() {}, open() {}, act });
  assert.ok(asked.includes('story') && asked.includes(style.sends.said));
  const svg = JSON.stringify(drawn.scene.svg), bar = JSON.stringify(drawn.scene.before);
  assert.ok(svg.includes('rt-t-core') && svg.includes('rt-t-learned'), 'each branch carries its tier');
  assert.ok(svg.includes('rt-trial'), 'a trial node is drawn hollow');
  assert.ok(svg.includes('rt-gap'), 'grown, the place a miss grew nothing from keeps its gap');
  assert.ok(!bar.includes('schematic'));
  assert.ok(bar.includes('misses') && bar.includes('held'), 'the counter is misses against held');
});


test('grown, no two shown names overlap or cross a wire, and every node is named or a dot with its name as tooltip', async () => {
  const places = ['tool:change', 'tool:query', 'file:packs/canvas/layouts/*.js', 'file:packs/*/page/*.js', 'file:ui/*', 'session_start', 'working_rules', 'guide:style_code'];
  const items = Array.from({ length: 40 }, (_, i) => node(i, { title: `A rule of the harness, number ${i}`, fields: { for: [places[i % places.length]] } }));
  const links = [partOf(9, 1), partOf(17, 1), partOf(25, 9), partOf(12, 4), partOf(20, 4), partOf(28, 4), partOf(33, 2), partOf(34, 33)];
  const answer40 = { lens: { find: ['forty'] }, items, links };
  const tree = treeOf(answer40, undefined, n)!;
  const placed = radial(tree, z, n, (text: string, px: number) => text.length * px * 0.55, 2);
  const counts = new Map(tree.written.map((one, i) => [one.id, i % 5]));
  for (const f of [1.4, 1, 0.5]) {
    const { shown, boxes } = namesShown(tree, placed, counts, z, n, f);
    const ids = [...shown];
    for (let i = 0; i < ids.length; i++) for (let j = i + 1; j < ids.length; j++) assert.ok(!overlap(boxes.get(ids[i]), boxes.get(ids[j])), `${ids[i]} and ${ids[j]} at ${f}`);
    for (const id of ids) {
      const own = new Set([id, ...tree.nodes.get(id)!.kids.map((k) => k.id)]);
      for (const [to, points] of placed.along) if (!own.has(to)) for (let k = 1; k < points.length; k++) assert.ok(!overlap([points[k - 1], points[k]], boxes.get(id)), `${id} and the wire to ${to} at ${f}`);
    }
    if (f === 1) assert.ok(shown.size > 0 && shown.size < placed.labels.size, 'some names show and some give way');
  }
  // Zoomed in, more show; every bough that shows outranks a leaf it met.
  assert.ok(namesShown(tree, placed, counts, z, n, 0.5).shown.size >= namesShown(tree, placed, counts, z, n, 1).shown.size);
  const drawn = await picture({ answer: answer40, style, reduced: true }, { frame: () => new Promise(() => {}), patch() {}, open() {} });
  const marks = JSON.stringify(drawn.scene.svg);
  for (const one of tree.order.filter((x) => x.parent)) assert.ok(marks.includes(JSON.stringify(['title', {}, one.title]).slice(0, -2)), `${one.title} has its tooltip`);
  assert.ok(marks.includes('rt-quiet'), 'a name that gives way is drawn quiet');
  assert.ok(drawn.viewport({ x: 0, y: 0, width: 1, height: 1, scale: 0.5 }).some((p: any) => p.set?.transform?.includes('scale(2)')), 'names keep their size on screen');
});

test('given the room it is shown in, the grown tree closes its rings to fit there, names and all', () => {
  const places = ['tool:change', 'tool:query', 'file:packs/canvas/layouts/*.js', 'session_start', 'working_rules', 'guide:style_code'];
  const items = Array.from({ length: 36 }, (_, i) => node(i, { title: `A rule of the harness, number ${i}`, fields: { for: [places[i % places.length]] } }));
  const tree = treeOf({ lens: { find: ['fit'] }, items, links: [partOf(7, 1), partOf(13, 7), partOf(19, 13)] }, undefined, n)!;
  const measure = (text: string, px: number) => text.length * px * 0.55;
  const free = radial(tree, z, n, measure, 2);
  const room = { width: free.width * 0.75, height: free.height * 0.75 };
  const fitted = radial(tree, z, n, measure, 2, room);
  assert.ok(fitted.width <= room.width + 1 && fitted.height <= room.height + 1, `${fitted.width} x ${fitted.height} in ${room.width} x ${room.height}`);
  assert.ok(fitted.reach < free.reach, 'the rings closed up');
  assert.equal(radial(tree, z, n, measure, 2, { width: free.width * 2, height: free.height * 2 }).reach, free.reach, 'room to spare: the rings stay as they are');
});

test('the pack’s counts and misses make the story: a gap, a trial’s making, sayings on their days', () => {
  const records = [
    { id: 'e_trialaaa', tier: 'learned', status: 'trial', for: ['tool:change'], per_run: [{ said_at: '2026-11-18T10:00:00Z', verdict: 'failed' }] },
    { id: 'e_standing', tier: 'core', status: 'current', for: ['tool:assign'], per_run: [{ said_at: '2026-11-17T10:00:00Z', verdict: 'held' }, { said_at: '2026-11-17T11:00:00Z', verdict: 'quiet' }] },
  ];
  const misses = [
    { kind: 'refusal', at: '2026-11-18T09:00:00Z', where: 'tool:change', covered_by: ['e_trialaaa'] },
    { kind: 'refusal', at: '2026-11-16T09:00:00Z', where: 'push', covered_by: [] },
    { kind: 'trap', at: '2026-11-15T09:00:00Z', where: 'file:ui/*', covered_by: ['e_standing'] },
  ];
  const told = toldFrom(records, misses, Date.UTC(2026, 10, 19), 30);
  assert.deepEqual(told.misses.map((m: any) => [m.where, m.grew]), [['tool:change', 'e_trialaaa'], ['push', undefined]], 'a miss a standing node covers is none of the tree’s');
  assert.deepEqual(told.said.map((x: any) => x.verdict), ['failed', 'held', 'held']);
  const story = storyOf(answer(1, []), told, null, n);
  assert.equal(story.schematic, false);
  assert.equal(story.nodes.get('e_standing').tier, 'core');
});

test('rules stand on the tree where they guard, beside what is said there: a square, in their pack’s hue, firing a light of their own', async () => {
  const a = { ...answer(3, []), lens: { find: ['rules'] } };
  a.items[0].fields = { for: ['tool:change'] };
  const rules = [
    { id: 'core.status_owner', title: 'Only the owner closes', pack: 'core', effect: 'hold', where: 'tool:change:task:status', fired: ['2026-11-18T09:00:00Z', '2026-11-18T10:00:00Z'] },
    { id: 'build.ci_green', title: '"{title}" waits for CI', pack: 'build', effect: 'refuse', where: 'tool:change:task', fired: [] },
  ];
  const act = async (name: string, params: any) => (name === 'rules' ? { answer: rules } : { answer: params.ids.map((one: string) => ({ id: one, said: 0 })) });
  const drawn = await picture({ answer: a, style: { ...style, sends: { ...style.sends, rules: 'rules' } }, reduced: true }, { frame: () => new Promise(() => {}), patch() {}, open() {}, act });
  const svg = JSON.stringify(drawn.scene.svg), css = drawn.scene.css, key = JSON.stringify(drawn.scene.aside);
  assert.ok(svg.includes('n:~for:tool:change:task:status') && svg.includes('n:~for:tool:change:task'), 'a rule hangs under the op, the type, the field');
  assert.equal((svg.match(/"n:~for:tool:change"/g) || []).length, 1, 'the instruction said at tool:change and the rules share one bough');
  assert.ok(svg.includes('"rect",{"class":"rt-dot"'), 'a rule is a square');
  assert.ok(svg.includes('rt-p-core') && svg.includes('rt-p-build'), 'each node carries its pack');
  assert.ok(svg.includes('Only the owner closes · rule, hold · core'), 'its effect and pack in its tooltip');
  assert.ok(css.includes('.rt-p-build .rt-dot { fill: #'), 'a pack beyond core takes the next of the style’s hues');
  assert.ok(key.includes('lg:pack:build') && key.includes('lg:pack:core') && key.includes('Rule fired'));
  assert.ok(svg.includes('ci green · rule, refuse · build'), 'a rule whose title is a message with blanks goes by its own name');
  const tree = treeOf(a, (item: any) => item.fields?.for, n, rules.map((r) => ({ id: r.id, title: r.title, for: [r.where], kind: 'rule' })))!;
  const film = filmOf(tree, { ...storyOf(a, null, null, n), rules: rulesOf(rules) }, n);
  assert.equal(film.events.filter((e: any) => e.kind === 'fired').length, 2, 'each firing is a light of its own');
});

test('played from the start, the trunk comes in too: a rule there from the first frame is switched on', async () => {
  const a = { ...answer(2, []), lens: { find: ['trunk'] } };
  const rules = [{ id: 'core.guard', title: 'A guard', pack: 'core', effect: 'refuse', where: 'tool:change', fired: [] }];
  const on = new Set<string>();
  const act = async (name: string, params: any) => (name === 'rules' ? { answer: rules } : { answer: params.ids.map((one: string) => ({ id: one, said: 0 })) });
  const played = await picture({ answer: a, style: { ...style, sends: { ...style.sends, rules: 'rules' } }, reduced: false }, { frame: () => new Promise((r) => setTimeout(r, 1)), patch: (p: any[]) => p.forEach((x) => x.toggle?.on && on.add(x.key)), open() {}, act, surface: async () => null });
  await new Promise((r) => setTimeout(r, 40));
  played.end();
  assert.ok(on.has('n:core.guard'));
});

test('the legend is the filter: entries off leave the tree, every entry keeps its count, and a click asks the view’s pack', async () => {
  const a = { ...answer(3, []), lens: { find: ['legend'] } };
  const rules = [
    { id: 'core.guard', title: 'A guard', pack: 'core', effect: 'refuse', where: 'tool:change', fired: ['2026-11-18T00:00:00Z'] },
    { id: 'build.lane', title: 'A lane', pack: 'build', effect: 'hold', where: 'tool:change:task', fired: [] },
  ];
  const asked: any[] = [];
  const act = async (name: string, params: any) => (asked.push([name, params]), name === 'rules' ? { answer: rules } : name === 'legend' ? { answer: {} } : { answer: params.ids.map((one: string) => ({ id: one, said: 0 })) });
  const tools = { frame: () => new Promise(() => {}), patch() {}, open() {}, act };
  const sends = { ...style.sends, rules: 'rules', legend: 'legend' };
  const all = await picture({ answer: a, style: { ...style, sends }, reduced: true }, tools);
  const off = await picture({ answer: { ...a, lens: { find: ['legend-off'] } }, style: { ...style, sends, hidden: ['kind:rule', 'event:fired'] }, reduced: true }, tools);
  const svgAll = JSON.stringify(all.scene.svg), svgOff = JSON.stringify(off.scene.svg), legendOff = JSON.stringify(off.scene.aside);
  assert.ok(svgAll.includes('n:core.guard') && svgAll.includes('n:build.lane'));
  assert.ok(!svgOff.includes('n:core.guard') && !svgOff.includes('n:build.lane'), 'rules turned off leave the tree');
  assert.ok(!svgOff.includes('n:~for:tool:change:task'), 'a bough with nothing left under it goes too');
  assert.ok(legendOff.includes('"rt-lg-row rt-off toggles"'), 'an entry off is marked off');
  assert.ok(/"Rules"\],\["span",\{"class":"rt-lg-n"\},"2"\]/.test(legendOff), 'an entry off still says how many');
  const reflexOnly = (await picture({ answer: { ...a, lens: { find: ['legend-click'] } }, style: { ...style, sends, hidden: ['kind:rule'] }, reduced: false }, { ...tools, surface: async () => null }));
  const patched = reflexOnly.on({ name: 'click', key: 'lg:kind:rule' });
  reflexOnly.end();
  const sent = asked.filter((x) => x[0] === 'legend').at(-1)[1];
  assert.deepEqual([sent.view, sent.entry, sent.on], ['reflex_view.tree', 'kind:rule', true], 'a click asks the pack to turn it back on, on the owner’s version of the shipped view');
  assert.ok(sent.style.shape === 'reflex_tree' && !('hidden' in sent.style) && sent.filter.find.length, 'with the style and query drawn, should it have to make that version');
  assert.deepEqual(patched, [{ key: 'lg:kind:rule', toggle: { 'rt-off': false } }]);
  const none = await picture({ answer: { ...a, lens: { find: ['legend-none'] } }, style: { ...style, sends, hidden: ['kind:rule', 'kind:instruction'] }, reduced: true }, tools);
  assert.ok(none.scene.aside, 'everything filtered out, the legend stays to bring it back');
});

test('a branch whose place can be said takes a new trial node there, through the view’s pack, its words asked first', async () => {
  assert.deepEqual(['~for:tool:change', '~for:tool:change:task:status', '~for:file:packs/canvas/', '~for:session_start', '~for:tool', '~for:guide:style_code', '~for:push'].map(placeOfBough),
    ['tool:change', 'tool:change', 'file:packs/canvas/**', 'session_start', null, 'guide:style_code', null]);
  const a = { ...answer(2, []), lens: { find: ['add'] } };
  a.items[0].fields = { for: ['tool:change'] };
  const asked: any[] = [];
  const act = async (name: string, params: any, more?: any) => (asked.push([name, params, more]), { answer: params.ids ? params.ids.map((one: string) => ({ id: one, said: 0 })) : {} });
  const drawn = await picture({ answer: a, style: { ...style, sends: { ...style.sends, add: 'add' } }, reduced: true }, { frame: () => new Promise(() => {}), patch() {}, open() {}, act });
  assert.ok(JSON.stringify(drawn.scene.svg).includes('rt-adds'), 'a branch that takes a node is marked so');
  drawn.on({ name: 'click', key: 'n:~for:tool:change' });
  const add = asked.find((x) => x[0] === 'add');
  assert.deepEqual(add[1], { for: 'tool:change' });
  assert.equal(add[2].asks[0].field, 'title', 'the page asks for its words first');
  const { add: _add, ...noAdd } = style.sends;
  const none = await picture({ answer: { ...a, lens: { find: ['no-add'] } }, style: { ...style, sends: noAdd }, reduced: true }, { frame: () => new Promise(() => {}), patch() {}, open() {}, act });
  assert.ok(!JSON.stringify(none.scene.svg).includes('rt-adds'), 'where the view sends no add, a branch takes nothing');
});
