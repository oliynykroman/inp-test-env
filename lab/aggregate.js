import fs from 'fs';

// Input & output paths
const INPUT = 'lab-results.json';
const OUTPUT = 'lab-aggregate.csv';

// Load data
const data = JSON.parse(fs.readFileSync(INPUT, 'utf8'));

// Helpers
function quantile(arr, p) {
  const a = arr.filter((x) => Number.isFinite(x)).sort((x, y) => x - y);
  if (!a.length) return NaN;
  const i = (a.length - 1) * p;
  const lo = Math.floor(i);
  const hi = Math.ceil(i);
  return lo === hi ? a[lo] : a[lo] + (a[hi] - a[lo]) * (i - lo);
}

function fmt(x, digits = 1) {
  return Number.isFinite(x) ? x.toFixed(digits) : '';
}

// Group by scenario × variant
const groups = new Map();
for (const r of data) {
  const key = `${r.scenario}|${r.variant}`;
  if (!groups.has(key)) {
    groups.set(key, { scenario: r.scenario, variant: r.variant, inp: [], loafsum: [], loafcount: [] });
  }
  const g = groups.get(key);
  const INP = Number(r.INP);
  const LS = Number(r.LoAFsum);
  const LC = Number(r.LoAFcount);
  if (Number.isFinite(INP)) g.inp.push(INP);
  if (Number.isFinite(LS)) g.loafsum.push(LS);
  if (Number.isFinite(LC)) g.loafcount.push(LC);
}

// Build CSV rows
const header = ['scenario','variant','count','p50_INP_ms','p75_INP_ms','loaf_sum_median','loaf_any_%'];
const rows = [header.join(',')];

for (const g of [...groups.values()].sort((a,b)=> (a.scenario+a.variant).localeCompare(b.scenario+b.variant))) {
  const count = g.inp.length;
  const p50 = quantile(g.inp, 0.5);
  const p75 = quantile(g.inp, 0.75);
  const loafSumMedian = quantile(g.loafsum, 0.5);
  const loafAnyPct = g.loafcount.length ? (100 * g.loafcount.filter(x => x > 0).length / g.loafcount.length) : NaN;
  rows.push([
    g.scenario,
    g.variant,
    count,
    fmt(p50),
    fmt(p75),
    fmt(loafSumMedian),
    fmt(loafAnyPct)
  ].join(','));
}

fs.writeFileSync(OUTPUT, rows.join('\n'));
console.log(`Wrote ${OUTPUT} with ${rows.length - 1} rows.`);