// Core planner: pick the cleanest time to run an appliance inside the user's window.
// Pure functions, no DOM. Intensities are gCO2/kWh, one value per half-hour slot.

export const SLOT_MS = 30 * 60 * 1000;

export interface Series {
  /** Start of slot 0, epoch ms (UTC). */
  start: number;
  /** gCO2 per kWh, one value per half-hour. */
  values: number[];
}

export interface Appliance {
  id: string;
  name: string;
  /** Energy per run, kWh. */
  kWh: number;
  /** Run length in half-hour slots. */
  slots: number;
  /** Runs per week (for yearly totals). */
  perWeek: number;
}

export interface Choice {
  /** First slot index of the run. */
  index: number;
  /** Mean intensity over the run, gCO2/kWh. */
  mean: number;
}

/** Mean of values[index .. index+slots-1]; NaN if the run does not fit. */
export function runMean(values: readonly number[], index: number, slots: number): number {
  if (slots < 1 || index < 0 || index + slots > values.length) return NaN;
  let s = 0;
  for (let i = index; i < index + slots; i++) s += values[i];
  return s / slots;
}

/**
 * Cleanest and dirtiest start inside [earliest, latestStart] (slot indices, inclusive).
 * Ties go to the earliest start, so the user waits no longer than needed.
 * Returns null when no run fits.
 */
export function bestAndWorst(values: readonly number[], slots: number, earliest: number, latestStart: number):
  { best: Choice; worst: Choice } | null {
  const lo = Math.max(0, earliest);
  const hi = Math.min(latestStart, values.length - slots);
  if (slots < 1 || hi < lo) return null;
  // sliding window sum
  let sum = 0;
  for (let i = lo; i < lo + slots; i++) sum += values[i];
  let best = { index: lo, sum }, worst = { index: lo, sum };
  for (let i = lo + 1; i <= hi; i++) {
    sum += values[i + slots - 1] - values[i - 1];
    if (sum < best.sum - 1e-9) best = { index: i, sum };
    if (sum > worst.sum + 1e-9) worst = { index: i, sum };
  }
  return {
    best: { index: best.index, mean: best.sum / slots },
    worst: { index: worst.index, mean: worst.sum / slots },
  };
}

/** Grams of CO2 for one run of `kWh` at a mean intensity. */
export const grams = (kWh: number, mean: number) => kWh * mean;

export interface Plan {
  appliance: Appliance;
  now: Choice;
  best: Choice;
  worst: Choice;
  /** grams saved per run vs starting now */
  savedPerRun: number;
  /** percent cut vs starting now (0..100) */
  cutPct: number;
  /** kg saved per year at perWeek runs */
  kgPerYear: number;
}

/**
 * Plan one appliance: start no earlier than `nowIndex`, finish by `deadlineIndex`
 * (exclusive slot index, i.e. the run must end at or before the start of that slot).
 */
export function plan(series: Series, a: Appliance, nowIndex: number, deadlineIndex: number): Plan | null {
  const latestStart = deadlineIndex - a.slots;
  const bw = bestAndWorst(series.values, a.slots, nowIndex, latestStart);
  if (!bw) return null;
  const nowMean = runMean(series.values, nowIndex, a.slots);
  const now = { index: nowIndex, mean: nowMean };
  const savedPerRun = grams(a.kWh, nowMean) - grams(a.kWh, bw.best.mean);
  return {
    appliance: a,
    now,
    best: bw.best,
    worst: bw.worst,
    savedPerRun,
    cutPct: nowMean > 0 ? (savedPerRun / grams(a.kWh, nowMean)) * 100 : 0,
    kgPerYear: (savedPerRun * a.perWeek * 52) / 1000,
  };
}

/** Slot index of an epoch-ms time within a series (floor). */
export const slotOf = (s: Series, t: number) => Math.floor((t - s.start) / SLOT_MS);
/** Epoch ms of a slot index. */
export const timeOf = (s: Series, i: number) => s.start + i * SLOT_MS;
