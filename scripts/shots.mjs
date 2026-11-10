// Screenshots in Edge: node scripts/shots.mjs [baseUrl] [outDir]
import { chromium } from '../../video/node_modules/playwright/index.mjs';
const base = process.argv[2] ?? 'http://localhost:5195';
const out = process.argv[3] ?? 'shots';
const browser = await chromium.launch({ channel: 'msedge' });
const errors = [];
for (const [name, vp] of [['desktop', { width: 1280, height: 860 }], ['phone', { width: 390, height: 844 }]]) {
  const page = await browser.newPage({ viewport: vp, deviceScaleFactor: 2 });
  page.on('pageerror', (e) => errors.push(`${name}: ${e.message}`));
  page.on('console', (m) => m.type() === 'error' && errors.push(`${name}: ${m.text()}`));
  await page.goto(`${base}/?saved`, { waitUntil: 'networkidle' });
  await page.waitForSelector('.boat.best');
  await page.waitForTimeout(1800);
  await page.screenshot({ path: `${out}/${name}-top.png` });
  await page.screenshot({ path: `${out}/${name}-full.png`, fullPage: true });
  await page.close();
}
await browser.close();
console.log(errors.length ? errors.join('\n') : 'no page errors');
