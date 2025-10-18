import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as XLSX from 'xlsx/xlsx.mjs';
XLSX.set_fs(fs);

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const OUT_DIR = process.env.LAB_OUT || path.resolve(__dirname, '..');

const results      = JSON.parse(fs.readFileSync(path.join(OUT_DIR,'lab/lab-results.json'),'utf-8'));
const aggregates   = JSON.parse(fs.readFileSync(path.join(OUT_DIR,'lab/lab-results.aggregates.json'),'utf-8'));
const meta         = aggregates.meta;
const aggData      = aggregates.data;

const wb = XLSX.utils.book_new();

// runs
const wsRuns = XLSX.utils.json_to_sheet(results.map(r => ({
  scenario:r.scenario, variant:r.variant, rep:r.rep, INP:r.INP, LoAFsum:r.LoAFsum, LoAFcount:r.LoAFcount
})));
XLSX.utils.book_append_sheet(wb, wsRuns, 'runs');

// aggregates
const aggRows = [];
for (const [sc, vmap] of Object.entries(aggData)) {
  for (const [vn, s] of Object.entries(vmap)) aggRows.push({ scenario: sc, variant: vn, ...s });
}
const wsAgg = XLSX.utils.json_to_sheet(aggRows);
XLSX.utils.book_append_sheet(wb, wsAgg, 'aggregates');

// meta
const wsMeta = XLSX.utils.json_to_sheet([
  { key: 'base', value: meta.base }, { key: 'reps', value: meta.reps },
  { key: 'cpuThrottlingRate', value: meta.cpuThrottlingRate },
  { key: 'latencyMs', value: meta.network.latencyMs },
  { key: 'downloadMbps', value: meta.network.downloadMbps },
  { key: 'uploadMbps', value: meta.network.uploadMbps },
  { key: 'timestamp', value: meta.timestamp }
]);
XLSX.utils.book_append_sheet(wb, wsMeta, 'meta');

const OUT_XLSX = path.join(OUT_DIR, 'lab-results.xlsx');
XLSX.writeFile(wb, OUT_XLSX);
console.log(`Saved to ${OUT_XLSX}`);