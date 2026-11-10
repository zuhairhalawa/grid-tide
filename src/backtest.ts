// Replays a year of real grid data: what would shifting have saved?
// The start is chosen from the FORECAST (what the app sees), the result is scored on
// the ACTUAL intensity (what really came out of the chimneys).

import { bestAndWorst, runMean, SLOT_MS } from './plan.ts';

export interface History {
  start: string;
  stepMinutes: number;
  forecast: (number | null)[];
  actual: (number | null)[];
}

export interface Cleaned {
  start: number;
  forecast: number[];
  actual: number[];
  /** slots whose actual value was repaired (missing or an obvious glitch) */
  repaired: number[];
}

/**
 * Fill gaps: a missing value takes the other series' value; an actual that drops
 * below 5 g while the forecast says over 30 g is a meter glitch and takes the forecast.
 */
export function clean(h: History): Cleaned {
  const forecast: number[] = [], actual: number[] = [], repaired: number[] = [];
  for (let i = 0; i < h.forecast.length; i++) {
    let f = h.forecast[i], a = h.actual[i];
    if (f == null && a == null) {
      f = forecast[i - 1] ?? 0; a = actual[i - 1] ?? 0; repaired.push(i);
    } else if (a == null || (a < 5 && (f ?? 0) > 30)) {
      a = f!; repaired.push(i);
    } else if (f == null) f = a;
    forecast.push(f!); actual.push(a!);
  }
  return { start: Date.parse(h.start), forecast, actual, repaired };
}

const londonParts = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Europe/London', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  year: 'numeric', month: '2-digit', day: '2-digit',
});

/** London wall-clock {date, minutes since midnight} for an epoch-ms time. */
export function london(t: number): { date: string; minutes: number } {
  const p = Object.fromEntries(londonParts.formatToParts(new Date(t)).map((x) => [x.type, x.value]));
  return { date: `${p.year}-${p.month}-${p.day}`, minutes: Number(p.hour) * 60 + Number(p.minute) };
}

/** Indices of slots that start at the given London wall-clock time (one per day; DST-safe). */
export function slotsAtLocal(c: Cleaned, minutes: number): number[] {
  const out: number[] = [];
  for (let i = 0; i < c.actual.length; i++) {
    if (london(c.start + i * SLOT_MS).minutes === minutes) out.push(i);
  }
  return out;
}

export interface Habit {
  /** London local start time people use today, minutes after midnight (e.g. 19*60). */
  habitStart: number;
  /** Hours the appliance may wait (window length, start..finish). */
  windowHours: number;
}

export interface Replay {
  days: number;
  /** mean actual gCO2/kWh when started at the habit time */
  habitMean: number;
  /** mean actual gCO2/kWh at the start the forecast picked */
  shiftedMean: number;
  /** mean actual gCO2/kWh at the best start in hindsight (upper bound) */
  hindsightMean: number;
  /** % cut vs habit, forecast-picked (what the app achieves) */
  cutPct: number;
  /** % cut with perfect knowledge */
  hindsightCutPct: number;
  /** share of days where the shifted run was cleaner than the habit run */
  daysBetterPct: number;
  /** mean hours waited after the habit start */
  meanWaitHours: number;
}

export function replay(c: Cleaned, slots: number, habit: Habit): Replay {
  const starts = slotsAtLocal(c, habit.habitStart);
  const win = Math.round(habit.windowHours * 2);
  let h = 0, s = 0, o = 0, better = 0, wait = 0, n = 0;
  for (const i0 of starts) {
    const latest = i0 + win - slots;
    if (latest + slots > c.actual.length) continue;
    const pick = bestAndWorst(c.forecast, slots, i0, latest);
    const oracle = bestAndWorst(c.actual, slots, i0, latest);
    if (!pick || !oracle) continue;
    const hm = runMean(c.actual, i0, slots);
    const sm = runMean(c.actual, pick.best.index, slots);
    h += hm; s += sm; o += oracle.best.mean; n++;
    if (sm < hm - 1e-9) better++;
    wait += (pick.best.index - i0) / 2;
  }
  return {
    days: n,
    habitMean: h / n,
    shiftedMean: s / n,
    hindsightMean: o / n,
    cutPct: (1 - s / h) * 100,
    hindsightCutPct: (1 - o / h) * 100,
    daysBetterPct: (better / n) * 100,
    meanWaitHours: wait / n,
  };
}

/** Same replay, split by London calendar month of the habit start (YYYY-MM). */
export function replayByMonth(c: Cleaned, slots: number, habit: Habit): { month: string; habitMean: number; shiftedMean: number; cutPct: number }[] {
  const starts = slotsAtLocal(c, habit.habitStart);
  const win = Math.round(habit.windowHours * 2);
  const acc = new Map<string, { h: number; s: number; n: number }>();
  for (const i0 of starts) {
    const latest = i0 + win - slots;
    if (latest + slots > c.actual.length) continue;
    const pick = bestAndWorst(c.forecast, slots, i0, latest);
    if (!pick) continue;
    const month = london(c.start + i0 * SLOT_MS).date.slice(0, 7);
    const a = acc.get(month) ?? { h: 0, s: 0, n: 0 };
    a.h += runMean(c.actual, i0, slots);
    a.s += runMean(c.actual, pick.best.index, slots);
    a.n++;
    acc.set(month, a);
  }
  return [...acc.entries()].map(([month, a]) => ({
    month, habitMean: a.h / a.n, shiftedMean: a.s / a.n, cutPct: (1 - a.s / a.h) * 100,
  }));
}
