/* NYC Job Calendar — renders data/jobs.json as a month grid plus a list view.
   No dependencies, no build step. State that belongs to this browser only
   (saved/applied jobs, filter prefs) lives in localStorage. */

'use strict';

const CATEGORY_LABELS = {
  ib: 'Investment Banking',
  vc: 'VC & Investing',
  finance: 'Corporate Finance',
  ops_strategy: 'Strategy & Ops',
  sales_bd: 'Sales & BD',
};

// The two lanes the search is actually built around; the page opens on these.
const PRIORITY_CATS = ['ib', 'vc'];

const MOVE_DATE = new Date('2027-01-05T00:00:00Z');
const DAY_MS = 86_400_000;

const state = {
  data: { jobs: [], sources: [], counts: {} },
  recruiters: null,
  month: startOfMonth(new Date()),
  calMode: 'rolling',   // 'rolling' = trailing 6 weeks, 'month' = calendar month
  view: 'cal',
  q: '',
  cats: new Set(Object.keys(CATEGORY_LABELS)),
  dateBasis: 'applyBy',   // 'applyBy' = forward-looking deadlines, 'postedAt' = when it went live
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
// { [firm name]: ISO date it was last checked }
let checkedFirms = store.read('njc.checkedFirms', {});
// Recruiters the user adds themselves — kept in this browser only.
let myRecruiters = store.read('njc.recruiters', []);
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

// The scraper writes applyBy, but a page can be served alongside data written
// by an older scraper. Derive it rather than trusting the field to exist.
const APPLY_WINDOW_DAYS = 21;

function applyByOf(job) {
  if (job.applyBy) return new Date(job.applyBy);
  return new Date(new Date(job.postedAt).getTime() + APPLY_WINDOW_DAYS * DAY_MS);
}

// Which date a job sits on. applyBy looks forward; postedAt looks back.
function jobDate(job) {
  return state.dateBasis === 'postedAt' ? new Date(job.postedAt) : applyByOf(job);
}

// Days until the apply-by deadline. Negative means it has passed.
function daysUntilDeadline(job) {
  return Math.ceil((applyByOf(job) - Date.now()) / DAY_MS);
}

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
    if (state.openOnly) {
      // "Open" means still on the board AND the apply-by window has not lapsed.
      // A role you can no longer realistically apply to is not an open role.
      if (j.active === false) return false;
      if (daysUntilDeadline(j) < 0) return false;
    }
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
    const k = dayKey(jobDate(j));
    if (!map.has(k)) map.set(k, []);
    map.get(k).push(j);
  }
  for (const list of map.values()) {
    list.sort((a, b) => Number(b.priority) - Number(a.priority)
      || Number(b.strongMatch) - Number(a.strongMatch)
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
  const closingSoon = jobs.filter(j => { const d = daysUntilDeadline(j); return d >= 0 && d <= 7; }).length;
  const sals = jobs.map(j => j.salaryMax).filter(Boolean).sort((a, b) => a - b);
  const median = sals.length ? sals[Math.floor(sals.length / 2)] : 0;
  const strong = jobs.filter(j => j.strongMatch).length;

  const cards = [
    { k: 'Matching roles', v: jobs.length },
    { k: 'Closing in 7 days', v: closingSoon, accent: true },
    { k: 'Median top of range', v: median ? money(median) : '—' },
    { k: 'IB + VC roles', v: jobs.filter(j => j.priority).length },
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
    if (state.openOnly && (j.active === false || daysUntilDeadline(j) < 0)) continue;
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
      store.write('njc.cats', [...state.cats]);
      render();
    });
    box.append(b);
  }
}

const CATEGORY_GROUPS = {
  restructuring_advisory: 'Restructuring & turnaround advisory',
  restructuring_bank: 'Restructuring / RX banks',
  big_four_advisory: 'Big Four & mid-tier advisory',
  credit_fund: 'Credit & distressed funds',
  bank: 'Investment banks',
  private_equity: 'Private equity',
  ireland_financial: 'Irish financial',
  corporate_development: 'Corporate development',
};

// Firms with no public job feed. Listed so they get checked by hand rather than
// quietly disappearing from the search.
function renderManual() {
  const panel = $('#manual-panel');
  const firms = state.data.targets?.unreachable || [];
  if (!firms.length) { panel.hidden = true; return; }
  panel.hidden = false;

  const done = firms.filter(f => checkedFirms[f.name]).length;
  $('#manualsummary').textContent =
    `— ${firms.length} firms with no public feed, ${done} checked`;

  const grid = $('#manualgrid');
  grid.replaceChildren();

  for (const [cat, label] of Object.entries(CATEGORY_GROUPS)) {
    const inGroup = firms.filter(f => f.category === cat);
    if (!inGroup.length) continue;

    const g = el('div', 'mgroup');
    g.append(el('h4', null, `${label} (${inGroup.length})`));
    const list = el('div', 'mlist');

    for (const firm of inGroup) {
      const row = el('div', 'mrow' + (checkedFirms[firm.name] ? ' done' : ''));

      const cb = el('input');
      cb.type = 'checkbox';
      cb.checked = !!checkedFirms[firm.name];
      cb.title = 'Mark as checked today';
      cb.addEventListener('change', () => {
        if (cb.checked) checkedFirms[firm.name] = new Date().toISOString();
        else delete checkedFirms[firm.name];
        store.write('njc.checkedFirms', checkedFirms);
        renderManual();
      });
      row.append(cb);

      const name = el('div', 'mname');
      const a = el('a', null, firm.name);
      // A careers search rather than a guessed /careers path, which 404s often.
      a.href = 'https://www.google.com/search?q=' +
        encodeURIComponent(`${firm.name} careers New York restructuring analyst associate`);
      a.target = '_blank';
      a.rel = 'noopener noreferrer';
      name.append(a);
      if (firm.whyFit) name.append(el('span', 'mwhy', firm.whyFit));
      row.append(name);

      const when = checkedFirms[firm.name];
      if (when) {
        const days = Math.floor((Date.now() - new Date(when)) / DAY_MS);
        row.append(el('div', 'mdate', days === 0 ? 'today' : `${days}d ago`));
      }
      list.append(row);
    }
    g.append(list);
    grid.append(g);
  }
}

// ---------------------------------------------------------------- recruiters

// A LinkedIn people search scoped to a firm surfaces its actual recruiters,
// which is the honest way to get names: the firm's specialism is publicly
// stated, whereas asserting what a named individual places is not something
// this page can verify.
function linkedInPeopleSearch(firm) {
  return 'https://www.linkedin.com/search/results/people/?' + new URLSearchParams({
    keywords: `${firm} recruiter restructuring investment banking New York`,
  });
}

function renderRecruiters() {
  const data = state.recruiters;
  $('#recnote').textContent = data?.note || '';

  // The user's own contacts first — those are the ones that matter.
  const mine = $('#reccontacts');
  mine.replaceChildren();
  if (myRecruiters.length) {
    const g = el('div', 'recgroup');
    g.append(el('h4', null, `Your contacts (${myRecruiters.length})`));
    const grid = el('div', 'recgrid');
    myRecruiters.forEach((r, i) => grid.append(recruiterCard(r, i)));
    g.append(grid);
    mine.append(g);
  }

  const box = $('#recfirms');
  box.replaceChildren();
  const firms = data?.firms || [];
  if (!firms.length) return;
  const g = el('div', 'recgroup');
  g.append(el('h4', null, `Search firms (${firms.length}) — ${data.verify || ''}`));
  const grid = el('div', 'recgrid');
  for (const f of firms) grid.append(recruiterCard(f));
  g.append(grid);
  box.append(g);
}

function recruiterCard(r, myIndex) {
  const card = el('div', 'reccard' + (myIndex === undefined ? '' : ' mine'));
  card.append(el('div', 'rname', r.name));
  if (r.focus) card.append(el('div', 'rfocus', r.focus));

  const links = el('div', 'rlinks');
  if (r.url) {
    const a = el('a', null, r.url.includes('linkedin') ? 'LinkedIn' : 'Contact');
    a.href = r.url.startsWith('http') ? r.url : (r.url.includes('@') ? `mailto:${r.url}` : `https://${r.url}`);
    a.target = '_blank'; a.rel = 'noopener noreferrer';
    links.append(a);
  }
  if (myIndex === undefined) {
    const li = el('a', null, 'Find their recruiters');
    li.href = linkedInPeopleSearch(r.name);
    li.target = '_blank'; li.rel = 'noopener noreferrer';
    links.append(li);
    if (r.site) {
      const w = el('a', null, 'Website');
      w.href = `https://${r.site}`;
      w.target = '_blank'; w.rel = 'noopener noreferrer';
      links.append(w);
    }
  } else {
    const del = el('button', 'del', '×');
    del.title = 'Remove';
    del.addEventListener('click', () => {
      myRecruiters.splice(myIndex, 1);
      store.write('njc.recruiters', myRecruiters);
      renderRecruiters();
    });
    links.append(del);
  }
  card.append(links);
  return card;
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
    if (state.dateBasis === 'applyBy') {
      // Deadlines are ahead of us: start from the Monday of last week so a few
      // just-missed roles stay visible, then run five weeks forward.
      const monday = new Date(today.getFullYear(), today.getMonth(),
        today.getDate() - ((today.getDay() + 6) % 7) - 7);
      return { start: monday, cells: WEEKS * 7, monthOf: null };
    }
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

// Two short lists to open the page on: what closes soonest, and what has only
// just gone live.
//
// On "under 20 applicants": no public ATS feed exposes an applicant count.
// Greenhouse, Lever, Ashby, SmartRecruiters and Workday all omit it; the number
// people recognise is LinkedIn's, and LinkedIn blocks automated access. Days
// since posting is the honest proxy — a role listed 24 hours ago has a fraction
// of the applicants it will have in a fortnight.
const FRESH_DAYS = 3;

function renderActNow() {
  const box = $('#actnow');
  box.replaceChildren();

  const open = visibleJobs().filter(j => j.active !== false && daysUntilDeadline(j) >= 0);
  if (!open.length) { box.hidden = true; return; }
  box.hidden = false;

  const closing = open.filter(j => daysUntilDeadline(j) <= 7)
    .sort((a, b) => daysUntilDeadline(a) - daysUntilDeadline(b));
  const fresh = open.filter(j => (daysAgo(j.postedAt) ?? 99) <= FRESH_DAYS)
    .sort((a, b) => new Date(b.postedAt) - new Date(a.postedAt));

  const wrap = el('div', 'actgrid');
  wrap.append(actColumn('Closing this week', closing,
    'Apply-by date within 7 days.', 'urgent'));
  wrap.append(actColumn(`Just posted — fewest applicants`, fresh,
    `Live for ${FRESH_DAYS} days or less. No job board publishes an applicant count, so recency is the closest honest signal.`, 'fresh'));
  box.append(wrap);
}

function actColumn(title, jobs, note, kind) {
  const col = el('div', 'actcol ' + kind);
  const head = el('div', 'acthead');
  head.append(el('h3', null, title));
  head.append(el('span', 'actcount', String(jobs.length)));
  col.append(head);
  col.append(el('p', 'actnote', note));

  if (!jobs.length) {
    col.append(el('div', 'actempty', 'Nothing right now — check back in a day or two.'));
    return col;
  }

  for (const job of jobs.slice(0, 6)) {
    const row = el('button', 'actrow');
    row.dataset.cat = job.category;
    const main = el('div', 'actmain');
    main.append(el('div', 'acttitle', job.title));
    main.append(el('div', 'actmeta', `${job.company} · ${job.salaryText || 'salary n/a'}`));
    row.append(main);
    const d = daysUntilDeadline(job);
    row.append(el('div', 'actwhen', kind === 'urgent'
      ? (d === 0 ? 'today' : `${d}d`)
      : relativeDay(job.postedAt)));
    row.addEventListener('click', () => openDrawer(job));
    col.append(row);
  }
  if (jobs.length > 6) col.append(el('div', 'actempty', `+${jobs.length - 6} more in the list below`));
  return col;
}

function renderCalendar() {
  const jobs = visibleJobs();
  const byDay = groupByDay(jobs);

  // An empty month grid gives the reader nothing to act on; say why.
  const notice = $('#cal-empty');
  if (notice) notice.remove();
  if (!jobs.length) {
    const box = emptyState();
    box.id = 'cal-empty';
    box.style.marginBottom = '14px';
    $('#view-cal').prepend(box);
  }
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
  // Urgency is signalled with colour and weight, not opacity. Fading a chip
  // reads as "disabled", which is the opposite of what a near deadline means.
  const dl = daysUntilDeadline(job);
  if (state.dateBasis === 'applyBy') {
    b.dataset.urgency = dl < 0 ? 'gone'
      : dl <= 2 ? 'critical'
      : dl <= 7 ? 'soon'
      : dl <= 14 ? 'ok'
      : 'later';
  } else {
    b.dataset.age = ageBand(job.postedAt);
  }
  if (job.strongMatch || job.priority) b.classList.add('star');
  if (job.active === false) b.classList.add('closed');
  b.title = `${job.title} — ${job.company} — ${job.salaryText || 'salary n/a'}`
    + (dl >= 0 ? ` — apply within ${dl} day${dl === 1 ? '' : 's'}` : ' — deadline passed');
  // A countdown on the chip itself, so urgency survives at a glance.
  if (state.dateBasis === 'applyBy' && dl >= 0 && dl <= 7) {
    b.append(el('span', 'jdays', dl === 0 ? 'TODAY' : `${dl}d`));
  }
  if (job.deadlineSource === 'stated') b.classList.add('stated');
  b.append(document.createTextNode(job.title));
  b.append(el('span', 'co', ` · ${job.company}`));
  b.addEventListener('click', () => openDrawer(job));
  return b;
}

// ---------------------------------------------------------------- render: list

function renderList() {
  const jobs = visibleJobs().slice().sort((a, b) => {
    if (state.dateBasis !== 'applyBy') {
      return new Date(b.postedAt) - new Date(a.postedAt);
    }
    // Anything still open outranks a lapsed deadline — a passed date is never
    // the most useful thing to show first, priority lane or not. Then the
    // priority lanes, then soonest deadline.
    const aPassed = daysUntilDeadline(a) < 0;
    const bPassed = daysUntilDeadline(b) < 0;
    return Number(aPassed) - Number(bPassed)
      || Number(b.priority) - Number(a.priority)
      || jobDate(a) - jobDate(b);
  });

  const box = $('#list');
  box.replaceChildren();

  if (!jobs.length) { box.append(emptyState()); return; }

  for (const job of jobs) {
    const card = el('div', 'card');
    card.dataset.cat = job.category;
    const dl = daysUntilDeadline(job);
    if (state.dateBasis === 'applyBy') {
      card.dataset.urgency = job.active === false || dl < 0 ? 'gone'
        : dl <= 2 ? 'critical' : dl <= 7 ? 'soon' : 'ok';
    }
    card.append(el('div', 'bar'));

    const main = el('div', 'main');
    main.append(el('div', 't', job.title));

    const meta = el('div', 'm');
    meta.append(el('span', null, job.company));
    meta.append(el('span', null, job.location));
    meta.append(el('span', null, CATEGORY_LABELS[job.category]));
    if (job.salaryEstimated) meta.append(el('span', 'tag est', 'salary estimated'));
    if (job.deadlineSource === 'stated') meta.append(el('span', 'tag stated', 'real closing date'));
    if (job.priority) meta.append(el('span', 'tag match', CATEGORY_LABELS[job.category]));
    if (job.strongMatch) meta.append(el('span', 'tag match', 'strong match'));
    if (dl >= 0 && dl <= 5) meta.append(el('span', 'tag hot', dl === 0 ? 'closes today' : `${dl}d left`));
    else if ((daysAgo(job.postedAt) ?? 99) <= 3) meta.append(el('span', 'tag hot', 'new'));
    if (job.j1Friendly) meta.append(el('span', 'tag match', 'J-1 friendly'));
    if (job.noSponsorship) meta.append(el('span', 'tag nospon', 'says no sponsorship'));
    if (job.active === false) meta.append(el('span', 'tag closed', 'delisted'));
    if (applied.has(job.id)) meta.append(el('span', 'tag', 'applied'));
    main.append(meta);
    card.append(main);

    const right = el('div', 'right');
    const sal = el('div', 'sal' + (job.salaryEstimated ? ' est' : ''), job.salaryText || '—');
    if (job.salaryEstimated) {
      sal.title = `The posting states no range. Estimated from ${job.salaryEstimate.samples} `
        + `comparable ${CATEGORY_LABELS[job.category]} postings at this grade.`;
    }
    right.append(sal);
    right.append(el('div', 'when', state.dateBasis === 'applyBy'
      ? (dl < 0 ? 'deadline passed' : dl === 0 ? 'apply today' : `${dl}d left`)
      : relativeDay(job.postedAt)));
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

function resetFilters() {
  state.cats = new Set(Object.keys(CATEGORY_LABELS));
  state.q = '';
  state.minSalary = 100_000;
  state.strongOnly = state.j1Only = state.hideNoSpon = state.savedOnly = false;
  state.openOnly = true;
  $('#q').value = '';
  $('#sal').value = 100_000;
  $('#salout').textContent = money(100_000);
  for (const [sel, key] of [['#f-strong', 'strongOnly'], ['#f-j1', 'j1Only'],
    ['#f-spon', 'hideNoSpon'], ['#f-saved', 'savedOnly'], ['#f-open', 'openOnly']]) {
    $(sel).checked = state[key];
    store.write(`njc.${key}`, state[key]);
  }
  store.write('njc.cats', [...state.cats]);
  store.write('njc.minSalary', state.minSalary);
  render();
}

// Explains an empty result rather than leaving a blank grid, and says which
// filter is responsible — an earlier build showed nothing at all when the
// selected lanes happened to match no jobs.
function emptyState() {
  const box = el('div', 'empty');
  const total = (state.data.jobs || []).length;

  if (!total) {
    box.append(el('h3', null, 'No jobs yet'));
    const p = el('p');
    p.append(document.createTextNode('The scraper has not run yet. Trigger the '));
    p.append(el('code', null, 'Update NYC jobs'));
    p.append(document.createTextNode(' workflow in the repository’s Actions tab, or wait for the next 6-hourly run.'));
    box.append(p);
    return box;
  }

  // Work out which filter is doing the damage.
  const lanes = new Set(state.data.jobs.map(j => j.category));
  const laneMiss = ![...state.cats].some(c => lanes.has(c));
  const reasons = [];
  if (laneMiss) {
    reasons.push(`none of the selected lanes (${[...state.cats].map(c => CATEGORY_LABELS[c] || c).join(', ')}) exist in the current data`);
  }
  if (state.q) reasons.push(`the search “${state.q}” matches nothing`);
  if (state.minSalary > 100_000) reasons.push(`the salary floor is set to ${money(state.minSalary)}`);
  if (state.strongOnly) reasons.push('“strong match only” is on');
  if (state.j1Only) reasons.push('“J-1 friendly” is on');
  if (state.savedOnly) reasons.push('“saved only” is on');

  box.append(el('h3', null, `No roles match — ${total} in the data`));
  box.append(el('p', null, reasons.length
    ? `Nothing gets through because ${reasons.join('; and ')}.`
    : 'Every current role is outside the dates shown. Try the "Date posted" view or a wider range.'));

  const btn = el('button', 'btn', 'Reset all filters');
  btn.style.cssText = 'margin-top:14px;max-width:200px';
  btn.addEventListener('click', resetFilters);
  box.append(btn);
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
  pair(job.salaryEstimated ? 'Salary (est.)' : 'Salary',
    job.salaryText ? job.salaryText + (job.hourly ? ' (from hourly rate)' : '') : 'not stated');
  pair('Posted', `${new Date(job.postedAt).toLocaleDateString('en-US', { dateStyle: 'medium' })} · ${relativeDay(job.postedAt)}`);
  const dld = daysUntilDeadline(job);
  const statedDl = job.deadlineSource === 'stated';
  pair(statedDl ? 'Closing date' : 'Apply by (est.)',
    `${applyByOf(job).toLocaleDateString('en-US', { dateStyle: 'medium' })} · ` +
    (dld < 0 ? 'passed' : dld === 0 ? 'today' : `${dld} days left`));
  if (!statedDl) {
    body.append(note('est', 'This posting states no closing date — almost none do. ' +
      'The date above is an estimate: three weeks after it went live, which is roughly ' +
      'how long a listing in this market stays open. Treat it as a nudge, not a deadline.'));
  }
  pair('Category', CATEGORY_LABELS[job.category]);
  pair('Source', job.source);
  pair('Status', job.active === false ? 'Delisted from the board' : 'Open');
  body.append(dl);

  const notes = el('div');
  if (job.salaryEstimated) {
    const e = job.salaryEstimate;
    notes.append(note('est', `This posting states no salary. Kept because ${e.samples} comparable `
      + `${CATEGORY_LABELS[job.category]} postings at this grade advertised a median of `
      + `${money(e.median)} (range ${money(e.low)}–${money(e.high)}), which clears the $100k floor. `
      + `It is a comparison against real observed pay, not a quote — confirm with the employer.`));
  }
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

  // LinkedIn shows an applicant count (and the "first 25 applicants" badge) to
  // a signed-in reader, but exposes it through no API and blocks scraping — so
  // this hands the check to the reader rather than guessing a number.
  const li = el('a', 'btn ghost linkedin', 'Applicants on LinkedIn ↗');
  li.href = 'https://www.linkedin.com/jobs/search/?' + new URLSearchParams({
    keywords: `${job.title} ${job.company}`,
    location: 'New York, New York, United States',
    f_TPR: 'r2592000',   // posted in the last 30 days
  });
  li.target = '_blank';
  li.rel = 'noopener noreferrer';
  li.title = 'Opens a LinkedIn search for this role. The applicant count is on the posting itself.';
  body.append(li);

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
  const palette = {
    nospon: ['rgba(217,138,152,.09)', '#7a4a55', '#e3b0ba'],
    est:    ['rgba(120,140,170,.10)', '#33405a', '#9fb0c9'],
    match:  ['rgba(255,200,87,.08)',  '#5c4a1f', '#e8d3a0'],
  };
  const [bg, border, color] = palette[kind] || palette.match;
  n.style.background = bg;
  n.style.border = `1px solid ${border}`;
  n.style.color = color;
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
  renderActNow();
  if (state.view === 'rec') renderRecruiters();
  else if (state.view === 'cal') renderCalendar();
  else renderList();
  renderManual();
  renderSources();
}

// ---------------------------------------------------------------- wiring

function setDateBasis(basis) {
  state.dateBasis = basis;
  state.expandedDays.clear();
  $('#basis-apply').setAttribute('aria-pressed', basis === 'applyBy');
  $('#basis-posted').setAttribute('aria-pressed', basis === 'postedAt');
  store.write('njc.dateBasis', basis);
  render();
}

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
  for (const [id, v] of [['#tab-cal', 'cal'], ['#tab-list', 'list'], ['#tab-rec', 'rec']]) {
    $(id).setAttribute('aria-pressed', view === v);
  }
  $('#view-cal').hidden = view !== 'cal';
  $('#view-list').hidden = view !== 'list';
  $('#view-rec').hidden = view !== 'rec';
  $('.calbar').style.display = view === 'cal' ? '' : 'none';
  // Hide the job filters on the recruiters tab — but NOT the whole controls
  // panel, which is where the view tabs live. Hiding it stranded the reader on
  // the tab with no way back.
  $('#jobfilters').style.display = view === 'rec' ? 'none' : '';
  $('#searchwrap').style.visibility = view === 'rec' ? 'hidden' : '';
  $('#stats').style.display = view === 'rec' ? 'none' : '';
  $('#actnow').style.display = view === 'rec' ? 'none' : '';
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

  $('#basis-apply').addEventListener('click', () => setDateBasis('applyBy'));
  $('#basis-posted').addEventListener('click', () => setDateBasis('postedAt'));

  $('#mode-rolling').addEventListener('click', () => setCalMode('rolling'));
  $('#mode-month').addEventListener('click', () => setCalMode('month'));

  $('#tab-cal').addEventListener('click', () => setView('cal'));
  $('#tab-list').addEventListener('click', () => setView('list'));
  $('#tab-rec').addEventListener('click', () => setView('rec'));

  $('#rec-add').addEventListener('click', () => {
    const name = $('#rec-name').value.trim();
    if (!name) { $('#rec-name').focus(); return; }
    myRecruiters.push({
      name,
      focus: $('#rec-firm').value.trim(),
      url: $('#rec-url').value.trim(),
    });
    store.write('njc.recruiters', myRecruiters);
    for (const id of ['#rec-name', '#rec-firm', '#rec-url']) $(id).value = '';
    renderRecruiters();
  });

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
  state.dateBasis = store.read('njc.dateBasis', 'applyBy');
  const savedCats = store.read('njc.cats', null);
  if (Array.isArray(savedCats) && savedCats.length) state.cats = new Set(savedCats);
}

async function boot() {
  restorePrefs();
  bind();

  try {
    const res = await fetch(`data/jobs.json?t=${Date.now()}`, { cache: 'no-store' });
    if (res.ok) state.data = await res.json();
  } catch { /* fall through to the empty state */ }

  try {
    const res = await fetch(`data/recruiters.json?t=${Date.now()}`, { cache: 'no-store' });
    if (res.ok) state.recruiters = await res.json();
  } catch { /* the tab still works with the user's own contacts */ }

  setDateBasis(state.dateBasis);
  setCalMode(state.calMode);
  setView(state.view);
}

boot();
