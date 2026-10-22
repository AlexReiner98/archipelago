// The results as a note for the map: the point first, then a table a section at a time. Numbers only, no titles.

import type { Fixture, Summary } from './score.ts';

const pct = (n: number) => `${Math.round(n * 100)}%`;
const money = (n: number, currency: string) => `${currency === 'EUR' ? '€' : '$'}${n < 0.01 ? n.toFixed(4) : n.toFixed(3)}`;

export function report(fixtures: Fixture[], models: Summary[], chosen: { default?: Summary; fallback?: Summary; why: string }, skipped: string[] = []): string {
  const labels = fixtures.flatMap((f) => f.labels);
  const strong = labels.filter((l) => !l.weak);
  const count = (xs: typeof labels, v: 'good' | 'bad') => xs.filter((l) => l.verdict === v).length;
  const rows = models.map((m) => `| ${m.model} | ${pct(m.quality)} | ${pct(m.strict)} | ${pct(m.precision)} | ${pct(m.recall)} | ${m.copies} | ${m.perPush.toFixed(1)} | ${money(m.usdPerPush, m.currency)} | ${m.secondsPerPush.toFixed(0)}s | ${Math.round(m.tokens / Math.max(m.runs, 1)).toLocaleString('en')} | ${m.failed}/${m.runs} |`);
  return [
    chosen.default
      ? `Use ${chosen.default.model} for the push reader${chosen.fallback ? `, with ${chosen.fallback.model} as its fallback` : ''}. ${chosen.why}`
      : chosen.why,
    '',
    'Results',
    '',
    '| Model | Quality | Precision (strict) | Precision (judged) | Recall | Copies | Changes/push | Cost/push | Time/push | Tokens/push | Failed |',
    '|---|---|---|---|---|---|---|---|---|---|---|',
    ...rows,
    '',
    ...(skipped.length ? ['Not run', '', ...skipped.map((s) => `- ${s}`), ''] : []),
    'What was measured',
    '',
    `${fixtures.length} pushes the reader read, replayed offline on each model against a throwaway map holding the open items as they stood and the GitHub answers recorded for the push. ${labels.length} labels: ${count(strong, 'good')} right and ${count(strong, 'bad')} wrong changes on the owner's word, the log or a copy check, and ${labels.length - strong.length} that stand only because nobody undid them.`,
    '',
    '- Precision (strict): changes a label says the owner would approve, over all changes sent; a change no label speaks to counts against.',
    '- Precision (judged): the same over labelled changes only.',
    '- Recall: closes the push brought (approved, or made citing its commits and kept), that the replay made.',
    '- Quality: precision (strict) and recall together, precision weighted twice.',
    '- Copies: items created whose title matches an open one.',
    '- Cost: in the currency the provider prices in (Scaleway in euros before tax, Anthropic in dollars).',
    '',
  ].join('\n');
}
