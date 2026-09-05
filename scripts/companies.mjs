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
];
