#!/usr/bin/env node
// Polls public ATS job boards, keeps NYC roles that match the search config,
// and writes data/jobs.json. Run by .github/workflows/update-jobs.yml.
//
// No dependencies and no API keys — every endpoint here is public JSON.

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { COMPANIES } from './companies.mjs';
import { TARGETS } from './targets.mjs';
import {
  SALARY_FLOOR, APPLY_WINDOW_DAYS, MAX_POSTING_AGE_DAYS, NYC_PATTERNS, NOT_NYC_PATTERNS, CATEGORIES,
  SALARY_BASIS, EXCLUDE_TITLE, NO_SPONSORSHIP_PATTERNS, CITIZENSHIP_BLOCK_PATTERNS,
  J1_FRIENDLY_PATTERNS, STRONG_MATCH_PATTERNS,
} from './config.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = resolve(ROOT, 'data/jobs.json');

const TIMEOUT_MS = 25_000;
const CONCURRENCY = 6;
// Workday's list response has no description, so salary and category can only be
// read from a per-job follow-up call. Capping that at 25 silently threw away
// everything past the 25th NYC role at each bank — Citi returned 40 postings and
// yielded one. The cap now applies to NYC matches only, and is high enough to
// cover them.
const WORKDAY_DETAIL_CAP = 200;

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

// Careers pages are HTML, not JSON — needed to read a Workday tenant off the
// page or its redirect.
async function fetchText(url) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      redirect: 'follow',
      headers: {
        'accept': 'text/html,application/xhtml+xml',
        'user-agent': 'nyc-job-calendar/1.0 (github actions; personal job search)',
      },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return { url: res.url, body: await res.text() };
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

// ---------------------------------------------------------------- deadlines

const MONTHS = ['january','february','march','april','may','june','july',
  'august','september','october','november','december'];

// Real closing dates exist only where a posting states one in its text — no ATS
// feed carries a close-date field. Structured programmes and graduate schemes
// usually do; rolling roles almost never do.
const DEADLINE_CUES = /(appl(?:y|ications?)\s+(?:by|close[sd]?|deadline|due|must be (?:received|submitted))|closing date|deadline for applications?|applications? (?:will )?close|final day to apply|last day to apply|submit(?:ted)? by)/i;

function parseStatedDeadline(text, postedAt) {
  if (!text) return null;
  const now = Date.now();
  const posted = new Date(postedAt).getTime();

  for (const m of text.matchAll(new RegExp(DEADLINE_CUES.source + '[^.]{0,60}', 'gi'))) {
    const chunk = m[0];
    const d = extractDate(chunk);
    if (!d) continue;
    const t = d.getTime();
    // Sanity: a stated deadline must be after the posting and within a year of it.
    if (Number.isFinite(t) && t > posted - 864e5 && t < posted + 365 * 864e5 && t > now - 180 * 864e5) {
      return d.toISOString();
    }
  }
  return null;
}

function extractDate(chunk) {
  // 15 January 2027 / January 15, 2027 / Jan 15 2027
  const names = MONTHS.map(m => m.slice(0, 3)).join('|');
  let m = chunk.match(new RegExp(`(\\d{1,2})(?:st|nd|rd|th)?\\s+(${names})[a-z]*\\.?,?\\s*(\\d{4})?`, 'i'));
  if (m) return buildDate(m[3], MONTHS.findIndex(x => x.startsWith(m[2].toLowerCase())), m[1]);

  m = chunk.match(new RegExp(`(${names})[a-z]*\\.?\\s+(\\d{1,2})(?:st|nd|rd|th)?,?\\s*(\\d{4})?`, 'i'));
  if (m) return buildDate(m[3], MONTHS.findIndex(x => x.startsWith(m[1].toLowerCase())), m[2]);

  // 2027-01-15
  m = chunk.match(/(\d{4})-(\d{2})-(\d{2})/);
  if (m) return new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));

  // 01/15/2027 (US order — these boards are US)
  m = chunk.match(/(\d{1,2})\/(\d{1,2})\/(\d{2,4})/);
  if (m) {
    const y = +m[3] < 100 ? 2000 + +m[3] : +m[3];
    return new Date(Date.UTC(y, +m[1] - 1, +m[2]));
  }
  return null;
}

function buildDate(year, monthIdx, day) {
  if (monthIdx < 0) return null;
  // An undated deadline means the next occurrence of that day.
  const y = year ? +year : new Date().getFullYear();
  const d = new Date(Date.UTC(y, monthIdx, +day));
  if (!year && d.getTime() < Date.now() - 30 * 864e5) d.setUTCFullYear(y + 1);
  return d;
}

// ---------------------------------------------------------------- pay benchmarks

// Grade implied by the title. Pay in this market tracks grade far more closely
// than it tracks employer, so it is the right key for a comparison.
function seniorityLevel(title) {
  const t = title.toLowerCase();
  if (/senior associate|sr\.? associate/.test(t)) return 'senior_associate';
  if (/senior analyst|sr\.? analyst/.test(t)) return 'senior_analyst';
  if (/senior consultant/.test(t)) return 'senior_consultant';
  if (/\bassociate\b/.test(t)) return 'associate';
  if (/\banalyst\b/.test(t)) return 'analyst';
  if (/\bconsultant\b/.test(t)) return 'consultant';
  return 'other';
}

const MIN_BENCHMARK_SAMPLES = 3;

// Median advertised pay per category and grade, taken from postings that DID
// state a range. This is the reference an unpriced role is checked against —
// real observed pay for comparable roles, not an assumption.
function benchmarkSalaries(jobs, previous = {}) {
  const buckets = {};
  for (const j of jobs) {
    if (!j.salaryMin || !j.level) continue;
    const key = `${j.category}|${j.level}`;
    (buckets[key] ||= []).push(Math.round((j.salaryMin + j.salaryMax) / 2));
  }

  const out = {};
  // Carry the previous run's samples so a thin day does not lose the reference.
  for (const [key, prev] of Object.entries(previous)) {
    out[key] = { ...prev, carried: true };
  }
  for (const [key, vals] of Object.entries(buckets)) {
    vals.sort((a, b) => a - b);
    out[key] = {
      median: vals[Math.floor(vals.length / 2)],
      samples: vals.length,
      low: vals[0],
      high: vals[vals.length - 1],
    };
  }
  return out;
}

// Decide whether an unpriced role clears the floor, on the evidence available.
// Returns null when there is no comparable data — an unverifiable role is
// dropped rather than assumed to qualify.
function inferSalary(job, benchmarks) {
  const b = benchmarks[`${job.category}|${job.level}`];
  if (!b || b.samples < MIN_BENCHMARK_SAMPLES) return null;
  if (b.median < SALARY_FLOOR) return null;
  return { median: b.median, samples: b.samples, low: b.low, high: b.high };
}

// ---------------------------------------------------------------- classify

function isNYC(location) {
  const loc = String(location || '');
  if (!loc) return false;
  if (matchesAny(loc, NOT_NYC_PATTERNS)) return false;
  return matchesAny(loc, NYC_PATTERNS);
}

// Title only. An earlier version fell back to matching the description, but the
// first live scrape showed that pulling in nurse practitioners, hardware product
// managers and procurement roles — 46 of 124 results, almost all irrelevant.
function categorize(title) {
  for (const cat of CATEGORIES) {
    if (matchesAny(title, cat.patterns)) return cat.id;
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
    `https://api.smartrecruiters.com/v1/companies/${co.token}/postings?limit=100`));
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
  // Workday pages 20 at a time and reports a total. Stopping at 200 capped every
  // large employer well below their actual New York headcount.
  for (let offset = 0; offset < 1000; offset += 20) {
    const page = await withRetry(() => fetchJSON(`${base}/jobs`, {
      method: 'POST',
      body: { appliedFacets: {}, limit: 20, offset, searchText: 'New York' },
    }), offset === 0 ? 3 : 1);
    const posts = page.jobPostings || [];
    collected.push(...posts);
    if (!posts.length) break;
    if (page.total && collected.length >= page.total) break;
    if (posts.length < 20) break;
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

// ---------------------------------------------------------------- ats discovery
//
// The target list carries names and domains but no ATS tokens, so they have to
// be found. Try a few plausible board slugs against each key-less platform and
// keep the first that answers. Results — including misses — are cached in
// data/jobs.json so a run does not re-probe the whole list every six hours.

const DISCOVERY_TTL_DAYS = 7;   // how long to trust a miss before trying again

// Bump when the discovery logic gains a platform. A cached miss is only
// trustworthy if it was produced by the current logic: adding the Workday step
// while 87 firms sat cached as "checked today" meant none of them were ever
// probed for it. Anything recorded under an older version is re-probed.
const DISCOVERY_VERSION = 3;   // 3: instrumented discovery for the coverage report

function slugCandidates(target) {
  const root = target.domain.split('.')[0];
  const name = target.name.toLowerCase()
    .replace(/&/g, 'and')
    .replace(/[^a-z0-9]+/g, '');
  const trimmed = name.replace(
    /(partners|capital|management|group|advisors|advisory|holdings|global|financial|securities|company|llc|inc)$/, '');
  return [...new Set([root, name, trimmed])].filter(x => x && x.length > 2);
}

// A cheap existence check per platform. No retries: a wrong slug 404s fast and
// there are hundreds of these.
const PROBES = {
  greenhouse: slug => `https://boards-api.greenhouse.io/v1/boards/${slug}/jobs`,
  lever:      slug => `https://api.lever.co/v0/postings/${slug}?mode=json&limit=1`,
  ashby:      slug => `https://api.ashbyhq.com/posting-api/job-board/${slug}`,
};

// Workday is where the banks and restructuring boutiques actually post, but its
// endpoint needs a tenant, a wd number and a site name that cannot be guessed —
// ten hand-written attempts all returned 404 or 422. They can be read off the
// careers page, which redirects to or links the real board.
const WORKDAY_RE = /([a-z0-9][a-z0-9-]*)\.(wd\d+)\.myworkdayjobs\.com\/(?:[a-z]{2}-[A-Z]{2}\/)?([A-Za-z0-9_-]+)/;

const CAREERS_PATHS = ['/careers', '/en/careers', '/careers/jobs', '/about/careers', '/join-us', '/en-us/careers'];

// HTTP status out of the Error thrown by fetchJSON/fetchText, or 0 for a
// transport failure. Needed so the coverage report can tell a 403 apart from a
// 404 — one is a block, the other is a wrong guess.
function statusOf(err) {
  const m = /HTTP (\d{3})/.exec(err?.message || '');
  if (m) return +m[1];
  return err?.name === 'AbortError' ? 0 : 0;
}

const BLOCKING_STATUSES = new Set([401, 403, 429, 451]);

// Visible text left after stripping markup — used to tell a real careers page
// from a single-page-app shell that renders its jobs in JavaScript.
function visibleTextLength(html) {
  return stripHtml(html).length;
}

async function discoverWorkday(target, diag) {
  for (const path of CAREERS_PATHS) {
    let page;
    try {
      page = await fetchText(`https://${target.domain}${path}`);
      diag.careersUrl = page.url;
      diag.careersStatus = 200;
      diag.htmlText = Math.max(diag.htmlText || 0, visibleTextLength(page.body));
    } catch (err) {
      const st = statusOf(err);
      diag.statuses.push(`${path}:${st || 'net'}`);
      if (BLOCKING_STATUSES.has(st)) diag.blocked = true;
      continue;
    }

    // The redirect target itself, then anything linked in the page.
    const hit = page.url.match(WORKDAY_RE) || page.body.match(WORKDAY_RE);
    if (!hit) continue;

    const [, tenant, wd, site] = hit;
    const host = `${tenant}.${wd}.myworkdayjobs.com`;
    const endpoint = `https://${host}/wday/cxs/${tenant}/${site}/jobs`;
    try {
      const probe = await fetchJSON(endpoint, {
        method: 'POST',
        body: { appliedFacets: {}, limit: 1, offset: 0, searchText: '' },
      });
      if (Array.isArray(probe?.jobPostings)) {
        return { ats: 'workday', token: site, host, tenant, site, endpoint };
      }
    } catch (err) {
      const st = statusOf(err);
      diag.statuses.push(`workday:${st}`);
      if (BLOCKING_STATUSES.has(st)) diag.blocked = true;
    }
  }
  return null;
}

// Returns { hit, diag }. diag is always populated, even on total failure — the
// point of the coverage report is that nothing fails silently.
async function discoverAts(target) {
  const diag = { statuses: [], careersUrl: null, careersStatus: null, htmlText: 0, blocked: false };

  for (const slug of slugCandidates(target)) {
    for (const [ats, url] of Object.entries(PROBES)) {
      const endpoint = url(slug);
      try {
        const data = await fetchJSON(endpoint);
        const found = ats === 'lever' ? Array.isArray(data) : Array.isArray(data?.jobs);
        if (found) return { hit: { ats, token: slug, endpoint }, diag };
      } catch (err) {
        const st = statusOf(err);
        if (BLOCKING_STATUSES.has(st)) diag.blocked = true;
        if (st && st !== 404) diag.statuses.push(`${ats}/${slug}:${st}`);
      }
    }
  }
  const hit = await discoverWorkday(target, diag);
  return { hit, diag };
}

// Classify what happened to one company, for the coverage report.
function outcomeFor({ hit, diag, raw, matched }) {
  if (hit) {
    if (matched > 0) return 'ok';
    return 'no_matching_roles';
  }
  if (diag.blocked) return 'blocked';
  if (diag.careersStatus === 200) {
    // Reached a careers page but found no postings source in it.
    return diag.htmlText < 500 ? 'js_only' : 'no_ats_found';
  }
  return 'careers_page_missing';
}

async function resolveTargets(cache) {
  const now = Date.now();
  const resolved = [];
  const nextCache = {};
  const diags = new Map();   // company name -> discovery diagnostics

  const stale = t => {
    const hit = cache[t.name];
    if (!hit) return true;
    if (hit.v !== DISCOVERY_VERSION) return true;    // probed by older logic
    if (hit.ats) return false;                       // a known board never expires
    return now - new Date(hit.checkedAt).getTime() > DISCOVERY_TTL_DAYS * 864e5;
  };

  const toProbe = TARGETS.filter(stale);
  // Probing hits the same few hosts, so keep it gentler than the main sweep.
  const found = await pool(toProbe, 4, async (t) => {
    const { hit, diag } = await discoverAts(t);
    if (hit) console.log(`  found ${t.name.padEnd(30)} ${hit.ats}/${hit.token}`);
    return { name: t.name, hit, diag };
  });

  const probed = new Map(found.map(f => [f.name, f]));
  for (const t of TARGETS) {
    const fresh = probed.get(t.name);
    const cached = cache[t.name];
    const hit = fresh?.hit || (cached?.ats ? { ...cached } : null);
    // A cached row carries no diagnostics; say so rather than inventing them.
    const diag = fresh?.diag || {
      statuses: [], careersUrl: cached?.careersUrl || null,
      careersStatus: cached?.ats ? 200 : null, htmlText: 0, blocked: false, fromCache: true,
    };
    diags.set(t.name, diag);

    nextCache[t.name] = {
      ats: hit?.ats || null, token: hit?.token || null,
      host: hit?.host, tenant: hit?.tenant, site: hit?.site,
      endpoint: hit?.endpoint || cached?.endpoint || null,
      careersUrl: diag.careersUrl || cached?.careersUrl || null,
      v: DISCOVERY_VERSION,
      checkedAt: new Date(now).toISOString(),
    };
    if (hit?.ats) {
      resolved.push({
        name: t.name, ats: hit.ats, token: hit.token,
        host: hit.host, tenant: hit.tenant, site: hit.site,
        endpoint: nextCache[t.name].endpoint,
        category: t.category, whyFit: t.whyFit,
      });
    }
  }
  return { resolved, nextCache, diags };
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

  const category = categorize(title);
  if (!category) return null;

  const salary = parseSalary(raw.salaryHint ? `${raw.salaryHint} salary ${body}` : body);
  if (salary) {
    const basis = SALARY_BASIS === 'max' ? salary.max
      : SALARY_BASIS === 'mid' ? Math.round((salary.min + salary.max) / 2)
      : salary.min;
    if (basis < SALARY_FLOOR) return null;
  }
  // An unpriced role is not dropped here. Many bank and Workday postings state
  // no range in the text, and discarding them loses real roles. It is instead
  // checked against observed pay for comparable roles once the whole sweep is
  // in — see benchmarkSalaries() and the second pass in main().

  const cat = CATEGORIES.find(c => c.id === category);

  return {
    id: raw.externalId,
    title,
    company: co.name,
    url: raw.url,
    location: raw.location.replace(/\s+/g, ' ').trim(),
    postedAt: raw.postedAt,
    category,
    priority: !!cat?.priority,
    salaryMin: salary ? salary.min : null,
    salaryMax: salary ? salary.max : null,
    salaryText: salary ? formatSalary(salary) : null,
    hourly: !!salary?.hourly,
    level: seniorityLevel(title),
    // A deadline the posting actually states, if it has one. Null means we fall
    // back to the estimate at merge time.
    statedDeadline: parseStatedDeadline(body, raw.postedAt || new Date().toISOString()),
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

  // Resolve the target firms' job boards before the main sweep.
  const cache = previous.atsCache || {};
  const { resolved, nextCache, diags } = await resolveTargets(cache);
  const newlyFound = Object.entries(nextCache)
    .filter(([n, v]) => v.ats && !cache[n]?.ats).map(([n]) => n);
  console.log(`\nTarget list: ${resolved.length}/${TARGETS.length} firms have a reachable board` +
    (newlyFound.length ? ` (new: ${newlyFound.join(', ')})` : ''));

  // Pinned boards plus whatever discovery resolved, de-duplicated by name.
  const seenNames = new Set(COMPANIES.map(c => c.name));
  const boards = [...COMPANIES, ...resolved.filter(r => !seenNames.has(r.name))];

  const results = await pool(boards, CONCURRENCY, async (co) => {
    const t0 = Date.now();
    try {
      const raw = await ADAPTERS[co.ats](co);
      const kept = raw.map(r => refine(r, co)).filter(Boolean);
      console.log(`  ok   ${co.name.padEnd(22)} ${String(raw.length).padStart(4)} seen -> ${kept.length} kept`);
      return { co, kept, rawCount: raw.length, health: { company: co.name, ats: co.ats, ok: true, seen: raw.length, kept: kept.length, ms: Date.now() - t0 } };
    } catch (err) {
      const msg = err?.name === 'AbortError' ? 'timeout' : (err?.message || String(err));
      console.log(`  FAIL ${co.name.padEnd(22)} ${msg}`);
      return { co, kept: [], rawCount: 0, fetchError: msg, fetchStatus: statusOf(err),
        health: { company: co.name, ats: co.ats, ok: false, error: msg, ms: Date.now() - t0 } };
    }
  });

  // Pay benchmarks from everything that stated a range this run, blended with
  // what earlier runs observed. Unpriced roles are judged against these.
  const allKept = results.flatMap(r => r.kept);
  const benchmarks = benchmarkSalaries(allKept, previous.salaryBenchmarks || {});
  let admitted = 0, unverifiable = 0;

  // Merge, dedupe, and carry forward first-seen dates.
  const nowISO = startedAt.toISOString();
  const byId = new Map();
  const seenKeys = new Set();

  for (const { kept } of results) {
    for (const job of kept) {
      const key = `${job.company}::${job.title}`.toLowerCase();
      if (seenKeys.has(key)) continue;
      seenKeys.add(key);

      // Unpriced roles: keep only where comparable postings show this grade
      // clears the floor. No comparable data means no basis to keep it.
      if (!job.salaryMin) {
        const est = inferSalary(job, benchmarks);
        if (!est) { unverifiable++; continue; }
        job.salaryEstimated = true;
        job.salaryEstimate = est;
        job.salaryText = `~${formatSalary({ min: est.median, max: est.median })} est.`;
        admitted++;
      }

      const prev = prevById.get(job.id);
      const firstSeen = prev?.firstSeen || nowISO;
      // Prefer the board's own posted date; fall back to when we first saw it.
      const posted = job.postedAt || prev?.postedAt || firstSeen;
      // Prefer a deadline the posting states. Failing that — which is most of
      // them, since no ATS feed carries a close date — estimate one at
      // APPLY_WINDOW_DAYS after posting. The two are labelled differently in the
      // UI so an estimate is never mistaken for a real closing date.
      // Age cutoff. Applied here rather than in refine() because postedAt is
      // only settled once the board's date and the previous run's are merged.
      const ageDays = (startedAt - new Date(posted)) / 864e5;
      if (ageDays > MAX_POSTING_AGE_DAYS) continue;

      const stated = job.statedDeadline || prev?.statedDeadline || null;
      const applyBy = stated
        || new Date(new Date(posted).getTime() + APPLY_WINDOW_DAYS * 864e5).toISOString();

      byId.set(job.id, {
        ...job,
        postedAt: posted,
        applyBy,
        deadlineSource: stated ? 'stated' : 'estimated',
        firstSeen,
        lastSeen: nowISO,
        active: true,
      });
    }
  }

  // Delisted roles are dropped, not retained. Carrying them forward copied old
  // records through verbatim, so entries scraped under looser filters survived
  // every later tightening — 143 of 222 retained rows were titles the current
  // filters reject outright, showing up struck through on the page. A role that
  // is off the board is also not applicable, so there is nothing to keep.

  const jobs = [...byId.values()].sort(
    (a, b) => new Date(b.postedAt) - new Date(a.postedAt));

  console.log(`\nUnpriced roles: ${admitted} admitted on comparable pay, ` +
    `${unverifiable} dropped with no comparable data`);

  const health = results.map(r => r.health).sort((a, b) =>
    Number(a.ok) - Number(b.ok) || b.kept - a.kept);

  const payload = {
    generatedAt: nowISO,
    salaryFloor: SALARY_FLOOR,
    atsCache: nextCache,
    targets: {
      total: TARGETS.length,
      reachable: resolved.length,
      // Firms with no key-less public board — Workday, iCIMS or proprietary
      // portals. The page lists these as a manual checklist, since naming them
      // is more useful than dropping them silently.
      unreachable: TARGETS.filter(t => !nextCache[t.name]?.ats)
        .map(({ name, domain, category, whyFit }) => ({ name, domain, category, whyFit })),
      reached: TARGETS.filter(t => nextCache[t.name]?.ats).map(t => t.name),
    },
    maxPostingAgeDays: MAX_POSTING_AGE_DAYS,
    salaryBenchmarks: benchmarks,
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

  await writeCoverageReport({ results, resolved, nextCache, diags });

  console.log(`\n${jobs.length} jobs (${payload.counts.active} active) from ` +
    `${payload.counts.boardsOk}/${payload.counts.boardsTotal} boards -> data/jobs.json`);
}

// Exported for the unit tests in scripts/test-parsing.mjs.
export { parseSalary, formatSalary, isNYC, categorize, refine, parseWorkdayPosted, stripHtml, matchesAny, parseStatedDeadline, seniorityLevel, benchmarkSalaries, inferSalary };

const invokedDirectly = process.argv[1] &&
  resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));
if (invokedDirectly) {
  // ---------------------------------------------------------------- coverage

const csvCell = v => {
  const t = v === null || v === undefined ? '' : String(v);
  return /[",\n]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t;
};

// One row per target company, always. A company that was never reached still
// gets a row saying why — silent skipping is what hides a coverage failure.
async function writeCoverageReport({ results, resolved, nextCache, diags }) {
  const byName = new Map(results.map(r => [r.co.name, r]));
  const resolvedByName = new Map(resolved.map(r => [r.name, r]));

  const rows = TARGETS.map(t => {
    const hit = resolvedByName.get(t.name) || null;
    const run = byName.get(t.name);
    const diag = diags.get(t.name) || { statuses: [], blocked: false };

    const raw = run?.rawCount ?? 0;
    const matched = run?.kept?.length ?? 0;

    let outcome;
    let status = '';
    if (!hit) {
      outcome = outcomeFor({ hit, diag, raw, matched });
      status = diag.careersStatus ?? (diag.statuses[0]?.split(':').pop() || '');
    } else if (!run) {
      // A board was discovered but the sweep never fetched it.
      outcome = 'not_attempted';
    } else if (run.fetchError) {
      outcome = BLOCKING_STATUSES.has(run.fetchStatus) ? 'blocked' : 'no_ats_found';
      status = run.fetchStatus || '';
    } else {
      status = 200;
      outcome = matched > 0 ? 'ok' : 'no_matching_roles';
    }

    const notes = [
      diag.fromCache ? 'from cache' : null,
      diag.statuses.length ? `probe:${diag.statuses.slice(0, 4).join(' ')}` : null,
      run?.fetchError ? `fetch:${run.fetchError}` : null,
      !hit && diag.careersUrl ? `careers:${diag.careersUrl}` : null,
      !hit && diag.htmlText ? `visible_text:${diag.htmlText}` : null,
    ].filter(Boolean).join('; ');

    return {
      company: t.name,
      ats_detected: hit?.ats || '',
      endpoint_url: hit?.endpoint || nextCache[t.name]?.endpoint || '',
      http_status: status,
      raw_jobs_returned: raw,
      matched_after_filter: matched,
      outcome,
      notes,
    };
  });

  const header = ['company', 'ats_detected', 'endpoint_url', 'http_status',
    'raw_jobs_returned', 'matched_after_filter', 'outcome', 'notes'];
  const csv = [header.join(',')]
    .concat(rows.map(r => header.map(h => csvCell(r[h])).join(',')))
    .join('\n') + '\n';
  await writeFile(resolve(ROOT, 'data/coverage_report.csv'), csv);

  // Summary, grouped by outcome.
  const groups = {};
  for (const r of rows) (groups[r.outcome] ||= []).push(r.company);
  const order = ['ok', 'no_matching_roles', 'blocked', 'js_only', 'no_ats_found',
    'careers_page_missing', 'not_attempted'];

  console.log(`\n=== COVERAGE REPORT — ${rows.length} companies ===`);
  for (const k of order) {
    const list = groups[k] || [];
    console.log(`\n${k}: ${list.length}`);
    if (list.length) console.log('  ' + list.join(', '));
  }
  const rawTotal = rows.reduce((a, r) => a + r.raw_jobs_returned, 0);
  const matchTotal = rows.reduce((a, r) => a + r.matched_after_filter, 0);
  console.log(`\nraw postings seen across targets: ${rawTotal}`);
  console.log(`matched after filtering:          ${matchTotal}`);
  console.log('\nwritten to data/coverage_report.csv');
}

main().catch(err => { console.error(err); process.exit(1); });
}
