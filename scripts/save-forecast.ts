// Saves the current 48-hour forecast to public/data/forecast-saved.json.
// The site falls back to it when the live API is unreachable, and ?saved shows it on purpose
// (the demo video uses it so the numbers in the narration stay true). Run: npm run save-forecast
import { writeFileSync } from 'node:fs';
import { fetchLive, toCompact } from '../src/grid.ts';
const now = Date.now();
const f = await fetchLive(now);
writeFileSync('public/data/forecast-saved.json', JSON.stringify(toCompact(f, new Date(now).toISOString())));
console.log('saved', f.regions.length, 'regions,', f.regions[0].series.values.length, 'slots from', new Date(f.start).toISOString());
