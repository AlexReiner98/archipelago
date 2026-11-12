// A published finding reads in one line (task e_cg5y8qdy): the findings pack's rules refuse, from an agent, a finding with no
// value, a note past three lines, an option, a bug or a placeholder title, and each refusal says what to send instead.
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { test } from 'node:test';
import { Registry } from '../packs/loader/kernel/packs.ts';
import { checkRules, judge, type Target, type Who, type Written } from '../packs/rules/kernel/rules.ts';

const reg = new Registry(join(import.meta.dirname, '..', 'packs'));
const agent: Who = { human: false };
const person: Who = { human: true };
const finding = (title: string, props: Record<string, unknown> = { value: 42, value_type: 'number', unit: 'kW' }, body?: string) =>
  ({ op: 'create', type: 'finding', title, props, ...(body !== undefined && { body }) }) as Written;
const refused = (w: Written, who: Who = agent, targets: Target[] = []) => judge(reg.rules, reg, who, w, targets).refused;

test('a finding said in one line passes', () => {
  assert.deepEqual(refused(finding('Peak load is 42 kW', undefined, 'Read off the meter on the hottest day.\nTwo readings agreed.')), []);
  assert.deepEqual(refused(finding('Snowdon baseline', { value: 557, value_type: 'number', unit: 's' })), [], 'a name with its value reads');
});

test('a finding with no value is refused, and told what it is instead', () => {
  const [why] = refused(finding('Requests a minute', { value_type: 'number' }));
  assert.match(why, /"Requests a minute": a finding carries its value/);
  assert.match(why, /research or a question/);
  assert.equal(refused(finding('Requests a minute', { value: '' })).length, 1);
});

test('a note past three lines or 400 characters is refused', () => {
  assert.match(refused(finding('Peak load is 42 kW', undefined, 'one\ntwo\n\nthree\nfour'))[0], /three lines and 400 characters at most/);
  assert.equal(refused(finding('Peak load is 42 kW', undefined, 'x'.repeat(401))).length, 1);
  assert.deepEqual(refused(finding('Peak load is 42 kW', undefined, 'one\n\ntwo\n\nthree\n')), [], 'blank lines are not lines');
});

test('an option, a bug and a placeholder are refused with what to send', () => {
  assert.match(refused(finding('Option B: cache the shore'))[0], /a question part_of the decision/);
  assert.match(refused(finding('Alternative: split the read'))[0], /alternative_for/);
  assert.deepEqual(refused(finding('Optional fields are rare')), [], 'a word that only starts with option');
  assert.match(refused(finding('Bug: the shore drops units'))[0], /Make it the work that fixes it/);
  assert.deepEqual(refused(finding('Debug logs are quiet')), []);
  assert.match(refused(finding('Peak load, as Energy reads it'))[0], /the claim itself, as a sentence/);
});

test('only what the op writes is read, and a person is not refused', () => {
  const old: Target = { id: 'e_1', type: 'finding', title: 'Option B: cache the shore', status: 'current', props: {} };
  assert.deepEqual(refused({ op: 'update', status: 'withdrawn' } as Written, agent, [old]), [], 'an unreadable finding may still be withdrawn');
  assert.equal(refused({ op: 'update', title: 'Option C' } as Written, agent, [old]).length, 1);
  assert.deepEqual(refused(finding('Option B', {}), person), []);
});

test('a pattern that is none is refused when a pack is read', () => {
  const rules = [{ id: 'bad', pack: 'x', when: { type: 'finding', matches: { title: '(' } }, then: 'refuse' as const }];
  assert.match(checkRules(rules, reg).join('\n'), /matches.title is no pattern/);
});
