import fs from 'node:fs';
import puppeteer from 'puppeteer';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const BASE = process.env.LAB_BASE || 'http://localhost:8000';
const REPS = Number(process.env.LAB_REPS || 15);
const wait = (ms) => new Promise(r => setTimeout(r, ms));

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
// Write outputs to project root by default (one level up from lab/), override via LAB_OUT
const OUT_DIR = process.env.LAB_OUT || path.resolve(__dirname, '..');
console.log(`[lab] Output directory: ${OUT_DIR}`);

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
const OUT_MAIN = path.join(OUT_DIR, 'lab-results.json');
fs.writeFileSync(OUT_MAIN, JSON.stringify(results, null, 2));
console.log(`\nSaved to ${OUT_MAIN}`);

// Also save a detailed, grouped view per scenario and variant
const meta = {
  base: BASE,
  reps: REPS,
  network: { latencyMs: 150, downloadMbps: 1.5, uploadMbps: 0.75 },
  cpuThrottlingRate: 4,
  timestamp: new Date().toISOString()
};

// Prepare grouping structure
const byVariant = {};
for (const s of scenarios) byVariant[s] = {};
for (const v of variants) {
  for (const s of scenarios) {
    if (s !== 'dashboard' && v.i5) continue; // keep invariant from main loop
    if (!byVariant[s][v.name]) byVariant[s][v.name] = [];
  }
}

// Fill with all repetitions for each scenario × variant
for (const r of results) {
  const { scenario, variant, rep, INP, LoAFsum, LoAFcount } = r;
  (byVariant[scenario][variant] || (byVariant[scenario][variant] = []))
    .push({ rep, INP, LoAFsum, LoAFcount });
}

const detailed = { meta, data: byVariant };
const OUT_BYVAR = path.join(OUT_DIR, 'lab-results.by-variant.json');
fs.writeFileSync(OUT_BYVAR, JSON.stringify(detailed, null, 2));
console.log(`Saved to ${OUT_BYVAR}`);

// --- Write per-scenario×variant files ---
const pairsDir = path.join(OUT_DIR, 'lab-results', 'pairs');
fs.mkdirSync(pairsDir, { recursive: true });

for (const [sc, vmap] of Object.entries(byVariant)) {
  for (const [vn, runs] of Object.entries(vmap)) {
    if (!runs || runs.length === 0) continue;
    const payload = { meta, scenario: sc, variant: vn, runs };
    const filePath = `${pairsDir}/${sc}__${vn}.json`;
    fs.writeFileSync(filePath, JSON.stringify(payload, null, 2));
    console.log(`Saved to ${filePath}`);
  }
}

// --- Aggregates per scenario×variant (INP mean/median/q98) ---
function quantileSorted(arr, q) {
  if (!arr.length) return null;
  const pos = (arr.length - 1) * q;
  const base = Math.floor(pos);
  const rest = pos - base;
  return arr[base + 1] !== undefined ? arr[base] + rest * (arr[base + 1] - arr[base]) : arr[base];
}

function statsINP(values) {
  const n = values.length;
  const xs = values.filter((v) => Number.isFinite(v)).sort((a, b) => a - b);
  const m = xs.length;
  const mean = m ? xs.reduce((a, b) => a + b, 0) / m : null;
  const median = m ? quantileSorted(xs, 0.5) : null;
  const q98 = m ? quantileSorted(xs, 0.98) : null;
  return { n_total: n, n_numeric: m, meanINP: mean, medianINP: median, q98INP: q98 };
}

const aggData = {};
for (const [sc, vmap] of Object.entries(byVariant)) {
  aggData[sc] = {};
  for (const [vn, runs] of Object.entries(vmap)) {
    const inpValues = (runs || []).map((r) => r.INP);
    aggData[sc][vn] = statsINP(inpValues);
  }
}

const aggregates = { meta, data: aggData };
const OUT_AGG = path.join(OUT_DIR, 'lab-results.aggregates.json');
fs.writeFileSync(OUT_AGG, JSON.stringify(aggregates, null, 2));
console.log(`Saved to ${OUT_AGG}`);