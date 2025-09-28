  import {onINP, onLCP, onCLS} from 'https://unpkg.com/web-vitals@3?module';
  const send = (m) => {
    console.log('[RUM]', m.name, m.value, m.rating, m.id);
    // TODO: navigator.sendBeacon('/rum', JSON.stringify(m));
  };
  onINP(send, { reportAllChanges: true });
  onLCP(send); onCLS(send);

  // LoAF + LongTask observers
  const LoAF = []; const LT = [];
  if ('PerformanceObserver' in window) {
    try { new PerformanceObserver(list => { for (const e of list.getEntries()) LoAF.push({s:e.startTime, d:e.duration}); })
      .observe({ type: 'long-animation-frame', buffered: true }); } catch {}
    try { new PerformanceObserver(list => { for (const e of list.getEntries()) LT.push({s:e.startTime, d:e.duration}); })
      .observe({ type: 'longtask', buffered: true }); } catch {}
  }

  // Event Timing context (last interactions)
  const ET = [];
  try { new PerformanceObserver(list => { for (const e of list.getEntries()) ET.push({name:e.name, s:e.startTime, d:e.duration, target:e.target?.tagName}); })
    .observe({ type: 'event', buffered: true, durationThreshold: 16 }); } catch {}

  // Simple inspector
  window.__perf = { LoAF, LT, ET };
  console.log('%cRUM ready → window.__perf', 'color:#8bd450');