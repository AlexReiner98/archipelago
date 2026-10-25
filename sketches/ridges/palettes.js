// Each archipelago's palette: paper, ink, and the colours islands are banded in.
// The first four were drawn by fromPixels from photos of each place on Wikimedia Commons (25 Oct 2026; each photo
// is credited under it, and used only to read its colours). The hand-picked ones follow, to compare.

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
export function fromPixels(data, k = 9, seed = 1) {
  const px = [];
  for (let i = 0; i < data.length; i += 4) if (data[i + 3] > 200) px.push(oklab(data[i], data[i + 1], data[i + 2]));
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
