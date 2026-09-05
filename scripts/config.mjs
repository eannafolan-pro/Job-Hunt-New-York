// Search criteria for the NYC job calendar.
// Tuned to: ~2 yrs post-grad, restructuring/turnaround + M&A background,
// targeting analyst -> associate / senior analyst roles in NYC.

export const SALARY_FLOOR = 100_000;

// A posting must look like it is in New York City.
export const NYC_PATTERNS = [
  /new york/i,
  /\bnyc\b/i,
  /manhattan/i,
  /brooklyn/i,
  /\bny\b(?!\s*[a-z])/i,
  /us-ny/i,
];

// Explicitly not New York even though the string mentions "New York".
export const NOT_NYC_PATTERNS = [
  /new york state office/i,
  /upstate new york/i,
  /albany/i,
  /buffalo/i,
  /rochester/i,
  /syracuse/i,
];

// Roles are bucketed into these three lanes. Order matters: first match wins.
export const CATEGORIES = [
  {
    id: 'finance',
    label: 'Finance & Deals',
    patterns: [
      /restructuring/i, /turnaround/i, /distressed/i, /insolvency/i, /liquidation/i,
      /investment bank/i, /\bm&a\b/i, /mergers/i, /acquisitions/i,
      /corporate development/i, /corp dev/i, /transaction (advisory|services)/i,
      /valuation/i, /due diligence/i, /deal (team|desk)/i,
      /financial analyst/i, /finance analyst/i, /\bfp&a\b/i, /financial planning/i,
      /strategic finance/i, /treasury/i, /controller/i, /accounting/i, /accountant/i,
      /private (equity|credit)/i, /credit analyst/i, /underwrit/i,
      /equity research/i, /capital markets/i, /investor relations/i,
      /portfolio (analyst|associate|manager)/i, /asset management/i,
      /financial (reporting|operations|crime)/i, /\brevenue accounting/i,
    ],
  },
  {
    id: 'sales_bd',
    label: 'Sales & BD',
    patterns: [
      /account executive/i, /\bsales\b/i, /business development/i, /\bbd\b/i,
      /partnerships/i, /relationship manager/i, /account manager/i,
      /client (success|services|partner|solutions)/i, /customer success/i,
      /sales development/i, /\bsdr\b/i, /\bbdr\b/i, /go.to.market/i, /\bgtm\b/i,
      /revenue (lead|associate)/i, /commercial (analyst|associate)/i,
    ],
  },
  {
    id: 'ops_strategy',
    label: 'Strategy & Ops',
    patterns: [
      /strategy/i, /strategic (initiatives|projects)/i, /chief of staff/i,
      /business operations/i, /bizops/i, /revenue operations/i, /\brevops\b/i,
      /sales operations/i, /operations (analyst|associate|manager|specialist)/i,
      /program manager/i, /project manager/i, /consultant/i, /consulting/i,
      /business analyst/i, /\bbusiness intelligence/i, /analytics (analyst|associate)/i,
      /special projects/i, /corporate strategy/i,
    ],
  },
];

// Hard excludes. Anything matching these is dropped regardless of category.
export const EXCLUDE_TITLE = [
  // Quant — explicitly not wanted.
  /quantitative/i, /\bquant\b/i, /algorithmic trading/i, /\bhft\b/i,
  // Too senior for a ~2yr analyst.
  /\bvp\b/i, /vice president/i, /\bsvp\b/i, /\bevp\b/i,
  /\bdirector\b/i, /head of/i, /\bchief\b/i, /managing director/i, /\bmd\b,/i,
  /senior manager/i, /\bprincipal\b/i, /\bpartner\b(?!ships)/i, /\bexecutive\b(?! assistant)/i,
  /\blead\b(?!s)/i, /\bstaff\b/i,
  // Too junior / wrong shape.
  /\bintern\b/i, /internship/i, /co.?op\b/i, /apprentice/i,
  /summer (analyst|associate|program)/i, /\bnew grad\b/i, /campus/i,
  // Wrong discipline — engineering-heavy roles that trip the analytics keywords.
  /software engineer/i, /\bdeveloper\b/i, /data engineer/i, /machine learning/i,
  /\bdevops\b/i, /site reliability/i, /security engineer/i, /\bdesigner\b/i,
  /recruiter/i, /\bnurse\b/i, /\battorney\b/i, /\bcounsel\b/i,
];

// ---------------------------------------------------------------- visa
//
// Target status: J-1 Trainee (Irish citizen, EY-Parthenon experience -> meets
// the degree + 1 year relevant non-US experience requirement; 18 month max).
//
// On a J-1 the VISA SPONSOR is a designated third-party organisation (Cultural
// Vistas, InterExchange, Intrax...), not the employer. The employer is a "host
// company" that signs the DS-7002 training plan. So boilerplate like "we do not
// sponsor visas" — which almost always means "no H-1B" — is a soft signal worth
// flagging, not a disqualification. These get tagged, not dropped.
export const NO_SPONSORSHIP_PATTERNS = [
  /(unable|not able|do not|does not|will not|cannot|can't|won't|are not)\b[^.]{0,30}\bsponsor/i,
  /not (provide|offer|support|eligible)\b[^.]{0,30}sponsor/i,
  /\bno\b[^.]{0,20}\b(visa )?sponsorship/i,
  /without (the need for )?(visa |immigration )?sponsorship/i,
  /sponsorship (is|will) not be? ?(available|offered|provided|considered)/i,
  /not (currently )?(sponsoring|considering).{0,30}(visa|sponsorship)/i,
  /must be (legally )?authori[sz]ed to work in the (u\.?s\.?|united states)[^.]{0,80}without/i,
];

// These ARE hard blocks for a J-1 holder — no third-party sponsor gets you past
// a citizenship, green-card or clearance requirement. Dropped outright.
export const CITIZENSHIP_BLOCK_PATTERNS = [
  /must be a (u\.?s\.?|united states) citizen/i,
  /(u\.?s\.?) citizenship (is )?(is )?required/i,
  /require[sd]? (u\.?s\.?|united states) citizenship/i,
  /citizens? only/i,
  /\bu\.?s\.? person(s)? (only|status required)/i,
  /permanent resident(s)? only/i,
  /green card holder(s)? only/i,
  /(active |current )?(security|government) clearance/i,
  /\b(ts\/sci|top secret|secret clearance)\b/i,
  /finra (registration|licensed).{0,40}required.{0,40}(citizen|permanent)/i,
];

// J-1 trainee placements need a host company willing to sign a DS-7002 training
// plan for a fixed term. Roles already framed as programmes/rotations/contract
// terms are structurally the easiest fit, so surface them.
export const J1_FRIENDLY_PATTERNS = [
  /training (programme|program)/i, /rotational/i, /rotation programme|rotation program/i,
  /graduate (programme|program|scheme)/i, /\b(12|18|24).month\b/i,
  /fixed.term/i, /\bsecondment\b/i, /international (assignment|mobility)/i,
  /\bj-?1\b/i, /visa sponsorship (available|provided|offered)/i,
  /we sponsor/i, /will sponsor/i,
];

// Roles that read as an especially strong match for this background.
export const STRONG_MATCH_PATTERNS = [
  /restructuring/i, /turnaround/i, /distressed/i, /special situations/i,
  /\bm&a\b/i, /mergers/i, /corporate development/i, /corp dev/i,
  /transaction (advisory|services)/i, /valuation/i,
  /\bfp&a\b/i, /strategic finance/i, /financial analyst/i,
  /investment bank/i, /private credit/i, /due diligence/i,
];
