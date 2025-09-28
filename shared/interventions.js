// Polyfill/adapter for prioritized tasks
export const postTask = (cb, priority = 'user-visible') => {
  if (window.scheduler?.postTask) return scheduler.postTask(cb, { priority });
  // degrade priorities: user-blocking ~ microtask; user-visible ~ macrotask; background ~ idle
  if (priority === 'user-blocking') return Promise.resolve().then(cb);
  if (priority === 'background' && 'requestIdleCallback' in window) {
    return new Promise(r => requestIdleCallback(() => r(cb())));
  }
  return new Promise(r => setTimeout(() => r(cb()), 0));
};

// DOM mutation batching in a single RAF
export const mutate = (() => {
  let q = []; let scheduled = false; const root = () => document.getElementById('app-root');
  return (fn) => {
    q.push(fn);
    if (!scheduled) {
      scheduled = true;
      requestAnimationFrame(() => {
        const frag = document.createDocumentFragment();
        for (const job of q) job(frag);
        const target = root(); if (target) target.appendChild(frag);
        q = []; scheduled = false;
      });
    }
  };
})();

// Toggle state (read/write from URL & UI)
export const VARIANT = {
  delegation: false, // I1
  slicing: false,    // I2
  prioritization: false, // I3
  batching: false,   // I4
  containment: false // I5 (dashboard only)
};

export function readVariantFromURL() {
  const p = new URLSearchParams(location.search);
  const on = (v) => ['1','true','yes','y'].includes(String(v).toLowerCase());
  VARIANT.delegation = on(p.get('i1'));
  VARIANT.slicing = on(p.get('i2'));
  VARIANT.prioritization = on(p.get('i3'));
  VARIANT.batching = on(p.get('i4'));
  VARIANT.containment = on(p.get('i5'));
}

export function writeVariantToURL() {
  const p = new URLSearchParams(location.search);
  p.set('i1', VARIANT.delegation); p.set('i2', VARIANT.slicing);
  p.set('i3', VARIANT.prioritization); p.set('i4', VARIANT.batching);
  p.set('i5', VARIANT.containment);
  history.replaceState(null, '', '?' + p.toString());
}

export function applyContainment(el) {
  if (!el) return;
  el.style.contain = 'content';
  el.style.containIntrinsicSize = 'auto 600px';
  el.style.contentVisibility = 'auto';
}

// Heavy work simulator split into chunks
export function* heavyWorkChunks(items = 1200) {
  // quick CPU loop to emulate expensive calc
  const CHUNK = 150; let i = 0;
  while (i < items) {
    const end = Math.min(i + CHUNK, items);
    let acc = 0; for (; i < end; i++) acc += Math.sqrt(i) * Math.random();
    yield acc;
  }
}

export async function processHeavyWork({ slices = VARIANT.slicing, prio = VARIANT.prioritization } = {}) {
  if (!slices) {
    // monolithic work (baseline)
    for (const _ of heavyWorkChunks(2400)) {/* block main thread */}
    return;
  }
  // sliced with cooperative yielding and priorities
  for (const chunk of heavyWorkChunks(2400)) {
    const run = () => {/* compute */};
    if (prio) await postTask(run, 'user-visible'); else await postTask(run);
  }
}

export function attachHandlers({ container, selector, handler }) {
  if (VARIANT.delegation) {
    container.addEventListener('click', (e) => {
      const target = e.target.closest(selector); if (!target) return;
      handler(e, target);
    });
    return () => container.removeEventListener('click', handler);
  }
  // direct listeners (baseline)
  const nodes = container.querySelectorAll(selector);
  for (const n of nodes) n.addEventListener('click', (e) => handler(e, n));
  return () => { for (const n of nodes) n.replaceWith(n.cloneNode(true)); };
}