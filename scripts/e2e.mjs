// End-to-end test in Edge against a running site (default: the live one).
// It captures the forecast the page itself downloaded, recomputes the cleanest start by
// brute force here in Node, and checks the page agrees; then drives the controls.
// Run: node scripts/e2e.mjs [baseUrl]   (writes docs/e2e.json)
import { writeFileSync, readFileSync, mkdirSync } from 'node:fs';
import { chromium } from '../../video/node_modules/playwright/index.mjs';

const base = process.argv[2] ?? 'https://grid-tide.pages.dev';
const results = [];
const check = (name, ok, detail = '') => { results.push({ name, ok: !!ok, detail }); console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ': ' + detail : ''}`); };
const uk = (t) => new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/London', weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(t)).replace(',', '');

function brute(values, slots, lo, deadline) {
  let best = -1, bm = Infinity;
  for (let i = lo; i + slots <= deadline; i++) {
    let s = 0; for (let k = i; k < i + slots; k++) s += values[k];
    if (s / slots < bm - 1e-9) { bm = s / slots; best = i; }
  }
  return { best, mean: bm };
}

const browser = await chromium.launch({ channel: 'msedge' });
const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, acceptDownloads: true });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
let apiJson = null;
page.on('response', async (r) => { if (r.url().includes('api.carbonintensity.org.uk/regional/intensity')) apiJson = await r.json().catch(() => null); });

await page.goto(base, { waitUntil: 'networkidle' });
await page.waitForSelector('.boat.best', { timeout: 15000 });
await page.waitForTimeout(1800);

const status = await page.textContent('#status');
check('loads the live forecast', /^Live forecast/.test(status) && apiJson, status);

// 1. the page's pick equals brute force on the same data
const slotsData = [...apiJson.data].sort((a, b) => Date.parse(a.from) - Date.parse(b.from));
const start = Date.parse(slotsData[0].from);
const gb = slotsData.map((s) => s.regions.find((r) => r.regionid === 18).intensity.forecast);
const nowIndex = Math.floor((Date.now() - start) / 18e5);
const deadlineText = await page.$eval('#deadline', (s) => s.value);
const deadline = Number(deadlineText);
const ref = brute(gb, 6, nowIndex, deadline);
const when = await page.textContent('.when');
const expected = uk(start + ref.best * 18e5);
check('dishwasher pick matches brute force', ref.best === nowIndex ? /cleanest time/.test(when) : when.includes(expected), `page "${when}", brute force ${expected} (${ref.mean.toFixed(1)} g/kWh)`);

// 2. grams shown = kWh x mean
const detail = await page.textContent('.detail');
const grams = Math.round(0.9 * ref.mean);
check('grams per run = 0.9 kWh x mean intensity', detail.includes(`${grams} g`), detail.slice(0, 90));

// 3. a later deadline can only keep or improve the saving
const before = await page.textContent('.saving .big');
const lastOpt = await page.$eval('#deadline', (s) => s.options[s.options.length - 1].value);
await page.selectOption('#deadline', lastOpt);
await page.waitForTimeout(1900);
const after = await page.textContent('.saving .big');
const refLate = brute(gb, 6, nowIndex, Number(lastOpt));
const toG = (s) => { const m = s.replace('−', '-').match(/(-?[\d.]+)\s*(kg|g)/); return m ? Number(m[1]) * (m[2] === 'kg' ? 1000 : 1) : 0; };
check('a later deadline keeps or improves the saving', Math.abs(toG(after)) >= Math.abs(toG(before)) - 0.5, `${before} -> ${after}`);
check('latest-deadline pick matches brute force', (await page.textContent('.when')).includes(uk(start + refLate.best * 18e5)) || refLate.best === nowIndex, await page.textContent('.when'));

// 4. dragging the boat moves the start and the numbers follow
const box = await page.locator('#chart svg').boundingBox();
await page.mouse.move(box.x + box.width * 0.12, box.y + box.height * 0.5);
await page.mouse.down();
await page.mouse.move(box.x + box.width * 0.2, box.y + box.height * 0.5, { steps: 6 });
await page.mouse.up();
await page.waitForTimeout(300);
const moved = await page.textContent('.when');
check('dragging moves the boat off the cleanest start', /^Your start/.test(moved) && (await page.$('.boat.moved')), moved);
await page.click('#reset');
check('"Back to the cleanest" returns to the pick', /Cleanest start|cleanest time/.test(await page.textContent('.when')));

// 5. calendar reminder
const [dl] = await Promise.all([page.waitForEvent('download'), page.click('#remind')]);
const path = await dl.path();
const icsText = readFileSync(path, 'utf8');
check('reminder downloads a valid calendar file', dl.suggestedFilename() === 'grid-tide-dishwasher.ics' && /BEGIN:VEVENT[\s\S]*DTSTART:\d{8}T\d{6}Z[\s\S]*BEGIN:VALARM/.test(icsText), dl.suggestedFilename());

// 6. every machine and region renders
for (const id of ['washer', 'dryer', 'ev', 'dishwasher']) {
  await page.click(`.machines button[data-id="${id}"]`);
  await page.waitForTimeout(1700);
}
check('all four machines render a plan', (await page.$$('#table tbody tr')).length === 4 && (await page.$('.boat')));
await page.selectOption('#region', '13');
await page.waitForTimeout(1700);
const london = slotsData.map((s) => s.regions.find((r) => r.regionid === 13).intensity.forecast);
const sound = await page.$$eval('.sounding', (n) => n.map((x) => Number(x.textContent)));
check('switching to London redraws with London numbers', sound.length > 3 && sound.every((v) => london.some((l) => Math.round(l) === v)), `${sound.slice(0, 5).join(',')}`);

// 7. phone: no sideways scroll, chart fits
const phone = await browser.newPage({ viewport: { width: 375, height: 812 }, isMobile: true, hasTouch: true });
await phone.goto(base, { waitUntil: 'networkidle' });
await phone.waitForSelector('.boat.best');
const overflow = await phone.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
check('phone: no horizontal page scroll', overflow <= 0, `overflow ${overflow}px`);

// 8. saved forecast mode is labelled
await phone.goto(base + '/?saved', { waitUntil: 'networkidle' });
check('saved forecast is labelled as saved', /^Saved forecast from/.test(await phone.textContent('#status')));

check('no console errors', errors.length === 0, errors.join(' | '));
await browser.close();

const passed = results.filter((r) => r.ok).length;
console.log(`\n${passed}/${results.length} passed`);
mkdirSync('docs', { recursive: true });
writeFileSync('docs/e2e.json', JSON.stringify({ base, ranAt: new Date().toISOString(), passed, total: results.length, results }, null, 1));
process.exit(passed === results.length ? 0 : 1);
