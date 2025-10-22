// runner.js — restored + updated
// Node 18+ ESM. Launches Puppeteer, emulates network/CPU, runs scenarios/variants with REPS,
// collects INP + Event Timing (W/H/R) and LoAF, and writes:
//   - lab-results.json (flat runs)
//   - lab-results.by-variant.json (grouped)
//   - lab-results/pairs/<scenario>__<variant>.json (per pair)
//   - lab-results.aggregates.json (INP + W/H/R + LoAF aggregates)

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer';

// ---------- Config ----------
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const BASE = process.env.LAB_BASE || 'http://localhost:8000';
const REPS = Number(process.env.LAB_REPS || 15);
const OUT_DIR = process.env.LAB_OUT || path.resolve(__dirname, '..');

console.log(`[lab] BASE=${BASE}`);
console.log(`[lab] REPS=${REPS}`);
console.log(`[lab] Output directory: ${OUT_DIR}`);

const NETWORK = { latencyMs: 150, downloadMbps: 1.5, uploadMbps: 0.75 };
const CPU_THROTTLE = 8;

const scenarios = ['form'];
const variants = [
  { name: 'B0',          i1:0, i2:0, i3:0, i4:0, i5:0 },
  { name: 'I2',          i1:0, i2:1, i3:0, i4:0, i5:0 },
  { name: 'I3',          i1:0, i2:0, i3:1, i4:0, i5:0 },
  { name: 'I4',          i1:0, i2:0, i3:0, i4:1, i5:0 },
  { name: 'I2+I3',       i1:0, i2:1, i3:1, i4:0, i5:0 },
  { name: 'I2+I3+I4',    i1:0, i2:1, i3:1, i4:1, i5:0 },
  { name: 'I2+I4',       i1:0, i2:1, i3:0, i4:1, i5:0 },
  { name: 'I3+I4',       i1:0, i2:0, i3:1, i4:1, i5:0 },
  { name: 'I1',          i1:1, i2:0, i3:0, i4:0, i5:0 },
  { name: 'I5',          i1:0, i2:0, i3:0, i4:0, i5:1 } // only for dashboard
];

function qsFrom(v) {
  const p = new URLSearchParams();
  p.set('i1', String(v.i1));
  p.set('i2', String(v.i2));
  p.set('i3', String(v.i3));
  p.set('i4', String(v.i4));
  p.set('i5', String(v.i5));
  return p.toString();
}

function wait(ms) { return new Promise(res => setTimeout(res, ms)); }

// ---------- Browser bootstrap ----------
const browser = await puppeteer.launch({
  headless: 'new',
  defaultViewport: { width: 1280, height: 900 }
});
const page = await browser.newPage();

// Emulate network + CPU via CDP
const client = await page.target().createCDPSession();
await client.send('Network.enable');
await client.send('Network.emulateNetworkConditions', {
  offline: false,
  latency: NETWORK.latencyMs,
  downloadThroughput: Math.round(NETWORK.downloadMbps * 1024 * 1024 / 8),
  uploadThroughput: Math.round(NETWORK.uploadMbps * 1024 * 1024 / 8)
});
await client.send('Emulation.setCPUThrottlingRate', { rate: CPU_THROTTLE });

// ---------- Storage ----------
const results = [];
const byVariant = Object.create(null);
for (const s of scenarios) byVariant[s] = Object.create(null);

const meta = {
  base: BASE,
  reps: REPS,
  network: NETWORK,
  cpuThrottlingRate: CPU_THROTTLE,
  timestamp: new Date().toISOString()
};

// ---------- Helpers for scripted interactions ----------
async function safeClick(sel) {
  const el = await page.$(sel);
  if (el) await el.click().catch(()=>{});
}

async function scenarioInteractions(scenario) {
  if (scenario === 'content') {
    await safeClick('#expand');
    await wait(150);
    await safeClick('#collapse');
    await wait(150);
    await safeClick('#scroll');
  } else if (scenario === 'dashboard') {
    await safeClick('#sortName');
    await wait(150);
    await safeClick('#filterTag');
    await wait(150);
    await safeClick('#paginate');
  } else if (scenario === 'form') {
    await safeClick('#fill');
    await wait(150);
    await safeClick('button[type="submit"], #submit, [data-test="submit"]');
  }
}

// ---------- Main loop ----------
for (const scenario of scenarios) {
  const vorder = [...variants].sort(() => Math.random() - 0.5);
  for (const v of vorder) {
    // skip I5 except for dashboard
    if (scenario !== 'dashboard' && v.i5) continue;

    for (let rep = 1; rep <= REPS; rep++) {
      const url = `${BASE}/${scenario}.html?${qsFrom(v)}`;
      console.log(`[lab] ${scenario} :: ${v.name} :: rep ${rep} → ${url}`);

      try {
        await page.goto(url, { waitUntil: 'networkidle0', timeout: 60_000 });
      } catch (e) {
        console.warn(`[lab] navigation error: ${e?.message}`);
      }

      // ---- Inject Event Timing + INP collectors
      await page.addScriptTag({
        type: 'module',
        content: `
          import { onINP } from 'https://unpkg.com/web-vitals@3?module';
          (function(){
            window.__INP_READY = false;

            // Event Timing
            window.__evt = window.__evt || [];
            if (PerformanceObserver.supportedEntryTypes?.includes('event')) {
              new PerformanceObserver((list) => {
                for (const e of list.getEntries()) {
                  if (!('interactionId' in e) || !e.interactionId) continue;
                  window.__evt.push({
                    interactionId: e.interactionId,
                    name: e.name,
                    startTime: e.startTime,
                    processingStart: e.processingStart,
                    processingEnd: e.processingEnd,
                    duration: e.duration
                  });
                }
              }).observe({ type: 'event', buffered: true, durationThreshold: 0 });
            }

            // INP candidates
            window.__inp = null;
            onINP((m) => {
              window.__inp = {
                value: m.value,
                rating: m.rating,
                entries: (m.entries || []).map((e) => ({
                  interactionId: e.interactionId,
                  name: e.name,
                  startTime: e.startTime,
                  processingStart: e.processingStart,
                  processingEnd: e.processingEnd,
                  duration: e.duration
                }))
              };
            }, { reportAllChanges: true });

            window.__INP_READY = true;
          })();
        `
      });

      // ensure listeners are ready before driving interactions
      await page.waitForFunction('window.__INP_READY === true', { timeout: 10_000 }).catch(()=>{});

      // drive the scenario
      await scenarioInteractions(scenario);

      // give metrics time to flush
      await wait(1200);

      // read out metrics
      const { inp, evt, perf } = await page.evaluate(() => ({
        inp:  window.__inp || null,
        evt:  window.__evt || [],
        perf: window.__perf || {}
      }));

      const INP = inp?.value ?? null;
      let INP_W = null, INP_H = null, INP_R = null, INP_event = null;

      if (inp?.entries?.length) {
        const worst = inp.entries[inp.entries.length - 1];
        INP_event = worst;
        INP_W = (worst.processingStart ?? 0) - (worst.startTime ?? 0);
        INP_H = (worst.processingEnd ?? 0) - (worst.processingStart ?? 0);
        INP_R = (INP != null) ? Math.max(0, INP - (INP_W + INP_H)) : null;
      } else if (Array.isArray(evt) && evt.length) {
        // fallback: take the longest Event Timing entry
        const fb = evt.reduce((a,b) => (b?.duration ?? -1) > (a?.duration ?? -1) ? b : a, null);
        if (fb) {
          INP_event = fb;
          INP_W = (fb.processingStart ?? 0) - (fb.startTime ?? 0);
          INP_H = (fb.processingEnd ?? 0) - (fb.processingStart ?? 0);
          INP_R = (INP != null) ? Math.max(0, INP - (INP_W + INP_H)) : null;
        }
      }

      const loafArr = Array.isArray(perf?.LoAF) ? perf.LoAF : [];
      const LoAFcount = loafArr.length;
      const LoAFsum = loafArr.reduce((a, b) => a + (Number(b?.overBudget ?? b?.d ?? 0) || 0), 0);

      // --- LoAF window relative to worst interaction: [startTime, startTime+500ms] ---
      let LoAFsum_500ms = null, LoAFcount_500ms = null, LoAFany_500ms = null;
      if (INP_event && Number.isFinite(INP_event.startTime)) {
        const T0 = INP_event.startTime;
        const T1 = T0 + 500;
        const inWin = loafArr.filter(f => {
          const fs = Number(f?.startTime);
          const dur = Number(f?.duration);
          if (!Number.isFinite(fs) || !Number.isFinite(dur)) return false;
          const fe = fs + dur;
          return fe >= T0 && fs <= T1; // overlaps the 0–500ms window
        });
        LoAFcount_500ms = inWin.length;
        LoAFsum_500ms = inWin.reduce((a, f) => a + (Number(f?.overBudget ?? f?.d ?? 0) || 0), 0);
        LoAFany_500ms = LoAFcount_500ms > 0 ? 1 : 0;
      }

      const rec = {
        scenario, variant: v.name, rep,
        INP, INP_W, INP_H, INP_R,
        LoAFsum, LoAFcount,
        LoAFsum_500ms, LoAFcount_500ms, LoAFany_500ms,
        INP_event
      };
      results.push(rec);

      // populate byVariant for grouped outputs
      if (!byVariant[scenario][v.name]) byVariant[scenario][v.name] = [];
      byVariant[scenario][v.name].push({
        rep, INP, INP_W, INP_H, INP_R,
        LoAFsum, LoAFcount,
        LoAFsum_500ms, LoAFcount_500ms, LoAFany_500ms
      });
    }
  }
}

await browser.close().catch(()=>{});

// ---------- Write outputs ----------
fs.mkdirSync(OUT_DIR, { recursive: true });

// flat runs
const OUT_MAIN = path.join(OUT_DIR, 'lab-results.json');
fs.writeFileSync(OUT_MAIN, JSON.stringify(results, null, 2));
console.log(`\nSaved to ${OUT_MAIN}`);
// also save a shadow copy in lab/ for tools that read relative to this folder
const OUT_MAIN_LAB = path.join(__dirname, 'lab-results.json');
try {
  fs.writeFileSync(OUT_MAIN_LAB, JSON.stringify(results, null, 2));
  console.log(`Saved (shadow) to ${OUT_MAIN_LAB}`);
} catch (e) {
  console.warn(`[lab] shadow write failed: ${e?.message}`);
}

// grouped view
const detailed = { meta, data: byVariant };
const OUT_BYVAR = path.join(OUT_DIR, 'lab-results.by-variant.json');
fs.writeFileSync(OUT_BYVAR, JSON.stringify(detailed, null, 2));
console.log(`Saved to ${OUT_BYVAR}`);
// shadow copy for lab/
const OUT_BYVAR_LAB = path.join(__dirname, 'lab-results.by-variant.json');
try {
  fs.writeFileSync(OUT_BYVAR_LAB, JSON.stringify(detailed, null, 2));
  console.log(`Saved (shadow) to ${OUT_BYVAR_LAB}`);
} catch (e) {
  console.warn(`[lab] shadow write failed: ${e?.message}`);
}

// per scenario×variant files
const pairsDir = path.join(OUT_DIR, 'lab-results', 'pairs');
fs.mkdirSync(pairsDir, { recursive: true });
for (const [sc, vmap] of Object.entries(byVariant)) {
  for (const [vn, runs] of Object.entries(vmap)) {
    if (!runs || runs.length === 0) continue;
    const payload = { meta, scenario: sc, variant: vn, runs };
    const fp = path.join(pairsDir, `${sc}__${vn}.json`);
    fs.writeFileSync(fp, JSON.stringify(payload, null, 2));
    console.log(`Saved to ${fp}`);
    // shadow copy under lab/
    const pairsDirLab = path.join(__dirname, 'lab-results', 'pairs');
    fs.mkdirSync(pairsDirLab, { recursive: true });
    const fpLab = path.join(pairsDirLab, `${sc}__${vn}.json`);
    try {
      fs.writeFileSync(fpLab, JSON.stringify(payload, null, 2));
      console.log(`Saved (shadow) to ${fpLab}`);
    } catch (e) {
      console.warn(`[lab] shadow pair write failed: ${e?.message}`);
    }
  }
}

// ---------- Aggregates per scenario×variant (INP + W/H/R + LoAF) ----------
function quantileSorted(arr, q) {
  if (!arr.length) return null;
  const pos = (arr.length - 1) * q;
  const base = Math.floor(pos);
  const rest = pos - base;
  return arr[base + 1] !== undefined ? arr[base] + rest * (arr[base + 1] - arr[base]) : arr[base];
}

function toNumericSorted(values) {
  const xs = values.filter((v) => Number.isFinite(v)).slice().sort((a, b) => a - b);
  return xs;
}

function statsMeanMedianQ98(values) {
  const xs = toNumericSorted(values);
  const m = xs.length;
  const mean = m ? xs.reduce((a, b) => a + b, 0) / m : null;
  const median = m ? quantileSorted(xs, 0.5) : null;
  const q75 = m ? quantileSorted(xs, 0.75) : null; // p75
  const q98 = m ? quantileSorted(xs, 0.98) : null;
  return { n_numeric: m, mean, median, q75, q98 };
}
// Prefer the fresh in-memory byVariant; if missing, derive from results
const sourceByVariant = byVariant && Object.keys(byVariant).length ? byVariant : (() => {
  const m = {};
  for (const r of results) {
    const sc = r.scenario; const vn = r.variant;
    if (!sc || !vn) continue;
    if (!m[sc]) m[sc] = {};
    if (!m[sc][vn]) m[sc][vn] = [];
    m[sc][vn].push({
      rep: r.rep,
      INP: r.INP,
      INP_W: r.INP_W,
      INP_H: r.INP_H,
      INP_R: r.INP_R,
      LoAFsum: r.LoAFsum,
      LoAFcount: r.LoAFcount,
      LoAFsum_500ms: r.LoAFsum_500ms,
      LoAFcount_500ms: r.LoAFcount_500ms,
      LoAFany_500ms: r.LoAFany_500ms
    });
  }
  return m;
})();

const aggData = {};
for (const [sc, vmap] of Object.entries(sourceByVariant)) {
  aggData[sc] = {};
  for (const [vn, runs] of Object.entries(vmap)) {
    const r = runs || [];

    // INP
    const sINP = statsMeanMedianQ98(r.map(x => x.INP));

    // W/H/R
    const sW = statsMeanMedianQ98(r.map(x => x.INP_W));
    const sH = statsMeanMedianQ98(r.map(x => x.INP_H));
    const sR = statsMeanMedianQ98(r.map(x => x.INP_R));

    // LoAF
    const sLoAFsum = statsMeanMedianQ98(r.map(x => x.LoAFsum));
    const sLoAFcnt = statsMeanMedianQ98(r.map(x => x.LoAFcount));

    // LoAF within 0–500ms window after interaction start
    const sLoAFsumWin = statsMeanMedianQ98(r.map(x => x.LoAFsum_500ms));
    const sLoAFcntWin = statsMeanMedianQ98(r.map(x => x.LoAFcount_500ms));
    const meanLoAFanyWin = (() => {
      const xs = r.map(x => x.LoAFany_500ms).filter(v => Number.isFinite(v));
      return xs.length ? xs.reduce((a,b)=>a+b,0) / xs.length : null;
    })();

    aggData[sc][vn] = {
      // INP
  n_total: r.length,
  n_numeric_INP: sINP.n_numeric,
  meanINP: sINP.mean,
  medianINP: sINP.median,
  p75INP: sINP.q75,
  q98INP: sINP.q98,

      // W/H/R (D1/D2/D3)
      n_numeric_W: sW.n_numeric,
      medianINP_W: sW.median,
      p75INP_W: sW.q75,
      q98INP_W: sW.q98,

      n_numeric_H: sH.n_numeric,
      medianINP_H: sH.median,
      p75INP_H: sH.q75,
      q98INP_H: sH.q98,

      n_numeric_R: sR.n_numeric,
      medianINP_R: sR.median,
      p75INP_R: sR.q75,
      q98INP_R: sR.q98,

      // LoAFsum (whole run)
      n_numeric_LoAFsum: sLoAFsum.n_numeric,
      meanLoAFsum: sLoAFsum.mean,
      medianLoAFsum: sLoAFsum.median,
      p75LoAFsum: sLoAFsum.q75,
      q98LoAFsum: sLoAFsum.q98,

      // LoAFcount (whole run)
      n_numeric_LoAFcount: sLoAFcnt.n_numeric,
      meanLoAFcount: sLoAFcnt.mean,
      medianLoAFcount: sLoAFcnt.median,
      p75LoAFcount: sLoAFcnt.q75,
      q98LoAFcount: sLoAFcnt.q98,

      // LoAF in 0–500ms window after interaction
      n_numeric_LoAFsum_500ms: sLoAFsumWin.n_numeric,
      meanLoAFsum_500ms: sLoAFsumWin.mean,
      medianLoAFsum_500ms: sLoAFsumWin.median,
      p75LoAFsum_500ms: sLoAFsumWin.q75,
      q98LoAFsum_500ms: sLoAFsumWin.q98,

      n_numeric_LoAFcount_500ms: sLoAFcntWin.n_numeric,
      meanLoAFcount_500ms: sLoAFcntWin.mean,
      medianLoAFcount_500ms: sLoAFcntWin.median,
      p75LoAFcount_500ms: sLoAFcntWin.q75,
      q98LoAFcount_500ms: sLoAFcntWin.q98,

      meanLoAFany_500ms: meanLoAFanyWin
    };
  }
}

const OUT_AGG = path.join(OUT_DIR, 'lab-results.aggregates.json');
fs.writeFileSync(OUT_AGG, JSON.stringify({ meta, data: aggData }, null, 2));
console.log(`Saved to ${OUT_AGG}`);

console.log('\nAll done.');