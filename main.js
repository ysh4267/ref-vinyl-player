// Recreates the spinning record and the wheel of note lines from the reference video (godly.design 616).
// Coordinates are video pixels (1920x1198); the record center sits on the left edge at (2, 598).

const SVGNS = 'http://www.w3.org/2000/svg';
const STAGE = { w: 1920, h: 1198 };
const CENTER = { x: 2, y: 598 };
const DISC_R = 560;
const PIVOT = { x: 341, y: 23 };
const RING_R = 590;
const SPIN = 40.25; // degrees per second, clockwise
const LINE_STEP = 13; // angle between lines
const SEEK = { from: -51.5, span: 103 }; // progress range on the outer arc, in degrees

// Color per note name (sampled from the video)
const COLORS = {
  c: [222, 98, 108],
  d: [222, 180, 88],
  eb: [226, 142, 184],
  f: [123, 104, 210],
  g: [110, 97, 210],
  bb: [78, 193, 100],
};

// Seconds per line, taken from when the lines change in the video.
const SONG = [
  { section: 'verse', text: 'g4 g4 bb4 c5 [eb5 d5] [c5 bb4]', dur: 2.0 },
  { section: 'verse', text: 'c5 c5 bb4 [c5 eb5] d5 c5 g4 _ _', dur: 2.6 },
  { section: 'drop', text: 'c6 g5 eb6 d6 [bb5 g5] [f5 d5]', dur: 1.4 },
  { section: 'hook', text: 'eb5 [eb5 f5 g5 f5] eb5 _ _', dur: 2.0, tag: '[pd fx]' },
  { section: 'hook', text: 'c5 c5 d5 eb5 d5 c5 _ _', dur: 2.0 },
  { section: 'hook', text: 'eb5 [eb5 f5 g5 f5] eb5 _ _', dur: 2.0, tag: '[pd fx]' },
  // The last line plays seven notes at the same pace and holds the final rests longer.
  { section: 'outro', text: 'g4 [bb4 c5 d5] [eb5 d5] c5 _ _ _', dur: 5.0, durs: [0.24, 0.24, 0.24, 0.24, 0.24, 0.24, 0.24, 0.55, 0.7, 2.07] },
];

const stage = document.getElementById('stage');
const scene = document.getElementById('scene');
const discCanvas = document.getElementById('disc');
const dctx = discCanvas.getContext('2d');
const deck = document.getElementById('deck');
const wheel = document.getElementById('wheel');
const playButton = document.getElementById('play');
const nowEl = document.getElementById('now');

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const mix = (a, b, t) => a + (b - a) * t;
const mixRGB = (a, b, t) => [mix(a[0], b[0], t), mix(a[1], b[1], t), mix(a[2], b[2], t)];
const rgb = (c, alpha = 1) => `rgb(${Math.round(c[0])} ${Math.round(c[1])} ${Math.round(c[2])} / ${alpha})`;
const smooth = (a, b, x) => {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};
const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);
const el = (tag, attrs = {}, parent = null) => {
  const node = document.createElementNS(SVGNS, tag);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
  if (parent) parent.appendChild(node);
  return node;
};

/* ------------------------------------------------------------- song */

// Split each line into tokens and give each a start time. Within a line every note (rests included) gets the same time.
let clock = 0;
const lines = SONG.map((line, index) => {
  const raw = line.text.split(' ');
  const tokens = raw.map((text) => {
    const name = text.replace(/[[\]]/g, '');
    const pitch = name === '_' ? null : name.replace(/\d+$/, '');
    return { text, name, pitch };
  });
  const each = line.dur / tokens.length;
  let at = clock;
  tokens.forEach((tok, k) => {
    tok.at = at;
    at += line.durs ? line.durs[k] : each;
  });
  const out = { ...line, index, start: clock, tokens, each };
  clock += line.dur;
  return out;
});
const TOTAL = clock;
// A rest keeps the color of the note before it.
let lastColor = COLORS.g;
for (const line of lines) {
  for (const tok of line.tokens) {
    if (tok.pitch) lastColor = COLORS[tok.pitch];
    tok.color = lastColor;
  }
}
const allTokens = lines.flatMap((line) => line.tokens.map((tok, k) => ({ ...tok, line: line.index, k })));

/* ------------------------------------------------------------- record */

// Value noise and fbm. The pattern is generated once.
function makeNoise(seed) {
  let s = seed >>> 0;
  const rand = () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
  const N = 256;
  const perm = new Uint16Array(N * 2);
  const vals = new Float32Array(N);
  const p = [...Array(N).keys()];
  for (let i = N - 1; i > 0; i -= 1) {
    const j = Math.floor(rand() * (i + 1));
    [p[i], p[j]] = [p[j], p[i]];
  }
  for (let i = 0; i < N * 2; i += 1) perm[i] = p[i & 255];
  for (let i = 0; i < N; i += 1) vals[i] = rand();
  const at = (x, y) => vals[perm[(perm[x & 255] + y) & 511]];
  return (x, y) => {
    const xi = Math.floor(x);
    const yi = Math.floor(y);
    const fx = x - xi;
    const fy = y - yi;
    const ux = fx * fx * (3 - 2 * fx);
    const uy = fy * fy * (3 - 2 * fy);
    const a = at(xi, yi);
    const b = at(xi + 1, yi);
    const c = at(xi, yi + 1);
    const d = at(xi + 1, yi + 1);
    return a + (b - a) * ux + (c - a) * uy + (a - b - c + d) * ux * uy;
  };
}

function fbm(noise, x, y) {
  let v = 0;
  let amp = 0.5;
  let f = 1;
  for (let o = 0; o < 4; o += 1) {
    v += amp * noise(x * f, y * f);
    f *= 2.03;
    amp *= 0.5;
  }
  return v / 0.9375;
}

// Pink base with violet and indigo swirls and orange streaks, built on a polar grid and smeared around the circle
// so it looks motion-blurred like the spinning record in the video.
function makeTexture() {
  const NR = 190;
  const NT = 1024;
  const R0 = 200;
  const R1 = 566;
  const noise = makeNoise(616);
  const field = new Float32Array(NR * NT * 3);
  const PINK = [228, 60, 140];
  const DEEP = [190, 44, 120];
  const LIGHT = [246, 112, 178];
  const VIOLET = [104, 56, 170];
  const INDIGO = [70, 58, 205];
  const ORANGE = [243, 137, 58];
  // Build two noise fields (v: violet areas, w: orange areas), then set thresholds by percentile so the colors spread evenly.
  const V = new Float32Array(NR * NT);
  const Wf = new Float32Array(NR * NT);
  for (let i = 0; i < NR; i += 1) {
    const r = R0 + ((R1 - R0) * i) / (NR - 1);
    for (let j = 0; j < NT; j += 1) {
      const th = (j / NT) * Math.PI * 2;
      const x = (Math.cos(th) * r) / 250;
      const y = (Math.sin(th) * r) / 250;
      const qx = fbm(noise, x + 1.7, y + 9.2);
      const qy = fbm(noise, x + 8.3, y + 2.8);
      V[i * NT + j] = fbm(noise, x + 4.2 * qx, y + 4.2 * qy);
      Wf[i * NT + j] = fbm(noise, x * 1.3 + 3.1 * qy + 5.1, y * 1.3 + 3.1 * qx + 1.3);
    }
  }
  const pct = (arr, q) => {
    const sorted = Float32Array.from(arr).sort();
    return sorted[Math.floor(q * (sorted.length - 1))];
  };
  const v20 = pct(V, 0.2);
  const v40 = pct(V, 0.4);
  const v66 = pct(V, 0.66);
  const v78 = pct(V, 0.78);
  const v90 = pct(V, 0.9);
  const w50 = pct(Wf, 0.5);
  const w82 = pct(Wf, 0.82);
  const w93 = pct(Wf, 0.93);
  for (let n = 0; n < NR * NT; n += 1) {
    const v = V[n];
    const w = Wf[n];
    let c = mixRGB(PINK, DEEP, smooth(w50, w82, w) * 0.7);
    c = mixRGB(c, LIGHT, smooth(v40, v20, v) * 0.6);
    const blue = smooth(v66, v78, v);
    c = mixRGB(c, mixRGB(VIOLET, INDIGO, smooth(v78, v90, v)), blue * 0.84);
    const edge = Math.exp(-(((v - v66) / ((v78 - v66) * 0.12)) ** 2));
    c = mixRGB(c, [70, 70, 220], edge * 0.4);
    const orange = smooth(w82, w93, w) * (1 - blue);
    c = mixRGB(c, ORANGE, orange * 0.85);
    field[n * 3] = c[0];
    field[n * 3 + 1] = c[1];
    field[n * 3 + 2] = c[2];
  }
  // Smear around the circle (two box blurs)
  const blurred = new Float32Array(field.length);
  const K = 10;
  for (let pass = 0; pass < 2; pass += 1) {
    const src = pass ? blurred.slice() : field;
    for (let i = 0; i < NR; i += 1) {
      for (let ch = 0; ch < 3; ch += 1) {
        let acc = 0;
        for (let k = -K; k <= K; k += 1) acc += src[(i * NT + ((k + NT) % NT)) * 3 + ch];
        for (let j = 0; j < NT; j += 1) {
          blurred[(i * NT + j) * 3 + ch] = acc / (2 * K + 1);
          acc += src[(i * NT + ((j + K + 1) % NT)) * 3 + ch] - src[(i * NT + ((j - K + NT) % NT)) * 3 + ch];
        }
      }
    }
  }
  // Polar grid → image (diameter 1132, 1 unit = 1 pixel)
  const size = 1132;
  const half = size / 2;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const c2 = canvas.getContext('2d');
  const img = c2.createImageData(size, size);
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const dx = x + 0.5 - half;
      const dy = y + 0.5 - half;
      const r = Math.hypot(dx, dy);
      if (r > 566) continue;
      const fi = clamp(((r - R0) / (R1 - R0)) * (NR - 1), 0, NR - 1.001);
      let th = Math.atan2(dy, dx);
      if (th < 0) th += Math.PI * 2;
      const fj = (th / (Math.PI * 2)) * NT;
      const i0 = Math.floor(fi);
      const j0 = Math.floor(fj) % NT;
      const j1 = (j0 + 1) % NT;
      const ti = fi - i0;
      const tj = fj - Math.floor(fj);
      const o = (y * size + x) * 4;
      for (let ch = 0; ch < 3; ch += 1) {
        const a = blurred[(i0 * NT + j0) * 3 + ch] * (1 - tj) + blurred[(i0 * NT + j1) * 3 + ch] * tj;
        const b = blurred[((i0 + 1) * NT + j0) * 3 + ch] * (1 - tj) + blurred[((i0 + 1) * NT + j1) * 3 + ch] * tj;
        img.data[o + ch] = a * (1 - ti) + b * ti;
      }
      img.data[o + 3] = 255;
    }
  }
  c2.putImageData(img, 0, 0);
  return canvas;
}

// Label: text on pink, lavender and peach paper, drawn once at 2x resolution.
function makeLabel() {
  const S = 2;
  const R = 208;
  const size = R * 2 * S;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const c = canvas.getContext('2d');
  c.scale(S, S);
  c.translate(R, R);
  // black rim
  c.fillStyle = '#0e0a0e';
  c.beginPath();
  c.arc(0, 0, 207, 0, Math.PI * 2);
  c.fill();
  // paper
  c.save();
  c.beginPath();
  c.arc(0, 0, 198, 0, Math.PI * 2);
  c.clip();
  c.fillStyle = '#f0c4dc';
  c.fillRect(-R, -R, R * 2, R * 2);
  const blob = (x, y, r, color) => {
    const g = c.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, color);
    g.addColorStop(1, 'rgb(240 196 220 / 0)');
    c.fillStyle = g;
    c.fillRect(-R, -R, R * 2, R * 2);
  };
  blob(-40, -60, 150, 'rgb(250 226 238 / 0.9)');
  blob(70, -20, 150, 'rgb(176 178 244 / 0.85)');
  blob(-30, 120, 150, 'rgb(246 196 160 / 0.8)');
  blob(-120, 40, 120, 'rgb(236 170 206 / 0.7)');
  // grain
  const grain = c.getImageData(0, 0, 1, 1);
  void grain;
  const noise = makeNoise(33);
  for (let k = 0; k < 9000; k += 1) {
    const a = noise(k * 0.37, 1.3) * Math.PI * 2;
    const r = Math.sqrt(noise(2.1, k * 0.61)) * 198;
    c.fillStyle = k % 2 ? 'rgb(255 255 255 / 0.18)' : 'rgb(120 60 100 / 0.10)';
    c.fillRect(Math.cos(a) * r, Math.sin(a) * r, 0.8, 0.8);
  }
  c.restore();
  // rings
  c.strokeStyle = 'rgb(110 50 92 / 0.75)';
  c.lineWidth = 1.2;
  for (const r of [186.5, 191]) {
    c.beginPath();
    c.arc(0, 0, r, 0, Math.PI * 2);
    c.stroke();
  }
  c.strokeStyle = 'rgb(110 50 92 / 0.35)';
  c.lineWidth = 0.8;
  c.beginPath();
  c.arc(0, 0, 156, 0, Math.PI * 2);
  c.stroke();
  // text around the edge
  const ring = 'Composed note by note in TypeScript and pressed onto pixels, no real vinyl was harmed, play it loud and scratch it often  ';
  c.fillStyle = '#6e3a60';
  c.font = '500 11px Inter, sans-serif';
  c.textAlign = 'center';
  c.textBaseline = 'middle';
  const step = (Math.PI * 2) / ring.length;
  for (let i = 0; i < ring.length; i += 1) {
    const a = -Math.PI / 2 + i * step;
    c.save();
    c.rotate(a);
    c.translate(0, -171);
    c.fillText(ring[i], 0, 0);
    c.restore();
  }
  // center text
  c.fillStyle = '#5e1f50';
  c.font = '700 41px Inter, sans-serif';
  c.fillText('Soft Static', 0, -110);
  c.fillStyle = '#80506f';
  c.font = '500 14px Inter, sans-serif';
  c.letterSpacing = '1.5px';
  c.fillText('Phonk mix', -18, -56);
  c.letterSpacing = '0px';
  c.fillStyle = '#a5354c';
  c.font = '700 38px Inter, sans-serif';
  c.fillText('33⅓', 64, 6);
  c.font = '500 13px Inter, sans-serif';
  c.fillText('rpm', 64, 36);
  c.fillText('Side', -64, -20);
  c.font = '700 40px Inter, sans-serif';
  c.fillText('A', -64, 8);
  c.fillStyle = '#5e1f50';
  c.font = '600 19px Inter, sans-serif';
  c.fillText('ysh4267', 0, 140);
  // orange ring mark (same shape as the progress marker on the outer ring)
  c.strokeStyle = '#e0653f';
  c.lineWidth = 2;
  c.beginPath();
  c.arc(0, 72, 9, 0, Math.PI * 2);
  c.stroke();
  c.fillStyle = '#e0653f';
  c.beginPath();
  c.arc(0, 72, 3.2, 0, Math.PI * 2);
  c.fill();
  // spindle hole
  c.fillStyle = '#0b0809';
  c.beginPath();
  c.arc(0, 0, 8, 0, Math.PI * 2);
  c.fill();
  return canvas;
}

let texture = null;
let label = null;
let discView = { k: 1 };

function sizeDisc() {
  const scale = stageScale * Math.min(window.devicePixelRatio || 1, 2);
  const px = Math.round(clamp(1200 * scale, 600, 2400));
  discCanvas.width = px;
  discCanvas.height = px;
  discView = { k: px / 1200 };
}

function drawDisc(angle) {
  const { k } = discView;
  const c = dctx;
  c.setTransform(1, 0, 0, 1, 0, 0);
  c.clearRect(0, 0, discCanvas.width, discCanvas.height);
  c.setTransform(k, 0, 0, k, 600 * k, 600 * k);
  // record shadow
  const shade = c.createRadialGradient(0, 0, DISC_R - 6, 0, 0, DISC_R + 16);
  shade.addColorStop(0, 'rgb(40 12 26 / 0.8)');
  shade.addColorStop(1, 'rgb(40 12 26 / 0)');
  c.fillStyle = shade;
  c.beginPath();
  c.arc(0, 0, DISC_R + 16, 0, Math.PI * 2);
  c.fill();
  c.save();
  c.beginPath();
  c.arc(0, 0, DISC_R, 0, Math.PI * 2);
  c.clip();
  c.rotate((angle * Math.PI) / 180);
  if (texture) c.drawImage(texture, -566, -566);
  c.restore();
  // slightly darker toward the edge
  const fall = c.createRadialGradient(0, 0, 210, 0, 0, DISC_R);
  fall.addColorStop(0, 'rgb(255 255 255 / 0.06)');
  fall.addColorStop(0.55, 'rgb(0 0 0 / 0)');
  fall.addColorStop(1, 'rgb(20 0 20 / 0.16)');
  c.fillStyle = fall;
  c.beginPath();
  c.arc(0, 0, DISC_R, 0, Math.PI * 2);
  c.fill();
  // grooves: fine lines and a few bright rings
  c.lineWidth = 0.6;
  for (let r = 214; r < DISC_R - 4; r += 3.1) {
    c.strokeStyle = `rgb(255 255 255 / ${0.018 + 0.012 * Math.sin(r * 0.7)})`;
    c.beginPath();
    c.arc(0, 0, r, 0, Math.PI * 2);
    c.stroke();
  }
  c.lineWidth = 2.6;
  for (const r of [279, 350.5, 423, 495]) {
    c.strokeStyle = 'rgb(255 190 225 / 0.075)';
    c.beginPath();
    c.arc(0, 0, r, 0, Math.PI * 2);
    c.stroke();
  }
  // edge
  c.lineWidth = 5;
  c.strokeStyle = 'rgb(255 200 230 / 0.07)';
  c.beginPath();
  c.arc(0, 0, DISC_R - 5, 0, Math.PI * 2);
  c.stroke();
  // label
  if (label) {
    c.save();
    c.rotate((angle * Math.PI) / 180);
    c.drawImage(label, -208, -208, 416, 416);
    c.restore();
  }
}

/* ------------------------------------------------------------- tonearm, tick ring */

const ARM = {};
const TICKS = [];
function buildDeck() {
  const defs = el('defs', {}, deck);
  const tube = el('linearGradient', { id: 'tube', x1: '0', x2: '1', y1: '0', y2: '0' }, defs);
  [[0, '#4a4e53'], [0.16, '#c3c7cc'], [0.34, '#ffffff'], [0.5, '#eef0f2'], [0.74, '#9a9ea3'], [1, '#3a3d42']].forEach(([o, c]) => el('stop', { offset: o, 'stop-color': c }, tube));
  const collar = el('linearGradient', { id: 'collar', x1: '0', x2: '1', y1: '0', y2: '0' }, defs);
  [[0, '#55595e'], [0.3, '#e9ecef'], [0.55, '#ffffff'], [0.8, '#8a8e93'], [1, '#3a3d41']].forEach(([o, c]) => el('stop', { offset: o, 'stop-color': c }, collar));
  const plate = el('radialGradient', { id: 'plate', cx: '0.45', cy: '0.4', r: '0.6' }, defs);
  [[0, '#c9cdd1'], [0.6, '#9a9fa5'], [1, '#5a5e63']].forEach(([o, c]) => el('stop', { offset: o, 'stop-color': c }, plate));
  const cap = el('radialGradient', { id: 'cap', cx: '0.4', cy: '0.35', r: '0.7' }, defs);
  [[0, '#8e9398'], [0.5, '#5b5f64'], [1, '#2a2c30']].forEach(([o, c]) => el('stop', { offset: o, 'stop-color': c }, cap));
  const shell = el('linearGradient', { id: 'shell', x1: '0', x2: '1', y1: '0', y2: '0' }, defs);
  [[0, '#121214'], [0.45, '#2b2b2f'], [1, '#0d0d0f']].forEach(([o, c]) => el('stop', { offset: o, 'stop-color': c }, shell));
  const soft = el('filter', { id: 'soft', x: '-50%', y: '-50%', width: '200%', height: '200%' }, defs);
  el('feGaussianBlur', { stdDeviation: '6' }, soft);

  // tick ring
  const ringG = el('g', {}, deck);
  const arc = (r, a0, a1) => {
    const p0 = [CENTER.x + r * Math.cos(a0), CENTER.y + r * Math.sin(a0)];
    const p1 = [CENTER.x + r * Math.cos(a1), CENTER.y + r * Math.sin(a1)];
    return `M${p0[0].toFixed(2)} ${p0[1].toFixed(2)}A${r} ${r} 0 0 1 ${p1[0].toFixed(2)} ${p1[1].toFixed(2)}`;
  };
  ARM.arc = arc;
  el('path', { d: arc(RING_R, (-64 * Math.PI) / 180, (64 * Math.PI) / 180), fill: 'none', stroke: 'rgb(78 70 70 / 0.85)', 'stroke-width': '1.3' }, ringG);
  for (let a = -64.2; a <= 64.3; a += 2.1) {
    const line = el('line', { 'stroke-width': '2.6', 'stroke-linecap': 'round' }, ringG);
    TICKS.push({ a: (a * Math.PI) / 180, deg: a, line, len: 10 });
  }
  ARM.progress = el('path', { fill: 'none', stroke: '#e2553f', 'stroke-width': '1.8', 'stroke-linecap': 'round' }, ringG);
  // Wide invisible band over the progress range of the arc: drag it to move the playback position.
  ARM.seek = el('path', {
    d: arc(605, (SEEK.from * Math.PI) / 180, ((SEEK.from + SEEK.span) * Math.PI) / 180),
    class: 'seek', fill: 'none', stroke: 'transparent', 'stroke-width': '72', 'stroke-linecap': 'round',
    tabindex: '0', role: 'slider', 'aria-label': 'Playback position', 'aria-valuemin': '0', 'aria-valuemax': String(Math.round(TOTAL)), 'aria-valuenow': '0',
  }, ringG);
  ARM.marker = el('g', { class: 'marker' }, ringG);
  const knob = el('g', { class: 'knob' }, ARM.marker);
  el('circle', { r: '9', fill: 'rgb(15 11 10 / 0.9)', stroke: '#e2553f', 'stroke-width': '2' }, knob);
  el('circle', { r: '3.2', fill: '#e2553f' }, knob);

  // tonearm base (pivot)
  const base = el('g', {}, deck);
  el('circle', { cx: PIVOT.x, cy: PIVOT.y, r: '86', fill: 'rgb(0 0 0 / 0.55)', filter: 'url(#soft)' }, base);
  el('circle', { cx: PIVOT.x, cy: PIVOT.y, r: '83', fill: 'url(#plate)', stroke: '#3a3d41', 'stroke-width': '1.5' }, base);
  el('circle', { cx: PIVOT.x, cy: PIVOT.y, r: '66', fill: '#2a2c30', stroke: '#6d7277', 'stroke-width': '1.2' }, base);
  el('circle', { cx: PIVOT.x, cy: PIVOT.y, r: '57', fill: 'url(#cap)' }, base);
  for (let k = 0; k < 36; k += 1) {
    const a = (k / 36) * Math.PI * 2;
    el('line', {
      x1: PIVOT.x + Math.cos(a) * 8, y1: PIVOT.y + Math.sin(a) * 8, x2: PIVOT.x + Math.cos(a) * 55, y2: PIVOT.y + Math.sin(a) * 55,
      stroke: k % 2 ? 'rgb(255 255 255 / 0.07)' : 'rgb(0 0 0 / 0.08)', 'stroke-width': '3',
    }, base);
  }
  for (const a of [0.55, 2.2, 3.9, 5.4]) {
    el('circle', { cx: PIVOT.x + Math.cos(a) * 75, cy: PIVOT.y + Math.sin(a) * 75, r: '3.4', fill: '#3b3e42', stroke: '#c9ccd0', 'stroke-width': '0.8' }, base);
  }

  // arm (turns around the pivot); 0 degrees points straight down
  ARM.g = el('g', {}, deck);
  const g = ARM.g;
  el('rect', { x: PIVOT.x - 13, y: PIVOT.y - 6, width: '26', height: '46', rx: '5', fill: 'url(#collar)' }, g);
  el('rect', { x: PIVOT.x - 10.5, y: PIVOT.y + 20, width: '21', height: '525', rx: '10', fill: 'url(#tube)' }, g);
  el('rect', { x: PIVOT.x - 13.5, y: PIVOT.y + 508, width: '27', height: '46', rx: '6', fill: 'url(#collar)' }, g);
  el('line', { x1: PIVOT.x - 4, y1: PIVOT.y + 140, x2: PIVOT.x - 4, y2: PIVOT.y + 150, stroke: '#333', 'stroke-width': '3', 'stroke-linecap': 'round' }, g);
  // headshell
  const top = PIVOT.y + 548;
  const hs = el('g', { transform: `rotate(-4 ${PIVOT.x} ${top})` }, g);
  el('path', {
    d: `M${PIVOT.x - 17} ${top} L${PIVOT.x + 17} ${top} L${PIVOT.x + 24} ${top + 70} L${PIVOT.x + 94} ${top + 100} L${PIVOT.x + 93} ${top + 106} L${PIVOT.x + 23} ${top + 86} L${PIVOT.x + 26} ${top + 142} L${PIVOT.x - 24} ${top + 142} Z`,
    fill: 'url(#shell)', stroke: '#050506', 'stroke-width': '1',
  }, hs);
  el('rect', { x: PIVOT.x - 20, y: top + 112, width: '40', height: '38', rx: '3', fill: '#141416' }, hs);
  el('rect', { x: PIVOT.x - 2.2, y: top + 120, width: '4.4', height: '24', fill: '#e6772e' }, hs);
  for (const dx of [-12, 12]) {
    el('circle', { cx: PIVOT.x + dx, cy: top + 104, r: '5.4', fill: '#d4d7da', stroke: '#4a4d51', 'stroke-width': '1.2' }, hs);
    el('circle', { cx: PIVOT.x + dx - 1.3, cy: top + 102.6, r: '1.7', fill: '#ffffff' }, hs);
  }
  el('path', { d: `M${PIVOT.x + 8} ${top + 22} q 12 6 9 24`, fill: 'none', stroke: '#e0743a', 'stroke-width': '1.3' }, hs);
}

function setArm(angle) {
  ARM.g.setAttribute('transform', `rotate(${(-angle).toFixed(3)} ${PIVOT.x} ${PIVOT.y})`);
}

function setRing(progress, level, time, shown) {
  ARM.marker.style.display = shown ? '' : 'none';
  const a0 = (SEEK.from * Math.PI) / 180;
  const a1 = a0 + ((SEEK.span * Math.PI) / 180) * progress;
  ARM.progress.setAttribute('d', shown && progress > 0.001 ? ARM.arc(RING_R, a0, a1) : '');
  ARM.marker.setAttribute('transform', `translate(${(CENTER.x + RING_R * Math.cos(a1)).toFixed(2)} ${(CENTER.y + RING_R * Math.sin(a1)).toFixed(2)})`);
  for (const t of TICKS) {
    const w = Math.exp(-((t.deg / 24) ** 2));
    const wob = 0.62 + 0.38 * Math.sin(time * 9.1 + t.deg * 0.73) * Math.sin(time * 5.3 - t.deg * 0.41);
    const target = 10 + 42 * level * w * wob;
    t.len += (target - t.len) * 0.35;
    const hot = clamp(((t.len - 10) / 38) * 1.4, 0, 1);
    const c = mixRGB([62, 56, 56], [214, 96, 124], hot);
    const r0 = 606;
    const r1 = r0 + t.len;
    t.line.setAttribute('x1', (CENTER.x + r0 * Math.cos(t.a)).toFixed(2));
    t.line.setAttribute('y1', (CENTER.y + r0 * Math.sin(t.a)).toFixed(2));
    t.line.setAttribute('x2', (CENTER.x + r1 * Math.cos(t.a)).toFixed(2));
    t.line.setAttribute('y2', (CENTER.y + r1 * Math.sin(t.a)).toFixed(2));
    t.line.setAttribute('stroke', rgb(c, 0.95));
  }
}

/* ------------------------------------------------------------- wheel of note lines */

const rows = lines.map((line) => {
  const row = document.createElement('div');
  row.className = 'line';
  const section = document.createElement('span');
  section.className = 'section';
  section.textContent = line.section;
  const notes = document.createElement('span');
  notes.className = 'notes';
  const toks = line.tokens.map((tok, k) => {
    if (k) notes.appendChild(document.createTextNode(' '));
    const span = document.createElement('span');
    span.className = 'tok';
    const box = document.createElement('span');
    box.className = 'box';
    span.appendChild(box);
    span.appendChild(document.createTextNode(tok.text));
    notes.appendChild(span);
    return { span, box };
  });
  if (line.tag) {
    const tag = document.createElement('span');
    tag.className = 'tag';
    row.tag = tag;
    tag.textContent = `  ${line.tag}`;
    notes.appendChild(tag);
  }
  row.append(section, notes);
  wheel.appendChild(row);
  return { row, section, notes, toks };
});

const square = document.createElement('div');
square.className = 'square';
wheel.appendChild(square);

// Token center x (30 px per character; note lines start at x=822)
const tokenX = (line, k) => {
  let col = 0;
  for (let i = 0; i < k; i += 1) col += line.tokens[i].text.length + 1;
  const tok = line.tokens[k];
  // center on the note name, ignoring brackets
  const lead = tok.text.startsWith('[') ? 1 : 0;
  const trail = tok.text.endsWith(']') ? 1 : 0;
  return 822 + (col + lead + (tok.text.length - lead - trail) / 2) * 30;
};

/* ------------------------------------------------------------- playback state */

const state = {
  playing: false,
  t: 0, // song time (s)
  spin: 0, // record angle
  spinRate: 0, // 0~1
  arm: 22.5,
  wheelPos: 0,
  wheelFrom: 0,
  wheelTo: 0,
  wheelAt: -1,
  level: 0,
  lastFrame: null,
  dragging: false, // moving the playback position by hand on the ring
  loop: false,
};

function currentIndex(t) {
  let idx = -1;
  for (let i = 0; i < allTokens.length; i += 1) if (allTokens[i].at <= t) idx = i;
  return idx;
}

function lineAt(t) {
  for (let i = lines.length - 1; i >= 0; i -= 1) if (t >= lines[i].start) return i;
  return 0;
}

function fmt(sec) {
  const s = Math.max(0, Math.floor(sec));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

function setPlaying(on) {
  state.playing = on;
  playButton.classList.toggle('playing', on);
  playButton.setAttribute('aria-label', on ? 'Pause' : 'Play');
}

function seek(t) {
  const before = state.t;
  state.t = clamp(t, 0, TOTAL - 0.05);
  // Scrubbing by hand turns the record with it, like pushing the platter.
  if (state.dragging) state.spin = (state.spin + (state.t - before) * SPIN + 360) % 360;
  sound.resync();
  const li = lineAt(state.t);
  state.wheelFrom = state.wheelPos;
  state.wheelTo = li;
  state.wheelAt = performance.now();
}

function render(now) {
  const dt = state.lastFrame === null ? 0 : Math.min((now - state.lastFrame) / 1000, 0.05);
  state.lastFrame = now;

  if (state.playing && !state.frozen && !state.dragging) {
    state.t += dt;
    if (state.t >= TOTAL) {
      state.t = 0;
      sound.resync();
      if (!demoMode && !state.loop) setPlaying(false);
    }
    sound.tick();
  }
  const t = state.t;

  // Record: spins up in about 0.4 s on play and slows to a stop on pause.
  state.spinRate += ((state.playing ? 1 : 0) - state.spinRate) * (1 - Math.exp(-dt / 0.16));
  state.spin = (state.spin + SPIN * state.spinRate * dt) % 360;
  drawDisc(state.spin);

  // Tonearm: 22.5 degrees at rest; while playing it moves in from 17.6 to -9.4 degrees by the end of the song.
  const started = state.playing || t > 0;
  const armTarget = started ? 17.64 - 1.588 * t : 22.5;
  state.arm += (armTarget - state.arm) * (1 - Math.exp(-dt / 0.18));
  setArm(state.arm);

  // notes
  const idx = state.playing || t > 0 ? currentIndex(t) : -1;
  const cur = idx >= 0 ? allTokens[idx] : null;
  if (cur && dt > 0) {
    const since = t - cur.at;
    state.level = Math.max(state.level * Math.exp(-dt / 0.32), since < 0.05 && cur.pitch ? 1 : 0);
  }
  if (!state.playing) state.level *= Math.exp(-dt / 0.25);
  const level = state.playing ? 0.32 + 0.68 * state.level : state.level * 0.5;
  setRing(t / TOTAL, level, now / 1000, started);

  // Wheel: turns for 0.45 s, starting just before the line changes.
  const li = lineAt(t);
  const wheelLine = state.playing ? lineAt(Math.min(t + 0.25, TOTAL - 0.001)) : li;
  if (wheelLine !== state.wheelTo) {
    state.wheelFrom = state.wheelPos;
    state.wheelTo = wheelLine;
    state.wheelAt = now;
  }
  const wf = state.wheelAt < 0 ? 1 : clamp((now - state.wheelAt) / 450, 0, 1);
  state.wheelPos = mix(state.wheelFrom, state.wheelTo, ease(wf));

  rows.forEach((r, i) => {
    const off = i - state.wheelPos;
    const d = Math.abs(off);
    const angle = off * LINE_STEP;
    const blur = off < 0 ? d * 2.2 : d * 3.4;
    const alpha = d < 1 ? mix(1, off < 0 ? 0.42 : 0.3, d) : Math.max(0, (off < 0 ? 0.42 : 0.3) * (1 - (d - 1) * 0.42));
    r.row.style.transform = `rotate(${angle.toFixed(3)}deg)`;
    r.row.style.opacity = alpha.toFixed(3);
    r.row.style.filter = blur > 0.05 ? `blur(${blur.toFixed(2)}px)` : 'none';
    r.row.style.visibility = d > 3.6 ? 'hidden' : 'visible';
    r.section.style.color = rgb(mixRGB([226, 85, 63], [150, 144, 142], clamp(d, 0, 1)));
    if (r.row.tag) r.row.tag.style.opacity = clamp(d, 0, 1).toFixed(3);
    const line = lines[i];
    r.toks.forEach((tk, k) => {
      const tok = line.tokens[k];
      const g = line.start + k * line.each;
      const played = idx >= 0 && (tok.at <= t) && (i < li || (i === li));
      const since = t - tok.at;
      let text = [66, 63, 62];
      let boxA = 0;
      let pop = 0;
      if (played && i === li) {
        const fade = Math.exp(-since / 0.45);
        text = mixRGB([242, 239, 238], tok.color.map((v) => Math.min(255, v + 18)), fade);
        boxA = since < 1.2 ? 0.5 * Math.exp(-since / 0.3) : 0;
        pop = Math.exp(-since / 0.09);
      } else if (played || i < li) {
        text = [242, 239, 238];
      }
      if (i !== li) text = i < li ? [150, 146, 144] : [96, 92, 91];
      void g;
      tk.span.style.color = rgb(text);
      tk.span.style.transform = pop > 0.01 ? `translateY(${(-5 * pop).toFixed(2)}px) scale(${(1 + 0.12 * pop).toFixed(3)})` : '';
      tk.box.style.opacity = boxA.toFixed(3);
      tk.box.style.background = rgb(tok.color, 0.85);
      tk.box.style.boxShadow = boxA > 0.25 ? `0 0 18px ${rgb(tok.color, 0.35 * boxA)}` : 'none';
    });
  });

  // Bouncing square: lands on each note as it plays and arcs to the next one.
  const showSquare = idx >= 0 || !state.playing;
  if (showSquare) {
    const a = idx >= 0 ? allTokens[idx] : allTokens[0];
    const b = idx >= 0 && idx + 1 < allTokens.length ? allTokens[idx + 1] : null;
    const la = lines[a.line];
    let x = tokenX(la, a.k);
    let y = 0;
    let color = a.color;
    let spinDeg = 0;
    let alpha = 1;
    if (b && idx >= 0) {
      const f = clamp((t - a.at) / (b.at - a.at), 0, 1);
      if (b.line === a.line) {
        const xb = tokenX(lines[b.line], b.k);
        x = mix(x, xb, f);
        y = -42 * 4 * f * (1 - f);
        color = mixRGB(a.color, b.color, f);
        spinDeg = 90 * f;
      } else {
        // End of line: stays on the last note, fades, then reappears on the first note of the next line.
        alpha = 1 - smooth(0.55, 0.95, f);
      }
    }
    if (idx >= 0 && t - a.at < 0.12 && a.k === 0 && a.line > 0) alpha = smooth(0, 0.12, t - a.at);
    square.style.opacity = alpha.toFixed(3);
    square.style.transform = `translate(${(x - 11).toFixed(2)}px, ${(538 + y).toFixed(2)}px) rotate(${spinDeg.toFixed(1)}deg)`;
    square.style.borderColor = rgb(mixRGB(color, [255, 255, 255], 0.12));
    square.style.boxShadow = `0 0 14px ${rgb(color, 0.75)}, inset 0 0 6px ${rgb(color, 0.6)}`;
    square.style.background = idx < 0 ? rgb(color, 0.55) : 'transparent';
  }

  nowEl.textContent = fmt(t);
  const sec = String(Math.floor(t));
  if (ARM.seek.getAttribute('aria-valuenow') !== sec) {
    ARM.seek.setAttribute('aria-valuenow', sec);
    ARM.seek.setAttribute('aria-valuetext', `${fmt(t)} of ${fmt(TOTAL)}`);
  }
  requestAnimationFrame(render);
}

/* ------------------------------------------------------------- sound */

// The notes are synthesized with Web Audio: a cowbell-like lead (two detuned squares through a band-pass) over a
// soft triangle, a kick every four steps, a light hat on every step and a sub note at the start of each line.
// Sound starts only after the play button is pressed (browsers need a click first); ?demo stays silent.
const sound = (() => {
  let ctx = null;
  let master = null;
  let bus = null;
  let noise = null;
  let next = 0;
  let volume = 0.7;
  let muted = false;
  const voices = new Set();

  const SEMI = { c: 0, db: 1, d: 2, eb: 3, e: 4, f: 5, gb: 6, g: 7, ab: 8, a: 9, bb: 10, b: 11 };
  const freq = (name) => {
    const m = name.match(/^([a-g]b?)(\d)$/);
    const midi = 12 * (Number(m[2]) + 1) + SEMI[m[1]];
    return 440 * 2 ** ((midi - 69) / 12);
  };

  function init() {
    if (ctx) {
      if (ctx.state === 'suspended') ctx.resume();
      return;
    }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    ctx = new AC();
    master = ctx.createGain();
    master.gain.value = muted ? 0 : volume;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14;
    comp.ratio.value = 4;
    bus = ctx.createGain();
    bus.gain.value = 0.55;
    bus.connect(comp);
    comp.connect(master);
    master.connect(ctx.destination);
    noise = ctx.createBuffer(1, ctx.sampleRate * 0.2, ctx.sampleRate);
    const data = noise.getChannelData(0);
    for (let i = 0; i < data.length; i += 1) data[i] = Math.random() * 2 - 1;
    resync();
  }

  function keep(node, end) {
    voices.add(node);
    node.onended = () => voices.delete(node);
    node.stop(end);
  }

  function lead(f, when, len) {
    const out = ctx.createGain();
    out.gain.setValueAtTime(0.0001, when);
    out.gain.exponentialRampToValueAtTime(1, when + 0.006);
    out.gain.exponentialRampToValueAtTime(0.001, when + len);
    out.connect(bus);
    const band = ctx.createBiquadFilter();
    band.type = 'bandpass';
    band.frequency.value = Math.min(9000, f * 2.6);
    band.Q.value = 1.3;
    const bell = ctx.createGain();
    bell.gain.value = 0.2;
    band.connect(bell);
    bell.connect(out);
    const body = ctx.createGain();
    body.gain.value = 0.32;
    body.connect(out);
    const parts = [['square', f, band], ['square', f * 1.4983, band], ['triangle', f, body]];
    for (const [type, hz, to] of parts) {
      const o = ctx.createOscillator();
      o.type = type;
      o.frequency.value = hz;
      o.connect(to);
      o.start(when);
      keep(o, when + len + 0.05);
    }
  }

  function kick(when) {
    const o = ctx.createOscillator();
    o.frequency.setValueAtTime(140, when);
    o.frequency.exponentialRampToValueAtTime(42, when + 0.14);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.9, when);
    g.gain.exponentialRampToValueAtTime(0.001, when + 0.38);
    o.connect(g);
    g.connect(bus);
    o.start(when);
    keep(o, when + 0.4);
  }

  function hat(when, amp) {
    const src = ctx.createBufferSource();
    src.buffer = noise;
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 7000;
    const g = ctx.createGain();
    g.gain.setValueAtTime(amp, when);
    g.gain.exponentialRampToValueAtTime(0.001, when + 0.05);
    src.connect(hp);
    hp.connect(g);
    g.connect(bus);
    src.start(when);
    keep(src, when + 0.06);
  }

  function sub(f, when, len) {
    const o = ctx.createOscillator();
    o.frequency.value = f;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, when);
    g.gain.exponentialRampToValueAtTime(0.42, when + 0.02);
    g.gain.exponentialRampToValueAtTime(0.001, when + len);
    o.connect(g);
    g.connect(bus);
    o.start(when);
    keep(o, when + len + 0.05);
  }

  // Next token to schedule: the first one at or after the current song time.
  function resync() {
    for (const v of voices) {
      try { v.stop(); } catch (e) { /* already stopped */ }
    }
    voices.clear();
    next = allTokens.findIndex((tok) => tok.at >= state.t - 0.001);
    if (next < 0) next = allTokens.length;
  }

  // Called every frame while playing: schedule what starts within the next 0.12 s.
  function tick() {
    if (!ctx || ctx.state !== 'running') return;
    const ahead = state.t + 0.12;
    while (next < allTokens.length && allTokens[next].at < ahead) {
      const tok = allTokens[next];
      const when = ctx.currentTime + Math.max(0, tok.at - state.t);
      const after = allTokens[next + 1];
      const dur = after && after.line === tok.line ? after.at - tok.at : 0.5;
      if (tok.k % 4 === 0) kick(when);
      hat(when, tok.k % 2 ? 0.035 : 0.06);
      if (tok.pitch) {
        const f = freq(tok.name);
        lead(f, when, Math.max(0.14, Math.min(0.5, dur * 1.3)));
        if (tok.k === 0) sub(f / 4, when, Math.min(1.6, lines[tok.line].dur));
      }
      next += 1;
    }
  }

  function setVolume(v) {
    volume = v;
    if (master) master.gain.setTargetAtTime(muted ? 0 : volume, ctx.currentTime, 0.02);
  }

  function setMuted(on) {
    muted = on;
    setVolume(volume);
  }

  return { init, tick, resync, setVolume, setMuted, halt: resync, get muted() { return muted; }, get volume() { return volume; } };
})();

/* ------------------------------------------------------------- layout and input */

let stageScale = 1;
let sceneY = 0;
// The record and note lines hug the left edge and fill the window height, as long as the end of the middle line (x=1800) stays inside.
// Title, transport and time stick to the window edges and do not shrink too far, so they stay readable on small screens.
function fitStage() {
  const W = window.innerWidth;
  const H = window.innerHeight;
  stageScale = Math.min(H / STAGE.h, W / 1800);
  const y = (H - STAGE.h * stageScale) / 2;
  sceneY = y;
  scene.style.transform = `translate(0px, ${y.toFixed(1)}px) scale(${stageScale})`;
  stage.style.setProperty('--s', String(stageScale));
  stage.style.setProperty('--u', String(Math.min(1.25, Math.max(stageScale, 0.6))));
  sizeDisc();
}

playButton.addEventListener('click', () => {
  if (!state.playing && state.t >= TOTAL) state.t = 0;
  if (!demoMode) sound.init();
  setPlaying(!state.playing);
  sound.resync();
});
document.getElementById('prev').addEventListener('click', () => {
  const li = lineAt(state.t);
  const back = state.t - lines[li].start < 0.6 && li > 0 ? li - 1 : li;
  seek(lines[back].start + 0.001);
});
document.getElementById('next').addEventListener('click', () => {
  const li = lineAt(state.t);
  if (li + 1 < lines.length) seek(lines[li + 1].start + 0.001);
});
window.addEventListener('resize', fitStage);

// Drag along the outer ring to move the playback position by hand.
function progressAt(event) {
  const x = event.clientX / stageScale;
  const y = (event.clientY - sceneY) / stageScale;
  const deg = (Math.atan2(y - CENTER.y, x - CENTER.x) * 180) / Math.PI;
  return clamp((deg - SEEK.from) / SEEK.span, 0, 1);
}
function endDrag() {
  if (!state.dragging) return;
  state.dragging = false;
  deck.classList.remove('dragging');
  sound.resync();
}
function wireSeek() {
  ARM.seek.addEventListener('pointerdown', (event) => {
    if (event.button !== 0) return;
    event.preventDefault();
    try { ARM.seek.setPointerCapture(event.pointerId); } catch (e) { /* synthetic pointer */ }
    state.dragging = true;
    deck.classList.add('dragging');
    seek(progressAt(event) * TOTAL);
  });
  ARM.seek.addEventListener('pointermove', (event) => {
    if (state.dragging) seek(progressAt(event) * TOTAL);
  });
  ARM.seek.addEventListener('pointerup', endDrag);
  ARM.seek.addEventListener('pointercancel', endDrag);
  ARM.seek.addEventListener('keydown', (event) => {
    const step = { ArrowRight: 1, ArrowUp: 1, ArrowLeft: -1, ArrowDown: -1 }[event.key];
    if (step) {
      event.preventDefault();
      seek(state.t + step);
    } else if (event.key === 'Home' || event.key === 'End') {
      event.preventDefault();
      seek(event.key === 'Home' ? 0 : TOTAL);
    }
  });
}

// Volume, mute and loop in the bottom-right corner.
const volumeInput = document.getElementById('volume');
const muteButton = document.getElementById('mute');
const loopButton = document.getElementById('loop');
function showVolume() {
  const v = sound.muted ? 0 : Number(volumeInput.value);
  volumeInput.style.setProperty('--v', `${v}%`);
  muteButton.classList.toggle('muted', sound.muted || Number(volumeInput.value) === 0);
  muteButton.setAttribute('aria-label', sound.muted ? 'Unmute' : 'Mute');
}
volumeInput.addEventListener('input', () => {
  if (sound.muted) sound.setMuted(false);
  sound.setVolume(Number(volumeInput.value) / 100);
  showVolume();
});
muteButton.addEventListener('click', () => {
  sound.setMuted(!sound.muted);
  showVolume();
});
loopButton.addEventListener('click', () => {
  state.loop = !state.loop;
  loopButton.setAttribute('aria-pressed', String(state.loop));
});
showVolume();

const demoMode = new URLSearchParams(location.search).has('demo');

// For the comparison tool: jump straight to the scene at a given song time.
window.__page = {
  pose({ t = 0, playing = true, spin = null, freeze = true } = {}) {
    state.t = t;
    state.frozen = freeze;
    setPlaying(playing);
    state.spinRate = playing ? 1 : 0;
    state.arm = playing || t > 0 ? 17.64 - 1.588 * t : 22.5;
    const li = lineAt(t);
    state.wheelPos = li;
    state.wheelFrom = li;
    state.wheelTo = li;
    state.wheelAt = -1;
    if (spin !== null) state.spin = spin;
    state.level = 0.6;
  },
  status: () => ({ t: state.t, playing: state.playing, dragging: state.dragging, loop: state.loop, muted: sound.muted, volume: sound.volume }),
};

buildDeck();
wireSeek();
fitStage();
setArm(state.arm);
document.fonts.ready.then(() => {
  label = makeLabel();
});
// Generating the pattern is heavy, so it waits until after the first frame.
requestAnimationFrame(() => setTimeout(() => {
  texture = makeTexture();
}, 0));
if (demoMode) setPlaying(true);
requestAnimationFrame(render);
