import '@fontsource-variable/archivo/wdth.css';
import '@fontsource/source-serif-4/400-italic.css';
import '@fontsource/source-serif-4/600-italic.css';
import './style.css';
import { APPLIANCES } from './appliances.ts';
import { renderChart, type ChartGeom } from './chart.ts';
import { cleanShare, fetchLive, fromCompact, FUELS, meanMix, type Compact, type Forecast, type Region } from './grid.ts';
import { plan, runMean, SLOT_MS, type Appliance } from './plan.ts';
import { clock, dayClock, defaultDeadline, ics } from './time.ts';
import replayData from './replay.json';

const escHtml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const params = new URLSearchParams(location.search);
const store = {
  get(k: string) { try { return localStorage.getItem('gt.' + k); } catch { return null; } },
  set(k: string, v: string) { try { localStorage.setItem('gt.' + k, v); } catch { /* private mode */ } },
};
const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;

interface MachineState { kWh: number; deadline: number | null; start: number | null }

const state = {
  forecast: null as Forecast | null,
  regionId: Number(params.get('region') ?? store.get('region') ?? 18),
  machine: params.get('machine') ?? 'dishwasher',
  machines: Object.fromEntries(APPLIANCES.map((a) => [a.id, { kWh: a.kWh, deadline: null, start: null }])) as Record<string, MachineState>,
  nowIndex: 0,
  sailing: 0 as number,
  shown: null as null | number, // boat position currently drawn (fractional while sailing)
};

const g1 = (x: number) => (x >= 100 ? Math.round(x).toLocaleString('en-GB') : x >= 10 ? x.toFixed(0) : x.toFixed(1));
const kgOrG = (grams: number) => (Math.abs(grams) >= 1000 ? `${(grams / 1000).toFixed(grams >= 10000 ? 0 : 1)} kg` : `${Math.round(grams)} g`);

function region(): Region {
  const f = state.forecast!;
  return f.regions.find((r) => r.id === state.regionId) ?? f.regions[0];
}
function appliance(id = state.machine): Appliance {
  const a = APPLIANCES.find((x) => x.id === id) ?? APPLIANCES[0];
  return { ...a, kWh: state.machines[a.id].kWh };
}
function deadlineOf(a: Appliance): number {
  const r = region(), n = r.series.values.length;
  const ms = state.machines[a.id];
  const d = ms.deadline ?? defaultDeadline(r.series.start, n, state.nowIndex, a.slots);
  return Math.min(n, Math.max(state.nowIndex + a.slots, d));
}
function planOf(a: Appliance) {
  return plan(region().series, a, state.nowIndex, deadlineOf(a))!;
}

// ---------- loading ----------
async function load() {
  const forceSaved = params.has('saved');
  try {
    if (forceSaved) throw new Error('saved forecast requested');
    state.forecast = await fetchLive();
    const now = Date.now();
    state.nowIndex = Math.max(0, Math.floor((now - state.forecast.start) / SLOT_MS));
  } catch (err) {
    const c: Compact = await fetch('/data/forecast-saved.json').then((r) => r.json());
    state.forecast = fromCompact(c);
    state.nowIndex = Math.max(0, Math.floor((Date.parse(c.savedAt) - state.forecast.start) / SLOT_MS));
    if (!forceSaved) console.warn('Live forecast unavailable, using the saved one:', err);
  }
  const f = state.forecast;
  const sel = $<HTMLSelectElement>('region');
  sel.innerHTML = f.regions.map((r) => `<option value="${r.id}">${r.id === 18 ? 'Great Britain' : escHtml(r.name)}</option>`).join('');
  if (!f.regions.some((r) => r.id === state.regionId)) state.regionId = 18;
  sel.value = String(state.regionId);
  sel.addEventListener('change', () => {
    state.regionId = Number(sel.value);
    store.set('region', sel.value);
    for (const m of Object.values(state.machines)) { m.start = null; }
    render(true);
  });
  const status = $('status');
  if (f.source === 'live') {
    status.textContent = `Live forecast, fetched ${clock(Date.now())} UK time`;
    status.className = 'status live';
  } else {
    status.textContent = `Saved forecast from ${dayClock(Date.parse(f.savedAt!))} UK time`;
    status.className = 'status saved';
  }
  renderMachines();
  render(true);
  renderYear();
  new ResizeObserver(() => drawChart()).observe($('chart'));
}

// ---------- machine tabs ----------
function renderMachines() {
  const box = $('machines');
  box.innerHTML = APPLIANCES.map((a) => `<button role="tab" data-id="${a.id}" aria-selected="${a.id === state.machine}">${a.name}</button>`).join('');
  box.querySelectorAll('button').forEach((b) => b.addEventListener('click', () => {
    state.machine = b.dataset.id!;
    box.querySelectorAll('button').forEach((x) => x.setAttribute('aria-selected', String(x === b)));
    render(true);
  }));
}

// ---------- chart + result ----------
let geomNow: ChartGeom | null = null;

function drawChart(pos?: number) {
  const a = appliance(), p = planOf(a);
  const start = pos ?? state.machines[a.id].start ?? p.best.index;
  geomNow = renderChart($('chart'), {
    series: region().series, slots: a.slots, nowIndex: state.nowIndex,
    deadline: deadlineOf(a), start: Math.round(start), best: p.best.index, name: a.name,
  });
  // while sailing, slide the boat smoothly between slots
  if (pos != null && geomNow) {
    const off = geomNow.x(pos) - geomNow.x(Math.round(pos));
    $('chart').querySelectorAll<SVGGElement>('.boat:not(.ghost)').forEach((b) => b.setAttribute('transform', `translate(${off.toFixed(1)},0)`));
  }
}

function sail() {
  const a = appliance(), p = planOf(a);
  const target = state.machines[a.id].start ?? p.best.index;
  cancelAnimationFrame(state.sailing);
  if (reduceMotion || target === state.nowIndex) { drawChart(); renderResult(); return; }
  const from = state.nowIndex, t0 = performance.now(), dur = 1400;
  const step = (t: number) => {
    const k = Math.min(1, (t - t0) / dur);
    const e = k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2;
    const pos = from + (target - from) * e;
    drawChart(pos);
    renderResult(pos);
    if (k < 1) state.sailing = requestAnimationFrame(step);
    else { drawChart(); renderResult(); }
  };
  state.sailing = requestAnimationFrame(step);
}

function render(animate = false) {
  if (animate) sail(); else { drawChart(); renderResult(); }
  renderTable();
}

function deadlineOptions(a: Appliance): string {
  const r = region(), n = r.series.values.length, cur = deadlineOf(a);
  let o = '';
  for (let i = state.nowIndex + a.slots; i <= n; i++) {
    o += `<option value="${i}" ${i === cur ? 'selected' : ''}>${dayClock(r.series.start + i * SLOT_MS)}</option>`;
  }
  return o;
}

function mixWords(row: number[]): string {
  const top = FUELS.map((f, k) => [f, row[k]] as const).filter(([, v]) => v >= 1).sort((x, y) => y[1] - x[1]).slice(0, 3);
  return top.map(([f, v]) => `${f} ${Math.round(v)}%`).join(', ');
}

function renderResult(pos?: number) {
  const a = appliance(), p = planOf(a), r = region(), t0 = r.series.start;
  const ms = state.machines[a.id];
  const startIdx = Math.round(pos ?? ms.start ?? p.best.index);
  const mean = runMean(r.series.values, startIdx, a.slots);
  const gNow = a.kWh * p.now.mean, gHere = a.kWh * mean;
  const saved = gNow - gHere;
  const pct = gNow > 0 ? (saved / gNow) * 100 : 0;
  const isBest = startIdx === p.best.index;
  const startT = t0 + startIdx * SLOT_MS;
  const mixNow = meanMix(r.mix, state.nowIndex, a.slots), mixHere = meanMix(r.mix, startIdx, a.slots);
  const headline = startIdx === state.nowIndex && isBest
    ? `Now is the cleanest time before ${clock(t0 + deadlineOf(a) * SLOT_MS)}.`
    : `${isBest ? 'Cleanest start' : 'Your start'}: ${dayClock(startT)}`;

  const box = $('result');
  const sailingNow = pos != null;
  box.innerHTML = `
    <div class="verdict">
      <p class="when">${headline}</p>
      <p class="saving"><span class="big">${saved > 0.5 ? '−' + kgOrG(saved) : saved < -0.5 ? '+' + kgOrG(-saved) : '0 g'}</span> CO2 <span class="vs">${saved >= 0 ? `${Math.round(pct)}% less than starting now` : `${Math.round(-pct)}% more than starting now`}</span></p>
      <p class="detail">${a.name}, ${a.kWh} kWh over ${a.slots / 2} h: <strong>${kgOrG(gHere)}</strong> at ${dayClock(startT)}, against <strong>${kgOrG(gNow)}</strong> if you press start now.${isBest ? '' : ` The cleanest start is ${dayClock(t0 + p.best.index * SLOT_MS)}.`}</p>
      <p class="mix"><span>Now: ${Math.round(cleanShare(mixNow))}% zero-carbon (${mixWords(mixNow)})</span><span>At ${clock(startT)}: ${Math.round(cleanShare(mixHere))}% zero-carbon (${mixWords(mixHere)})</span></p>
    </div>
    <div class="controls">
      <label>Needs to be done by<select id="deadline">${deadlineOptions(a)}</select></label>
      <label>Energy per run<span class="unit"><input id="kwh" type="number" min="0.1" max="100" step="0.1" value="${a.kWh}" inputmode="decimal"> kWh</span></label>
      <div class="actions">
        <button id="remind" class="primary" ${sailingNow ? 'disabled' : ''}>Remind me at ${clock(startT)}</button>
        ${isBest ? '' : '<button id="reset" class="quiet">Back to the cleanest</button>'}
      </div>
    </div>`;
  if (sailingNow) return;
  $<HTMLSelectElement>('deadline').addEventListener('change', (e) => {
    ms.deadline = Number((e.target as HTMLSelectElement).value);
    ms.start = null;
    render(true);
  });
  $<HTMLInputElement>('kwh').addEventListener('change', (e) => {
    const v = Number((e.target as HTMLInputElement).value);
    if (v > 0 && v <= 100) ms.kWh = Math.round(v * 100) / 100;
    render();
  });
  $('remind').addEventListener('click', () => {
    const note = `${a.name}: start at ${dayClock(startT)} UK time. About ${kgOrG(gHere)} CO2 instead of ${kgOrG(gNow)} if started at ${dayClock(t0 + state.nowIndex * SLOT_MS)}. Forecast: NESO Carbon Intensity API.`;
    const blob = new Blob([ics(startT, a.slots * 30, `Start the ${a.name.toLowerCase()}`, note)], { type: 'text/calendar' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `grid-tide-${a.id}.ics`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(link.href), 4000);
    const btn = $('remind');
    btn.textContent = 'Reminder downloaded';
  });
  document.getElementById('reset')?.addEventListener('click', () => { ms.start = null; render(); });
}

// drag the boat
function attachDrag() {
  const chart = $('chart');
  let dragging = false;
  const move = (e: PointerEvent) => {
    if (!geomNow) return;
    const a = appliance();
    const box = chart.getBoundingClientRect();
    const raw = geomNow.slotAt(e.clientX - box.left) - a.slots / 2;
    const s = Math.max(state.nowIndex, Math.min(deadlineOf(a) - a.slots, Math.round(raw)));
    if (s !== state.machines[a.id].start) {
      state.machines[a.id].start = s;
      drawChart(); renderResult(); renderTable();
    }
  };
  chart.addEventListener('pointerdown', (e) => {
    if (!(e.target as Element).closest('svg')) return;
    cancelAnimationFrame(state.sailing);
    dragging = true;
    chart.setPointerCapture(e.pointerId);
    move(e);
  });
  chart.addEventListener('pointermove', (e) => { if (dragging) move(e); });
  const end = () => { dragging = false; };
  chart.addEventListener('pointerup', end);
  chart.addEventListener('pointercancel', end);
  // keyboard: arrows move the boat by half an hour
  chart.tabIndex = 0;
  chart.addEventListener('keydown', (e) => {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    e.preventDefault();
    const a = appliance(), ms = state.machines[a.id];
    const cur = ms.start ?? planOf(a).best.index;
    ms.start = Math.max(state.nowIndex, Math.min(deadlineOf(a) - a.slots, cur + (e.key === 'ArrowRight' ? 1 : -1)));
    drawChart(); renderResult(); renderTable();
  });
}

// ---------- table ----------
function renderTable() {
  const r = region(), t0 = r.series.start;
  const rows = APPLIANCES.map((base) => {
    const a = appliance(base.id), p = planOf(a);
    const sel = a.id === state.machine;
    return `<tr class="${sel ? 'sel' : ''}">
      <th scope="row"><button class="link" data-id="${a.id}">${a.name}</button><span class="sub">${a.kWh} kWh, ${a.slots / 2} h, done by ${dayClock(t0 + deadlineOf(a) * SLOT_MS)}</span></th>
      <td>${kgOrG(a.kWh * p.now.mean)}</td>
      <td class="t-start">${dayClock(t0 + p.best.index * SLOT_MS)}</td>
      <td>${kgOrG(a.kWh * p.best.mean)}</td>
      <td class="t-save">${p.savedPerRun > 0.5 ? '−' + kgOrG(p.savedPerRun) + ` (${Math.round(p.cutPct)}%)` : 'now is best'}</td>
    </tr>`;
  }).join('');
  $('table').innerHTML = `<thead><tr><th scope="col">Machine</th><th scope="col">Start now</th><th scope="col">Cleanest start</th><th scope="col">CO2 then</th><th scope="col">Saved per run</th></tr></thead><tbody>${rows}</tbody>`;
  $('table').querySelectorAll<HTMLButtonElement>('button.link').forEach((b) => b.addEventListener('click', () => {
    state.machine = b.dataset.id!;
    $('machines').querySelectorAll('button').forEach((x) => x.setAttribute('aria-selected', String((x as HTMLElement).dataset.id === state.machine)));
    render(true);
    $('chart').scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth', block: 'center' });
  }));
}

// ---------- the replayed year ----------
type ReplayRow = (typeof replayData.appliances)[number];
function renderYear() {
  const R = replayData;
  const d = (s: string) => new Date(s + 'T12:00Z').toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
  $('period').textContent = `${d(R.period.from)} to ${d(R.period.to)}`;
  const dish = R.appliances[0].habits[0];
  const ev = R.appliances.find((a) => a.id === 'ev')!.habits[0];
  const day24 = R.appliances[0].habits[1];
  $('facts').innerHTML = `
    <div class="fact"><p class="n">${dish.cutPct}%</p><p>less CO2 for a dishwasher moved from 7 pm to Grid Tide's pick before 7 am, scored on what the grid really emitted.</p></div>
    <div class="fact"><p class="n">${Math.round(dish.daysBetterPct)}%</p><p>of the ${dish.days} evenings, the shifted run was cleaner. The average wait was ${dish.meanWaitHours} hours.</p></div>
    <div class="fact"><p class="n">${day24.cutPct}%</p><p>less if it can wait up to a day. An electric car charging overnight: ${ev.cutPct}%.</p></div>`;

  // monthly bars
  const W = 720, H = 220, L = 34, B = 190, T = 14;
  const months = R.months;
  const maxV = Math.ceil(Math.max(...months.map((m) => m.habitMean)) / 50) * 50;
  const bw = (W - L - 8) / months.length;
  const y = (v: number) => B - (v / maxV) * (B - T);
  let svg = '';
  for (let gv = 50; gv <= maxV; gv += 50) svg += `<line class="gridline" x1="${L}" x2="${W - 8}" y1="${y(gv)}" y2="${y(gv)}"/><text class="ylab" x="${L - 5}" y="${y(gv) + 4}" text-anchor="end">${gv}</text>`;
  months.forEach((m, i) => {
    const x = L + i * bw;
    const label = new Date(m.month + '-15T12:00Z').toLocaleDateString('en-GB', { month: 'short' });
    svg += `<rect class="bar-habit" x="${x + bw * 0.14}" y="${y(m.habitMean)}" width="${bw * 0.34}" height="${B - y(m.habitMean)}"><title>${label}: ${m.habitMean} g/kWh at 7 pm</title></rect>`;
    svg += `<rect class="bar-shift" x="${x + bw * 0.5}" y="${y(m.shiftedMean)}" width="${bw * 0.34}" height="${B - y(m.shiftedMean)}"><title>${label}: ${m.shiftedMean} g/kWh at Grid Tide's pick (${m.cutPct}% less)</title></rect>`;
    svg += `<text class="tick" x="${x + bw / 2}" y="${B + 18}" text-anchor="middle">${label}</text>`;
  });
  $('months').innerHTML = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Monthly carbon intensity at 7 pm against Grid Tide's pick">${svg}</svg>`;

  renderYours();
}

function renderYours() {
  const owned = new Set((store.get('owned') ?? 'dishwasher,washer').split(',').filter(Boolean));
  const per: Record<string, number> = JSON.parse(store.get('perWeek') ?? '{}');
  const rows = replayData.appliances as ReplayRow[];
  const kg = (r: ReplayRow) => {
    const a = appliance(r.id), h = r.habits[0];
    return (a.kWh * (per[r.id] ?? r.perWeek) * 52 * (h.habitMean - h.shiftedMean)) / 1000;
  };
  const total = rows.filter((r) => owned.has(r.id)).reduce((s, r) => s + kg(r), 0);
  $('yours').innerHTML = `
    <ul class="own">${rows.map((r) => `
      <li><label class="tick-box"><input type="checkbox" data-own="${r.id}" ${owned.has(r.id) ? 'checked' : ''}> ${r.name}</label>
        <label class="runs"><input type="number" min="0" max="21" step="1" data-per="${r.id}" value="${per[r.id] ?? r.perWeek}"> runs a week</label>
        <span class="kg">${g1(kg(r))} kg a year</span></li>`).join('')}
    </ul>
    <p class="total"><span class="big">${g1(total)} kg</span> CO2 a year saved by your home. A thousand homes doing the same: <strong>${g1(total)} tonnes</strong>.</p>`;
  $('yours').querySelectorAll<HTMLInputElement>('input').forEach((inp) => inp.addEventListener('change', () => {
    if (inp.dataset.own) {
      if (inp.checked) owned.add(inp.dataset.own); else owned.delete(inp.dataset.own);
      store.set('owned', [...owned].join(','));
    } else if (inp.dataset.per) {
      per[inp.dataset.per] = Math.max(0, Math.min(21, Math.round(Number(inp.value) || 0)));
      store.set('perWeek', JSON.stringify(per));
    }
    renderYours();
  }));
}

attachDrag();
load().catch((err) => {
  $('status').textContent = 'The forecast could not be loaded. Check your connection and reload.';
  console.error(err);
});
