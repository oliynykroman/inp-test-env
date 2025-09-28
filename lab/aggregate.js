import fs from "fs";
const data = JSON.parse(fs.readFileSync("lab-results.json","utf8"));

function quantile(arr, p) {
  const a = arr.filter(x => x!=null && isFinite(x)).sort((x,y)=>x-y);
  if (!a.length) return NaN;
  const i = (a.length - 1) * p, lo = Math.floor(i), hi = Math.ceil(i);
  return lo===hi ? a[lo] : a[lo] + (a[hi]-a[lo])*(i-lo);
}

const groups = {};
for (const r of data) {
  const k = `${r.scenario}|${r.variant}`;
  (groups[k] ||= []).push(r.INP);
}
console.log("scenario,variant,p50_INP_ms,p75_INP_ms");
for (const [k, vals] of Object.entries(groups)) {
  const [scenario,variant] = k.split("|");
  const p50 = quantile(vals, 0.5).toFixed(1);
  const p75 = quantile(vals, 0.75).toFixed(1);
  console.log(`${scenario},${variant},${p50},${p75}`);
}