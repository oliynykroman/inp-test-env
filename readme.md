# INP‑first Lab — reproducible interaction performance experiments

This repository contains **framework‑agnostic** demo pages (HTML/CSS/JS) and a **laboratory runner** (Puppeteer) for reproducible measurements of **INP** and related signals (LoAF, LCP, CLS). The goal is to test interventions **I1–I5** and compare their impact on **p50/p75 INP** across typical UI scenarios.

---
## 📦 Project structure
```
…/scopus/test-lab/
  content.html           # “content page” scenario (accordion, scroll)
  dashboard.html         # “list/table”: sort, filter, paginate
  form.html              # “form”: 24 fields, validation, submit
  shared/
    styles.css           # shared styles
    interventions.js     # I1–I5 implementation + helpers (postTask, batching, etc.)
    panel.js             # on‑page controls for toggling variants
    rum.js               # instrumentation: Web Vitals + LoAF/LongTask + Event Timing
  lab/
    runner.js            # Puppeteer runner: replays actions, emulates network/CPU, collects metrics
    aggregate.js         # aggregates p50/p75 INP into CSV
    package.json         # run scripts (serve/test/test:all/aggregate)
    readme.md            # this file
```

---
## 🧪 What we measure
**On‑page metric stack:**
- **INP / LCP / CLS** via `web-vitals` (see `shared/rum.js`; console log lines prefixed with `[RUM] …`).
- **LoAF** (*Long Animation Frames*) and **Long Tasks** via `PerformanceObserver` → exposed under `window.__perf`.
- **Event Timing** (event type, target) for interaction context → also in `window.__perf`.

**Intervention variants:**
- **B0** — baseline (naïve handlers).
- **I1** — *Delegation* (event delegation).
- **I2** — *Slicing* (breaking up handlers; cooperative yielding).
- **I3** — *Prioritization* (`scheduler.postTask` or fallbacks; priority levels).
- **I4** — *DOM batching* (apply many small mutations in a single RAF).
- **I5** — *CSS containment* (`content-visibility`); **used only on `dashboard.html`**.

Enable/disable on the page’s top panel or via query parameters: `?i1=1&i2=1&i3=1&i4=1&i5=1`.

**Laboratory measurements (runner):**
- Emulate **4G‑like** network (≈150 ms RTT, ~1.5 Mbps down / 0.75 Mbps up) and **CPU×4**.
- For each scenario/variant the runner performs a fixed interaction script (clicks) with repetitions (**REPS**).
- From the page it reads: `INP` (via `web-vitals`), `LoAFsum` and `LoAFcount` (sum/count of LoAF frames).
- Writes **`lab-results.json`**; then computes **p50/p75 INP** into **`lab-aggregate.csv`**.

> **Note:** `content.html` and `form.html` include synthetic loads (CPU + DOM) to make the differences between **B0 vs I2/I3/I4** more visible.

---
## 🚀 Quick start
Option A — **one command (auto‑server + tests + CSV):**
```bash
cd lab
npm i
npm run test:all
```
The script starts a local server (`http-server .. -p 8000`), waits for `http://localhost:8000/content.html`, runs `runner.js`, and produces `lab-aggregate.csv`.

Option B — **run server and tests separately:**
```bash
# Terminal A — a static server that serves the project root with the HTML pages
cd lab
npm run serve         # equivalent to: http-server .. -p 8000 --cors -c-1

After seerver run open server for ex.   
http://127.0.0.1:8000/content.html 
http://127.0.0.1:8000/form.html
http://127.0.0.1:8000/dashboard.html

# Terminal B — run tests against that server
cd lab
npm run test          # runs runner.js with LAB_BASE=http://localhost:8000
npm run aggregate     # produces lab-aggregate.csv
```

> **Windows (PowerShell):**
> - `npm run test` already uses `cross-env`, so it works as is.
> - If you want a global server: `npm run win:install-server` installs `http-server` globally (or use the devDependency).

If your server listens on a different host/port, run:
```bash
# macOS/Linux
LAB_BASE=http://localhost:5500 node runner.js
# Windows PowerShell
$env:LAB_BASE = 'http://localhost:5500'; node runner.js
```

---
## 📈 Outputs
- **`lab/lab-results.json`** — raw results (each repetition with fields: `scenario`, `variant`, `rep`, `INP`, `LoAFsum`, `LoAFcount`).
- **`lab/lab-aggregate.csv`** — aggregated summary per `scenario × variant`: `p50_INP_ms`, `p75_INP_ms`, `count`.

For a quick manual look on the page:
- Open DevTools → Console: check `[RUM] INP/LCP/CLS …` lines.
- Use arrays in `window.__perf`: `LoAF`, `LT` (LongTasks), `ET` (Event Timing).

---
## ⚙️ Load / environment settings
**Runner (`lab/runner.js`):**
- **REPS**: repetitions per variant (env `LAB_REPS`, default 15).
- **CPU throttling**: `Emulation.setCPUThrottlingRate({ rate: 4 })`. For stronger effects try 6–8.
- **Network**: `Network.emulateNetworkConditions` (150 ms, ~1.5/0.75 Mbps) — adjust if needed.

**Page scenarios:**
- `content.html`: constant **HEAVY_COUNT** — how many DOM nodes are injected per interaction (reveals I4 impact).
- `form.html`: **VALIDATION_WEIGHT**, **SERIALIZE_WEIGHT** — “weight” of validation/serialization (drives INP in B0; I2/I3 spread the work).
- `dashboard.html`: dataset size (≈3000 by default), **PAGE_SIZE** (200), buttons `sort/filter/paginate`.

**Toggling interventions:**
- Use the panel on each page (checkboxes I1–I5 + **Apply** button).
- Or the query string: `?i1=1&i2=1&i3=1&i4=1` (and for `dashboard.html` also `&i5=1`).

**Optional RUM collection:**
- `shared/rum.js` contains a commented `navigator.sendBeacon('/rum', …)`. Add a handler on your server to collect field data if desired.

---
## 🔍 Common issues & fixes
- **`ERR_CONNECTION_REFUSED`** in the runner — local server not started or wrong port. Open `http://localhost:8000/content.html` in a browser and check `LAB_BASE`.
- **`404 Not Found`** — the server serves the wrong directory. It must serve the **project root with the HTML** (`…/test-lab`), not `lab/`.
- **ESM warning** — ensure `"type": "module"` is present in `lab/package.json`.
- **Changes not reflected** — run `http-server` with `-c-1` (disable cache) or restart the server.
- **INP ≈ 24 ms across variants** — increase synthetic load (see constants above) and/or raise CPU throttling; increase `REPS`.

---
## 📚 Useful links
- [Web Vitals (INP/LCP/CLS)](https://web.dev/articles/vitals)
- [Long Animation Frames (LoAF)](https://github.com/WICG/long-animation-frames)
- [Event Timing](https://wicg.github.io/event-timing/)

---
## 📝 License
This demo set is provided “as is” for research purposes; feel free to use and modify.

# INP‑first Lab — reproducible interaction performance experiments

Цей репозиторій містить **фреймворк‑агностичні** демо‑сторінки (HTML/CSS/JS) та **лабораторний раннер** (Puppeteer) для відтворюваних вимірювань **INP** і пов’язаних показників (LoAF, LCP, CLS). Мета — протестувати інтервенції **I1–I5** і порівняти їхній вплив на **p50/p75 INP** у типових UI‑сценаріях.

---
## 📦 Структура проєкту
```
…/scopus/test-lab/
  content.html           # Сценарій «контентна сторінка» (акордеон, скрол)
  dashboard.html         # «список/таблиця»: сортування, фільтр, пагінація
  form.html              # «форма»: 24 поля, валідація, сабміт
  shared/
    styles.css           # спільні стилі
    interventions.js     # реалізація I1–I5 + helpers (postTask, batching, тощо)
    panel.js             # панель перемикачів варіантів на сторінці
    rum.js               # інструментація Web Vitals + LoAF/LongTask + Event Timing
  lab/
    runner.js            # Puppeteer‑раннер: клікає сценарії, емулює мережу/CPU, збирає метрики
    aggregate.js         # агрегує p50/p75 INP у CSV
    package.json         # скрипти запуску (serve/test/test:all/aggregate)
    readme.md            # цей файл
```

---
## 🧪 Що саме ми вимірюємо
**Метричний стек (на сторінці):**
- **INP / LCP / CLS** через `web-vitals` (див. `shared/rum.js`, лог у консоль `[RUM] …`).
- **LoAF** (*Long Animation Frames*) і **Long Tasks** через `PerformanceObserver` → доступно в `window.__perf`.
- **Event Timing** (тип події, таргет) для контексту взаємодій → також у `window.__perf`.

**Варіанти інтервенцій:**
- **B0** — базова реалізація (наївні обробники).
- **I1** — *Delegation* (делегування подій).
- **I2** — *Slicing* (дроблення обробників; cooperative yielding).
- **I3** — *Prioritization* (`scheduler.postTask` або фолбеки; пріоритети).
- **I4** — *DOM batching* (пакетні мутації за один RAF).
- **I5** — *CSS containment* (`content-visibility`); **лише для `dashboard.html`**.

Увімкнення/вимкнення — у верхній панелі сторінки або query‑параметрами: `?i1=1&i2=1&i3=1&i4=1&i5=1`.

**Лабораторні вимірювання (runner):**
- Емулюємо мережу **4G‑like** (≈150ms RTT, ~1.5Mbps down / 0.75Mbps up) і **CPU×4**.
- Для кожного сценарію та варіанту виконуємо послідовність дій (кліки) з повтореннями (**REPS**).
- Зі сторінки зчитуємо: `INP` (через `web-vitals`), `LoAFsum` і `LoAFcount` (сума/кількість кадрів LoAF).
- Записуємо в `lab-results.json`; потім рахуємо **p50/p75 INP** у `lab-aggregate.csv`.

> **Примітка:** у `content.html` і `form.html` додано «штучні» навантаження (CPU + DOM), щоби відчутніше проявлялися різниці **B0 vs I2/I3/I4**.

---
## 🚀 Швидкий старт
Варіант A — **одна команда (автосервер + тести + CSV):**
```bash
cd lab
npm i
npm run test:all
```
Скрипт підніме локальний сервер (`http-server .. -p 8000`), дочекається `http://localhost:8000/content.html`, запустить `runner.js` і збере `lab-aggregate.csv`.

Варіант B — **окремо** сервер і тести:
```bash
# Термінал A — сервер, що віддає кореневу теку зі сторінками
cd lab
npm run serve         # еквівалент http-server .. -p 8000 --cors -c-1

After seerver run open server for ex.   
http://127.0.0.1:8000/content.html 
http://127.0.0.1:8000/form.html
http://127.0.0.1:8000/dashboard.html

# Термінал B — тести проти цього сервера
cd lab
npm run test          # запускає runner.js із LAB_BASE=http://localhost:8000
npm run aggregate     # збирає lab-aggregate.csv
```

> **Windows (PowerShell):** 
> - `npm run test` вже використовує `cross-env`, тож працює без змін. 
> - Якщо хочеш глобальний сервер: `npm run win:install-server` встановить `http-server` глобально (або використовуй вбудований у devDependencies).

Якщо твій сервер слухає інший порт/хост, запусти так:
```bash
# macOS/Linux
LAB_BASE=http://localhost:5500 node runner.js
# Windows PowerShell
$env:LAB_BASE = 'http://localhost:5500'; node runner.js
```

---
## 📈 Що генерується у виході
- **`lab/lab-results.json`** — «сирі» результати (кожен репет, поля: `scenario`, `variant`, `rep`, `INP`, `LoAFsum`, `LoAFcount`).
- **`lab/lab-aggregate.csv`** — агрегований підсумок по кожному `scenario × variant`: `p50_INP_ms`, `p75_INP_ms`, `count`.

Для швидкого ручного аналізу на сторінці:
- Відкрий DevTools → Console: переглядай рядки `[RUM] INP/LCP/CLS …`.
- У консолі доступні масиви `window.__perf.LoAF` / `window.__perf.LT` / `window.__perf.ET`.

---
## ⚙️ Налаштування навантаження / середовища
**Runner (lab/runner.js):**
- **REPS**: кількість повторів на варіант (env `LAB_REPS`, дефолт 15).
- **CPU throttling**: у коді `Emulation.setCPUThrottlingRate({ rate: 4 })`. Для чіткіших ефектів можна підняти до 6–8.
- **Мережа**: `Network.emulateNetworkConditions` (150ms, ~1.5/0.75Mbps) — за потреби змініть.

**Сценарії сторінок:**
- `content.html`: константа **HEAVY_COUNT** — скільки DOM‑вузлів додаємо на взаємодію (видно вплив I4). 
- `form.html`: **VALIDATION_WEIGHT**, **SERIALIZE_WEIGHT** — «вага» валідації/серіалізації (вплив на INP у B0; I2/I3 розносять роботу). 
- `dashboard.html`: розмір датасета (за умовчанням ~3000), **PAGE_SIZE** (200), кнопки `sort/filter/paginate`.

**Увімкнення інтервенцій:**
- Панель на кожній сторінці (чекбокси I1–I5 + кнопка **Apply**).
- Або query‑рядок: `?i1=1&i2=1&i3=1&i4=1` (для `dashboard.html` ще `&i5=1`).

**Опційний збір RUM:**
- У `shared/rum.js` є закоментований `navigator.sendBeacon('/rum', …)`. Додайте обробник у вашому сервері, якщо хочете збирати польові дані.

---
## 🔍 Типові проблеми та рішення
- **`ERR_CONNECTION_REFUSED`** у runner — локальний сервер не запущено або інший порт. Перевір у браузері `http://localhost:8000/content.html` та значення `LAB_BASE`.
- **`404 Not Found`** — сервер віддає не ту теку. Сервер має обслуговувати **корінь із HTML** (`…/test-lab`), а не `lab/`.
- **ESM попередження** — переконайся, що в `lab/package.json` є `"type": "module"`.
- **Зміни не підтягуються** — у `http-server` запускай із `-c-1` (вимикає кеш) або перезапусти сервер.
- **INP ~ 24мс у всіх варіантах** — підвищ набір навантаження (див. константи вище) і/або збільш CPU throttling, підвищ `REPS`.

---
## 📚 Корисні посилання
- [Web Vitals (INP/LCP/CLS)](https://web.dev/articles/vitals)
- [Long Animation Frames (LoAF)](https://github.com/WICG/long-animation-frames)
- [Event Timing](https://wicg.github.io/event-timing/)

---
## 📝 Ліцензія
Цей демо‑набір надано «як є» для дослідницьких цілей; використовуйте та модифікуйте на свій розсуд.