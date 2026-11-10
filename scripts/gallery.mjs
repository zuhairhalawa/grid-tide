// 3:2 gallery images (1500x1000) of the live site on the saved forecast, plus a phone trio.
// Run: node scripts/gallery.mjs [baseUrl]
import { readFileSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { chromium } from 'playwright';
const base = (process.argv[2] ?? 'https://grid-tide.pages.dev') + '/?saved';
const browser = await chromium.launch({ channel: 'msedge' });
const page = await browser.newPage({ viewport: { width: 1200, height: 800 }, deviceScaleFactor: 1.25 });
const top = (sel, off) => page.evaluate(([s, o]) => scrollTo(0, document.querySelector(s).getBoundingClientRect().top + scrollY - o), [sel, off]);
const shot = (f) => page.screenshot({ path: `docs/gallery/${f}` });

await page.goto(base, { waitUntil: 'networkidle' });
await page.waitForSelector('.boat.best');
await page.waitForTimeout(1800);
await top('.machines', 12); await page.waitForTimeout(200);
await shot('2-dishwasher-calm-night.png');

await page.click('.machines button[data-id="ev"]');
const v = await page.$eval('#deadline', (s) => [...s.options].find((o) => o.textContent === 'Thu 07:00').value);
await page.selectOption('#deadline', v);
await page.waitForTimeout(2000);
await top('.machines', 12); await page.waitForTimeout(200);
await shot('1-electric-car-wait-for-wind.png');

await top('.table-sec', 30); await page.waitForTimeout(200);
await shot('3-tide-table.png');
await top('.year', 30); await page.waitForTimeout(200);
await shot('4-year-replay.png');
await page.click('input[data-own="ev"]');
await page.click('input[data-own="washer"]');
await top('.months', 30); await page.waitForTimeout(200);
await shot('5-your-year.png');
await page.close();

// phone trio
const phone = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
const pics = [];
for (const [q, sel] of [['', null], ['&machine=ev', '.machines'], ['', '.facts']]) {
  await phone.goto(base + q, { waitUntil: 'networkidle' });
  await phone.waitForSelector('.boat.best');
  await phone.waitForTimeout(1800);
  if (sel) await phone.evaluate((s) => scrollTo(0, document.querySelector(s).getBoundingClientRect().top + scrollY - 70), sel);
  await phone.waitForTimeout(200);
  pics.push('data:image/png;base64,' + (await phone.screenshot()).toString('base64'));
}
await phone.close();
const html = `<!doctype html><meta charset="utf-8"><body style="margin:0;width:1500px;height:1000px;background:#EEF3F1;display:flex;gap:70px;justify-content:center;align-items:center">${pics.map((p) => `<div style="width:380px;height:822px;border-radius:52px;background:#14323D;padding:15px;box-shadow:0 30px 60px rgba(20,50,61,.3)"><div style="width:100%;height:100%;border-radius:38px;overflow:hidden"><img src="${p}" style="width:100%;display:block"></div></div>`).join('')}</body>`;
writeFileSync('shots/phones.html', html);
const comp = await browser.newPage({ viewport: { width: 1500, height: 1000 } });
await comp.goto(pathToFileURL(resolve('shots/phones.html')).href);
await comp.waitForTimeout(300);
await comp.screenshot({ path: 'docs/gallery/6-phone.png' });
await browser.close();
console.log('ok');
process.exit(0);
