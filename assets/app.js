/* NYC Job Calendar — renders data/jobs.json as a month grid plus a list view.
   No dependencies, no build step. State that belongs to this browser only
   (saved/applied jobs, filter prefs) lives in localStorage. */

'use strict';

const CATEGORY_LABELS = {
  finance: 'Finance & Deals',
  sales_bd: 'Sales & BD',
  ops_strategy: 'Strategy & Ops',
};

const MOVE_DATE = new Date('2027-01-05T00:00:00Z');
const DAY_MS = 86_400_000;

const state = {
  data: { jobs: [], sources: [], counts: {} },
  month: startOfMonth(new Date()),
  calMode: 'rolling',   // 'rolling' = trailing 6 weeks, 'month' = calendar month
  view: 'cal',
  q: '',
  cats: new Set(Object.keys(CATEGORY_LABELS)),
  minSalary: 100_000,
  strongOnly: false,
  j1Only: false,
  hideNoSpon: false,
  savedOnly: false,
  openOnly: true,
  expandedDays: new Set(),
};

// ---------------------------------------------------------------- storage

const store = {
  read(key, fallback) {
    try {
      const v = localStorage.getItem(key);
      return v == null ? fallback : JSON.parse(v);
    } catch { return fallback; }
  },
  write(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* private mode */ }
  },
};

let saved = new Set(store.read('njc.saved', []));
let applied = new Set(store.read('njc.applied', []));

const persistSaved = () => store.write('njc.saved', [...saved]);
const persistApplied = () => store.write('njc.applied', [...applied]);

// ---------------------------------------------------------------- helpers

const $ = sel => document.querySelector(sel);
const el = (tag, cls, text) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
};

function startOfMonth(d) { return new Date(d.getFullYear(), d.getMonth(), 1); }
function dayKey(d) {
  const x = new Date(d);
  return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`;
}
function sameDay(a, b) { return dayKey(a) === dayKey(b); }

function daysAgo(iso) {
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return null;
  return Math.floor((Date.now() - t) / DAY_MS);
}

function ageBand(iso) {
  const d = daysAgo(iso);
  if (d == null) return 'stale';
  if (d <= 3) return 'fresh';
  if (d <= 10) return 'recent';
  if (d <= 21) return 'aging';
  return 'stale';
}

function relativeDay(iso) {
  const d = daysAgo(iso);
  if (d == null) return 'unknown';
  if (d <= 0) return 'today';
  if (d === 1) return 'yesterday';
  if (d < 30) return `${d}d ago`;
  if (d < 60) return '1mo ago';
  return `${Math.floor(d / 30)}mo ago`;
}

const money = n => n >= 1000 ? `$${Math.round(n / 1000)}k` : `$${n}`;

// ---------------------------------------------------------------- filtering

function visibleJobs() {
  const q = state.q.trim().toLowerCase();
  return state.data.jobs.filter(j => {
    if (state.openOnly && j.active === false) return false;
    if (!state.cats.has(j.category)) return false;
    if ((j.salaryMax ?? 0) < state.minSalary) return false;
    if (state.strongOnly && !j.strongMatch) return false;
    if (state.j1Only && !j.j1Friendly) return false;
    if (state.hideNoSpon && j.noSponsorship) return false;
    if (state.savedOnly && !saved.has(j.id)) return false;
    if (q) {
      const hay = `${j.title} ${j.company} ${j.location}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });
}

function groupByDay(jobs) {
  const map = new Map();
  for (const j of jobs) {
    const k = dayKey(new Date(j.postedAt));
    if (!map.has(k)) map.set(k, []);
    map.get(k).push(j);
  }
  for (const list of map.values()) {
    list.sort((a, b) => Number(b.strongMatch) - Number(a.strongMatch)
      || (b.salaryMax || 0) - (a.salaryMax || 0));
  }
  return map;
}

// ---------------------------------------------------------------- render: chrome

function renderCountdown() {
  const days = Math.max(0, Math.ceil((MOVE_DATE - Date.now()) / DAY_MS));
  $('#countdown').textContent = `${days} days`;

  const gen = state.data.generatedAt;
  $('#updated').textContent = gen
    ? `updated ${relativeDay(gen)}`
    : 'awaiting first scrape';
}

function renderStats() {
  const jobs = visibleJobs();
  const freshCount = jobs.filter(j => (daysAgo(j.postedAt) ?? 99) <= 7).length;
  const sals = jobs.map(j => j.salaryMax).filter(Boolean).sort((a, b) => a - b);
  const median = sals.length ? sals[Math.floor(sals.length / 2)] : 0;
  const strong = jobs.filter(j => j.strongMatch).length;

  const cards = [
    { k: 'Matching roles', v: jobs.length },
    { k: 'Posted this week', v: freshCount, accent: true },
    { k: 'Median top of range', v: median ? money(median) : '—' },
    { k: 'Strong matches', v: strong },
    { k: 'Saved', v: [...saved].filter(id => state.data.jobs.some(j => j.id === id)).length },
  ];

  const box = $('#stats');
  box.replaceChildren();
  for (const c of cards) {
    const n = el('div', 'stat' + (c.accent ? ' accent' : ''));
    n.append(el('div', 'v', String(c.v)), el('div', 'k', c.k));
    box.append(n);
  }
}

function renderCategoryChips() {
  const counts = {};
  for (const j of state.data.jobs) {
    if (state.openOnly && j.active === false) continue;
    counts[j.category] = (counts[j.category] || 0) + 1;
  }
  const box = $('#cats');
  box.replaceChildren();
  for (const [id, label] of Object.entries(CATEGORY_LABELS)) {
    const b = el('button', 'chip');
    b.dataset.cat = id;
    b.setAttribute('aria-pressed', state.cats.has(id));
    b.append(document.createTextNode(label));
    b.append(el('span', 'n', String(counts[id] || 0)));
    b.addEventListener('click', () => {
      if (state.cats.has(id) && state.cats.size > 1) state.cats.delete(id);
      else state.cats.add(id);
      render();
    });
    box.append(b);
  }
}

function renderSources() {
  const src = state.data.sources || [];
  if (!src.length) { $('#sources-panel').hidden = true; return; }
  $('#sources-panel').hidden = false;

  const ok = src.filter(s => s.ok).length;
  $('#srcsummary').textContent = `— ${ok}/${src.length} boards responding`;

  const grid = $('#srcgrid');
  grid.replaceChildren();
  for (const s of src) {
    const row = el('div', 'srcrow' + (s.ok ? '' : ' bad'));
    row.append(el('span', 'nm', s.company));
    row.append(el('span', 'ct', s.ok ? `${s.kept} kept / ${s.seen}` : (s.error || 'failed')));
    grid.append(row);
  }
}

// ---------------------------------------------------------------- render: calendar

// Returns the first cell date and cell count for the active calendar mode.
// Rolling mode ends on the Sunday of the current week, so the grid is all
// past days — a job calendar never has anything useful in the future.
function gridRange() {
  const today = new Date();
  if (state.calMode === 'rolling') {
    const WEEKS = 6;
    const endOfWeek = new Date(today.getFullYear(), today.getMonth(),
      today.getDate() + (7 - ((today.getDay() + 6) % 7) - 1));
    const start = new Date(endOfWeek.getFullYear(), endOfWeek.getMonth(),
      endOfWeek.getDate() - (WEEKS * 7 - 1));
    return { start, cells: WEEKS * 7, monthOf: null };
  }
  const first = state.month;
  const offset = (first.getDay() + 6) % 7;
  return {
    start: new Date(first.getFullYear(), first.getMonth(), 1 - offset),
    cells: 42,
    monthOf: first.getMonth(),
  };
}

function renderCalendar() {
  const jobs = visibleJobs();
  const byDay = groupByDay(jobs);
  const { start: gridStart, cells, monthOf } = gridRange();

  if (state.calMode === 'rolling') {
    const last = new Date(gridStart.getFullYear(), gridStart.getMonth(), gridStart.getDate() + cells - 1);
    const f = d => d.toLocaleString('en-US', { month: 'short', day: 'numeric' });
    $('#monthlabel').textContent = `${f(gridStart)} – ${f(last)}`;
  } else {
    $('#monthlabel').textContent =
      state.month.toLocaleString('en-US', { month: 'long', year: 'numeric' });
  }

  const grid = $('#grid');
  grid.replaceChildren();
  const today = new Date();

  for (let i = 0; i < cells; i++) {
    const date = new Date(gridStart.getFullYear(), gridStart.getMonth(), gridStart.getDate() + i);
    const key = dayKey(date);
    const dayJobs = byDay.get(key) || [];
    const outside = monthOf !== null && date.getMonth() !== monthOf;

    const cell = el('div', 'day'
      + (outside ? ' outside' : '')
      + (dayJobs.length ? ' has' : '')
      + (sameDay(date, today) ? ' today' : ''));

    cell.append(el('div', 'dnum', String(date.getDate())));

    const expanded = state.expandedDays.has(key);
    const limit = expanded ? dayJobs.length : 3;

    for (const job of dayJobs.slice(0, limit)) {
      cell.append(jobChip(job));
    }
    if (dayJobs.length > limit) {
      const more = el('button', 'more', `+${dayJobs.length - limit} more`);
      more.addEventListener('click', () => { state.expandedDays.add(key); render(); });
      cell.append(more);
    } else if (expanded && dayJobs.length > 3) {
      const less = el('button', 'more', 'show less');
      less.addEventListener('click', () => { state.expandedDays.delete(key); render(); });
      cell.append(less);
    }
    grid.append(cell);
  }

  // Month mode can end on a fully out-of-month week; drop it.
  if (state.calMode === 'month') {
    const nodes = [...grid.children];
    for (let w = 5; w >= 4; w--) {
      const week = nodes.slice(w * 7, w * 7 + 7);
      if (week.every(c => c.classList.contains('outside'))) week.forEach(c => c.remove());
      else break;
    }
  }
}

function jobChip(job) {
  const b = el('button', 'jchip');
  b.dataset.cat = job.category;
  b.dataset.age = ageBand(job.postedAt);
  if (job.strongMatch) b.classList.add('star');
  if (job.active === false) b.classList.add('closed');
  b.title = `${job.title} — ${job.company} — ${job.salaryText || 'salary n/a'}`;
  b.append(document.createTextNode(job.title));
  b.append(el('span', 'co', ` · ${job.company}`));
  b.addEventListener('click', () => openDrawer(job));
  return b;
}

// ---------------------------------------------------------------- render: list

function renderList() {
  const jobs = visibleJobs().slice().sort(
    (a, b) => new Date(b.postedAt) - new Date(a.postedAt));

  const box = $('#list');
  box.replaceChildren();

  if (!jobs.length) { box.append(emptyState()); return; }

  for (const job of jobs) {
    const card = el('div', 'card');
    card.dataset.cat = job.category;
    card.append(el('div', 'bar'));

    const main = el('div', 'main');
    main.append(el('div', 't', job.title));

    const meta = el('div', 'm');
    meta.append(el('span', null, job.company));
    meta.append(el('span', null, job.location));
    meta.append(el('span', null, CATEGORY_LABELS[job.category]));
    if (job.strongMatch) meta.append(el('span', 'tag match', 'strong match'));
    if ((daysAgo(job.postedAt) ?? 99) <= 3) meta.append(el('span', 'tag hot', 'new'));
    if (job.j1Friendly) meta.append(el('span', 'tag match', 'J-1 friendly'));
    if (job.noSponsorship) meta.append(el('span', 'tag nospon', 'says no sponsorship'));
    if (job.active === false) meta.append(el('span', 'tag closed', 'delisted'));
    if (applied.has(job.id)) meta.append(el('span', 'tag', 'applied'));
    main.append(meta);
    card.append(main);

    const right = el('div', 'right');
    right.append(el('div', 'sal', job.salaryText || '—'));
    right.append(el('div', 'when', relativeDay(job.postedAt)));
    const star = el('button', 'starbtn', saved.has(job.id) ? '★' : '☆');
    star.setAttribute('aria-pressed', saved.has(job.id));
    star.title = 'Save this role';
    star.addEventListener('click', e => { e.stopPropagation(); toggleSaved(job.id); });
    right.append(star);
    card.append(right);

    card.addEventListener('click', () => openDrawer(job));
    box.append(card);
  }
}

function emptyState() {
  const box = el('div', 'empty');
  const hasData = (state.data.jobs || []).length > 0;
  if (hasData) {
    box.append(el('h3', null, 'No roles match these filters'));
    box.append(el('p', null, 'Try lowering the salary floor, clearing the search box, or re-enabling a category.'));
  } else {
    box.append(el('h3', null, 'No jobs yet'));
    const p = el('p');
    p.append(document.createTextNode('The scraper has not run yet. Trigger the '));
    p.append(el('code', null, 'Update NYC jobs'));
    p.append(document.createTextNode(' workflow in the repository’s Actions tab, or wait for the next 6-hourly run.'));
    box.append(p);
  }
  return box;
}

// ---------------------------------------------------------------- drawer

let drawerNodes = null;

function closeDrawer() {
  if (!drawerNodes) return;
  drawerNodes.forEach(n => n.remove());
  drawerNodes = null;
  document.removeEventListener('keydown', onDrawerKey);
}

function onDrawerKey(e) { if (e.key === 'Escape') closeDrawer(); }

function openDrawer(job) {
  closeDrawer();

  const scrim = el('div', 'scrim');
  scrim.addEventListener('click', closeDrawer);

  const drawer = el('aside', 'drawer');
  drawer.setAttribute('role', 'dialog');
  drawer.setAttribute('aria-label', job.title);

  const head = el('header');
  const htext = el('div');
  htext.append(el('h3', null, job.title));
  htext.append(el('div', 'co', `${job.company} · ${job.location}`));
  head.append(htext);
  const close = el('button', 'iconbtn', '×');
  close.setAttribute('aria-label', 'Close');
  close.addEventListener('click', closeDrawer);
  head.append(close);
  drawer.append(head);

  const body = el('div', 'body');
  const dl = el('dl', 'kv');
  const pair = (k, v) => { dl.append(el('dt', null, k), el('dd', null, v)); };
  pair('Salary', job.salaryText ? job.salaryText + (job.hourly ? ' (from hourly rate)' : '') : 'not stated');
  pair('Posted', `${new Date(job.postedAt).toLocaleDateString('en-US', { dateStyle: 'medium' })} · ${relativeDay(job.postedAt)}`);
  pair('Category', CATEGORY_LABELS[job.category]);
  pair('Source', job.source);
  pair('Status', job.active === false ? 'Delisted from the board' : 'Open');
  body.append(dl);

  const notes = el('div');
  if (job.strongMatch) {
    notes.append(note('match', 'Strong match — the title lines up with your restructuring, M&A and financial-analysis experience.'));
  }
  if (job.j1Friendly) {
    notes.append(note('match', 'J-1 friendly signals — the posting mentions a programme, fixed term or explicit sponsorship.'));
  }
  if (job.noSponsorship) {
    notes.append(note('nospon', 'This posting says it will not sponsor a visa. That usually means no H-1B. On a J-1 trainee visa your sponsor is a designated third-party organisation and the employer only signs the DS-7002 training plan — so it is worth asking, but expect to explain the difference.'));
  }
  body.append(notes);
  drawer.append(body);

  const foot = el('div', 'foot');
  const apply = el('a', 'btn', 'Open posting →');
  apply.href = job.url;
  apply.target = '_blank';
  apply.rel = 'noopener noreferrer';
  foot.append(apply);

  const saveBtn = el('button', 'btn ghost', saved.has(job.id) ? '★ Saved' : '☆ Save');
  saveBtn.setAttribute('aria-pressed', saved.has(job.id));
  saveBtn.addEventListener('click', () => {
    toggleSaved(job.id);
    saveBtn.textContent = saved.has(job.id) ? '★ Saved' : '☆ Save';
    saveBtn.setAttribute('aria-pressed', saved.has(job.id));
  });
  foot.append(saveBtn);

  const appliedBtn = el('button', 'btn ghost', applied.has(job.id) ? '✓ Applied' : 'Mark applied');
  appliedBtn.setAttribute('aria-pressed', applied.has(job.id));
  appliedBtn.addEventListener('click', () => {
    applied.has(job.id) ? applied.delete(job.id) : applied.add(job.id);
    persistApplied();
    appliedBtn.textContent = applied.has(job.id) ? '✓ Applied' : 'Mark applied';
    appliedBtn.setAttribute('aria-pressed', applied.has(job.id));
    if (state.view === 'list') renderList();
  });
  foot.append(appliedBtn);
  drawer.append(foot);

  document.body.append(scrim, drawer);
  drawerNodes = [scrim, drawer];
  document.addEventListener('keydown', onDrawerKey);
  close.focus();
}

function note(kind, text) {
  const n = el('div');
  n.style.cssText = 'font-size:12.5px;line-height:1.6;padding:10px 12px;border-radius:6px;margin-top:10px';
  n.style.background = kind === 'nospon' ? 'rgba(217,138,152,.09)' : 'rgba(255,200,87,.08)';
  n.style.border = `1px solid ${kind === 'nospon' ? '#7a4a55' : '#5c4a1f'}`;
  n.style.color = kind === 'nospon' ? '#e3b0ba' : '#e8d3a0';
  n.textContent = text;
  return n;
}

function toggleSaved(id) {
  saved.has(id) ? saved.delete(id) : saved.add(id);
  persistSaved();
  render();
}

// ---------------------------------------------------------------- render root

function render() {
  renderCountdown();
  renderCategoryChips();
  renderStats();
  if (state.view === 'cal') renderCalendar(); else renderList();
  renderSources();
}

// ---------------------------------------------------------------- wiring

function setCalMode(mode) {
  state.calMode = mode;
  state.expandedDays.clear();
  $('#mode-rolling').setAttribute('aria-pressed', mode === 'rolling');
  $('#mode-month').setAttribute('aria-pressed', mode === 'month');
  // Month navigation is meaningless in the rolling window.
  for (const sel of ['#prev', '#next', '#today']) $(sel).hidden = mode === 'rolling';
  store.write('njc.calMode', mode);
  render();
}

function setView(view) {
  state.view = view;
  $('#tab-cal').setAttribute('aria-pressed', view === 'cal');
  $('#tab-list').setAttribute('aria-pressed', view === 'list');
  $('#view-cal').hidden = view !== 'cal';
  $('#view-list').hidden = view !== 'list';
  $('.calbar').style.display = view === 'cal' ? '' : 'none';
  store.write('njc.view', view);
  render();
}

function bind() {
  $('#q').addEventListener('input', e => { state.q = e.target.value; render(); });

  $('#sal').addEventListener('input', e => {
    state.minSalary = +e.target.value;
    $('#salout').textContent = money(state.minSalary);
    store.write('njc.minSalary', state.minSalary);
    render();
  });

  const toggles = [
    ['#f-strong', 'strongOnly'],
    ['#f-j1', 'j1Only'],
    ['#f-spon', 'hideNoSpon'],
    ['#f-saved', 'savedOnly'],
    ['#f-open', 'openOnly'],
  ];
  for (const [sel, key] of toggles) {
    $(sel).addEventListener('change', e => {
      state[key] = e.target.checked;
      store.write(`njc.${key}`, state[key]);
      render();
    });
  }

  $('#mode-rolling').addEventListener('click', () => setCalMode('rolling'));
  $('#mode-month').addEventListener('click', () => setCalMode('month'));

  $('#tab-cal').addEventListener('click', () => setView('cal'));
  $('#tab-list').addEventListener('click', () => setView('list'));

  $('#prev').addEventListener('click', () => {
    state.month = new Date(state.month.getFullYear(), state.month.getMonth() - 1, 1);
    render();
  });
  $('#next').addEventListener('click', () => {
    state.month = new Date(state.month.getFullYear(), state.month.getMonth() + 1, 1);
    render();
  });
  $('#today').addEventListener('click', () => {
    state.month = startOfMonth(new Date());
    render();
  });

  document.addEventListener('keydown', e => {
    if (e.target.matches('input, textarea')) return;
    if (e.key === 'ArrowLeft') $('#prev').click();
    if (e.key === 'ArrowRight') $('#next').click();
  });
}

function restorePrefs() {
  state.minSalary = store.read('njc.minSalary', 100_000);
  $('#sal').value = state.minSalary;
  $('#salout').textContent = money(state.minSalary);

  for (const [sel, key] of [['#f-strong', 'strongOnly'], ['#f-j1', 'j1Only'],
    ['#f-spon', 'hideNoSpon'], ['#f-saved', 'savedOnly'], ['#f-open', 'openOnly']]) {
    state[key] = store.read(`njc.${key}`, key === 'openOnly');
    $(sel).checked = state[key];
  }
  state.view = store.read('njc.view', 'cal');
  state.calMode = store.read('njc.calMode', 'rolling');
}

async function boot() {
  restorePrefs();
  bind();

  try {
    const res = await fetch(`data/jobs.json?t=${Date.now()}`, { cache: 'no-store' });
    if (res.ok) state.data = await res.json();
  } catch { /* fall through to the empty state */ }

  setCalMode(state.calMode);
  setView(state.view);
}

boot();
