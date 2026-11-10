// The tide chart: the 48-hour carbon forecast drawn as a sea, the machine as a boat riding it.
import { runMean, SLOT_MS, type Series } from './plan.ts';
import { clock, dayLabel, ukParts } from './time.ts';

export interface ChartModel {
  series: Series;
  slots: number;
  nowIndex: number;
  deadline: number;
  /** boat start (slot) */
  start: number;
  /** cleanest start in the window */
  best: number;
  name: string;
}

export interface ChartGeom {
  w: number; h: number;
  left: number; right: number; top: number; bottom: number;
  x: (slot: number) => number;
  y: (g: number) => number;
  slotAt: (px: number) => number;
}

export function geom(w: number, h: number, n: number, maxV: number): ChartGeom {
  const left = w < 560 ? 34 : 46, right = 12, top = 52, bottom = h - 30;
  const ymax = Math.max(100, Math.ceil((maxV * 1.18) / 50) * 50);
  const x = (s: number) => left + (s / n) * (w - left - right);
  const y = (g: number) => bottom - (g / ymax) * (bottom - top);
  const slotAt = (px: number) => ((px - left) / (w - left - right)) * n;
  return { w, h, left, right, top, bottom, x, y, slotAt };
}

/** Monotone cubic (Fritsch-Carlson) through points: no overshoot below the data, so no negative carbon. */
export function monotonePath(pts: [number, number][]): string {
  const n = pts.length;
  if (n < 2) return '';
  const dx: number[] = [], m: number[] = [];
  for (let i = 0; i < n - 1; i++) {
    dx.push(pts[i + 1][0] - pts[i][0]);
    m.push((pts[i + 1][1] - pts[i][1]) / dx[i]);
  }
  const t: number[] = [m[0]];
  for (let i = 1; i < n - 1; i++) t.push(m[i - 1] * m[i] <= 0 ? 0 : (m[i - 1] + m[i]) / 2);
  t.push(m[n - 2]);
  for (let i = 0; i < n - 1; i++) {
    if (m[i] === 0) { t[i] = 0; t[i + 1] = 0; continue; }
    const a = t[i] / m[i], b = t[i + 1] / m[i], s = a * a + b * b;
    if (s > 9) { const k = 3 / Math.sqrt(s); t[i] = k * a * m[i]; t[i + 1] = k * b * m[i]; }
  }
  let d = `M${pts[0][0].toFixed(1)},${pts[0][1].toFixed(1)}`;
  for (let i = 0; i < n - 1; i++) {
    const h = dx[i] / 3;
    d += `C${(pts[i][0] + h).toFixed(1)},${(pts[i][1] + t[i] * h).toFixed(1)} ${(pts[i + 1][0] - h).toFixed(1)},${(pts[i + 1][1] - t[i + 1] * h).toFixed(1)} ${pts[i + 1][0].toFixed(1)},${pts[i + 1][1].toFixed(1)}`;
  }
  return d;
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');

function boat(g: ChartGeom, s: number, slots: number, level: number, cls: string, label: string, below = false): string {
  const x1 = g.x(s), x2 = g.x(s + slots), y = g.y(level);
  const lip = Math.min(8, (x2 - x1) / 5);
  const hull = `M${x1 - 3},${y - 4} L${x2 + 3},${y - 4} L${x2 - lip},${y + 9} L${x1 + lip},${y + 9} Z`;
  const mx = (x1 + x2) / 2;
  const mast = `M${mx},${y - 4} L${mx},${y - 26}`;
  const flag = `M${mx},${y - 26} L${mx + 13},${y - 21} L${mx},${y - 16} Z`;
  const anchor = mx > g.w - 120 ? 'end' : mx < g.left + 110 ? 'start' : 'middle';
  const lx = anchor === 'end' ? x2 : anchor === 'start' ? x1 : mx;
  return `<g class="boat ${cls}">
    <path class="hull" d="${hull}"/><path class="mast" d="${mast}"/><path class="flag" d="${flag}"/>
    <text class="boat-label" x="${lx}" y="${below ? y + 28 : y - 32}" text-anchor="${anchor}">${esc(label)}</text>
  </g>`;
}

export function renderChart(el: HTMLElement, m: ChartModel): ChartGeom {
  const w = Math.max(320, el.clientWidth);
  const h = w < 560 ? 280 : 380;
  const v = m.series.values, n = v.length;
  const g = geom(w, h, n, Math.max(...v));
  const t0 = m.series.start;

  // surface points at slot centres, extended to both edges
  const pts: [number, number][] = [[g.x(0), g.y(v[0])]];
  v.forEach((val, i) => pts.push([g.x(i + 0.5), g.y(val)]));
  pts.push([g.x(n), g.y(v[n - 1])]);
  const surface = monotonePath(pts);
  const sea = `${surface} L${g.x(n)},${g.bottom} L${g.x(0)},${g.bottom} Z`;

  // grid: day lines and 3-hour ticks
  let ticks = '';
  for (let i = 0; i <= n; i++) {
    const p = ukParts(t0 + i * SLOT_MS);
    if (p.minute !== 0) continue;
    const x = g.x(i);
    if (p.hour === 0) {
      ticks += `<line class="day" x1="${x}" x2="${x}" y1="${g.top - 28}" y2="${g.bottom}"/>`;
      if (x < g.w - 70) ticks += `<text class="day-label" x="${x + 6}" y="${g.top - 8}">${dayLabel(t0 + i * SLOT_MS)}</text>`;
    }
    const every = w < 560 ? 6 : 3;
    if (p.hour % every === 0 && x > g.left + 14 && x < g.w - 20) {
      ticks += `<text class="tick" x="${x}" y="${g.bottom + 18}" text-anchor="middle">${clock(t0 + i * SLOT_MS)}</text>`;
    }
  }
  // y axis
  let yaxis = '';
  const ymax = Math.round((g.bottom - g.top) / ((g.bottom - g.y(100)) / 100));
  const step = ymax > 300 ? 100 : 50;
  for (let gv = step; gv < ymax; gv += step) {
    yaxis += `<line class="gridline" x1="${g.left}" x2="${g.w - g.right}" y1="${g.y(gv)}" y2="${g.y(gv)}"/>`;
    yaxis += `<text class="ylab" x="${g.left - 6}" y="${g.y(gv) + 4}" text-anchor="end">${gv}</text>`;
  }
  yaxis += `<text class="yunit" x="2" y="${g.top - 34}">g/kWh</text>`;

  // soundings: hourly values written in the water, like depths on a chart
  let soundings = '';
  const sEvery = w < 560 ? 8 : 4;
  for (let i = 2; i < n - 1; i += sEvery) {
    const ys = g.y(v[i]);
    if (g.bottom - ys < 34) continue;
    soundings += `<text class="sounding" x="${g.x(i + 0.5)}" y="${(ys + g.bottom) / 2 + 8}" text-anchor="middle">${Math.round(v[i])}</text>`;
  }

  // restricted area: after the deadline
  const xd = g.x(m.deadline);
  const restricted = m.deadline < n
    ? `<rect class="restricted" x="${xd}" y="${g.top - 28}" width="${g.x(n) - xd}" height="${g.bottom - g.top + 28}"/>
       <line class="limit" x1="${xd}" x2="${xd}" y1="${g.top - 28}" y2="${g.bottom}"/>
       ${g.x(n) - xd > 90 ? `<text class="restricted-label" x="${(xd + g.x(n)) / 2}" y="${g.bottom - 10}" text-anchor="middle">after you need it</text>` : ''}`
    : '';

  const xn = g.x(m.nowIndex);
  const nowLine = `<line class="now" x1="${xn}" x2="${xn}" y1="${g.top - 28}" y2="${g.bottom}"/>`;

  const nowMean = runMean(v, m.nowIndex, m.slots);
  const level = runMean(v, m.start, m.slots);
  const small = w < 560;
  const ghost = m.start !== m.nowIndex ? boat(g, m.nowIndex, m.slots, nowMean, 'ghost', small ? '' : `start now: ${Math.round(nowMean)} g/kWh`, true) : '';
  const isBest = m.start === m.best;
  const main = boat(g, m.start, m.slots, level, isBest ? 'best' : 'moved',
    small ? `${clock(t0 + m.start * SLOT_MS)} to ${clock(t0 + (m.start + m.slots) * SLOT_MS)}, ${Math.round(level)} g`
      : `${m.name} ${clock(t0 + m.start * SLOT_MS)} to ${clock(t0 + (m.start + m.slots) * SLOT_MS)}: ${Math.round(level)} g/kWh`);
  const shade = `<rect class="run" x="${g.x(m.start)}" y="${g.y(level)}" width="${g.x(m.start + m.slots) - g.x(m.start)}" height="${g.bottom - g.y(level)}"/>`;

  el.innerHTML = `<svg viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" role="img" aria-label="Carbon forecast for the next 48 hours, with the ${esc(m.name)} placed at ${clock(t0 + m.start * SLOT_MS)}">
    <defs>
      <linearGradient id="water" gradientUnits="userSpaceOnUse" x1="0" y1="${g.y(260)}" x2="0" y2="${g.bottom}">
        <stop offset="0" stop-color="var(--murk)"/><stop offset="0.55" stop-color="var(--mid)"/><stop offset="1" stop-color="var(--clear)"/>
      </linearGradient>
      <pattern id="hatch" width="7" height="7" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
        <line x1="0" y1="0" x2="0" y2="7" class="hatch-line"/>
      </pattern>
    </defs>
    ${yaxis}${ticks}
    <path class="sea" d="${sea}" fill="url(#water)"/>
    <path class="surface" d="${surface}"/>
    ${soundings}${shade}${restricted}${nowLine}
    <text class="now-label" x="${xn + 5}" y="${g.top - 34}">now</text>
    ${ghost}${main}
    <rect class="drag" x="${g.left}" y="${g.top - 18}" width="${g.w - g.left - g.right}" height="${g.bottom - g.top + 18}"/>
  </svg>`;
  return g;
}
