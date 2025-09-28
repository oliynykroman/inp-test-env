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
