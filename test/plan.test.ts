import { describe, expect, it } from 'vitest';
import { bestAndWorst, plan, runMean, slotOf, timeOf, SLOT_MS, type Appliance } from '../src/plan.ts';
import { clean, london, replay, slotsAtLocal } from '../src/backtest.ts';

const dish: Appliance = { id: 'd', name: 'Dishwasher', kWh: 1, slots: 2, perWeek: 7 };

/** Brute force reference: try every start. */
function brute(v: number[], slots: number, lo: number, hi: number) {
  let best = -1, bm = Infinity, worst = -1, wm = -Infinity;
  for (let i = lo; i <= hi && i + slots <= v.length; i++) {
    const m = runMean(v, i, slots);
    if (m < bm - 1e-9) { bm = m; best = i; }
    if (m > wm + 1e-9) { wm = m; worst = i; }
  }
  return { best, worst };
}

describe('runMean', () => {
  it('averages the run', () => expect(runMean([1, 2, 3, 4], 1, 2)).toBe(2.5));
  it('is NaN when the run does not fit', () => {
    expect(runMean([1, 2, 3], 2, 2)).toBeNaN();
    expect(runMean([1, 2, 3], -1, 1)).toBeNaN();
  });
});

describe('bestAndWorst', () => {
  it('finds the valley and the peak', () => {
    const v = [200, 180, 90, 60, 70, 150, 250];
    const r = bestAndWorst(v, 2, 0, 5)!;
    expect(r.best).toEqual({ index: 3, mean: 65 });
    expect(r.worst.index).toBe(5);
  });
  it('respects the window even when a cleaner slot lies outside it', () => {
    const v = [100, 100, 100, 0, 0];
    expect(bestAndWorst(v, 2, 0, 1)!.best.index).toBe(0);
  });
  it('prefers the earliest start on ties', () => {
    expect(bestAndWorst([50, 50, 50, 50], 2, 0, 2)!.best.index).toBe(0);
  });
  it('returns null when nothing fits', () => {
    expect(bestAndWorst([1, 2, 3], 4, 0, 0)).toBeNull();
    expect(bestAndWorst([1, 2, 3], 1, 2, 1)).toBeNull();
  });
  it('matches brute force on 300 random series', () => {
    let seed = 7;
    const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);
    for (let k = 0; k < 300; k++) {
      const v = Array.from({ length: 20 + Math.floor(rnd() * 80) }, () => Math.round(rnd() * 300));
      const slots = 1 + Math.floor(rnd() * 9);
      const lo = Math.floor(rnd() * 10), hi = lo + Math.floor(rnd() * 60);
      const r = bestAndWorst(v, slots, lo, hi);
      const b = brute(v, slots, lo, hi);
      if (b.best < 0) { expect(r).toBeNull(); continue; }
      expect(r!.best.index).toBe(b.best);
      expect(r!.worst.index).toBe(b.worst);
    }
  });
});

describe('plan', () => {
  const series = { start: Date.UTC(2026, 10, 11, 18), values: [200, 200, 150, 100, 50, 50, 120, 220] };
  it('computes grams saved, percent cut and yearly kg', () => {
    const p = plan(series, dish, 0, 8)!;
    expect(p.best.index).toBe(4);
    expect(p.savedPerRun).toBe(150); // 1 kWh x (200 - 50)
    expect(p.cutPct).toBe(75);
    expect(p.kgPerYear).toBeCloseTo((150 * 7 * 52) / 1000);
  });
  it('the run must finish by the deadline', () => {
    const p = plan(series, dish, 0, 5)!; // latest start = 3
    expect(p.best.index).toBe(3);
    expect(p.best.index + dish.slots).toBeLessThanOrEqual(5);
  });
  it('saves nothing when now is already the cleanest', () => {
    const p = plan({ start: 0, values: [10, 10, 90, 90] }, dish, 0, 4)!;
    expect(p.savedPerRun).toBe(0);
    expect(p.best.index).toBe(0);
  });
  it('returns null when the window is shorter than the run', () => {
    expect(plan(series, dish, 3, 4)).toBeNull();
  });
  it('converts between slots and times', () => {
    const t = series.start + 3 * SLOT_MS + 60_000;
    expect(slotOf(series, t)).toBe(3);
    expect(timeOf(series, 3)).toBe(series.start + 3 * SLOT_MS);
  });
});

describe('backtest helpers', () => {
  it('reads London wall-clock time across the DST change', () => {
    expect(london(Date.UTC(2026, 0, 15, 19)).minutes).toBe(19 * 60); // GMT
    expect(london(Date.UTC(2026, 6, 15, 18)).minutes).toBe(19 * 60); // BST
    expect(london(Date.UTC(2026, 6, 15, 23, 30)).date).toBe('2026-07-16');
  });
  it('repairs gaps and meter glitches', () => {
    const c = clean({ start: '2026-01-01T00:00Z', stepMinutes: 30, forecast: [100, null, 62, 80], actual: [90, 95, 0, null] });
    expect(c.forecast).toEqual([100, 95, 62, 80]);
    expect(c.actual).toEqual([90, 95, 62, 80]);
    expect(c.repaired).toEqual([2, 3]);
  });
  it('finds one 19:00 slot per day, in winter and in summer', () => {
    const start = '2026-03-27T00:00Z'; // DST starts 29 Mar
    const n = 48 * 5;
    const c = clean({ start, stepMinutes: 30, forecast: Array(n).fill(100), actual: Array(n).fill(100) });
    const s = slotsAtLocal(c, 19 * 60);
    expect(s.length).toBe(5);
    expect(s[3] - s[2]).toBe(48);
    expect(s[2] - s[1]).toBe(46); // the night the clocks go forward
  });
  it('scores forecast picks on actuals and never beats hindsight', () => {
    // evening peak, overnight wind valley; forecast puts the valley one slot late
    const day = (k: number) => Array.from({ length: 48 }, (_, i) => (i >= 36 || i < 2 ? 200 : i >= 4 + k && i < 10 + k ? 40 : 120));
    const actual = [...day(0), ...day(0), ...day(0)];
    const forecast = [...day(1), ...day(1), ...day(1)];
    const c = clean({ start: '2026-01-05T00:00Z', stepMinutes: 30, forecast, actual });
    const r = replay(c, 2, { habitStart: 19 * 60, windowHours: 12 });
    expect(r.days).toBe(2);
    expect(r.habitMean).toBe(200);
    expect(r.hindsightMean).toBe(40);
    expect(r.shiftedMean).toBeGreaterThanOrEqual(r.hindsightMean);
    expect(r.cutPct).toBeLessThanOrEqual(r.hindsightCutPct);
    expect(r.daysBetterPct).toBe(100);
  });
});
