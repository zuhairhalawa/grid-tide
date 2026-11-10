// Downloads 12 months of GB national carbon intensity (forecast + actual, half-hourly)
// from the National Energy System Operator's Carbon Intensity API into data/gb-history.json.
// Run: node scripts/fetch-history.mjs
import { writeFileSync } from 'node:fs';
const START = Date.UTC(2025, 10, 1); // 1 Nov 2025
const END = Date.UTC(2026, 10, 1);   // 1 Nov 2026 (exclusive)
const iso = (t) => new Date(t).toISOString().slice(0, 16) + 'Z';
const rows = new Map();
for (let t = START; t < END; t += 14 * 864e5) {
  const to = Math.min(t + 14 * 864e5, END);
  const url = `https://api.carbonintensity.org.uk/intensity/${iso(t)}/${iso(to)}`;
  const r = await fetch(url);
  if (!r.ok) throw new Error(url + ' ' + r.status);
  for (const x of (await r.json()).data) {
    const from = Date.parse(x.from);
    if (from >= START && from < END) rows.set(from, [x.intensity.forecast, x.intensity.actual]);
  }
  process.stdout.write('.');
}
const keys = [...rows.keys()].sort((a, b) => a - b);
const forecast = [], actual = [];
let gaps = 0, missingActual = 0;
for (let t = START, i = 0; t < END; t += 18e5, i++) {
  const v = rows.get(t);
  if (!v) gaps++;
  forecast.push(v ? v[0] : null);
  actual.push(v && v[1] != null ? v[1] : null);
  if (v && v[1] == null) missingActual++;
}
writeFileSync('data/gb-history.json', JSON.stringify({
  source: 'https://api.carbonintensity.org.uk (NESO Carbon Intensity API, CC BY 4.0), national, gCO2/kWh',
  start: iso(START), stepMinutes: 30, forecast, actual,
}));
console.log('\nslots', forecast.length, 'present', keys.length, 'gaps', gaps, 'missingActual', missingActual);
