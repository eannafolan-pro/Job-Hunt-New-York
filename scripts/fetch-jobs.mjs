#!/usr/bin/env node
// Polls public ATS job boards, keeps NYC roles that match the search config,
// and writes data/jobs.json. Run by .github/workflows/update-jobs.yml.
//
// No dependencies and no API keys — every endpoint here is public JSON.

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { COMPANIES } from './companies.mjs';
import {
  SALARY_FLOOR, NYC_PATTERNS, NOT_NYC_PATTERNS, CATEGORIES,
  EXCLUDE_TITLE, NO_SPONSORSHIP_PATTERNS, CITIZENSHIP_BLOCK_PATTERNS,
  J1_FRIENDLY_PATTERNS, STRONG_MATCH_PATTERNS,
} from './config.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = resolve(ROOT, 'data/jobs.json');

const TIMEOUT_MS = 25_000;
const CONCURRENCY = 6;
const RETAIN_CLOSED_DAYS = 45;   // keep delisted jobs this long so the calendar has history
const WORKDAY_DETAIL_CAP = 25;   // per-company cap on follow-up description fetches

// ---------------------------------------------------------------- http

async function fetchJSON(url, { method = 'GET', body, headers = {} } = {}) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      method,
      signal: ctrl.signal,
      headers: {
        'accept': 'application/json',
        'user-agent': 'nyc-job-calendar/1.0 (github actions; personal job search)',
        ...(body ? { 'content-type': 'application/json' } : {}),
        ...headers,
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

async function withRetry(fn, attempts = 3) {
  let lastErr;
  for (let i = 0; i < attempts; i++) {
    try { return await fn(); } catch (err) {
      lastErr = err;
      if (i < attempts - 1) await new Promise(r => setTimeout(r, 1000 * 2 ** i));
    }
  }
  throw lastErr;
}

// ---------------------------------------------------------------- text utils

const stripHtml = (s = '') => String(s)
  .replace(/<style[\s\S]*?<\/style>/gi, ' ')
  .replace(/<script[\s\S]*?<\/script>/gi, ' ')
  .replace(/<[^>]+>/g, ' ')
  .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&')
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
  .replace(/&#(\d+);/g, (_, d) => String.fromCharCode(+d))
  .replace(/&[a-z]+;/gi, ' ')
  .replace(/\s+/g, ' ')
  .trim();

const matchesAny = (text, patterns) => patterns.some(p => p.test(text));

// ---------------------------------------------------------------- salary

const HOURLY_HINT = /(per hour|\/\s?hour|\/\s?hr|hourly|an hour)/i;

function toDollars(raw, suffix, hourly) {
  let n = parseFloat(String(raw).replace(/,/g, ''));
  if (!Number.isFinite(n)) return null;
  if (suffix) n *= 1000;
  if (hourly && n < 500) n *= 2080;           // full-time-equivalent
  else if (!suffix && n > 0 && n < 1000) return null;  // bare "$85" — not a salary
  if (n < 20_000 || n > 5_000_000) return null;
  return Math.round(n);
}

// Pull the most credible salary range out of a job description.
function parseSalary(text) {
  if (!text) return null;

  const rangeRe = /\$\s?([\d][\d,]*(?:\.\d+)?)\s?([kK])?\s*(?:-|–|—|\bto\b|\bthrough\b)\s*\$?\s?([\d][\d,]*(?:\.\d+)?)\s?([kK])?/g;
  const candidates = [];

  for (const m of text.matchAll(rangeRe)) {
    const ctx = text.slice(Math.max(0, m.index - 140), m.index + m[0].length + 90);
    const hourly = HOURLY_HINT.test(ctx);
    const min = toDollars(m[1], m[2], hourly);
    const max = toDollars(m[3], m[4], hourly);
    if (min == null || max == null || max < min) continue;

    // Score by how salary-ish the surrounding sentence reads.
    let score = 0;
    if (/salary|compensation|base pay|pay range|annual|comp range|\bofs\b|expected pay/i.test(ctx)) score += 3;
    if (/equity|bonus|benefits|total (comp|rewards)/i.test(ctx)) score += 1;
    if (/revenue|raised|valuation|aum|funding|portfolio|budget|deal size/i.test(ctx)) score -= 4;
    if (hourly) score -= 1;
    candidates.push({ min, max, score, hourly });
  }

  if (candidates.length) {
    candidates.sort((a, b) => b.score - a.score || b.max - a.max);
    const best = candidates[0];
    if (best.score > -2) return { min: best.min, max: best.max, hourly: best.hourly };
  }

  // Fallback: a single figure sitting in an explicit salary sentence.
  const singleRe = /(salary|base (pay|salary)|compensation|pay range)[^.$]{0,80}\$\s?([\d][\d,]*)\s?([kK])?/gi;
  for (const m of text.matchAll(singleRe)) {
    const v = toDollars(m[3], m[4], false);
    if (v) return { min: v, max: v, hourly: false };
  }
  return null;
}

function formatSalary(sal) {
  if (!sal) return null;
  const fmt = n => n >= 1000 ? `$${Math.round(n / 1000)}k` : `$${n}`;
  return sal.min === sal.max ? fmt(sal.min) : `${fmt(sal.min)} – ${fmt(sal.max)}`;
}

// ---------------------------------------------------------------- classify

function isNYC(location) {
  const loc = String(location || '');
  if (!loc) return false;
  if (matchesAny(loc, NOT_NYC_PATTERNS)) return false;
  return matchesAny(loc, NYC_PATTERNS);
}

function categorize(title, body) {
  for (const cat of CATEGORIES) {
    if (matchesAny(title, cat.patterns)) return cat.id;
  }
  // Weaker signal: fall back to the description for otherwise vague titles.
  for (const cat of CATEGORIES) {
    if (matchesAny(body.slice(0, 1200), cat.patterns)) return cat.id;
  }
  return null;
}

// ---------------------------------------------------------------- adapters

async function fromGreenhouse(co) {
  const data = await withRetry(() => fetchJSON(
    `https://boards-api.greenhouse.io/v1/boards/${co.token}/jobs?content=true`));
  return (data.jobs || []).map(j => {
    const body = stripHtml(j.content);
    const loc = j.location?.name || (j.offices || []).map(o => o.name).join(', ');
    return {
      externalId: `gh-${co.token}-${j.id}`,
      title: j.title || '',
      location: loc,
      url: j.absolute_url,
      postedAt: j.first_published || j.updated_at || null,
      body,
      salaryHint: null,
    };
  });
}

async function fromLever(co) {
  const data = await withRetry(() => fetchJSON(
    `https://api.lever.co/v0/postings/${co.token}?mode=json`));
  return (Array.isArray(data) ? data : []).map(j => ({
    externalId: `lv-${co.token}-${j.id}`,
    title: j.text || '',
    location: j.categories?.location || '',
    url: j.hostedUrl || j.applyUrl,
    postedAt: j.createdAt ? new Date(j.createdAt).toISOString() : null,
    body: stripHtml(j.descriptionPlain || j.description || '') + ' ' +
          stripHtml((j.lists || []).map(l => `${l.text} ${l.content}`).join(' ')),
    salaryHint: j.salaryRange
      ? `$${j.salaryRange.min} - $${j.salaryRange.max}` : null,
  }));
}

async function fromAshby(co) {
  const data = await withRetry(() => fetchJSON(
    `https://api.ashbyhq.com/posting-api/job-board/${co.token}?includeCompensation=true`));
  return (data.jobs || []).filter(j => j.isListed !== false).map(j => ({
    externalId: `ab-${co.token}-${j.id}`,
    title: j.title || '',
    location: j.location || (j.secondaryLocations || []).map(l => l.location).join(', '),
    url: j.jobUrl || j.applyUrl,
    postedAt: j.publishedAt || j.updatedAt || null,
    body: stripHtml(j.descriptionHtml || j.descriptionPlain || ''),
    salaryHint: j.compensation?.compensationTierSummary
      || j.compensation?.summaryComponents?.map(c => c.summary).join(' ') || null,
  }));
}

async function fromSmartRecruiters(co) {
  const list = await withRetry(() => fetchJSON(
    `https://api.smartrecruiters.com/v1/companies/${co.token}/postings?limit=100&country=us`));
  const out = [];
  for (const j of (list.content || [])) {
    const city = j.location?.city || '';
    const region = j.location?.region || '';
    out.push({
      externalId: `sr-${co.token}-${j.id}`,
      title: j.name || '',
      location: [city, region].filter(Boolean).join(', '),
      url: j.ref ? `https://jobs.smartrecruiters.com/${co.token}/${j.id}` : null,
      postedAt: j.releasedDate || null,
      body: stripHtml(j.jobAd?.sections?.jobDescription?.text || ''),
      salaryHint: null,
      needsDetail: `https://api.smartrecruiters.com/v1/companies/${co.token}/postings/${j.id}`,
    });
  }
  // SmartRecruiters' list view omits descriptions; fetch the NYC ones only.
  let fetched = 0;
  for (const job of out) {
    if (job.body || !isNYC(job.location) || fetched >= WORKDAY_DETAIL_CAP) continue;
    try {
      const d = await fetchJSON(job.needsDetail);
      const secs = d.jobAd?.sections || {};
      job.body = stripHtml([secs.jobDescription?.text, secs.qualifications?.text,
        secs.additionalInformation?.text].filter(Boolean).join(' '));
      fetched++;
    } catch { /* keep the posting without a description */ }
  }
  return out.map(({ needsDetail, ...j }) => j);
}

function parseWorkdayPosted(s) {
  const t = String(s || '').toLowerCase();
  const now = new Date();
  if (/today/.test(t)) return now.toISOString();
  if (/yesterday/.test(t)) return new Date(now - 864e5).toISOString();
  const m = t.match(/(\d+)\+?\s*days?/);
  if (m) return new Date(now - (+m[1]) * 864e5).toISOString();
  const mo = t.match(/(\d+)\+?\s*months?/);
  if (mo) return new Date(now - (+mo[1]) * 30 * 864e5).toISOString();
  return null;
}

async function fromWorkday(co) {
  const base = `https://${co.host}/wday/cxs/${co.tenant}/${co.site}`;
  const collected = [];
  for (let offset = 0; offset < 200; offset += 20) {
    const page = await withRetry(() => fetchJSON(`${base}/jobs`, {
      method: 'POST',
      body: { appliedFacets: {}, limit: 20, offset, searchText: 'New York' },
    }), offset === 0 ? 3 : 1);
    const posts = page.jobPostings || [];
    collected.push(...posts);
    if (posts.length < 20 || collected.length >= (page.total || 0)) break;
  }

  const jobs = collected.map(j => ({
    externalId: `wd-${co.tenant}-${j.externalPath || j.bulletFields?.[0] || j.title}`,
    title: j.title || '',
    location: j.locationsText || j.locations || '',
    url: `https://${co.host}/en-US/${co.site}${j.externalPath || ''}`,
    postedAt: parseWorkdayPosted(j.postedOn),
    body: '',
    salaryHint: null,
    _path: j.externalPath,
  }));

  // Descriptions (and therefore salaries) need a per-job call; cap the volume.
  let fetched = 0;
  for (const job of jobs) {
    if (!job._path || !isNYC(job.location) || fetched >= WORKDAY_DETAIL_CAP) continue;
    try {
      const d = await fetchJSON(`${base}${job._path}`);
      const info = d.jobPostingInfo || {};
      job.body = stripHtml(info.jobDescription || '');
      if (info.startDate) job.postedAt = new Date(info.startDate).toISOString();
      fetched++;
    } catch { /* keep the posting without a description */ }
  }
  return jobs.map(({ _path, ...j }) => j);
}

const ADAPTERS = {
  greenhouse: fromGreenhouse,
  lever: fromLever,
  ashby: fromAshby,
  smartrecruiters: fromSmartRecruiters,
  workday: fromWorkday,
};

// ---------------------------------------------------------------- pipeline

function refine(raw, co) {
  const title = raw.title.trim();
  if (!title || !raw.url) return null;
  if (!isNYC(raw.location)) return null;
  if (matchesAny(title, EXCLUDE_TITLE)) return null;

  const body = raw.body || '';

  // Hard visa block: no third-party J-1 sponsor gets past a citizenship or
  // clearance requirement, so these are dropped rather than flagged.
  if (matchesAny(body, CITIZENSHIP_BLOCK_PATTERNS)) return null;

  const category = categorize(title, body);
  if (!category) return null;

  const salary = parseSalary(raw.salaryHint ? `${raw.salaryHint} salary ${body}` : body);
  // Keep unpriced roles out — the floor is the whole point of the list.
  if (!salary || salary.max < SALARY_FLOOR) return null;

  return {
    id: raw.externalId,
    title,
    company: co.name,
    url: raw.url,
    location: raw.location.replace(/\s+/g, ' ').trim(),
    postedAt: raw.postedAt,
    category,
    salaryMin: salary.min,
    salaryMax: salary.max,
    salaryText: formatSalary(salary),
    hourly: !!salary.hourly,
    noSponsorship: matchesAny(body, NO_SPONSORSHIP_PATTERNS),
    j1Friendly: matchesAny(body, J1_FRIENDLY_PATTERNS) || matchesAny(title, J1_FRIENDLY_PATTERNS),
    strongMatch: matchesAny(title, STRONG_MATCH_PATTERNS),
    source: co.ats,
  };
}

async function pool(items, size, worker) {
  const results = [];
  let cursor = 0;
  await Promise.all(Array.from({ length: Math.min(size, items.length) }, async () => {
    while (cursor < items.length) {
      const i = cursor++;
      results[i] = await worker(items[i]);
    }
  }));
  return results;
}

async function loadPrevious() {
  try { return JSON.parse(await readFile(OUT, 'utf8')); }
  catch { return { jobs: [] }; }
}

async function main() {
  const startedAt = new Date();
  const previous = await loadPrevious();
  const prevById = new Map((previous.jobs || []).map(j => [j.id, j]));

  const results = await pool(COMPANIES, CONCURRENCY, async (co) => {
    const t0 = Date.now();
    try {
      const raw = await ADAPTERS[co.ats](co);
      const kept = raw.map(r => refine(r, co)).filter(Boolean);
      console.log(`  ok   ${co.name.padEnd(22)} ${String(raw.length).padStart(4)} seen -> ${kept.length} kept`);
      return { co, kept, health: { company: co.name, ats: co.ats, ok: true, seen: raw.length, kept: kept.length, ms: Date.now() - t0 } };
    } catch (err) {
      const msg = err?.name === 'AbortError' ? 'timeout' : (err?.message || String(err));
      console.log(`  FAIL ${co.name.padEnd(22)} ${msg}`);
      return { co, kept: [], health: { company: co.name, ats: co.ats, ok: false, error: msg, ms: Date.now() - t0 } };
    }
  });

  // Merge, dedupe, and carry forward first-seen dates.
  const nowISO = startedAt.toISOString();
  const byId = new Map();
  const seenKeys = new Set();

  for (const { kept } of results) {
    for (const job of kept) {
      const key = `${job.company}::${job.title}`.toLowerCase();
      if (seenKeys.has(key)) continue;
      seenKeys.add(key);

      const prev = prevById.get(job.id);
      const firstSeen = prev?.firstSeen || nowISO;
      // Prefer the board's own posted date; fall back to when we first saw it.
      const posted = job.postedAt || prev?.postedAt || firstSeen;
      byId.set(job.id, {
        ...job,
        postedAt: posted,
        firstSeen,
        lastSeen: nowISO,
        active: true,
      });
    }
  }

  // Retain recently-delisted roles so past days on the calendar aren't empty.
  const cutoff = Date.now() - RETAIN_CLOSED_DAYS * 864e5;
  for (const [id, prev] of prevById) {
    if (byId.has(id)) continue;
    if (new Date(prev.lastSeen || prev.firstSeen || 0).getTime() < cutoff) continue;
    byId.set(id, { ...prev, active: false });
  }

  const jobs = [...byId.values()].sort(
    (a, b) => new Date(b.postedAt) - new Date(a.postedAt));

  const health = results.map(r => r.health).sort((a, b) =>
    Number(a.ok) - Number(b.ok) || b.kept - a.kept);

  const payload = {
    generatedAt: nowISO,
    salaryFloor: SALARY_FLOOR,
    counts: {
      total: jobs.length,
      active: jobs.filter(j => j.active).length,
      boardsOk: health.filter(h => h.ok).length,
      boardsTotal: health.length,
    },
    sources: health,
    jobs,
  };

  await mkdir(dirname(OUT), { recursive: true });
  await writeFile(OUT, JSON.stringify(payload, null, 2) + '\n');

  console.log(`\n${jobs.length} jobs (${payload.counts.active} active) from ` +
    `${payload.counts.boardsOk}/${payload.counts.boardsTotal} boards -> data/jobs.json`);
}

// Exported for the unit tests in scripts/test-parsing.mjs.
export { parseSalary, formatSalary, isNYC, categorize, refine, parseWorkdayPosted, stripHtml, matchesAny };

const invokedDirectly = process.argv[1] &&
  resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));
if (invokedDirectly) {
  main().catch(err => { console.error(err); process.exit(1); });
}
