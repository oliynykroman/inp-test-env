
import fs from 'node:fs';
import path from 'node:path';

const inPath = path.resolve('lab-results.json');
if (!fs.existsSync(inPath)) {
  console.error('lab-results.json not found. Run the runner first.');
  process.exit(1);
}
const raw = JSON.parse(fs.readFileSync(inPath, 'utf8'));

// ---- helpers ----
const byScenarioVariant = new Map(); // key: `${scenario}||${variant}` -> INP[]
for (const r of raw) {
  if (r.INP == null || !isFinite(r.INP)) continue;
  const key = `${r.scenario}||${r.variant}`;
  if (!byScenarioVariant.has(key)) byScenarioVariant.set(key, []);
  byScenarioVariant.get(key).push(Number(r.INP));
}

function rankWithTies(arr) {
  // returns array of ranks (1-based), ties get average rank
  const n = arr.length;
  const idx = arr.map((v,i)=>({v,i})).sort((a,b)=>a.v-b.v);
  const ranks = Array(n);
  let i = 0;
  while (i < n) {
    let j = i+1;
    while (j<n && idx[j].v === idx[i].v) j++;
    const avgRank = (i+1 + j)/2; // 1-based
    for (let k=i;k<j;k++) ranks[idx[k].i] = avgRank;
    i = j;
  }
  return ranks;
}

function mannWhitneyUTest(x, y) {
  // two-sided p-value with tie correction (normal approx)
  const n1 = x.length, n2 = y.length;
  const pooled = x.concat(y);
  const ranks = rankWithTies(pooled);
  const ranksX = ranks.slice(0, n1);
  const R1 = ranksX.reduce((a,b)=>a+b,0);

  const U1 = R1 - n1*(n1+1)/2;
  const U2 = n1*n2 - U1;
  const U = Math.min(U1, U2);

  const n = n1 + n2;
  // tie correction term
  const counts = new Map();
  for (const v of pooled) counts.set(v, (counts.get(v)||0)+1);
  let tieSum = 0;
  for (const t of counts.values()) {
    tieSum += (t*t*t - t);
  }
  const mu = n1*n2/2;
  const varU = (n1*n2/12) * (n + 1 - tieSum/(n*(n-1)));
  const sd = Math.sqrt(varU);

  // continuity correction
  const z = sd > 0 ? (U - mu + 0.5*Math.sign(mu - U)) / sd : 0;
  const p = 2 * (1 - normalCdf(Math.abs(z)));

  return { U, U1, U2, p, z };
}

// Abramowitz & Stegun approximation for normal CDF
function normalCdf(z) {
  const t = 1 / (1 + 0.2316419 * z);
  const d = Math.exp(-z*z/2) / Math.sqrt(2*Math.PI);
  const poly = 0.319381530*t - 0.356563782*t**2 + 1.781477937*t**3 - 1.821255978*t**4 + 1.330274429*t**5;
  return 1 - d*poly;
}

function cliffsDelta(x, y) {
  // O(n*m) — ок для наших вибірок
  let wins = 0, losses = 0, ties = 0;
  for (const xi of x) {
    for (const yi of y) {
      if (xi > yi) wins++;
      else if (xi < yi) losses++;
      else ties++;
    }
  }
  const n = x.length * y.length;
  const delta = n ? (wins - losses) / n : 0;
  // інтерпретація за Romano et al.: |δ| < .147 (negligible), < .33 (small), < .474 (medium), інакше large
  const a = Math.abs(delta);
  let level = 'negligible';
  if (a >= 0.474) level = 'large';
  else if (a >= 0.33) level = 'medium';
  else if (a >= 0.147) level = 'small';
  return { delta, level, wins, losses, ties };
}

// ---- per-scenario comparisons vs B0 ----
const scenarios = [...new Set(raw.map(r => r.scenario))];
const records = [];

for (const s of scenarios) {
  // зібрати усі варіанти цього сценарію
  const variants = [...new Set(raw.filter(r=>r.scenario===s).map(r=>r.variant))];
  if (!variants.includes('B0')) continue;

  const base = (byScenarioVariant.get(`${s}||B0`) || []).slice().sort((a,b)=>a-b);
  const tests = [];

  for (const v of variants) {
    if (v === 'B0') continue;
    const sample = (byScenarioVariant.get(`${s}||${v}`) || []).slice().sort((a,b)=>a-b);
    if (base.length === 0 || sample.length === 0) continue;

    const { p, U } = mannWhitneyUTest(sample, base); // (variant vs B0)
    const { delta, level } = cliffsDelta(sample, base);

    tests.push({ scenario:s, variant:v, n_base:base.length, n_var:sample.length, p_raw:p, U, cliff_delta:delta, cliff_level:level });
  }

  // Holm–Bonferrони is scenario
  const alpha = 0.05;
  const m = tests.length;
  const sorted = [...tests].sort((a,b)=>a.p_raw - b.p_raw);

  let maxAdj = 0;
  for (let i=0;i<sorted.length;i++) {
    const rank = i+1;                   
    const pAdj = Math.min(1, sorted[i].p_raw * (m - i)); // step-down
    maxAdj = Math.max(maxAdj, pAdj);
    sorted[i].p_holm = maxAdj;           // monotomized Holm p-value
    sorted[i].significant_0_05 = sorted[i].p_holm <= alpha;
  }
  // swap 
  const byVar = new Map(sorted.map(t => [t.variant, t]));
  for (const t of tests) {
    const adj = byVar.get(t.variant);
    records.push({
      scenario: t.scenario,
      variant: t.variant,
      n_base: t.n_base,
      n_var: t.n_var,
      U: t.U.toFixed(1),
      p_raw: t.p_raw.toExponential(3),
      p_holm: adj.p_holm.toExponential(3),
      significant_0_05: adj.significant_0_05 ? 'TRUE' : 'FALSE',
      cliffs_delta: t.cliff_delta.toFixed(3),
      effect: t.cliff_level
    });
  }
}

// ---- write CSV ----
const header = ['scenario','variant','n_base','n_var','U','p_raw','p_holm','significant_0_05','cliffs_delta','effect'];
const lines = [header.join(',')].concat(
  records.map(r => header.map(h => r[h]).join(','))
);
fs.writeFileSync('lab-stats.csv', lines.join('\n'), 'utf8');
console.log('Saved lab-stats.csv');