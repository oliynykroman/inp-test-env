import fs from 'node:fs';
import puppeteer from 'puppeteer';

const BASE = process.env.LAB_BASE || 'http://localhost:8000';
const REPS = Number(process.env.LAB_REPS || 15);
const wait = (ms) => new Promise(r => setTimeout(r, ms));

const scenarios = ['content','dashboard','form'];
const variants = [
  {name:'B0', i1:0,i2:0,i3:0,i4:0,i5:0},
  {name:'I2+I3', i1:0,i2:1,i3:1,i4:0,i5:0},
  {name:'I2+I3+I4', i1:0,i2:1,i3:1,i4:1,i5:0},
  {name:'I1', i1:1,i2:0,i3:0,i4:0,i5:0},
  {name:'I5', i1:0,i2:0,i3:0,i4:0,i5:1}, // тільки для dashboard
];

const qs = (o) => Object.entries(o).map(([k,v]) => `${k}=${v}`).join('&');

const browser = await puppeteer.launch({ headless: true, defaultViewport: { width: 1280, height: 900 } });
const page = await browser.newPage();

// CDP для мережі/CPU (сумісно з новими версіями)
const client = page.createCDPSession ? await page.createCDPSession() : await page.target().createCDPSession();

await client.send('Network.enable');
await client.send('Network.emulateNetworkConditions', {
  offline: false,
  latency: 150,
  downloadThroughput: (1.5 * 1024 * 1024) / 8, // ~1.5 Mbps
  uploadThroughput: (750 * 1024) / 8,          // ~0.75 Mbps
  connectionType: 'cellular4g'
});
await client.send('Emulation.setCPUThrottlingRate', { rate: 4 });

const results = [];

for (const scenario of scenarios) {
  for (const v of variants) {
    if (scenario !== 'dashboard' && v.i5) continue; // i5 тільки на dashboard
    for (let rep = 1; rep <= REPS; rep++) {
      const url = `${BASE}/${scenario}.html?${qs(v)}`;
      await page.goto(url, { waitUntil: 'networkidle0', timeout: 60000 });

      // дочекатися RUM (якщо є) — не критично
      await page.waitForFunction('window.__perf !== undefined', { timeout: 5000 }).catch(() => {});

      // інжект INP-колектора
      await page.addScriptTag({
        type: 'module',
        content: `
          import { onINP } from 'https://unpkg.com/web-vitals@3?module';
          window.__rum = window.__rum || [];
          onINP(m => window.__rum.push({name:m.name, value:m.value, rating:m.rating, id:m.id}), { reportAllChanges: true });
        `
      });

      // сценарії взаємодій
      if (scenario === 'content') {
        await page.waitForSelector('#expand', { timeout: 10000 });
        await page.click('#expand'); await wait(150);
        await page.click('#collapse'); await wait(150);
        await page.click('#scroll'); await wait(300);
      } else if (scenario === 'dashboard') {
        await page.waitForSelector('#sortName', { timeout: 10000 });
        await page.click('#sortName'); await wait(150);
        await page.click('#filterTag'); await wait(150);
        await page.click('#paginate'); await wait(150);
      } else if (scenario === 'form') {
        await page.waitForSelector('#fill', { timeout: 10000 });
        await page.click('#fill'); await wait(150);
        await page.click('button[type=submit]'); await wait(400);
      }

      // зачекати щоб INP/LoAF зібралися
      await wait(1200);

      const { rum, perf } = await page.evaluate(() => ({
        rum: window.__rum || [],
        perf: window.__perf || {}
      }));
      const INP = (rum.find(x => x.name === 'INP')?.value) ?? null;
      const LoAFsum = (perf.LoAF || []).reduce((a,b) => a + (b?.d || 0), 0);
      const LoAFcount = (perf.LoAF || []).length;

      results.push({ scenario, variant: v.name, rep, INP, LoAFsum, LoAFcount });
      process.stdout.write(`\r${scenario} ${v.name} rep ${rep}/${REPS} INP=${INP?.toFixed?.(1) ?? 'n/a'}    `);
    }
    process.stdout.write('\n');
  }
}

await browser.close();
fs.writeFileSync('lab-results.json', JSON.stringify(results, null, 2));
console.log('\nSaved to lab-results.json');