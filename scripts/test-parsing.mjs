#!/usr/bin/env node
// Unit tests for the filtering/parsing logic. Run: node scripts/test-parsing.mjs
// These cover the pure functions only — the network adapters are exercised by
// the scheduled workflow, which reports board health into data/jobs.json.

import assert from 'node:assert/strict';
import { parseSalary, isNYC, categorize, refine, parseWorkdayPosted,
  seniorityLevel, benchmarkSalaries, inferSalary } from './fetch-jobs.mjs';

let pass = 0, fail = 0;
const t = (name, fn) => {
  try { fn(); pass++; console.log(`  ok    ${name}`); }
  catch (e) { fail++; console.log(`  FAIL  ${name}\n        ${e.message}`); }
};

console.log('\nsalary parsing');
t('comma range', () => {
  const s = parseSalary('The base salary range for this role is $120,000 - $165,000 plus equity.');
  assert.equal(s.min, 120000); assert.equal(s.max, 165000);
});
t('k-suffix range with en dash', () => {
  const s = parseSalary('Compensation: $150K – $200K annually');
  assert.equal(s.min, 150000); assert.equal(s.max, 200000);
});
t('"to" separator', () => {
  const s = parseSalary('Expected pay range of $135,000 to $175,000 per year');
  assert.equal(s.min, 135000); assert.equal(s.max, 175000);
});
t('hourly converts to FTE', () => {
  const s = parseSalary('The pay range for this position is $60.00 - $75.00 per hour');
  assert.ok(s.hourly); assert.ok(s.min > 100000 && s.max < 200000);
});
t('ignores AUM / revenue figures', () => {
  assert.equal(parseSalary('We manage $45,000 - $90,000 in client portfolios. Great team!'), null);
});
t('prefers the salary sentence over a funding figure', () => {
  const s = parseSalary('We raised $50,000,000 - $80,000,000 in Series C. The annual base salary range is $110,000 - $140,000.');
  assert.equal(s.min, 110000); assert.equal(s.max, 140000);
});
t('single figure with salary context', () => {
  const s = parseSalary('Base salary of $145,000 commensurate with experience.');
  assert.equal(s.min, 145000);
});
t('no salary present', () => {
  assert.equal(parseSalary('Competitive compensation and great benefits.'), null);
});

console.log('\nNYC detection');
t('New York, NY', () => assert.ok(isNYC('New York, NY')));
t('NYC shorthand', () => assert.ok(isNYC('NYC (Hybrid)')));
t('Manhattan', () => assert.ok(isNYC('Manhattan, New York')));
t('rejects San Francisco', () => assert.equal(isNYC('San Francisco, CA'), false));
t('rejects upstate', () => assert.equal(isNYC('Albany, New York'), false));
t('rejects empty', () => assert.equal(isNYC(''), false));

console.log('\ncategorisation');
t('restructuring -> ib', () => assert.equal(categorize('Restructuring Analyst'), 'ib'));
t('M&A -> ib', () => assert.equal(categorize('M&A Associate'), 'ib'));
t('leveraged finance -> ib', () => assert.equal(categorize('Leveraged Finance Analyst'), 'ib'));
t('capital markets -> ib', () => assert.equal(categorize('Analyst, Equity Capital Markets'), 'ib'));
t('venture capital -> vc', () => assert.equal(categorize('Venture Capital Analyst'), 'vc'));
t('investment associate -> vc', () => assert.equal(categorize('Investment Associate'), 'vc'));
t('growth equity -> vc', () => assert.equal(categorize('Growth Equity Analyst'), 'vc'));
t('private equity -> vc', () => assert.equal(categorize('Private Equity Associate'), 'vc'));
t('IB wins the overlap with VC', () => assert.equal(categorize('M&A Associate, Financial Sponsors'), 'ib'));
t('FP&A -> finance', () => assert.equal(categorize('Senior Analyst, FP&A'), 'finance'));
t('AE -> sales', () => assert.equal(categorize('Account Executive, Mid-Market'), 'sales_bd'));
t('bizops -> strategy', () => assert.equal(categorize('Business Operations Associate'), 'ops_strategy'));
t('unrelated -> null', () => assert.equal(categorize('Pastry Chef'), null));
t('no body fallback — vague title stays null', () => assert.equal(categorize('Product Manager | Tax'), null));

console.log('\nend-to-end refine()');
const co = { name: 'Testco', ats: 'greenhouse' };
const base = {
  externalId: 'x1', title: 'Restructuring Analyst', location: 'New York, NY',
  url: 'https://example.com/j/1', postedAt: '2026-09-01T00:00:00Z',
  body: 'Join our team. The base salary range for this role is $130,000 - $170,000.',
  salaryHint: null,
};
t('keeps a qualifying role', () => {
  const j = refine({ ...base }, co);
  assert.equal(j.category, 'ib');
  assert.ok(j.priority, 'IB is a priority lane');
  assert.equal(j.salaryMin, 130000);
  assert.equal(j.salaryText, '$130k – $170k');
  assert.ok(j.strongMatch);
});
t('drops VP-level titles', () => {
  assert.equal(refine({ ...base, title: 'VP, Restructuring' }, co), null);
});
t('drops Manager-level titles (too senior at ~2 yrs)', () => {
  assert.equal(refine({ ...base, title: 'Manager, Restructuring' }, co), null);
  assert.equal(refine({ ...base, title: 'Portfolio Manager' }, co), null);
});
t('keeps Analyst and Associate', () => {
  assert.ok(refine({ ...base, title: 'Investment Banking Analyst' }, co));
  assert.ok(refine({ ...base, title: 'Restructuring Associate' }, co));
});
t('secondary lanes are not flagged priority', () => {
  const j = refine({ ...base, title: 'Senior Analyst, FP&A' }, co);
  assert.equal(j.category, 'finance');
  assert.equal(j.priority, false);
});
t('drops internships', () => {
  assert.equal(refine({ ...base, title: 'Restructuring Summer Analyst' }, co), null);
});
t('drops quant roles', () => {
  assert.equal(refine({ ...base, title: 'Quantitative Research Analyst' }, co), null);
});
t('drops software engineering', () => {
  assert.equal(refine({ ...base, title: 'Software Engineer, Payments' }, co), null);
});
t('drops non-NYC', () => {
  assert.equal(refine({ ...base, location: 'Austin, TX' }, co), null);
});
t('drops below the salary floor', () => {
  assert.equal(refine({ ...base, body: 'Salary range $60,000 - $80,000.' }, co), null);
});
t('keeps unpriced postings for the benchmark pass to judge', () => {
  const j = refine({ ...base, body: 'Great benefits.' }, co);
  assert.ok(j, 'no longer dropped at refine time');
  assert.equal(j.salaryMin, null);
});
t('flags (but keeps) no-sponsorship postings — J-1 uses a third-party sponsor', () => {
  const j = refine({ ...base, body: base.body + ' We are unable to sponsor visas for this role.' }, co);
  assert.ok(j, 'should not be dropped');
  assert.ok(j.noSponsorship);
});
t('drops US-citizenship-only roles (hard J-1 block)', () => {
  assert.equal(refine({ ...base, body: base.body + ' Applicants must be a US citizen.' }, co), null);
});
t('drops roles needing security clearance', () => {
  assert.equal(refine({ ...base, body: base.body + ' An active security clearance is required.' }, co), null);
});
t('flags J-1-friendly framing', () => {
  const j = refine({ ...base, body: base.body + ' This is an 18-month rotational training program.' }, co);
  assert.ok(j.j1Friendly);
});
t('plain posting is not flagged J-1-friendly', () => {
  assert.equal(refine({ ...base }, co).j1Friendly, false);
});
t('uses the Ashby salary hint', () => {
  const j = refine({ ...base, body: 'No numbers here.', salaryHint: '$180K – $220K • Offers Equity' }, co);
  assert.equal(j.salaryMin, 180000); assert.equal(j.salaryMax, 220000);
});

console.log('\nWorkday relative dates');
t('Posted Today', () => assert.ok(parseWorkdayPosted('Posted Today').startsWith(new Date().toISOString().slice(0, 10))));
t('Posted 5 Days Ago', () => {
  const d = new Date(parseWorkdayPosted('Posted 5 Days Ago'));
  assert.equal(Math.round((Date.now() - d) / 864e5), 5);
});
t('unparseable -> null', () => assert.equal(parseWorkdayPosted('whenever'), null));

console.log('\npay benchmarks');
t('reads grade off the title', () => {
  assert.equal(seniorityLevel('Restructuring Analyst'), 'analyst');
  assert.equal(seniorityLevel('Senior Associate, TAS'), 'senior_associate');
  assert.equal(seniorityLevel('M&A Associate'), 'associate');
  assert.equal(seniorityLevel('Head of Widgets'), 'other');
});
t('medians by category and grade', () => {
  const jobs = [
    { category: 'ib', level: 'associate', salaryMin: 150000, salaryMax: 200000 },
    { category: 'ib', level: 'associate', salaryMin: 160000, salaryMax: 220000 },
    { category: 'ib', level: 'associate', salaryMin: 140000, salaryMax: 180000 },
  ];
  const b = benchmarkSalaries(jobs);
  assert.equal(b['ib|associate'].samples, 3);
  assert.equal(b['ib|associate'].median, 175000);   // midpoints 160/175/190
});
t('admits an unpriced role when comparables clear the floor', () => {
  const b = { 'ib|associate': { median: 190000, samples: 4, low: 150000, high: 250000 } };
  const est = inferSalary({ category: 'ib', level: 'associate' }, b);
  assert.ok(est); assert.equal(est.median, 190000);
});
t('refuses when comparables sit below the floor', () => {
  const b = { 'sales_bd|analyst': { median: 80000, samples: 5 } };
  assert.equal(inferSalary({ category: 'sales_bd', level: 'analyst' }, b), null);
});
t('refuses on too few comparables', () => {
  const b = { 'ib|analyst': { median: 200000, samples: 2 } };
  assert.equal(inferSalary({ category: 'ib', level: 'analyst' }, b), null);
});
t('refuses when there is no comparable bucket at all', () => {
  assert.equal(inferSalary({ category: 'vc', level: 'analyst' }, {}), null);
});

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
