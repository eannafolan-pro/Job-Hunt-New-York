# NYC Job Calendar

A single-page, self-updating calendar of high-paying New York City roles in
**finance & deals**, **sales & BD**, and **strategy & ops**. Jobs are plotted on
the day they were posted, with fresher postings shown brighter.

## How it updates itself

A GitHub Actions workflow runs **every 6 hours**, polls ~40 public company job
boards, filters them, and commits the result to `data/jobs.json`. The page just
reads that file — there is no server, no database and no API key anywhere.

```
.github/workflows/update-jobs.yml   schedule -> scrape -> commit -> deploy Pages
scripts/fetch-jobs.mjs              the scraper (5 ATS adapters)
scripts/companies.mjs               which boards to poll
scripts/config.mjs                  search criteria: salary floor, roles, visa rules
scripts/test-parsing.mjs            unit tests, run in CI before every scrape
data/jobs.json                      generated output — do not edit by hand
index.html + assets/                the page
```

Supported job-board platforms: **Greenhouse**, **Lever**, **Ashby**,
**SmartRecruiters** and **Workday**. All five expose public JSON endpoints.

## Filters applied

A posting is kept only if it clears every one of these:

| Filter | Rule |
|---|---|
| Location | Must be New York City (upstate NY excluded) |
| Salary | Midpoint of the posted range ≥ **$100,000** (set `SALARY_BASIS` in `scripts/config.mjs` to `min`/`max` to tighten or loosen) |
| Category | Matches finance & deals, sales & BD, or strategy & ops |
| Seniority | Analyst → Associate → Manager. VP+, Director+ and internships dropped |
| Discipline | Quant, engineering, product, marketing, HR, design, legal and clinical roles dropped |
| Visa | Roles requiring US citizenship or a security clearance dropped |

NYC's pay-transparency law requires a salary range in the posting, which is what
makes the salary floor enforceable.

### Visa handling (J-1 trainee)

The target status is a **J-1 trainee visa**. On a J-1 the visa sponsor is a
designated third-party organisation (Cultural Vistas, InterExchange, Intrax…),
**not** the employer — the employer is a host company that signs the DS-7002
training plan.

So the two visa signals are treated differently:

- **"We do not sponsor visas"** → *flagged, not dropped.* That boilerplate almost
  always means "no H-1B", which is a different question. Worth asking about.
- **US citizenship / green card / security clearance required** → *dropped.* No
  third-party sponsor gets past that.

Roles that look structurally J-1-friendly (training programmes, rotations, fixed
terms, explicit sponsorship) get a **J-1 friendly** tag and their own filter.

## Using the page

- **Last 6 weeks** is the default view — a rolling window of recent postings.
  Switch to **By month** to page through history.
- Colour = category. Gold outline = strong match for a restructuring / M&A /
  financial-analysis background. Chips fade as postings age.
- Filter by salary, category, strong match, J-1 friendliness or saved roles.
- Star a role to save it and mark ones you've applied to. This is stored in your
  browser only (`localStorage`), so it stays private and doesn't sync.
- **Job board health** at the bottom shows which boards responded on the last run.

## Setup

1. Push this branch and merge it to `main`.
2. Repo **Settings → Pages → Source: GitHub Actions**.
3. **Actions** tab → *Update NYC jobs* → **Run workflow** to populate it now
   rather than waiting for the next 6-hourly run.

If you keep the site on a branch other than `main`, change `SITE_BRANCH` at the
top of `.github/workflows/update-jobs.yml` to match.

## Maintaining the board list

Company board tokens change when companies migrate ATS providers. Every run
writes a per-board health report into `data/jobs.json` and the workflow summary.
If a board reports `ok: false` on two consecutive runs, fix or remove its entry
in `scripts/companies.mjs`.

The first live run started from 82 guessed boards; 40 returned 404/422 and were
removed, leaving 42 confirmed-working boards. The removed set was mostly
companies that have since migrated ATS (Ramp, for instance, is on Ashby, not
Greenhouse) plus the Workday tenants, whose tenant/site paths are not guessable.
To add a company back, look up its real careers URL and add the token.

To add a company, find its public board and add one line:

```js
{ name: 'Example Co', ats: 'greenhouse', token: 'exampleco' },
```

The token is the last path segment of `job-boards.greenhouse.io/<token>`,
`jobs.lever.co/<token>` or `jobs.ashbyhq.com/<token>`.

## Running locally

```bash
npm test        # unit tests for the filtering and salary parsing
npm run fetch   # scrape now, writes data/jobs.json
npm run serve   # http://localhost:8080
```
