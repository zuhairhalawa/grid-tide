// Live grid forecast from the NESO Carbon Intensity API (Great Britain, CC BY 4.0).
// One call returns 14 regions, England, Scotland, Wales and GB for the next 48 hours, half-hourly.

import { SLOT_MS, type Series } from './plan.ts';

export const API = 'https://api.carbonintensity.org.uk';
export const FUELS = ['wind', 'solar', 'hydro', 'nuclear', 'biomass', 'imports', 'gas', 'coal', 'other'] as const;
export type Fuel = (typeof FUELS)[number];

export interface Region {
  id: number;
  name: string;
  series: Series;
  /** generation mix per slot, percent by fuel (FUELS order) */
  mix: number[][];
}

export interface Forecast {
  /** epoch ms of slot 0 */
  start: number;
  regions: Region[];
  /** where the numbers came from */
  source: 'live' | 'saved';
  /** when the saved forecast was taken (saved only) */
  savedAt?: string;
}

interface RawRegion {
  regionid: number;
  shortname: string;
  intensity: { forecast: number };
  generationmix: { fuel: string; perc: number }[];
}
interface RawSlot { from: string; regions: RawRegion[] }

/** Parse the /regional/intensity/{from}/fw48h response. Skips slots with missing data. */
export function parseRegional(raw: { data: RawSlot[] }, source: Forecast['source'] = 'live'): Forecast {
  const slots = [...raw.data].sort((a, b) => Date.parse(a.from) - Date.parse(b.from));
  if (!slots.length) throw new Error('empty forecast');
  const start = Date.parse(slots[0].from);
  const byId = new Map<number, Region>();
  slots.forEach((slot, i) => {
    const t = Date.parse(slot.from);
    if (t !== start + i * SLOT_MS) throw new Error(`forecast has a gap at ${slot.from}`);
    for (const r of slot.regions) {
      let reg = byId.get(r.regionid);
      if (!reg) {
        reg = { id: r.regionid, name: r.shortname, series: { start, values: [] }, mix: [] };
        byId.set(r.regionid, reg);
      }
      const m = new Map(r.generationmix.map((g) => [g.fuel, g.perc]));
      reg.series.values.push(r.intensity.forecast);
      reg.mix.push(FUELS.map((f) => m.get(f) ?? 0));
    }
  });
  const regions = [...byId.values()].filter((r) => r.series.values.length === slots.length);
  regions.sort((a, b) => (a.id === 18 ? -1 : b.id === 18 ? 1 : a.id - b.id));
  return { start, regions, source };
}

/** Compact form saved in public/data/forecast-saved.json (fallback and demo). */
export interface Compact {
  savedAt: string;
  start: string;
  regions: { id: number; name: string; values: number[]; mix: number[][] }[];
}

export function toCompact(f: Forecast, savedAt: string): Compact {
  return {
    savedAt,
    start: new Date(f.start).toISOString(),
    regions: f.regions.map((r) => ({ id: r.id, name: r.name, values: r.series.values, mix: r.mix })),
  };
}

export function fromCompact(c: Compact): Forecast {
  const start = Date.parse(c.start);
  return {
    start,
    source: 'saved',
    savedAt: c.savedAt,
    regions: c.regions.map((r) => ({ id: r.id, name: r.name, series: { start, values: r.values }, mix: r.mix })),
  };
}

/** The API's own time format, e.g. 2026-11-11T13:30Z, floored to the half-hour. */
export function apiTime(t: number): string {
  const f = Math.floor(t / SLOT_MS) * SLOT_MS;
  return new Date(f).toISOString().slice(0, 16) + 'Z';
}

export async function fetchLive(now = Date.now(), fetcher: typeof fetch = fetch): Promise<Forecast> {
  const r = await fetcher(`${API}/regional/intensity/${apiTime(now)}/fw48h`);
  if (!r.ok) throw new Error(`grid API answered ${r.status}`);
  return parseRegional(await r.json(), 'live');
}

/** Share of zero-carbon sources (wind, solar, hydro, nuclear) in a mix row. */
export function cleanShare(mixRow: number[]): number {
  return ['wind', 'solar', 'hydro', 'nuclear'].reduce((s, f) => s + mixRow[FUELS.indexOf(f as Fuel)], 0);
}

/** Average mix over a run of slots. */
export function meanMix(mix: number[][], index: number, slots: number): number[] {
  const out = FUELS.map(() => 0);
  for (let i = index; i < index + slots; i++) mix[i].forEach((v, k) => (out[k] += v / slots));
  return out;
}
