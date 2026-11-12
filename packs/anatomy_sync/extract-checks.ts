// The structure checks' extractor: each check of test/structure.test.ts is a principle the code keeps, with how many
// known breaks its list still holds (each rule keeps a list of what broke it; an entry only goes, and 0 is the rule
// met). A check's lists are those declared between the check before it and itself.

import { title, type Extractor, type Want, type WantLink } from './model.ts';

const FILE = 'test/structure.test.ts';
const LIST = /^const (\w+)\s*:\s*(?:Record<string, number>|Owed)\s*=\s*\{([\s\S]*?)\};/gm;
const CHECK = /^test\(\s*(['"`])(.+?)\1/gm;
const HEADING = /^\/\/ (\d+\. .+)$/gm;

/** Each check, its known breaks and the rule's heading above it. */
export function checksOf(text: string): { check: string; breaks: number; heading?: string }[] {
  const marks = [
    ...[...text.matchAll(LIST)].map((m) => ({ at: m.index, breaks: [...m[2].matchAll(/['"`][^'"`]+['"`]\s*:/g)].length })),
    ...[...text.matchAll(CHECK)].map((m) => ({ at: m.index, check: m[2] })),
    ...[...text.matchAll(HEADING)].map((m) => ({ at: m.index, heading: m[1] })),
  ].sort((a, b) => a.at - b.at) as { at: number; breaks?: number; check?: string; heading?: string }[];
  const out: { check: string; breaks: number; heading?: string }[] = [];
  let breaks = 0, heading: string | undefined;
  for (const m of marks) {
    if (m.heading) heading = m.heading;
    else if (m.breaks !== undefined) breaks += m.breaks;
    else if (m.check) { out.push({ check: m.check, breaks, ...(heading && { heading }) }); breaks = 0; }
  }
  return out;
}

export const checks: Extractor = {
  id: 'checks',
  owns: (path) => path === FILE,
  extract(files) {
    const f = files.find((x) => x.path === FILE && x.repo === 'open_core');
    const items: Want[] = [], links: WantLink[] = [];
    for (const c of f ? checksOf(f.text) : []) {
      const key = `check:${c.check}`;
      items.push({ key, type: 'anatomy.principle', title: title(c.check[0].toUpperCase() + c.check.slice(1)), body: c.heading ? `Rule ${c.heading}` : '', props: { check: c.check, breaks: c.breaks } });
      links.push({ type: 'part_of', from: key, to: 'pack:core' });
    }
    return { items, links };
  },
};
