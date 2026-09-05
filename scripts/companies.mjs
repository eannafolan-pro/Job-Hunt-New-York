// Job boards to poll. Each entry resolves to a public, key-less JSON endpoint.
//
// NOTE: board tokens are best-effort. Companies rename or migrate boards, so
// every run writes a health report to data/jobs.json -> `sources`, and the site
// surfaces it under "Sources". Prune anything that reports `ok: false` twice.

export const COMPANIES = [
  // ---------- Greenhouse (boards-api.greenhouse.io) ----------
  // NYC fintech / financial services
  { name: 'Ramp', ats: 'greenhouse', token: 'ramp' },
  { name: 'Brex', ats: 'greenhouse', token: 'brex' },
  { name: 'Plaid', ats: 'greenhouse', token: 'plaid' },
  { name: 'Betterment', ats: 'greenhouse', token: 'betterment' },
  { name: 'Chime', ats: 'greenhouse', token: 'chime' },
  { name: 'Affirm', ats: 'greenhouse', token: 'affirm' },
  { name: 'Marqeta', ats: 'greenhouse', token: 'marqeta' },
  { name: 'Carta', ats: 'greenhouse', token: 'carta' },
  { name: 'Addepar', ats: 'greenhouse', token: 'addepar' },
  { name: 'Clear Street', ats: 'greenhouse', token: 'clearstreet' },
  { name: 'Modern Treasury', ats: 'greenhouse', token: 'moderntreasury' },
  { name: 'Alloy', ats: 'greenhouse', token: 'alloy' },
  { name: 'Rho', ats: 'greenhouse', token: 'rho' },
  { name: 'iCapital', ats: 'greenhouse', token: 'icapitalnetwork' },
  { name: 'SoFi', ats: 'greenhouse', token: 'sofi' },
  { name: 'Robinhood', ats: 'greenhouse', token: 'robinhood' },
  { name: 'Coinbase', ats: 'greenhouse', token: 'coinbase' },
  { name: 'Gemini', ats: 'greenhouse', token: 'gemini' },
  { name: 'Paxos', ats: 'greenhouse', token: 'paxos' },
  { name: 'Fireblocks', ats: 'greenhouse', token: 'fireblocks' },
  { name: 'Chainalysis', ats: 'greenhouse', token: 'chainalysis' },
  { name: 'Vestwell', ats: 'greenhouse', token: 'vestwell' },
  { name: 'Ethic', ats: 'greenhouse', token: 'ethic' },
  { name: 'Stash', ats: 'greenhouse', token: 'stash' },
  { name: 'Petal', ats: 'greenhouse', token: 'petal' },
  { name: 'Unit', ats: 'greenhouse', token: 'unit' },
  { name: 'Point72', ats: 'greenhouse', token: 'point72' },
  { name: 'Bridgewater', ats: 'greenhouse', token: 'bridgewaterassociates' },
  { name: 'Balyasny', ats: 'greenhouse', token: 'balyasnyassetmanagement' },
  { name: 'Millennium', ats: 'greenhouse', token: 'millennium' },

  // NYC tech with sizeable finance / strategy / sales orgs
  { name: 'Datadog', ats: 'greenhouse', token: 'datadog' },
  { name: 'MongoDB', ats: 'greenhouse', token: 'mongodb' },
  { name: 'Squarespace', ats: 'greenhouse', token: 'squarespace' },
  { name: 'Etsy', ats: 'greenhouse', token: 'etsy' },
  { name: 'Warby Parker', ats: 'greenhouse', token: 'warbyparker' },
  { name: 'Oscar Health', ats: 'greenhouse', token: 'oscar' },
  { name: 'Peloton', ats: 'greenhouse', token: 'peloton' },
  { name: 'SeatGeek', ats: 'greenhouse', token: 'seatgeek' },
  { name: 'Vimeo', ats: 'greenhouse', token: 'vimeo' },
  { name: 'Yext', ats: 'greenhouse', token: 'yext' },
  { name: 'Braze', ats: 'greenhouse', token: 'braze' },
  { name: 'Attentive', ats: 'greenhouse', token: 'attentive' },
  { name: 'Movable Ink', ats: 'greenhouse', token: 'movableink' },
  { name: 'Dataminr', ats: 'greenhouse', token: 'dataminr' },
  { name: 'Justworks', ats: 'greenhouse', token: 'justworks' },
  { name: 'Lemonade', ats: 'greenhouse', token: 'lemonade' },
  { name: 'Cedar', ats: 'greenhouse', token: 'cedar' },
  { name: 'Ro', ats: 'greenhouse', token: 'ro' },
  { name: 'Bombas', ats: 'greenhouse', token: 'bombas' },
  { name: 'Dataiku', ats: 'greenhouse', token: 'dataiku' },
  { name: 'Celonis', ats: 'greenhouse', token: 'celonis' },
  { name: 'Sisense', ats: 'greenhouse', token: 'sisense' },
  { name: 'Flatiron Health', ats: 'greenhouse', token: 'flatironhealth' },
  { name: 'Capital One', ats: 'greenhouse', token: 'capitalone' },
  { name: 'Bloomberg Industry', ats: 'greenhouse', token: 'bloombergindustrygroup' },

  // ---------- Lever (api.lever.co) ----------
  { name: 'NerdWallet', ats: 'lever', token: 'nerdwallet' },
  { name: 'Kraken', ats: 'lever', token: 'kraken' },
  { name: 'Sardine', ats: 'lever', token: 'sardine' },
  { name: 'Varo Bank', ats: 'lever', token: 'varomoney' },
  { name: 'Bilt Rewards', ats: 'lever', token: 'biltrewards' },
  { name: 'Fundrise', ats: 'lever', token: 'fundrise' },

  // ---------- Ashby (api.ashbyhq.com) ----------
  { name: 'Mercury', ats: 'ashby', token: 'mercury' },
  { name: 'Vanta', ats: 'ashby', token: 'vanta' },
  { name: 'Deel', ats: 'ashby', token: 'deel' },
  { name: 'Anthropic', ats: 'ashby', token: 'anthropic' },
  { name: 'OpenAI', ats: 'ashby', token: 'openai' },
  { name: 'Scale AI', ats: 'ashby', token: 'scaleai' },
  { name: 'Runway', ats: 'ashby', token: 'runwayml' },
  { name: 'Ramp (Ashby)', ats: 'ashby', token: 'ramp' },

  // ---------- SmartRecruiters (api.smartrecruiters.com) ----------
  { name: 'Visa', ats: 'smartrecruiters', token: 'Visa' },
  { name: 'Publicis Groupe', ats: 'smartrecruiters', token: 'PublicisGroupe' },
  { name: 'WPP', ats: 'smartrecruiters', token: 'WPP' },

  // ---------- Workday (traditional finance / advisory) ----------
  // Tenant + site paths are the least stable of the five adapters; expect some
  // of these to need correcting after the first live run.
  { name: 'Alvarez & Marsal', ats: 'workday', host: 'alvarezandmarsal.wd1.myworkdayjobs.com', tenant: 'alvarezandmarsal', site: 'AAMExternal' },
  { name: 'FTI Consulting', ats: 'workday', host: 'fticonsulting.wd1.myworkdayjobs.com', tenant: 'fticonsulting', site: 'FTIConsulting' },
  { name: 'AlixPartners', ats: 'workday', host: 'alixpartners.wd1.myworkdayjobs.com', tenant: 'alixpartners', site: 'AlixPartners' },
  { name: 'Jefferies', ats: 'workday', host: 'jefferies.wd1.myworkdayjobs.com', tenant: 'jefferies', site: 'Jefferies_Careers' },
  { name: 'Houlihan Lokey', ats: 'workday', host: 'hl.wd1.myworkdayjobs.com', tenant: 'hl', site: 'HL_External' },
  { name: 'Lazard', ats: 'workday', host: 'lazard.wd1.myworkdayjobs.com', tenant: 'lazard', site: 'Lazard_Careers' },
  { name: 'Evercore', ats: 'workday', host: 'evercore.wd1.myworkdayjobs.com', tenant: 'evercore', site: 'Evercore_Careers' },
  { name: 'Guggenheim', ats: 'workday', host: 'guggenheimpartners.wd1.myworkdayjobs.com', tenant: 'guggenheimpartners', site: 'GuggenheimCareers' },
  { name: 'Nomura', ats: 'workday', host: 'nomura.wd3.myworkdayjobs.com', tenant: 'nomura', site: 'Nomura_Careers' },
  { name: 'Macquarie', ats: 'workday', host: 'macquarie.wd3.myworkdayjobs.com', tenant: 'macquarie', site: 'Macquarie_Careers' },
];
