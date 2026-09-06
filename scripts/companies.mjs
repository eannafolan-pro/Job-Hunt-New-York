// Job boards to poll. Each entry resolves to a public, key-less JSON endpoint.
//
// NOTE: board tokens are best-effort. Companies rename or migrate boards, so
// every run writes a health report to data/jobs.json -> `sources`, and the site
// surfaces it under "Sources". Prune anything that reports `ok: false` twice.

export const COMPANIES = [
  // ---------- Greenhouse (boards-api.greenhouse.io) ----------
  // NYC fintech / financial services
  { name: 'Brex', ats: 'greenhouse', token: 'brex' },
  { name: 'Betterment', ats: 'greenhouse', token: 'betterment' },
  { name: 'Chime', ats: 'greenhouse', token: 'chime' },
  { name: 'Affirm', ats: 'greenhouse', token: 'affirm' },
  { name: 'Carta', ats: 'greenhouse', token: 'carta' },
  { name: 'Clear Street', ats: 'greenhouse', token: 'clearstreet' },
  { name: 'Alloy', ats: 'greenhouse', token: 'alloy' },
  { name: 'iCapital', ats: 'greenhouse', token: 'icapitalnetwork' },
  { name: 'SoFi', ats: 'greenhouse', token: 'sofi' },
  { name: 'Robinhood', ats: 'greenhouse', token: 'robinhood' },
  { name: 'Coinbase', ats: 'greenhouse', token: 'coinbase' },
  { name: 'Gemini', ats: 'greenhouse', token: 'gemini' },
  { name: 'Fireblocks', ats: 'greenhouse', token: 'fireblocks' },
  { name: 'Vestwell', ats: 'greenhouse', token: 'vestwell' },
  { name: 'Ethic', ats: 'greenhouse', token: 'ethic' },
  { name: 'Point72', ats: 'greenhouse', token: 'point72' },

  // NYC tech with sizeable finance / strategy / sales orgs
  { name: 'Datadog', ats: 'greenhouse', token: 'datadog' },
  { name: 'MongoDB', ats: 'greenhouse', token: 'mongodb' },
  { name: 'Squarespace', ats: 'greenhouse', token: 'squarespace' },
  { name: 'Oscar Health', ats: 'greenhouse', token: 'oscar' },
  { name: 'Peloton', ats: 'greenhouse', token: 'peloton' },
  { name: 'SeatGeek', ats: 'greenhouse', token: 'seatgeek' },
  { name: 'Yext', ats: 'greenhouse', token: 'yext' },
  { name: 'Braze', ats: 'greenhouse', token: 'braze' },
  { name: 'Attentive', ats: 'greenhouse', token: 'attentive' },
  { name: 'Movable Ink', ats: 'greenhouse', token: 'movableink' },
  { name: 'Justworks', ats: 'greenhouse', token: 'justworks' },
  { name: 'Bombas', ats: 'greenhouse', token: 'bombas' },
  { name: 'Dataiku', ats: 'greenhouse', token: 'dataiku' },
  { name: 'Celonis', ats: 'greenhouse', token: 'celonis' },
  { name: 'Flatiron Health', ats: 'greenhouse', token: 'flatironhealth' },

  // ---------- Lever (api.lever.co) ----------
  { name: 'Kraken', ats: 'lever', token: 'kraken' },
  { name: 'Varo Bank', ats: 'lever', token: 'varomoney' },
  { name: 'Fundrise', ats: 'lever', token: 'fundrise' },

  // ---------- Ashby (api.ashbyhq.com) ----------
  { name: 'Mercury', ats: 'ashby', token: 'mercury' },
  { name: 'Vanta', ats: 'ashby', token: 'vanta' },
  { name: 'Deel', ats: 'ashby', token: 'deel' },
  { name: 'OpenAI', ats: 'ashby', token: 'openai' },
  { name: 'Ramp', ats: 'ashby', token: 'ramp' },

  // ---------- SmartRecruiters (api.smartrecruiters.com) ----------
  { name: 'Visa', ats: 'smartrecruiters', token: 'Visa' },
  { name: 'Publicis Groupe', ats: 'smartrecruiters', token: 'PublicisGroupe' },
  { name: 'WPP', ats: 'smartrecruiters', token: 'WPP' },

  // ---------- Workday (traditional finance / advisory) ----------
  // Tenant + site paths are the least stable of the five adapters; expect some
  // of these to need correcting after the first live run.

  // ---------- Investment banking, VC, PE and asset managers ----------
  // Added for the IB/VC priority lanes. Tokens are unverified guesses: the
  // bulge brackets and elite boutiques (GS, JPM, MS, Evercore, Moelis, PJT,
  // Centerview, Lazard) run Workday or proprietary portals with no public JSON
  // API, so they cannot be polled here at all. What follows is the subset of
  // the buy side and mid-market that does tend to use a public ATS. Expect a
  // high failure rate on the first run and prune from the health report.
  { name: 'Insight Partners', ats: 'greenhouse', token: 'insightpartners' },
  { name: 'General Catalyst', ats: 'greenhouse', token: 'generalcatalyst' },
  { name: 'Bessemer Venture Partners', ats: 'greenhouse', token: 'bessemerventurepartners' },
  { name: 'Battery Ventures', ats: 'greenhouse', token: 'batteryventures' },
  { name: 'Index Ventures', ats: 'greenhouse', token: 'indexventures' },
  { name: 'Union Square Ventures', ats: 'greenhouse', token: 'unionsquareventures' },
  { name: 'FirstMark Capital', ats: 'greenhouse', token: 'firstmarkcapital' },
  { name: 'Lerer Hippeau', ats: 'greenhouse', token: 'lererhippeau' },
  { name: 'Greycroft', ats: 'greenhouse', token: 'greycroft' },
  { name: 'Primary Venture Partners', ats: 'greenhouse', token: 'primaryventurepartners' },
  { name: 'RRE Ventures', ats: 'greenhouse', token: 'rreventures' },
  { name: 'Tiger Global', ats: 'greenhouse', token: 'tigerglobalmanagement' },
  { name: 'Coatue', ats: 'greenhouse', token: 'coatuemanagement' },
  { name: 'Thrive Capital', ats: 'greenhouse', token: 'thrivecapital' },
  { name: 'Ares Management', ats: 'greenhouse', token: 'aresmanagement' },
  { name: 'Blue Owl Capital', ats: 'greenhouse', token: 'blueowlcapital' },
  { name: 'Sixth Street', ats: 'greenhouse', token: 'sixthstreet' },
  { name: 'Golub Capital', ats: 'greenhouse', token: 'golubcapital' },
  { name: 'Hamilton Lane', ats: 'greenhouse', token: 'hamiltonlane' },
  { name: 'StepStone Group', ats: 'greenhouse', token: 'stepstonegroup' },
  { name: 'Cambridge Associates', ats: 'greenhouse', token: 'cambridgeassociates' },
  { name: 'Bridgepoint', ats: 'greenhouse', token: 'bridgepoint' },
  { name: 'Lincoln International', ats: 'greenhouse', token: 'lincolninternational' },
  { name: 'Perella Weinberg', ats: 'greenhouse', token: 'perellaweinbergpartners' },
  { name: 'Solomon Partners', ats: 'greenhouse', token: 'solomonpartners' },
  { name: 'Union Square Advisors', ats: 'greenhouse', token: 'unionsquareadvisors' },
  { name: 'Cowen', ats: 'greenhouse', token: 'cowen' },
  { name: 'Oppenheimer', ats: 'greenhouse', token: 'oppenheimer' },
  { name: 'B. Riley', ats: 'greenhouse', token: 'brileyfinancial' },
  { name: 'Canaccord Genuity', ats: 'greenhouse', token: 'canaccordgenuity' },
  { name: 'Antares Capital', ats: 'greenhouse', token: 'antarescapital' },
  { name: 'Angelo Gordon', ats: 'greenhouse', token: 'angelogordon' },
  { name: 'Marathon Asset Management', ats: 'greenhouse', token: 'marathonassetmanagement' },
  { name: 'Man Group', ats: 'greenhouse', token: 'mangroup' },
  { name: 'Schonfeld', ats: 'greenhouse', token: 'schonfeld' },
  { name: 'Jane Street', ats: 'greenhouse', token: 'janestreet' },
  { name: 'Sculptor Capital', ats: 'lever', token: 'sculptor' },
  { name: 'Corsair Capital', ats: 'lever', token: 'corsair' },
  { name: 'Bain Capital Ventures', ats: 'ashby', token: 'baincapitalventures' },
  { name: 'Andreessen Horowitz', ats: 'ashby', token: 'a16z' },
];
