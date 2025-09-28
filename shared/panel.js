
  import { VARIANT, readVariantFromURL, writeVariantToURL } from './interventions.js';
  readVariantFromURL();
  const mount = () => {
    const el = document.getElementById('panel'); if (!el) return;
    el.innerHTML = `
      <div class="panel">
        <span class="badge">Variants</span>
        <label><input type="checkbox" id="i1"> I1 Delegation</label>
        <label><input type="checkbox" id="i2"> I2 Slicing</label>
        <label><input type="checkbox" id="i3"> I3 Prioritization</label>
        <label><input type="checkbox" id="i4"> I4 DOM Batching</label>
        ${location.pathname.endsWith('dashboard.html') ? '<label><input type="checkbox" id="i5"> I5 Containment</label>' : ''}
        <button class="btn" id="apply">Apply</button>
        <a class="btn" href="./content.html">Content</a>
        <a class="btn" href="./dashboard.html">Dashboard</a>
        <a class="btn" href="./form.html">Form</a>
      </div>`;
    ['i1','i2','i3','i4','i5'].forEach(id => {
      const cb = el.querySelector('#'+id); if (!cb) return;
      cb.checked = VARIANT[id];
    });
    el.querySelector('#apply')?.addEventListener('click', () => {
      ['i1','i2','i3','i4','i5'].forEach(id => {
        const cb = el.querySelector('#'+id); if (cb) VARIANT[id] = cb.checked;
      });
      writeVariantToURL(); location.reload();
    });
  };
  window.addEventListener('DOMContentLoaded', mount);
