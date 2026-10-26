// Each archipelago's palette: paper, ink, and the colours islands are banded in.
// The first four were drawn by fromPixels from photos of each place on Wikimedia Commons (25 Oct 2026; each photo
// is credited under it, and used only to read its colours). The hand-picked ones follow, to compare.

import { CANADA } from './canada.js';
import { MORE, NEW, MORE_ACCENTS, ASIDE } from './canada-more.js';

const commons = (file, by, license) => ({ page: `https://commons.wikimedia.org/wiki/File:${encodeURIComponent(file.replaceAll(' ', '_'))}`, by, license });

export const PLACES = {
  faroe: {
    title: 'Faroe', paper: '#faf4ee', ink: '#0e1014', colours: ['#26292b', '#174289', '#616549', '#3872c2', '#878478', '#7aaa3b', '#9a9ca1', '#c2b685', '#cccfd5'],
    weights: [0.23, 0.095, 0.499, 0.076, 0.379, 0.131, 0.282, 0.181, 0.237],
    photos: [
      commons('Hvannhagi 9.jpg', 'kallerna', 'CC BY-SA 4.0'),
      commons('Fratercula arctica, Faroe Islands.jpg', 'Ulrich Latzenhofer', 'CC BY-SA 2.0'),
      commons('Black house in Mykines Faroe Islands.jpg', 'Arne List', 'CC BY-SA 3.0'),
      commons('Faroe Islands, Viđoy, eastern shore with Talvborđ, 557 m.jpg', 'Vincent van Zeijst', 'CC BY-SA 3.0'),
      commons('Saksun, Faroe Islands (5).JPG', 'Erik Christensen', 'CC BY-SA 3.0'),
      commons('Saksun, Faroe Islands (6).JPG', 'Erik Christensen', 'CC BY-SA 3.0'),
    ],
  },
  galapagos: {
    title: 'Galápagos', paper: '#e9e4dd', ink: '#0b0909', colours: ['#400c05', '#34302d', '#4d443e', '#94341c', '#7d746c', '#107dd3', '#9c9182', '#52a5e0', '#96c4e7'],
    weights: [0.164, 0.282, 0.303, 0.13, 0.265, 0.131, 0.227, 0.149, 0.229],
    photos: [
      commons('Costa de isla Santa Cruz, islas Galápagos, Ecuador, 2015-07-26, DD 49.JPG', 'Diego Delso', 'CC BY-SA 4.0'),
      commons('Paisaje en Cerro Brujo, isla de San Cristóbal, islas Galápagos, Ecuador, 2015-07-24, DD 114.JPG', 'Diego Delso', 'CC BY-SA 4.0'),
      commons('Brachycereus nesioticus, Genovesa 2010 10 02 1591 (5155216287).jpg', 'Harvey Barrison', 'CC BY-SA 2.0'),
      commons('Sally Lightfoot crab (4202519454).jpg', 'Peter Wilton', 'CC BY 2.0'),
      commons('Sally Lightfoot crab (4229022550).jpg', 'Peter Wilton', 'CC BY 2.0'),
      commons('Iguana marina (Amblyrhynchus cristatus), Las Bachas, isla Santa Cruz, islas Galápagos, Ecuador, 2015-07-23, DD 23.jpg', 'Diego Delso', 'CC BY-SA 4.0'),
    ],
  },
  rajaAmpat: {
    title: 'Raja Ampat', paper: '#e5e5dd', ink: '#0f1010', colours: ['#3a3b2f', '#194969', '#545741', '#0969b0', '#b03f30', '#29804d', '#787455', '#8e9388', '#60c27a'],
    weights: [0.335, 0.223, 0.265, 0.208, 0.071, 0.163, 0.263, 0.366, 0.152],
    photos: [
      commons('Raja Ampat Islands - journal.pbio.1001457.g001.png', 'Jonathan Chase', 'CC BY 2.5'),
      commons('Majestic Raja Ampat.jpg', 'Nickoasmara', 'CC BY-SA 4.0'),
      commons('Pulau Piaynemo, Raja Ampat.jpg', 'Rizalubun', 'CC BY-SA 4.0'),
      commons("Reefscape in the Bird's Head Seascape.jpg", "Bird's Head Seascape / Jones/Shimlock", 'CC BY-SA 4.0'),
      commons('PIAYNEMO.jpg', 'Hadi Nyali', 'CC BY-SA 4.0'),
      commons("Wilson's Bird of Paradise Best.jpg", 'Serhanoksay', 'CC BY-SA 3.0'),
    ],
  },
  haidaGwaii: {
    title: 'Haida Gwaii', paper: '#e7e4e0', ink: '#0b0a0a', colours: ['#1e2d20', '#435236', '#4c682e', '#814f38', '#6d6f6a', '#6e8640', '#a67755', '#a8a85b', '#c3cf69'],
    weights: [0.391, 0.365, 0.212, 0.191, 0.23, 0.169, 0.193, 0.222, 0.126],
    photos: [
      commons('Haida Gwaii 2015 52.jpg', 'Murray Foubister', 'CC BY-SA 2.0'),
      commons('Haida villagesite.jpg', 'Grizzly01en', 'Public domain'),
      commons("S'G̱ang Gwaay Llanagaay 6291.jpg", 'Yvrsigmatech', 'Public domain'),
      commons('Haida Gwaii - View from Tow Hill (26646362554).jpg', 'Christine Rondeau', 'CC BY 2.0'),
      commons('Haida Gwaii 2015 48.jpg', 'Murray Foubister', 'CC BY-SA 2.0'),
      commons('Haida Gwaii 2015 50.jpg', 'Murray Foubister', 'CC BY-SA 2.0'),
      commons("Haida Gwaii (Queen Charlotte Islands) - around Louise Island by Zodiak - visit to an old logging site where Sitka Spruce trees in the early 1940's were harvested for the contruction of mosquito (21536456356).jpg", 'Murray Foubister', 'CC BY-SA 2.0'),
    ],
  },
  cyclades: {
    title: 'Cyclades', paper: '#ece3d7', ink: '#222022', colours: ['#6f1f3c', '#0e4978', '#6d5c48', '#3672b2', '#c06d47', '#6d9bc9', '#b19a81', '#c8baa7', '#8ed0fe'],
    weights: [0.086, 0.168, 0.193, 0.229, 0.237, 0.354, 0.233, 0.207, 0.149],
    photos: [
      commons('Oia - Santorini - Greece - 16.jpg', 'Norbert Nagel', 'CC BY-SA 3.0'),
      commons('Oia - Santorini - Greece - 13.jpg', 'Norbert Nagel', 'CC BY-SA 3.0'),
      commons('Sarakiniko from boat, Milos, 152762.jpg', 'Zde', 'CC BY-SA 4.0'),
      commons('Sarakiniko beach, Milos, 15M6402.jpg', 'Zde', 'CC BY-SA 4.0'),
      commons('Santorini, Oia 12.jpg', 'LBM1948', 'CC BY-SA 4.0'),
      commons('Bougainvillea Tree, Mykonos, Greece (53503388869).jpg', 'Warren LeMay', 'CC BY-SA 2.0'),
    ],
  },
  svalbard: {
    title: 'Svalbard', paper: '#e6ebe4', ink: '#1b110c', colours: ['#604a34', '#45516e', '#56698a', '#846e56', '#71829d', '#9498a3', '#b99a71', '#d7b88e', '#c7d2dd'],
    weights: [0.137, 0.173, 0.201, 0.213, 0.223, 0.311, 0.159, 0.178, 0.254],
    photos: [
      commons('Sveabreen 1.JPG', 'Superchilum', 'CC BY-SA 3.0'),
      commons('Sveabreen 2.JPG', 'Superchilum', 'CC BY-SA 3.0'),
      commons('Svalbardrein pho.jpg', 'Per Harald Olsen', 'CC BY 2.5'),
      commons('Svalbard reindeers (Rangifer tarandus platyrhynchus) in the Tundra of Reinsdyrflya.jpg', 'Andreas Weith', 'CC BY-SA 4.0'),
      commons('Adventdalen Birkafjellet Operafjellet.jpg', 'Bjoertvedt', 'CC BY-SA 3.0'),
      commons('Albert I Land Arlabreen Westmanfjellet Liljeborgfjellet IMG 5208.JPG', 'Bjoertvedt', 'CC BY-SA 3.0'),
    ],
  },
  maldives: {
    title: 'Maldives', paper: '#e7e5db', ink: '#000000', colours: ['#141908', '#0d3b83', '#3e4746', '#3f6269', '#518082', '#468ecb', '#7c9a9f', '#52b1e5', '#b5b9ad'],
    weights: [0.135, 0.174, 0.191, 0.235, 0.245, 0.178, 0.255, 0.165, 0.281],
    photos: [
      commons('Ari Atoll passes.jpg', 'Bruno de Giusti', 'CC BY-SA 2.5 it'),
      commons('Maldives-Vakarufalhi.JPG', 'Civvi', 'CC BY-SA 3.0'),
      commons('Baa atoll islands.JPG', 'Frédéric Ducarme', 'CC BY-SA 4.0'),
      commons('Maldives (15383006025).jpg', 'Laika ac', 'CC BY-SA 2.0'),
      commons('Coco Palm Bodu Hithi Maldives - panoramio (7).jpg', 'calvinstkm', 'CC BY-SA 3.0'),
      commons('Coco Palm Bodu Hithi Maldives - panoramio (14).jpg', 'calvinstkm', 'CC BY-SA 3.0'),
    ],
  },
  hawaii: {
    title: 'Hawaiʻi', paper: '#fcf8f0', ink: '#0a0c0e', colours: ['#1e282c', '#4d3827', '#565c2c', '#89432b', '#bd603f', '#3593c5', '#97a869', '#c3d4d8', '#efe061'],
    weights: [0.309, 0.235, 0.167, 0.217, 0.151, 0.091, 0.176, 0.149, 0.117],
    photos: [
      commons('Pāhoehoe Lava flow.JPG', 'Brocken Inaglory', 'CC BY-SA 3.0'),
      commons('Na Pali coast Kauai 2.jpg', 'Aion (English Wikipedia)', 'CC BY-SA 3.0'),
      commons('Na Pali Coast, Kauai, Hawaii.jpg', 'Jeff Kubina', 'CC BY-SA 2.0'),
      commons('2021-10-07 10 55 03 The Red Dirt Waterfall along Hawaii State Route 550 (Waimea Canyon Drive) in Kauai, Hawaii.jpg', 'Famartin', 'CC BY-SA 4.0'),
      commons('Maohauhele.jpg', 'see Commons page', 'CC BY-SA 3.0'),
      commons('Starr 030424-0086 Hibiscus brackenridgei subsp. brackenridgei.jpg', 'Forest & Kim Starr', 'CC BY 3.0'),
    ],
  },
  faroeHand: { title: 'Faroe, by hand', paper: '#e7e1d4', ink: '#23292b', colours: ['#4f6b54', '#93a98a', '#2f3a40', '#5f7f95', '#b7c4c8', '#b5533a', '#d27a92', '#f1ece0', '#8a6a4a'] },
  galapagosHand: { title: 'Galápagos, by hand', paper: '#ecdfc4', ink: '#2a241f', colours: ['#3b3a36', '#c9512c', '#e2b13c', '#3f8f8a', '#6f7d3e', '#a9ad6c', '#d98f6a', '#f6eedb', '#2f5f7a'] },
  rajaAmpatHand: { title: 'Raja Ampat, by hand', paper: '#e6e8de', ink: '#14262b', colours: ['#2f7a5a', '#7fb38a', '#2bb3a6', '#1f5f8b', '#f2c14e', '#e76f51', '#d9487a', '#ef8a3c', '#f7f3e6'] },
  haidaGwaiiHand: { title: 'Haida Gwaii, by hand', paper: '#e4dfd2', ink: '#1b2420', colours: ['#3e5c45', '#7c9575', '#8a4b33', '#d9a03a', '#4a3354', '#6e8f96', '#c9c2b0', '#2c3b40', '#b65a3a'] },
};

const lin = (v) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
const gam = (v) => (v <= 0.0031308 ? v * 12.92 : 1.055 * v ** (1 / 2.4) - 0.055);
function oklab(r, g, b) {
  [r, g, b] = [lin(r / 255), lin(g / 255), lin(b / 255)];
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b), m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b), s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s, 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s, 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s];
}
function hex([L, a, b]) {
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3, m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3, s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  const rgb = [4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s, -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s, -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s];
  return '#' + rgb.map((v) => Math.round(Math.min(1, Math.max(0, gam(v))) * 255).toString(16).padStart(2, '0')).join('');
}

/** A palette's overall cast, in OKLab: its colours averaged by weight, vividness counted double. */
export function signature({ colours, weights }) {
  const w = weights ?? colours.map(() => 1), total = w.reduce((a, b) => a + b, 0);
  return colours.reduce((s, h, i) => {
    const [L, a, b] = oklab(...[1, 3, 5].map((k) => parseInt(h.slice(k, k + 2), 16)));
    return [s[0] + (L * w[i]) / total, s[1] + (2 * a * w[i]) / total, s[2] + (2 * b * w[i]) / total];
  }, [0, 0, 0]);
}

/** How much of a photo's pixels each colour stands for (nearest in OKLab), softened so an accent still shows. */
export function coverage(data, colours, soften = 0.6) {
  const lab = colours.map((h) => oklab(...[1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16))));
  const count = colours.map(() => 0);
  for (let i = 0; i < data.length; i += 4) {
    const p = oklab(data[i], data[i + 1], data[i + 2]);
    let best = 0, bd = Infinity;
    lab.forEach((c, k) => {
      const d = (p[0] - c[0]) ** 2 + (p[1] - c[1]) ** 2 + (p[2] - c[2]) ** 2;
      if (d < bd) (bd = d), (best = k);
    });
    count[best]++;
  }
  const total = count.reduce((a, b) => a + b, 0) || 1;
  return count.map((n) => +((n / total) ** soften).toFixed(3));
}

/**
 * A palette from a photo's pixels (RGBA, as getImageData gives): k-means in OKLab, where distance is how
 * different colours look. Chroma is weighted up, so a small bright flower is not lost in a large grey sea.
 * The lightest cluster becomes the paper, the darkest the ink, the rest the colours.
 */
export function fromPixels(data, k = 9, seed = 1, only = null) {
  const px = [];
  for (let i = 0; i < data.length; i += 4) if (data[i + 3] > 200) px.push(oklab(data[i], data[i + 1], data[i + 2]));
  // Land and water can be drawn apart, so the sea and sky do not crowd the land out of its own palette.
  if (only === 'land') px.splice(0, px.length, ...px.filter((p) => !isBlue(p)));
  if (only === 'sea') px.splice(0, px.length, ...px.filter(isBlue));
  // Vivid: only the colourful, non-water pixels, for a species' accent (a puffin's beak, not the sky behind it).
  if (only === 'vivid') px.splice(0, px.length, ...px.filter((p) => !isBlue(p) && Math.hypot(p[1], p[2]) > 0.06));
  const weight = (p) => 1 + 6 * Math.hypot(p[1], p[2]);
  let s = seed;
  const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  // Start from far-apart pixels (k-means++), then settle.
  const centres = [px[Math.floor(rnd() * px.length)]];
  while (centres.length < Math.max(16, k + 2)) {
    const d2 = px.map((p) => Math.min(...centres.map((c) => (p[0] - c[0]) ** 2 + (p[1] - c[1]) ** 2 + (p[2] - c[2]) ** 2)) * weight(p));
    let pick = rnd() * d2.reduce((a, b) => a + b, 0), i = 0;
    while ((pick -= d2[i]) > 0 && i < px.length - 1) i++;
    centres.push(px[i]);
  }
  for (let round = 0; round < 12; round++) {
    const sum = centres.map(() => [0, 0, 0, 0]);
    for (const p of px) {
      let best = 0, bd = Infinity;
      centres.forEach((c, i) => {
        const dd = (p[0] - c[0]) ** 2 + (p[1] - c[1]) ** 2 + (p[2] - c[2]) ** 2;
        if (dd < bd) (bd = dd), (best = i);
      });
      const w = weight(p);
      sum[best][0] += p[0] * w, sum[best][1] += p[1] * w, sum[best][2] += p[2] * w, sum[best][3] += w;
    }
    sum.forEach((t, i) => t[3] && (centres[i] = [t[0] / t[3], t[1] / t[3], t[2] / t[3]]));
  }
  // How much of the photo each cluster holds.
  const share = centres.map(() => 0);
  for (const p of px) {
    let best = 0, bd = Infinity;
    centres.forEach((c, i) => {
      const dd = (p[0] - c[0]) ** 2 + (p[1] - c[1]) ** 2 + (p[2] - c[2]) ** 2;
      if (dd < bd) (bd = dd), (best = i);
    });
    share[best] += 1 / px.length;
  }
  const order = centres.map((c, i) => i).sort((a, b) => centres[a][0] - centres[b][0]);
  const [dk, lt] = [centres[order[0]], centres[order[order.length - 1]]];
  // The colours: chosen one by one, each as far as can be from those already chosen, counting both how vivid it is
  // and how much of the place it covers. A sea and a puffin's beak both make it.
  const dist = (a, b) => Math.hypot(centres[a][0] - centres[b][0], centres[a][1] - centres[b][1], centres[a][2] - centres[b][2]);
  // A colour that would read as ink is left to the ink.
  const pool = order.slice(1, -1).filter((i) => dist(i, order[0]) > 0.1), chosen = [pool.reduce((a, b) => (share[b] > share[a] ? b : a))];
  while (chosen.length < Math.min(k, pool.length)) {
    let best = -1, score = -1;
    for (const i of pool) {
      if (chosen.includes(i)) continue;
      const s = Math.min(...chosen.map((c) => dist(i, c))) * (1 + 3 * Math.hypot(centres[i][1], centres[i][2])) * Math.sqrt(share[i] + 0.01);
      if (s > score) (score = s), (best = i);
    }
    chosen.push(best);
  }
  // Ink kept dark and paper light and quiet, tinted by the photo's darkest and lightest.
  return {
    title: 'From photo',
    ink: hex([Math.min(dk[0], 0.28), dk[1] * 0.5, dk[2] * 0.5]),
    paper: hex([Math.max(lt[0], 0.92), lt[1] * 0.35 + 0.004, lt[2] * 0.35 + 0.012]),
    colours: chosen.sort((a, b) => centres[a][0] - centres[b][0]).map((i) => hex(centres[i])),
    // How much of the place each colour covers, softened so an accent still shows: the tool uses colours this often.
    weights: chosen.map((i) => +(share[i] ** 0.6).toFixed(3)),
  };
}

// How each place's land stands, on top of the dials: height and step as multiples, ruggedness and softness as
// shifts, flat tops (top) and sheer sides (cliff) from 0 to 1, and whether its islands are reef rings (atoll).
const FORMS = {
  faroe: { rise: 1.25, rugged: 0.2, step: 1.1, soft: -0.15, top: 0, cliff: 0.6 },        // fjord cliffs, crisp steps
  svalbard: { rise: 1.1, rugged: 0.3, step: 1, soft: -0.1, top: 0, cliff: 0.5 },         // glaciated peaks
  rajaAmpat: { rise: 1, rugged: -0.2, step: 0.8, soft: -0.05, top: 0.65, cliff: 0.9 },   // karst towers, sheer and flat-topped
  galapagos: { rise: 0.9, rugged: -0.35, step: 1, soft: 0.2, top: 0, cliff: 0 },         // broad shield volcanoes
  hawaii: { rise: 1.35, rugged: -0.15, step: 1, soft: 0.15, top: 0, cliff: 0.2 },        // tall volcanoes
  maldives: { rise: 0.22, rugged: -0.4, step: 0.7, soft: 0.3, top: 0, cliff: 0, atoll: true }, // low reef islets
  cyclades: { rise: 0.8, rugged: 0.1, step: 1, soft: 0, top: 0, cliff: 0.45 },           // dry hills, caldera walls
  haidaGwaii: { rise: 0.8, rugged: 0, step: 1, soft: 0.1, top: 0, cliff: 0.2 },          // forested, rolling
};
// Canada's archipelagos join the places, with Haida Gwaii, for the study.
Object.assign(PLACES, CANADA);
PLACES.haidaGwaii.region = 'canada';
/**
 * Accents draw the eye, so each must be its own colour. Tried most vivid first, one is kept only if it is truly
 * vivid (chroma 0.1 or more), stands clear of every colour of its palette (0.12 in OKLab), and differs in hue by 35
 * degrees or more from every accent kept before it: two pinks, or two sea greens, do not both stay. Three at most.
 */
function distinctAccents(accents, base) {
  const lab = (h) => oklab(...[1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16)));
  const chroma = (h) => Math.hypot(...lab(h).slice(1)), hue = (h) => (Math.atan2(lab(h)[2], lab(h)[1]) * 180) / Math.PI;
  const apart = (a, b) => Math.hypot(...lab(a).map((v, i) => v - lab(b)[i]));
  const hueGap = (a, b) => Math.abs(((hue(a) - hue(b) + 540) % 360) - 180);
  const kept = [];
  for (const c of [...accents].sort((a, b) => chroma(b) - chroma(a))) {
    if (kept.length >= 3 || chroma(c) < 0.1 || base.some((b) => apart(c, b) < 0.12) || kept.some((k) => hueGap(c, k) < 35)) continue;
    kept.push(c);
  }
  return kept;
}

// Seven more of them, and every Canadian place's accents from its flora and fauna. An accent joins the palette in
// lightness order at a modest weight, and is marked (accent) so the drawing can keep it for the smaller shapes.
const credit = ([file, by, license]) => commons(file, by, license);
for (const [k, extra] of Object.entries(MORE_ACCENTS)) (MORE[k].accents = [...MORE[k].accents, ...extra.add]), (MORE[k].flora = [...MORE[k].flora, ...extra.flora]);
for (const [k, more] of Object.entries(MORE)) {
  const p = (PLACES[k] ??= { ...NEW[k], region: 'canada', paper: more.paper, ink: more.ink, colours: more.colours, weights: more.weights, sea: more.sea, photos: more.photos.map(credit) });
  p.flora = more.flora.map(credit);
  const small = Math.min(...p.weights) * 0.6;
  p.accentsDropped = more.accents.filter((c) => !distinctAccents(more.accents, p.colours).includes(c));
  const all = [...p.colours.map((c, i) => [c, p.weights[i], false]), ...distinctAccents(more.accents, p.colours).map((c) => [c, small, true])];
  all.sort((a, b) => oklab(...[1, 3, 5].map((i) => parseInt(a[0].slice(i, i + 2), 16)))[0] - oklab(...[1, 3, 5].map((i) => parseInt(b[0].slice(i, i + 2), 16)))[0]);
  [p.colours, p.weights, p.accent] = [all.map((x) => x[0]), all.map((x) => +x[1].toFixed(3)), all.map((x) => x[2])];
}
for (const [k, p] of Object.entries(PLACES)) p.form ??= FORMS[k.replace(/Hand$/, '')];

// How mountainous each place really is: its highest point above the sea, in metres, rounded. From general reference
// knowledge, not checked against a survey; the low ones (Broken Group, Mingan, the two Ontario groups) are rough.
export const PEAKS = {
  hawaii: 4207, arctic: 2616, svalbard: 1713, galapagos: 1707, haidaGwaii: 1150, cyclades: 1004, rajaAmpat: 1000,
  faroe: 882, gulfIslands: 709, magdalen: 174, fundyIsles: 125, brokenGroup: 120, mingan: 50, thousandIslands: 30,
  thirtyThousand: 25, maldives: 2,
};
/**
 * How tall a place's islands stand, from its peak: on a log scale (a few metres to Mauna Kea), then stretched, so a
 * reef atoll barely clears the water and a volcano towers. Replaces the hand-set height in its landform.
 */
export const riseOf = (metres) => {
  const r = Math.log10(Math.max(1, metres)) / Math.log10(4207);
  return +(0.12 + 1.6 * r ** 2.5).toFixed(3);
};
for (const [k, p] of Object.entries(PLACES)) {
  const metres = PEAKS[k.replace(/Hand$/, '')] ?? p.peak;
  if (metres !== undefined) (p.peak = metres), (p.form = { ...p.form, rise: riseOf(metres) });
}

/**
 * Water's colour, in OKLab: a blue (toward blue, not toward red), or a clear cyan to turquoise (hue from about 175° round
 * to 265°, with real colour in it, so grey-teal rock stays land). Water colours are the sea's; the land is the rest.
 */
const isBlue = ([, a, b]) => {
  if (b < -0.03 && a < 0.03) return true;
  const hue = (Math.atan2(b, a) * 180) / Math.PI, chroma = Math.hypot(a, b);
  return chroma > 0.05 && (hue >= 175 || hue <= -95);
};

/** A palette's land colours: its colours and weights without the blues (all of them, if it is nothing but blue). */
export function landOf({ colours, weights, accent }) {
  const keep = colours.map((h) => !isBlue(oklab(...[1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16)))));
  if (!keep.some(Boolean)) return { colours, weights, accent };
  return { colours: colours.filter((_, i) => keep[i]), weights: weights?.filter((_, i) => keep[i]), accent: accent?.filter((_, i) => keep[i]) };
}

/**
 * A place's water, from its own blues: the deep sea (its darkest blue, taken deeper still) and three shallows from
 * offshore to the coast (its blues, dark to light, kept clear of the deep). A palette with too few blues has them
 * made from its most sea-like colour.
 */
export function waterOf({ colours, sea }) {
  const lab = colours.map((h) => oklab(...[1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16))));
  const seaLike = ([L, a, b]) => -b * 2 - Math.max(0, a) * 2 + Math.min(L, 0.7) - Math.abs(a + 0.03) * 0.5;
  // A palette may carry its water apart (sea), drawn from the photos' blue pixels; else its own blues.
  const blues = (sea ? sea.map((h) => oklab(...[1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16)))) : lab.filter(isBlue)).sort((p, q) => p[0] - q[0]);
  const base = blues[0] ?? lab.reduce((best, c) => (seaLike(c) > seaLike(best) ? c : best));
  // Hue of the place's sea, at least a little blue, for the deep and for any shade a palette lacks.
  const hue = [Math.min(base[1], 0), Math.min(base[2], -0.05)];
  const deep = [0.3, hue[0] * 0.9, hue[1] * 0.9];
  // Three shallows, darkest offshore: the place's blues where it has them, spread from L 0.5 up to the light.
  const want = [0.52, 0.66, 0.8];
  const shallows = want.map((L, i) => {
    // The darkest blue is the deep's; with enough blues, the shallows come from the rest.
    const from = blues.length > 3 ? blues.slice(1) : blues;
    const pick = from.length ? from[Math.min(from.length - 1, Math.round((i * (from.length - 1)) / 2))] : [L, ...hue];
    return hex([Math.max(pick[0], L), pick[1], pick[2]]);
  });
  return { deep: hex(deep), shallows };
}

// Where each place is: latitude and longitude of the archipelago's middle, rounded (general reference, approximate).
export const WHERE = {
  haidaGwaii: [53.3, -132.1], brokenGroup: [48.9, -125.3], gulfIslands: [48.8, -123.4], thirtyThousand: [45.4, -80.3],
  thousandIslands: [44.3, -76], mingan: [50.2, -63.9], magdalen: [47.4, -61.8], fundyIsles: [44.7, -66.8], arctic: [75, -95],
  faroe: [62, -6.9], galapagos: [-0.6, -90.4], rajaAmpat: [-0.5, 130.5], cyclades: [37, 25.2], svalbard: [78.6, 16],
  maldives: [3.2, 73.2], hawaii: [20.8, -156.3],
};
for (const [k, p] of Object.entries(PLACES)) p.where ??= WHERE[k.replace(/Hand$/, '')];

/**
 * Places laid out on a page by where they are: west to east across, north at the top (relative, not to scale). Each
 * axis is part true distance and mostly even spacing by rank (spread), so the order holds everywhere but a far place
 * (the Arctic) does not crowd the rest into a corner. Answers [x, y] in page units for each, or null if unknown.
 */
export function layout(places, width, height, margin = 0.14, spread = 0.7) {
  const known = places.filter((p) => p.where);
  const axis = (i, flip) => {
    const vs = known.map((p) => p.where[i]), lo = Math.min(...vs), hi = Math.max(...vs), sorted = [...vs].sort((a, b) => a - b);
    return (v) => {
      const lin = hi > lo ? (v - lo) / (hi - lo) : 0.5, rank = vs.length > 1 ? sorted.indexOf(v) / (vs.length - 1) : 0.5;
      const t = (1 - spread) * lin + spread * rank;
      return margin + (1 - 2 * margin) * (flip ? 1 - t : t);
    };
  };
  const ax = axis(1, false), ay = axis(0, true);
  return places.map((p) => p.where && [width * ax(p.where[1]), height * ay(p.where[0])]);
}

/** Whether OKLab falls inside the screen's colours (sRGB), with a hair of room. */
function inGamut([L, a, b]) {
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3, m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3, s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  return [4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s, -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s, -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s].every((v) => v >= -0.0005 && v <= 1.0005);
}

/**
 * A palette made richer and its character kept: every colour keeps its hue; its chroma is multiplied (greys stay
 * grey), held inside what a screen can show by easing the chroma back, never by shifting the hue; its lightness is
 * spread from the palette's weighted middle (darks darker, lights lighter, the order kept). The water too, gentler.
 */
export function enrich(p, { chroma = 1.4, contrast = 1.18, sea = 1.25, ceiling = 0.15, lift = 0 } = {}) {
  // A place can ask for more than the rest (boost): more chroma, livelier water, a little more light.
  const boost = p.boost ?? {};
  chroma *= boost.chroma ?? 1;
  sea *= boost.sea ?? 1;
  lift += boost.lift ?? 0;
  ceiling *= boost.chroma ?? 1;
  const lab = (h) => oklab(...[1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16)));
  const w = p.weights ?? p.colours.map(() => 1), total = w.reduce((a, b) => a + b, 0);
  const mid = p.colours.reduce((s, h, i) => s + (lab(h)[0] * w[i]) / total, 0);
  const richer = (h, k, spread) => {
    const [L, a, b] = lab(h), L2 = Math.min(0.95, Math.max(0.12, mid + (L - mid) * spread + lift * (spread > 1 ? 1 : 0))), C = Math.hypot(a, b);
    // The boost fades toward the lightest colours, where more chroma turns a pale moss to neon; and no colour passes
    // the ceiling, so earth stays earth.
    let c = 1 + (k - 1) * (1 - Math.max(0, Math.min(1, (L2 - 0.72) / 0.2)));
    if (C * c > ceiling) c = Math.max(1, ceiling / Math.max(C, 1e-6));
    while (c > 1 && !inGamut([L2, a * c, b * c])) c -= 0.02;
    return hex([L2, a * Math.max(c, 1), b * Math.max(c, 1)]);
  };
  return { ...p, colours: p.colours.map((h) => richer(h, chroma, contrast)), sea: p.sea?.map((h) => richer(h, sea, 1)), raw: { colours: p.colours, sea: p.sea } };
}

// Canada's palettes, enriched: more saturation and contrast, each colour's hue kept. The palettes as photographed
// stay on each as raw, for comparison (the study shows both).
for (const k of ASIDE) PLACES[k].region = 'canada-aside';
for (const [k, p] of Object.entries(PLACES)) if (p.region?.startsWith('canada')) PLACES[k] = enrich(p);
