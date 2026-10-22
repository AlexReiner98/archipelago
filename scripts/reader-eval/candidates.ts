// The models the evaluation can try, by short name, priced as their providers list them (a million tokens).
//
// Scaleway's Generative APIs (Paris) are an OpenAI-compatible server: `scw:<model>` for any model there, priced from
// the list below when it is on it. Its prices are in euros, before tax (Scaleway's price list, 22 Oct 2026); a
// result says each model's cost in its own currency.

import type { Candidate } from './replay.ts';

type Known = Omit<Candidate, 'key' | 'url'>;
const anthropic = (model: string, input: number, output: number): Known => ({ model, provider: 'anthropic', price: { input, output }, currency: 'USD' });
const scw = (model: string, input: number, output: number): Known => ({ model, provider: 'compatible', price: { input, output }, currency: 'EUR' });

export const ANTHROPIC: Record<string, Known> = {
  haiku: anthropic('claude-haiku-5-5', 0.1, 0.5),
  sonnet: anthropic('claude-sonnet-5-5', 2, 10),
  opus: anthropic('claude-opus-5-5', 4, 20),
  fable: anthropic('claude-fable-5-1', 10, 50),
};

/** Scaleway's chat models, cheapest first by what a push mostly costs (what is read). */
export const SCALEWAY: Record<string, Known> = Object.fromEntries(
  [
    scw('mistral-small-3.2-24b-instruct-2506', 0.15, 0.35),
    scw('gpt-oss-120b', 0.15, 0.6),
    scw('qwen3.6-35b-a3b', 0.25, 1.5),
    scw('gemma-4-26b-a4b-it', 0.25, 0.5),
    scw('deepseek-v4-flash-0731', 0.4, 0.8),
    scw('deepseek-v4.1-flash', 0.6, 1.8),
    scw('qwen3.8-27b', 0.6, 3.3),
    scw('qwen3.5-397b-a17b', 0.6, 3.6),
    scw('qwen3-235b-a22b-instruct-2507', 0.75, 2.25),
    scw('llama-3.3-70b-instruct', 0.9, 0.9),
    scw('mistral-medium-3.5-128b', 1.5, 7.5),
    scw('glm-5.2', 1.8, 5.5),
    scw('glm-5.3', 1.8, 5.5),
  ].map((k) => [k.model, k]),
);

/** A spread across Scaleway's price tiers, small to large: `--models scaleway`. */
export const SCALEWAY_SPREAD = ['mistral-small-3.2-24b-instruct-2506', 'gpt-oss-120b', 'deepseek-v4-flash-0731', 'llama-3.3-70b-instruct', 'qwen3.5-397b-a17b', 'mistral-medium-3.5-128b', 'glm-5.3'];

const keyName = (c: Known) => (c.provider === 'anthropic' ? 'ANTHROPIC_API_KEY' : c.provider === 'openai' ? 'OPENAI_API_KEY' : c.currency === 'EUR' ? 'SCW_SECRET_KEY' : 'READER_EVAL_KEY');

/** The specs a --models list names: "scaleway" is the spread above. */
export const expand = (list: string): string[] => list.split(',').map((s) => s.trim()).filter(Boolean).flatMap((s) => (s === 'scaleway' ? SCALEWAY_SPREAD.map((m) => `scw:${m}`) : [s]));

/** A candidate by its spec, or why it is skipped: a model without a key is said, not run. */
export function candidate(spec: string, env: NodeJS.ProcessEnv, where: string): Candidate | string {
  if (spec === 'none') return { model: 'none', provider: 'anthropic', key: 'none', price: { input: 0, output: 0 }, currency: 'USD' };
  const s = /^scw:(.+)$/.exec(spec);
  const m = /^(anthropic|openai|compatible):([^@]+)@([\d.]+)\/([\d.]+)$/.exec(spec);
  const c: Known | undefined = ANTHROPIC[spec] ?? (s ? (SCALEWAY[s[1]] ?? (/@/.test(s[1]) ? undefined : scw(s[1], NaN, NaN))) : m ? { model: m[2], provider: m[1] as Candidate['provider'], price: { input: Number(m[3]), output: Number(m[4]) }, currency: 'USD' } : undefined);
  if (!c) throw new Error(`"${spec}" is no candidate: give none, ${Object.keys(ANTHROPIC).join(', ')}, scaleway, scw:<model>, or provider:model@in/out.`);
  if (Number.isNaN(c.price.input)) return `${c.model}: no price known (give it as compatible:${c.model}@in/out with READER_EVAL_URL)`;
  const key = env[keyName(c)];
  if (!key && c.provider !== 'compatible') return `${c.model}: no key (set ${keyName(c)}, or put it in ${where})`;
  if (c.currency === 'EUR') return key ? { ...c, key, url: (env.SCW_API_BASE || 'https://api.scaleway.ai/v1').replace(/\/+$/, '') } : `${c.model}: no key (set SCW_SECRET_KEY, or put it in ${where})`;
  return { ...c, key, ...(c.provider === 'compatible' && { url: env.READER_EVAL_URL }) };
}
