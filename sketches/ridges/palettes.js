// Each archipelago's palette: paper, ink, and the colours islands are banded in. Hand-picked to start;
// fromPixels draws a palette out of a photo of the place instead.

export const PLACES = {
  faroe: { title: 'Faroe', paper: '#e7e1d4', ink: '#23292b', colours: ['#4f6b54', '#93a98a', '#2f3a40', '#5f7f95', '#b7c4c8', '#b5533a', '#d27a92', '#f1ece0', '#8a6a4a'] },
  galapagos: { title: 'Galápagos', paper: '#ecdfc4', ink: '#2a241f', colours: ['#3b3a36', '#c9512c', '#e2b13c', '#3f8f8a', '#6f7d3e', '#a9ad6c', '#d98f6a', '#f6eedb', '#2f5f7a'] },
  rajaAmpat: { title: 'Raja Ampat', paper: '#e6e8de', ink: '#14262b', colours: ['#2f7a5a', '#7fb38a', '#2bb3a6', '#1f5f8b', '#f2c14e', '#e76f51', '#d9487a', '#ef8a3c', '#f7f3e6'] },
  haidaGwaii: { title: 'Haida Gwaii', paper: '#e4dfd2', ink: '#1b2420', colours: ['#3e5c45', '#7c9575', '#8a4b33', '#d9a03a', '#4a3354', '#6e8f96', '#c9c2b0', '#2c3b40', '#b65a3a'] },
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
  while (centres.length < k + 2) {
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
  const byLight = [...centres].sort((a, b) => a[0] - b[0]);
  // Ink kept dark and paper light and quiet, tinted by the photo's darkest and lightest.
  const [dk, lt] = [byLight[0], byLight[byLight.length - 1]];
  return { title: 'From photo', ink: hex([Math.min(dk[0], 0.28), dk[1] * 0.5, dk[2] * 0.5]), paper: hex([Math.max(lt[0], 0.92), lt[1] * 0.35, lt[2] * 0.35]), colours: byLight.slice(1, -1).map(hex) };
}
