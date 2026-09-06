// Search criteria for the NYC job calendar.
// Tuned to: ~2 yrs post-grad (EY-Parthenon restructuring + EssilorLuxottica M&A),
// targeting ANALYST / ASSOCIATE level only. Investment banking and venture
// capital are the priority lanes; everything else is secondary.

// A posting is placed on the calendar this many days after it went live, as an
// "apply by" date. Postings in this market are typically filled or closed
// within about three weeks, so this is the practical deadline to act on.
export const APPLY_WINDOW_DAYS = 21;

// Hard cutoff on how old a posting may be. Anything first published longer ago
// than this is dropped outright, however live the board still says it is —
// a months-old listing is either an evergreen requisition or already filled.
export const MAX_POSTING_AGE_DAYS = 21;

export const SALARY_FLOOR = 100_000;

// Which end of the posted range must clear SALARY_FLOOR.
//   'min' — the bottom of the range (strict: a $85k-$105k role is not a $100k job)
//   'max' — the top of the range (loose: keeps wide ranges that top out high)
//   'mid' — the midpoint
// The first live scrape returned $85k-$105k SDR roles under 'max'; 'mid' drops
// those while keeping wide-but-real ranges like a $90k-$130k strategy associate.
export const SALARY_BASIS = 'mid';

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

// Roles are bucketed into these lanes. Order matters: first match wins, so the
// two priority lanes are declared first and win any overlap.
export const CATEGORIES = [
  {
    id: 'ib',
    label: 'Investment Banking',
    priority: true,
    patterns: [
      /investment bank/i, /\bibd\b/i, /\bm&a\b/i, /mergers and acquisitions/i,
      /restructuring/i, /turnaround/i, /distressed/i, /special situations/i,
      /capital markets/i, /\becm\b/i, /\bdcm\b/i, /equity capital markets/i,
      /debt capital markets/i, /leveraged finance/i, /\blevfin\b/i,
      /financial sponsors/i, /sponsor coverage/i, /coverage (analyst|associate)/i,
      /debt advisory/i, /sell.?side/i, /\bunderwriting\b/i,
      // Insolvency vocabulary from the target list — the exact work at
      // EY-Parthenon (receiverships, liquidations, asset disposals).
      /insolvency/i, /receivership/i, /\bworkout\b/i, /recoveries/i,
      /liquidation/i, /administration(s)? (analyst|associate)/i,
      /business recovery/i, /performance improvement/i, /transaction services/i,
      /\bcreditor\b/i, /\bdebtor\b/i, /chapter 11/i, /liability management/i,
      /corporate finance (analyst|associate)/i, /transaction (advisory|services)/i,
      /valuation (analyst|associate|services)/i, /due diligence (analyst|associate)/i,
      /deal (advisory|execution)/i, /merchant bank/i,
    ],
  },
  {
    id: 'vc',
    label: 'VC & Investing',
    priority: true,
    patterns: [
      /venture capital/i, /\bventure\b/i, /growth equity/i, /private equity/i,
      /private credit/i, /\bbuyout\b/i, /principal investing/i, /direct investing/i,
      /investment (analyst|associate|professional|team)/i,
      /investing (analyst|associate)/i, /\binvestments?\b.{0,12}(analyst|associate)/i,
      /deal (team|flow|sourcing)/i, /sourcing (analyst|associate)/i,
      /portfolio (operations|company|analyst|associate)/i,
      /platform (analyst|associate)/i, /fund (analyst|associate)/i,
      /\blp\b relations/i, /investor relations (analyst|associate)/i,
      /research (analyst|associate).{0,20}(equity|credit|investment)/i,
      /equity research/i, /credit (analyst|associate|research)/i,
      /asset management (analyst|associate)/i, /hedge fund/i,
    ],
  },
  {
    id: 'finance',
    label: 'Corporate Finance',
    patterns: [
      /financial analyst/i, /finance analyst/i, /\bfp&a\b/i, /financial planning/i,
      /strategic finance/i, /corporate development/i, /corp dev/i,
      /treasury/i, /accounting/i, /accountant/i, /financial reporting/i,
      /credit risk/i, /securities lending/i, /\bvaluation\b/i,
    ],
  },
  {
    id: 'ops_strategy',
    label: 'Strategy & Ops',
    patterns: [
      /strategy/i, /strategic (initiatives|projects)/i, /chief of staff/i,
      /business operations/i, /bizops/i, /corporate strategy/i,
      /operations (analyst|associate)/i, /business analyst/i,
      /consultant/i, /consulting/i, /special projects/i,
    ],
  },
  {
    id: 'sales_bd',
    label: 'Sales & BD',
    patterns: [
      /account executive/i, /\bsales\b/i, /business development/i,
      /partnerships/i, /relationship manager/i, /account manager/i,
      /client (success|services|partner|solutions)/i, /customer success/i,
    ],
  },
];

// Hard excludes. Anything matching these is dropped regardless of category.
export const EXCLUDE_TITLE = [
  // Quant — explicitly not wanted.
  /quantitative/i, /\bquant\b/i, /algorithmic trading/i, /\bhft\b/i,
  // Too senior. At ~2 years the target is Analyst / Associate / Senior Analyst,
  // so anything carrying people-management or ownership language is out —
  // "Manager" included, which the live data showed slipping through as
  // "Manager, Accounting" and "Portfolio Manager".
  /\bvp\b/i, /vice president/i, /\bsvp\b/i, /\bevp\b/i,
  /\bdirector\b/i, /head of/i, /\bchief\b/i, /managing director/i, /\bmd\b,/i,
  /\bmanager\b/i, /\bmanagement\b(?! (consultant|analyst|associate))/i,
  /\bprincipal\b/i, /\bpartner\b(?!ships)/i, /\bexecutive\b(?! assistant)/i,
  /\blead\b(?!s)/i, /\bstaff\b/i, /\bsenior manager\b/i,
  // Too junior / wrong shape.
  /\bintern\b/i, /internship/i, /co.?op\b/i, /apprentice/i,
  /summer (analyst|associate|program)/i, /\bnew grad\b/i, /campus/i,
  // Wrong discipline. The live run showed the analytics/GTM keywords pulling in
  // technical and marketing roles ("GTM Business Systems Engineer", "Treasury
  // Application Support Engineer", "Senior Growth Marketing Manager"), so these
  // are broader than they first look.
  /\bengineer(ing)?\b/i, /\bdeveloper\b/i, /machine learning/i, /\bdevops\b/i,
  /\bproduct (manager|operations|owner|lead)\b/i, /\bgtm\b/i,
  /site reliability/i, /\bdesigner\b/i, /\barchitect\b/i, /\bscientist\b/i,
  /\btechnician\b/i, /administrator/i, /business systems/i, /systems analyst/i,
  /solutions consultant/i, /\bsupport\b/i, /\bqa\b/i, /\bux\b/i, /\bui\b/i,
  // Marketing was not one of the selected lanes.
  /\bmarketing\b/i, /\bbrand\b/i, /\bcontent\b/i, /\bsocial media\b/i,
  /\bcommunications\b/i, /\bcreative\b/i,
  // Other functions that share vocabulary with the target lanes.
  /recruit(er|ing)/i, /\bnurse\b/i, /\battorney\b/i, /\bcounsel\b/i,
  /\bpeople\b/i, /\bhr\b/i, /human resources/i, /\bpayroll\b/i,
];

// ---------------------------------------------------------------- visa
//
// Set: treat the applicant as fully work-authorised in the US. Nothing is
// dropped or flagged on visa grounds, and the patterns below go unused. Flip to
// false to restore the J-1 handling described underneath.
export const ASSUME_WORK_AUTHORIZED = true;
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
