import { describe, expect, it } from 'vitest';
import { apiTime, cleanShare, fetchLive, FUELS, fromCompact, meanMix, parseRegional, toCompact } from '../src/grid.ts';
import { monotonePath } from '../src/chart.ts';
import { defaultDeadline, ics, dayClock } from '../src/time.ts';
import { SLOT_MS } from '../src/plan.ts';
import saved from '../public/data/forecast-saved.json';
import replay from '../src/replay.json';

const slot = (from: string, gb: number, nw: number) => ({
  from,
  regions: [
    { regionid: 3, shortname: 'North West England', intensity: { forecast: nw }, generationmix: [{ fuel: 'wind', perc: 60 }, { fuel: 'gas', perc: 40 }] },
    { regionid: 18, shortname: 'GB', intensity: { forecast: gb }, generationmix: [{ fuel: 'gas', perc: 50 }, { fuel: 'nuclear', perc: 20 }, { fuel: 'solar', perc: 30 }] },
  ],
});

describe('parseRegional', () => {
  const raw = { data: [slot('2026-11-11T00:30Z', 120, 40), slot('2026-11-11T00:00Z', 150, 60)] };
  it('sorts slots, puts GB first and keeps the mix', () => {
    const f = parseRegional(raw);
    expect(f.start).toBe(Date.parse('2026-11-11T00:00Z'));
    expect(f.regions.map((r) => r.id)).toEqual([18, 3]);
    expect(f.regions[0].series.values).toEqual([150, 120]);
    expect(f.regions[1].mix[0][FUELS.indexOf('wind')]).toBe(60);
    expect(cleanShare(f.regions[0].mix[0])).toBe(50);
  });
  it('refuses a forecast with a gap', () => {
    expect(() => parseRegional({ data: [slot('2026-11-11T00:00Z', 1, 1), slot('2026-11-11T01:30Z', 1, 1)] })).toThrow(/gap/);
  });
  it('round-trips through the saved form', () => {
    const f = parseRegional(raw);
    const back = fromCompact(toCompact(f, '2026-11-11T00:10:00Z'));
    expect(back.source).toBe('saved');
    expect(back.regions[1].series.values).toEqual([60, 40]);
  });
  it('fetches from the API with a half-hour aligned time', async () => {
    let url = '';
    const fake = (async (u: string) => { url = u; return new Response(JSON.stringify(raw)); }) as unknown as typeof fetch;
    await fetchLive(Date.parse('2026-11-11T00:47:13Z'), fake);
    expect(url).toBe('https://api.carbonintensity.org.uk/regional/intensity/2026-11-11T00:30Z/fw48h');
    expect(apiTime(Date.parse('2026-11-11T00:29:59Z'))).toBe('2026-11-11T00:00Z');
  });
  it('averages the mix over a run', () => {
    expect(meanMix([[10, 0, 0, 0, 0, 0, 90, 0, 0], [30, 0, 0, 0, 0, 0, 70, 0, 0]], 0, 2)[0]).toBe(20);
  });
});

describe('saved forecast file', () => {
  it('has 18 areas with 97 half-hours and mixes that add to about 100%', () => {
    const f = fromCompact(saved);
    expect(f.regions.length).toBe(18);
    for (const r of f.regions) {
      expect(r.series.values.length).toBe(97);
      for (const row of r.mix) expect(Math.abs(row.reduce((a, b) => a + b, 0) - 100)).toBeLessThan(1.5);
    }
  });
});

describe('replay output used on the site', () => {
  it('covers a full year and reports a cut below the hindsight bound', () => {
    expect(replay.period.slots).toBe(17520);
    for (const a of replay.appliances) for (const h of a.habits) {
      expect(h.cutPct).toBeGreaterThan(0);
      expect(h.cutPct).toBeLessThanOrEqual(h.hindsightCutPct);
    }
    expect(replay.months.length).toBe(12);
  });
});

describe('time helpers', () => {
  it('defaults the deadline to the next 07:00 UK time with room for the run', () => {
    const start = Date.parse('2026-11-11T19:00Z'); // GMT: 19:00 UK
    const d = defaultDeadline(start, 96, 0, 6);
    expect(dayClock(start + d * SLOT_MS)).toBe('Thu 07:00');
    // at 05:00 a 3 h run cannot finish by 07:00 with any choice, so it is the next day
    const early = Date.parse('2026-11-12T05:00Z');
    expect(dayClock(early + defaultDeadline(early, 96, 0, 6) * SLOT_MS)).toBe('Fri 07:00');
  });
  it('writes a calendar reminder with an alarm', () => {
    const s = ics(Date.parse('2026-11-12T03:00Z'), 180, 'Start the dishwasher', 'About 177 g; CO2, not 205 g', 0);
    expect(s).toContain('DTSTART:20261112T030000Z');
    expect(s).toContain('DTEND:20261112T060000Z');
    expect(s).toContain('BEGIN:VALARM');
    expect(s).toContain('About 177 g\\; CO2\\, not 205 g');
    expect(s.split('\r\n')[0]).toBe('BEGIN:VCALENDAR');
  });
});

describe('monotonePath', () => {
  it('never dips below the lowest point (no negative carbon drawn)', () => {
    const pts: [number, number][] = [[0, 100], [10, 10], [20, 100], [30, 100], [40, 12]];
    const nums = monotonePath(pts).replace(/[MC]/g, ' ').trim().split(/[\s,]+/).map(Number);
    const ys = nums.filter((_, i) => i % 2 === 1);
    expect(Math.max(...ys)).toBeLessThanOrEqual(100);
    expect(Math.min(...ys)).toBeGreaterThanOrEqual(10);
  });
});
