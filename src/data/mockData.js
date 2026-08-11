// Mock Data — Distributor Admin Dashboard, Universal Pensions Uganda
// Hierarchy: Country → 4 Regions → 135 Districts → ~314 Branches → ~2,000 Agents → ~30,000 Subscribers
//
// Static catalogues (the 135 GADM districts and the ~314 branch definitions)
// have been extracted to sibling files for navigability. They re-export
// straight back through this file so existing consumers keep working.

import { DISTRICTS } from './mockGeo';
import { BRANCH_DEFS } from './mockBranchDefs';

// Re-exports so any service file still importing DISTRICTS from mockData
// keeps resolving without changes.
export { DISTRICTS };

// ─── Reference "now" ─────────────────────────────────────────────────────────
// Mock dates (registeredDate, dueDate, paidDate, contribution history, etc.)
// are generated relative to this fixed point so demo data stays internally
// consistent — "due in 5 days" should always mean 5 days from this same
// reference, not from the wall clock. Replace with `new Date()` once real data
// arrives from the backend.
// Rolled forward 2026-07-01 (per ADR-006 and CLAUDE.md §10b — slide forward
// when relative dates start looking stale; previous anchor 2026-05-26 was ~5
// weeks stale). Manual roll-forward keeps "due in N days" math stable
// mid-session (vs `new Date()` which would drift as the demo runs).
export const MOCK_NOW = new Date(2026, 6, 1); // 2026-07-01

/**
 * Returns the "current time" as the rest of the codebase should treat it.
 * Today this resolves to MOCK_NOW so mock-derived "due in N days" math stays
 * consistent. When the backend is wired in and real timestamps replace mock
 * data, this should become `new Date()` (or accept an injected clock for
 * deterministic tests). Consumers (e.g. `services/commissions.js`,
 * `utils/settlementCycle.js`) should call this rather than reading MOCK_NOW
 * directly so the swap is one-line.
 */
export function currentTime() {
  return new Date(MOCK_NOW.getTime());
}

// ─── Seeded RNG for deterministic data ───────────────────────────────────────
let _seed = 42;
function rand() { _seed = (_seed * 16807 + 0) % 2147483647; return (_seed - 1) / 2147483646; }
function randInt(min, max) { return Math.floor(rand() * (max - min + 1)) + min; }
function pick(arr) { return arr[randInt(0, arr.length - 1)]; }

// ─── Ugandan name pools ─────────────────────────────────────────────────────
const FIRST_NAMES_M = ['James','Robert','David','Joseph','Samuel','Peter','John','Moses','Isaac','Patrick','Ronald','Brian','Denis','Frank','Henry','Richard','Charles','Emmanuel','Gerald','Andrew'];
const FIRST_NAMES_F = ['Grace','Sarah','Agnes','Mary','Rose','Esther','Florence','Janet','Rebecca','Judith','Harriet','Dorothy','Irene','Beatrice','Prossy','Lillian','Carol','Diana','Annet','Brenda'];
const LAST_NAMES = ['Okello','Namubiru','Mugisha','Kabuye','Ssempala','Atuhaire','Owori','Nankya','Tumusiime','Byaruhanga','Namutebi','Kisakye','Obua','Drazu','Akello','Okiror','Natukunda','Musinguzi','Katusiime','Babirye','Nsubuga','Kasozi','Lubega','Kato','Wasswa','Nakato','Kiiza','Asiimwe','Mwesigwa','Arinaitwe'];

function ugandanName(gender) {
  const first = gender === 'female' ? pick(FIRST_NAMES_F) : pick(FIRST_NAMES_M);
  return `${first} ${pick(LAST_NAMES)}`;
}

// Valid Ugandan mobile prefixes: MTN (76,77,78), Airtel (70,74,75), UTL (71)
const UG_MOBILE_PREFIXES = ['70','71','74','75','76','77','78'];
function ugandanPhone() {
  return `+256${pick(UG_MOBILE_PREFIXES)}${randInt(1000000, 9999999)}`;
}

// ─── Monthly contribution trend generator ────────────────────────────────────
function monthlyTrend(base, growth = 0.03, variance = 0.08) {
  const arr = [];
  let val = base;
  for (let i = 0; i < 12; i++) {
    val = Math.round(val * (1 + growth + (rand() - 0.5) * variance));
    arr.push(val);
  }
  return arr;
}

// ─── COUNTRY (metrics aggregated from regions after data generation) ─────────
export const COUNTRY = {
  id: 'ug',
  name: 'Uganda',
  center: [32.3, 1.4],
  metrics: null, // populated after region roll-up
};

// ─── REGIONS ─────────────────────────────────────────────────────────────────
export const REGIONS = {
  'r-central': { id: 'r-central', name: 'Central', parentId: 'ug', center: [32.58, 0.35], metrics: null },
  'r-eastern': { id: 'r-eastern', name: 'Eastern', parentId: 'ug', center: [33.75, 1.56], metrics: null },
  'r-northern': { id: 'r-northern', name: 'Northern', parentId: 'ug', center: [32.30, 2.77], metrics: null },
  'r-western': { id: 'r-western', name: 'Western', parentId: 'ug', center: [30.27, -0.61], metrics: null },
};

// ─── DISTRIBUTORS ────────────────────────────────────────────────────────────
// Two-row catalogue in the demo seed — `d-001` is the default national
// operator (every distributor login lands here via the demo_personas fallback)
// and `d-002` is the secondary distributor that the second persona row
// (`dp-d-002` → `+256700000022`) signs in as. Mirrors the `distributors` table
// seeded by `scripts/seed-supabase.mjs`. Kept as a Map for symmetry with the
// other level dictionaries.
export const DISTRIBUTORS = {
  'd-001': {
    id: 'd-001',
    name: 'Universal Pensions Uganda — National',
    parentId: 'ug',
    managerName: 'Distributor Lead',
    managerPhone: '+256700000021',
    managerEmail: null,
    status: 'active',
    metrics: null,
  },
  'd-002': {
    id: 'd-002',
    name: 'Universal Pensions Uganda — Secondary',
    parentId: 'ug',
    managerName: 'Secondary Distributor Lead',
    managerPhone: '+256700000022',
    managerEmail: null,
    status: 'active',
    metrics: null,
  },
};



// Demo-fallback entity IDs that the auth layer hands out when a login phone
// isn't recognised (ROLE_DEFAULTS in api/auth/_lib/personas.ts): agent `a-001`,
// branch `b-kam-015`, distributor `d-001`, employer `emp-001`. These MUST always
// seed as `status: 'active'` — otherwise a re-seed can randomly mark a fallback
// persona inactive, and the verify-otp/verify-password deactivation gate then
// 403s the demo login ("account has been deactivated"). Distributor `d-001` is
// already hardcoded active above and the employer INSERT omits status (DB
// DEFAULT 'active'), so only the randomised branch + agent assignments below
// need the guard. Kept inline (not imported from the API layer) so mockData.js
// stays free of server-side imports; the IDs are stable demo constants.
const DEMO_FALLBACK_ACTIVE_IDS = new Set(['a-001', 'b-kam-015', 'd-001', 'emp-001']);

export const BRANCHES = {};
BRANCH_DEFS.forEach((b) => {
  const mGender = rand() < 0.55 ? 'male' : 'female';
  const mName = ugandanName(mGender);
  BRANCHES[b.id] = {
    ...b,
    parentId: b.districtId,
    managerName: mName,
    managerPhone: ugandanPhone(),
    // Force the demo-fallback branch (b-kam-015) active so the branch demo
    // login never trips the deactivation gate. Others keep the ~10% inactive mix.
    status: DEMO_FALLBACK_ACTIVE_IDS.has(b.id)
      ? 'active'
      : rand() < 0.9 ? 'active' : 'inactive',
    metrics: null,
  };
  delete BRANCHES[b.id].districtId;
});

// ─── AGENTS ──────────────────────────────────────────────────────────────────
export const AGENTS = {};
const AGENT_STATUSES = ['active', 'active', 'active', 'active', 'inactive']; // 80% active
const AGENT_LANGUAGE_POOL = ['English', 'Luganda', 'Swahili', 'Runyankole', 'Acholi', 'Lugbara', 'Lusoga', 'Ateso'];
const AGENT_SPECIALTIES = [
  'Retirement planning',
  'Insurance & claims',
  'Goal-based saving',
  'Family beneficiaries',
  'Mobile money onboarding',
  'Self-employed savers',
  'Small-business owners',
];
let agentCounter = 0;

Object.keys(BRANCHES).forEach((branchId) => {
  const count = randInt(5, 8); // 5-8 agents per branch → ~500 total
  for (let i = 0; i < count; i++) {
    agentCounter++;
    const gender = rand() < 0.55 ? 'male' : 'female';
    const id = `a-${String(agentCounter).padStart(3, '0')}`;
    const branchCenter = BRANCHES[branchId].center;
    const name = ugandanName(gender);

    // Languages: English is universal; add 1–2 local languages on top.
    const localPool = AGENT_LANGUAGE_POOL.filter((l) => l !== 'English');
    const localCount = rand() < 0.6 ? 1 : 2;
    const localLangs = new Set();
    while (localLangs.size < localCount) localLangs.add(pick(localPool));
    const languages = ['English', ...localLangs];

    // Specialties: 1–2.
    const specialtyCount = rand() < 0.65 ? 1 : 2;
    const specialties = new Set();
    while (specialties.size < specialtyCount) specialties.add(pick(AGENT_SPECIALTIES));

    // Tenure: 0.5–8 years, expressed in months for richer copy.
    const tenureMonths = randInt(6, 96);
    const joinedYear = 2026 - Math.floor(tenureMonths / 12);
    const joinedMonth = randInt(1, 12);
    const joinedDate = `${joinedYear}-${String(joinedMonth).padStart(2, '0')}-15`;

    const subscribersManaged = randInt(40, 220);
    const responseHours = Math.round((rand() * 6 + 1) * 10) / 10; // 1.0–7.0h typical reply

    AGENTS[id] = {
      id,
      name,
      gender,
      employeeId: `EMP-${String(agentCounter).padStart(4, '0')}`,
      parentId: branchId,
      center: [branchCenter[0] + (rand() - 0.5) * 0.02, branchCenter[1] + (rand() - 0.5) * 0.02],
      phone: ugandanPhone(),
      email: `${name.toLowerCase().replace(/\s/g, '.')}@universalpensions.ug`,
      rating: Math.round((3 + rand() * 2) * 10) / 10, // 3.0 - 5.0
      performance: randInt(45, 100),
      // Force the demo-fallback agent (a-001) active so the agent demo login
      // (and the unknown-phone fallback) never trips the deactivation gate.
      // Others keep the ~20% inactive mix from AGENT_STATUSES.
      status: DEMO_FALLBACK_ACTIVE_IDS.has(id) ? 'active' : pick(AGENT_STATUSES),
      languages,
      specialties: Array.from(specialties),
      tenureMonths,
      joinedDate,
      subscribersManaged,
      avgResponseHours: responseHours,
      metrics: null, // populated below
    };
  }
});

// ─── SUBSCRIBERS (generated lazily) ──────────────────────────────────────────
const PRODUCTS = ['SavePlus', 'PensionBasic', 'PensionPremium', 'EducationSaver', 'HealthCover'];
// Every Universal Pensions subscriber is KYC-verified by definition: KYC is
// captured during agent-led onboarding (or the subscriber signup flow) before
// the record is created. The constant remains as a single-element array so
// the picker still works without cascading changes elsewhere.
const KYC_STATUSES = ['complete'];
const EMAIL_DOMAINS = ['gmail.com', 'gmail.com', 'gmail.com', 'yahoo.com', 'yahoo.com', 'outlook.com', 'hotmail.com', 'mail.ug'];

let _subscribersCache = null;

function generateSubscribers() {
  if (_subscribersCache) return _subscribersCache;
  const subs = {};
  const agentIds = Object.keys(AGENTS);
  const TARGET_SUBS = 5000;
  let subCounter = 0;

  // ── Book allocation ────────────────────────────────────────────────────────
  // PREVIOUSLY: `count = randInt(Math.max(5, subsPerAgent - 5), subsPerAgent + 5)`.
  // With 2,043 agents, subsPerAgent = ceil(5000/2043) = 3, so the floor
  // `Math.max(5, -2)` forced EVERY agent to 5–8 subscribers. The 5,000 budget
  // was exhausted after ~778 agents and the `subCounter < TARGET_SUBS` guard
  // silently stopped the loop. Agents are keyed in district order, so those 778
  // were all Central + Eastern — leaving Northern and Western with ZERO
  // subscribers, 1,265 agents with an empty book, and the demo personas
  // a-042 ("Northern region agent") / a-118 ("Western region agent") showing
  // nothing at all.
  //
  // NOW: allocate the same 5,000 across the whole network, weighted by region
  // and with a realistic long tail. Total is unchanged — only the distribution.
  const REGION_SHARE = {
    'r-central':  0.34,  // Kampala metro — highest formal-savings uptake
    'r-eastern':  0.25,
    'r-western':  0.24,
    'r-northern': 0.17,  // lowest penetration, still materially covered
  };
  const DORMANT_AGENT_RATE = 0.12;   // newly-recruited / inactive: empty book
  // Demo-login agents must always have a book to show.
  const DEMO_AGENTS = new Set(['a-001', 'a-042', 'a-118']);

  const regionOfAgent = (agentId) => {
    const branch = BRANCHES[AGENTS[agentId]?.parentId];
    return DISTRICTS[branch?.parentId]?.parentId ?? null;
  };

  // Raw per-agent weight. `rand()^2.2` gives a long right tail: most agents
  // modest, a handful of strong performers — rather than a flat 5–8 everywhere.
  const byRegion = {};
  agentIds.forEach((agentId) => {
    const region = regionOfAgent(agentId);
    if (!region || !(region in REGION_SHARE)) return;
    const dormant = !DEMO_AGENTS.has(agentId) && rand() < DORMANT_AGENT_RATE;
    const weight = dormant ? 0 : Math.pow(rand(), 2.2) + 0.05;
    (byRegion[region] ||= []).push({ agentId, weight });
  });

  // Distribute each region's target by weight, using largest-remainder so the
  // regional totals — and therefore the 5,000 grand total — land exactly.
  const countByAgent = {};
  Object.entries(byRegion).forEach(([region, list]) => {
    const target = Math.round(TARGET_SUBS * REGION_SHARE[region]);
    const totalWeight = list.reduce((s, a) => s + a.weight, 0) || 1;
    let assigned = 0;
    const withRemainder = list.map((a) => {
      const exact = (a.weight / totalWeight) * target;
      const base = Math.floor(exact);
      countByAgent[a.agentId] = base;
      assigned += base;
      return { agentId: a.agentId, rem: exact - base };
    });
    withRemainder.sort((a, b) => b.rem - a.rem);
    for (let i = 0; assigned < target; i++, assigned++) {
      countByAgent[withRemainder[i % withRemainder.length].agentId] += 1;
    }
  });
  // Guarantee the demo agents are never empty.
  DEMO_AGENTS.forEach((id) => {
    if (id in countByAgent && countByAgent[id] < 3) countByAgent[id] = 3;
  });

  agentIds.forEach((agentId) => {
    const count = countByAgent[agentId] ?? 0;
    for (let i = 0; i < count; i++) {
      subCounter++;
      const gRoll = rand();
      const gender = gRoll < 0.55 ? 'male' : gRoll < 0.98 ? 'female' : 'other';
      const age = pick([
        randInt(18, 25), randInt(18, 25),
        randInt(26, 35), randInt(26, 35), randInt(26, 35), randInt(26, 35),
        randInt(36, 45), randInt(36, 45), randInt(36, 45),
        randInt(46, 55), randInt(46, 55),
        randInt(56, 70),
      ]);
      const isActive = rand() < (0.60 + rand() * 0.35);
      const monthlyAmt = randInt(5, 50) * 1000; // 5K–50K UGX
      const contribHistory = monthlyTrend(monthlyAmt, isActive ? 0.02 : -0.05, 0.15);
      const totalC = contribHistory.reduce((s, v) => s + v, 0);
      const totalW = Math.round(totalC * (rand() * 0.15));
      const id = `s-${String(subCounter).padStart(4, '0')}`;
      const name = ugandanName(gender === 'other' ? (rand() < 0.5 ? 'male' : 'female') : gender);
      const numProducts = randInt(1, 3);
      const heldProducts = [];
      const used = new Set();
      for (let p = 0; p < numProducts; p++) {
        let prod = pick(PRODUCTS);
        while (used.has(prod)) prod = pick(PRODUCTS);
        used.add(prod);
        heldProducts.push(prod);
      }

      // Distribute registration dates: ~25% in 2024, ~45% in 2025, ~30% in 2026 (up to March)
      const yearRoll = rand();
      const regYear = yearRoll < 0.25 ? 2024 : yearRoll < 0.70 ? 2025 : 2026;
      const regMonth = regYear === 2026 ? randInt(1, 3) : randInt(1, 12);
      const regDay = randInt(1, 28);

      // ── Rich subscriber detail: units, balances, schedule, insurance,
      //   nominees, transactions, claims, withdrawals (deterministic via rand())
      const currentUnitValue = Math.round((1000 + (rand() - 0.5) * 100) * 100) / 100; // ≈1000 ± 5%
      // Model investment growth: contributions bought units at a lower average price than today,
      // so the current value of held units exceeds contributions (typical 6–18% accumulated gain).
      const avgPurchaseValue = currentUnitValue * (0.84 + rand() * 0.10);
      const grossBalance = Math.round((totalC / avgPurchaseValue) * currentUnitValue);
      const netBalance = Math.max(0, grossBalance - totalW);
      const unitsHeld = Math.round((netBalance / currentUnitValue) * 100) / 100;
      const retirementPct = pick([70, 75, 80, 80, 80, 85, 90]);
      const emergencyPct = 100 - retirementPct;
      const retirementBalance = Math.round(netBalance * retirementPct / 100);
      const emergencyBalance = netBalance - retirementBalance;
      const frequency = pick(['monthly', 'monthly', 'monthly', 'weekly', 'quarterly', 'half-yearly', 'annually']);
      const freqPerYear = { weekly: 52, monthly: 12, quarterly: 4, 'half-yearly': 2, annually: 1 }[frequency];
      const scheduleAmount = Math.round(monthlyAmt * (12 / freqPerYear) / 1000) * 1000;
      const includeInsurance = rand() < 0.55;
      const nextDueOffsetDays = randInt(1, 30);
      // Anchor to MOCK_NOW (not `new Date()`) so "due in N days" stays
      // consistent across the demo session — see CLAUDE.md §10b.
      const nextDue = new Date(MOCK_NOW.getTime());
      nextDue.setDate(nextDue.getDate() + nextDueOffsetDays);

      const regParts = `${regYear}-${String(regMonth).padStart(2, '0')}-${String(regDay).padStart(2, '0')}`.split('-').map(Number);
      const regDate = new Date(regParts[0], regParts[1] - 1, regParts[2]);
      const renewalDate = new Date(regDate.getTime() + 365 * 86400000);

      // Nominees (pension + insurance; same pool usually)
      const NOMINEE_REL = ['spouse', 'child', 'parent', 'sibling', 'other'];
      const nomineeCount = randInt(1, 4);
      const basePension = [];
      let remainingShare = 100;
      for (let n = 0; n < nomineeCount; n++) {
        const last = n === nomineeCount - 1;
        const share = last ? remainingShare : Math.max(5, Math.round(remainingShare / (nomineeCount - n)));
        remainingShare -= share;
        basePension.push({
          id: `nom-${id}-p-${n + 1}`,
          name: ugandanName(rand() < 0.5 ? 'male' : 'female'),
          phone: ugandanPhone(),
          relationship: pick(NOMINEE_REL),
          nin: `CM${randInt(10000000, 99999999)}`,
          share,
        });
      }
      // Insurance nominees: 70% share pool, may differ
      let insNominees;
      if (rand() < 0.7) {
        // Same-as-pension
        insNominees = basePension.map((n, i) => ({ ...n, id: `nom-${id}-i-${i + 1}` }));
      } else {
        const insCount = randInt(1, 3);
        insNominees = [];
        let rem = 100;
        for (let n = 0; n < insCount; n++) {
          const last = n === insCount - 1;
          const share = last ? rem : Math.max(10, Math.round(rem / (insCount - n)));
          rem -= share;
          insNominees.push({
            id: `nom-${id}-i-${n + 1}`,
            name: ugandanName(rand() < 0.5 ? 'male' : 'female'),
            phone: ugandanPhone(),
            relationship: pick(NOMINEE_REL),
            nin: `CM${randInt(10000000, 99999999)}`,
            share,
          });
        }
      }

      // Claims: 0–2
      const CLAIM_STATUSES = ['submitted', 'under_review', 'approved', 'paid', 'paid', 'rejected'];
      const CLAIM_TYPES = ['medical', 'accident', 'hospitalization', 'critical_illness'];
      const claimCount = rand() < 0.25 ? randInt(1, 2) : 0;
      const claims = [];
      for (let c = 0; c < claimCount; c++) {
        const cDays = randInt(30, 500);
        // Anchor to MOCK_NOW so claim dates don't drift as the wall clock
        // advances — keeps "submitted 3 weeks ago" copy demo-stable.
        const cDate = new Date(MOCK_NOW.getTime() - cDays * 86400000);
        claims.push({
          id: `clm-${id}-${c + 1}`,
          type: pick(CLAIM_TYPES),
          status: pick(CLAIM_STATUSES),
          amount: randInt(200, 900) * 1000,
          incidentDate: `${cDate.getFullYear()}-${String(cDate.getMonth() + 1).padStart(2, '0')}-${String(cDate.getDate()).padStart(2, '0')}`,
          submittedDate: `${cDate.getFullYear()}-${String(cDate.getMonth() + 1).padStart(2, '0')}-${String(cDate.getDate()).padStart(2, '0')}`,
          description: pick([
            'Routine outpatient treatment at Mulago Hospital',
            'Emergency surgery — broken leg',
            'Malaria hospitalization, 3 nights',
            'Maternity delivery support',
            'Dental procedure',
          ]),
        });
      }

      // Withdrawals: 0–5 records
      const withdrawCount = rand() < 0.4 ? randInt(1, 4) : 0;
      const withdrawals = [];
      let wRemaining = totalW;
      for (let w = 0; w < withdrawCount && wRemaining > 0; w++) {
        const amt = w === withdrawCount - 1 ? wRemaining : Math.round(wRemaining / (withdrawCount - w) * (0.7 + rand() * 0.6));
        wRemaining -= amt;
        const days = randInt(10, 400);
        // Anchor to MOCK_NOW so withdrawal dates stay demo-stable.
        const wd = new Date(MOCK_NOW.getTime() - days * 86400000);
        withdrawals.push({
          id: `wd-${id}-${w + 1}`,
          amount: amt,
          bucket: rand() < 0.75 ? 'emergency' : 'retirement',
          reason: pick(['Medical', 'Education', 'Housing', 'Business', 'Other']),
          status: pick(['paid', 'paid', 'paid', 'processing']),
          method: pick(['MTN Mobile Money', 'Airtel Money', 'Bank transfer']),
          date: `${wd.getFullYear()}-${String(wd.getMonth() + 1).padStart(2, '0')}-${String(wd.getDate()).padStart(2, '0')}`,
        });
      }

      // Transactions: contributions (~monthly), withdrawals, premiums
      const transactions = [];
      // Anchor to MOCK_NOW so the 12-month contribution trail lines up with
      // the same reference point as `nextDueDate` / claim dates above —
      // keeps every relative date in the demo internally consistent.
      const refMs = MOCK_NOW.getTime();
      // Contributions — last 12 months if active
      const contribMonths = isActive ? 3 : randInt(1, 3);
      for (let mIdx = contribMonths - 1; mIdx >= 0; mIdx--) {
        const contribDate = new Date(refMs - mIdx * 30 * 86400000 - randInt(0, 5) * 86400000);
        const monthAmount = contribHistory[11 - Math.min(mIdx, 11)] || monthlyAmt;
        if (monthAmount <= 0) continue;
        transactions.push({
          id: `tx-${id}-c-${mIdx}`,
          type: 'contribution',
          amount: monthAmount,
          date: `${contribDate.getFullYear()}-${String(contribDate.getMonth() + 1).padStart(2, '0')}-${String(contribDate.getDate()).padStart(2, '0')}`,
          status: 'settled',
          method: pick(['MTN Mobile Money', 'Airtel Money', 'Bank transfer']),
          reference: `CT-${randInt(10000, 99999)}`,
        });
      }
      // Insurance premium if opted-in. Self-paid cover is billed ANNUALLY — one
      // premium a year (the `pay_now` model, migration 0072/0073) — NEVER a
      // monthly stream. Post a SINGLE annual premium row (monthly rate × 12).
      // (The s-0002 save-to-cover demo strips its premium rows in the override
      // block below, so a "building" member correctly shows no upfront premium.)
      if (includeInsurance) {
        const pDate = new Date(refMs - (contribMonths - 1) * 30 * 86400000 - randInt(0, 3) * 86400000);
        transactions.push({
          id: `tx-${id}-p-annual`,
          type: 'premium',
          amount: 2000 * 12, // annual premium = insurance.premiumMonthly (2000) × 12
          date: `${pDate.getFullYear()}-${String(pDate.getMonth() + 1).padStart(2, '0')}-${String(pDate.getDate()).padStart(2, '0')}`,
          status: 'settled',
          method: pick(['MTN Mobile Money', 'Airtel Money', 'Bank transfer']),
          reference: `PR-${randInt(10000, 99999)}`,
        });
      }
      // Add withdrawals to transactions
      withdrawals.forEach((w) => {
        transactions.push({
          id: `tx-${id}-w-${w.id}`,
          type: 'withdrawal',
          amount: -w.amount,
          date: w.date,
          status: w.status,
          method: w.method,
          reference: `WD-${randInt(10000, 99999)}`,
          bucket: w.bucket,
        });
      });
      // Paid claims → transaction inflow
      claims.filter((c) => c.status === 'paid').forEach((c) => {
        transactions.push({
          id: `tx-${id}-clm-${c.id}`,
          type: 'claim',
          amount: c.amount,
          date: c.submittedDate,
          status: 'paid',
          method: 'Bank transfer',
          reference: `CL-${randInt(10000, 99999)}`,
        });
      });
      transactions.sort((a, b) => b.date.localeCompare(a.date));

      subs[id] = {
        id,
        name,
        email: `${name.toLowerCase().replace(/\s/g, '.')}${randInt(10, 999)}@${pick(EMAIL_DOMAINS)}`,
        phone: ugandanPhone(),
        gender,
        age,
        parentId: agentId,
        kycStatus: pick(KYC_STATUSES),
        isActive,
        contributionHistory: contribHistory,
        totalContributions: totalC,
        totalWithdrawals: totalW,
        registeredDate: `${regYear}-${String(regMonth).padStart(2, '0')}-${String(regDay).padStart(2, '0')}`,
        productsHeld: heldProducts,

        // Account snapshot (for Subscriber dashboard)
        unitsHeld,
        currentUnitValue,
        unitValueAsOf: new Date().toISOString(),
        netBalance,
        retirementBalance,
        emergencyBalance,
        // Cost basis of the units still held, at the average price they were
        // bought for. Mirrors what subscriber_balances.invested holds under
        // Supabase, so deriveInvestmentGrowth() reads a REAL basis in mock mode
        // too and never falls back to inventing one. Consistent by construction
        // with this block's own growth model (avgPurchaseValue < currentUnitValue).
        invested: Math.round(unitsHeld * avgPurchaseValue),

        contributionSchedule: {
          frequency,
          amount: scheduleAmount,
          retirementPct,
          emergencyPct,
          includeInsurance,
          nextDueDate: `${nextDue.getFullYear()}-${String(nextDue.getMonth() + 1).padStart(2, '0')}-${String(nextDue.getDate()).padStart(2, '0')}`,
        },

        insurance: {
          cover: includeInsurance ? 1_000_000 : 0,
          premiumMonthly: includeInsurance ? 2000 : 0,
          policyStart: `${regParts[0]}-${String(regParts[1]).padStart(2, '0')}-${String(regParts[2]).padStart(2, '0')}`,
          renewalDate: `${renewalDate.getFullYear()}-${String(renewalDate.getMonth() + 1).padStart(2, '0')}-${String(renewalDate.getDate()).padStart(2, '0')}`,
          status: includeInsurance ? 'active' : 'inactive',
        },

        claims,
        nominees: {
          pension: basePension,
          insurance: insNominees,
        },
        transactions,
        withdrawals,
      };
    }
  });
  _subscribersCache = subs;
  return subs;
}

// Proxy so SUBSCRIBERS behaves like a plain object but generates lazily
export const SUBSCRIBERS = new Proxy({}, {
  get(_, prop) {
    const data = generateSubscribers();
    if (prop === Symbol.iterator) return data[Symbol.iterator];
    return data[prop];
  },
  ownKeys() { return Object.keys(generateSubscribers()); },
  getOwnPropertyDescriptor(_, prop) {
    const data = generateSubscribers();
    if (prop in data) return { configurable: true, enumerable: true, value: data[prop] };
    return undefined;
  },
  has(_, prop) { return prop in generateSubscribers(); },
});

// ─── Aggregate metrics bottom-up ─────────────────────────────────────────────
function ageBucket(age) {
  if (age <= 25) return '18-25';
  if (age <= 35) return '26-35';
  if (age <= 45) return '36-45';
  if (age <= 55) return '46-55';
  return '56+';
}

function emptyMetrics() {
  return {
    totalSubscribers: 0,
    totalAgents: 0,
    totalContributions: 0,
    totalWithdrawals: 0,
    aum: 0,
    coverageRate: 0,
    activeRate: 0,
    activeSubscribers: 0,
    monthlyContributions: new Array(12).fill(0),
    genderRatio: { male: 0, female: 0, other: 0 },
    ageDistribution: { '18-25': 0, '26-35': 0, '36-45': 0, '46-55': 0, '56+': 0 },
    newSubscribersToday: 0,
    prevNewSubscribersToday: 0,
    dailyContributions: 0,
    prevDailyContributions: 0,
    dailyWithdrawals: 0,
    prevDailyWithdrawals: 0,
    newSubscribersThisWeek: 0,
    prevNewSubscribersThisWeek: 0,
    weeklyContributions: 0,
    prevWeeklyContributions: 0,
    weeklyWithdrawals: 0,
    prevWeeklyWithdrawals: 0,
    newSubscribersThisMonth: 0,
    prevNewSubscribersThisMonth: 0,
    monthlyWithdrawals: 0,
    prevMonthlyWithdrawals: 0,
    kycPending: 0,
    kycIncomplete: 0,
  };
}

function addMetrics(target, source) {
  target.totalSubscribers += source.totalSubscribers;
  target.totalAgents += source.totalAgents;
  target.totalContributions += source.totalContributions;
  target.totalWithdrawals += source.totalWithdrawals;
  target.aum += source.aum;
  target.newSubscribersToday += source.newSubscribersToday;
  target.prevNewSubscribersToday += source.prevNewSubscribersToday;
  target.dailyContributions += source.dailyContributions;
  target.prevDailyContributions += source.prevDailyContributions;
  target.dailyWithdrawals += source.dailyWithdrawals;
  target.prevDailyWithdrawals += source.prevDailyWithdrawals;
  target.newSubscribersThisWeek += source.newSubscribersThisWeek;
  target.prevNewSubscribersThisWeek += source.prevNewSubscribersThisWeek;
  target.weeklyContributions += source.weeklyContributions;
  target.prevWeeklyContributions += source.prevWeeklyContributions;
  target.weeklyWithdrawals += source.weeklyWithdrawals;
  target.prevWeeklyWithdrawals += source.prevWeeklyWithdrawals;
  target.newSubscribersThisMonth += source.newSubscribersThisMonth;
  target.prevNewSubscribersThisMonth += source.prevNewSubscribersThisMonth;
  target.monthlyWithdrawals += source.monthlyWithdrawals;
  target.prevMonthlyWithdrawals += source.prevMonthlyWithdrawals;
  target.kycPending += source.kycPending;
  target.kycIncomplete += source.kycIncomplete;
  // Track actual active subscriber count for correct rate calculation
  target._activeCount = (target._activeCount || 0) + Math.round(source.totalSubscribers * source.activeRate / 100);
  // Track coverage as weighted sum for correct rollup
  target._coverageWeighted = (target._coverageWeighted || 0) + source.coverageRate * source.totalSubscribers;
  for (let i = 0; i < 12; i++) target.monthlyContributions[i] += source.monthlyContributions[i];
  ['male', 'female', 'other'].forEach((g) => { target.genderRatio[g] += source.genderRatio[g]; });
  Object.keys(target.ageDistribution).forEach((k) => { target.ageDistribution[k] += source.ageDistribution[k]; });
}

function finalizeRates(m) {
  m.activeSubscribers = m._activeCount || 0;
  if (m.totalSubscribers > 0) {
    m.activeRate = Math.round(((m._activeCount || 0) / m.totalSubscribers) * 100);
    // Coverage = weighted average from children, or agent-level seed value
    m.coverageRate = Math.round((m._coverageWeighted || 0) / m.totalSubscribers);
  }
  delete m._activeCount;
  delete m._coverageWeighted;
  // Normalize gender ratio to percentages (ensure they always sum to exactly 100)
  const gTotal = m.genderRatio.male + m.genderRatio.female + m.genderRatio.other;
  if (gTotal > 0) {
    const malePct = Math.round((m.genderRatio.male / gTotal) * 100);
    const femalePct = Math.round((m.genderRatio.female / gTotal) * 100);
    m.genderRatio = { male: malePct, female: femalePct, other: 100 - malePct - femalePct };
  }
}

// Compute agent-level metrics from subscribers
const subs = generateSubscribers();

// ── save-to-cover demo (migration 0072) ──────────────────────────────────────
// Pin one subscriber into a BUILDING state (cover not on yet — savings filling
// the "tin") so the feature is demoable under VITE_USE_SUPABASE=false. All other
// rows default to funding_mode 'pay_now' / 0 → behaviour unchanged.
{
  const demo = subs['s-0002'];
  if (demo) {
    demo.contributionSchedule = {
      ...demo.contributionSchedule,
      insuranceFundingMode: 'save_to_cover',
      insurancePremiumTarget: 42_000,   // Life + Funeral combined annual premium
      insurancePremiumAccrued: 18_000,  // partway to the goal
      insuranceSavingsPct: 60,          // 60% of the take-out slice builds cover
      contributionIndexationPct: 5,
    };
    demo.insurance = {
      ...demo.insurance,
      cover: 1_000_000,
      premiumMonthly: 2000,
      status: 'building',               // filling the tin — not covered yet
    };
    // save-to-cover pays NO upfront premium — the emergency slice accrues and the
    // 0072 trigger sweeps it later. Drop any annual 'premium' row the generic
    // generator gave this member so the building demo shows no premium charge.
    demo.transactions = (demo.transactions ?? []).filter((t) => t.type !== 'premium');
  }
}

// ── multi-product cover demo (per-product cover amounts) ─────────────────────
// The generator gives every insured member a single LIFE policy at the entry
// tier, so offline (`VITE_USE_SUPABASE=false`) the settings cover page would
// show Health and Funeral as "—" for everyone and the product selector would
// have nothing to switch between. Pin one member holding TWO products at
// DIFFERENT ladder tiers, which also exercises activeCoverTotal /
// activeCoverProductsLabel ("Life & Health") on the summary cards.
//
// Policy rows only — deliberately NO extra 'premium' transaction, so the
// annual-premium invariant test (src/data/__tests__) stays a literal check
// against the single seeded rate.
{
  const demo = subs['s-0003'];
  if (demo) {
    const start = demo.insurance?.policyStart;
    const renews = demo.insurance?.renewalDate;
    demo.insurance = {
      ...demo.insurance,
      cover: 2_000_000,        // life ladder tier 1
      premiumMonthly: 3_500,
      status: 'active',
    };
    demo.insuranceProducts = [
      {
        product: 'life',
        cover: 2_000_000,
        premiumMonthly: 3_500,
        policyStart: start,
        renewalDate: renews,
        status: 'active',
        fundedBy: 'self',
      },
      {
        product: 'health',
        cover: 8_000_000,      // health ladder tier 2 — a deliberate upgrade
        premiumMonthly: 11_000,
        policyStart: start,
        renewalDate: renews,
        status: 'active',
        fundedBy: 'self',
      },
    ];
  }
}
// Pre-group subscribers by agent for O(1) lookup instead of O(n) filter
const subsByAgent = {};
Object.values(subs).forEach((s) => {
  if (!subsByAgent[s.parentId]) subsByAgent[s.parentId] = [];
  subsByAgent[s.parentId].push(s);
});
Object.values(AGENTS).forEach((agent) => {
  const m = emptyMetrics();
  const agentSubs = subsByAgent[agent.id] || [];
  m.totalSubscribers = agentSubs.length;
  m.totalAgents = 1;
  let activeCount = 0;
  agentSubs.forEach((s) => {
    m.totalContributions += s.totalContributions;
    m.totalWithdrawals += s.totalWithdrawals;
    if (s.isActive) activeCount++;
    if (s.kycStatus === 'pending') m.kycPending++;
    if (s.kycStatus === 'incomplete') m.kycIncomplete++;
    m.genderRatio[s.gender]++;
    m.ageDistribution[ageBucket(s.age)]++;
    s.contributionHistory.forEach((v, i) => { m.monthlyContributions[i] += v; });
  });
  m.activeRate = m.totalSubscribers ? Math.round((activeCount / m.totalSubscribers) * 100) : 0;
  m._activeCount = activeCount; // preserve for bottom-up aggregation
  // AUM = contributions + simulated investment returns (35-55% of contributions)
  m.aum = Math.round(m.totalContributions * (1.35 + rand() * 0.2));
  // Coverage derived from active rate + local variability (correlated but not identical)
  m.coverageRate = Math.min(95, Math.round(m.activeRate * 0.75 + randInt(5, 20)));
  m._coverageWeighted = m.coverageRate * m.totalSubscribers; // seed for weighted rollup
  // Monthly
  m.newSubscribersThisMonth = randInt(Math.max(1, Math.floor(m.totalSubscribers * 0.03)), Math.max(2, Math.ceil(m.totalSubscribers * 0.08)));
  m.prevNewSubscribersThisMonth = Math.max(1, Math.round(m.newSubscribersThisMonth * (0.75 + rand() * 0.35)));
  m.monthlyWithdrawals = Math.round((m.totalWithdrawals / 12) * (0.8 + rand() * 0.4));
  m.prevMonthlyWithdrawals = Math.max(1, Math.round(m.monthlyWithdrawals * (0.85 + rand() * 0.3)));
  // Weekly (roughly 1/4 of monthly with variance)
  m.newSubscribersThisWeek = Math.max(1, Math.round(m.newSubscribersThisMonth / (3.5 + rand() * 1.5)));
  m.prevNewSubscribersThisWeek = Math.max(1, Math.round(m.newSubscribersThisWeek * (0.8 + rand() * 0.3)));
  m.weeklyContributions = Math.round((m.monthlyContributions[11] || 0) / (3.5 + rand() * 1.5));
  m.prevWeeklyContributions = Math.max(1, Math.round(m.weeklyContributions * (0.85 + rand() * 0.3)));
  m.weeklyWithdrawals = Math.round(m.monthlyWithdrawals / (3.5 + rand() * 1.5));
  m.prevWeeklyWithdrawals = Math.max(1, Math.round(m.weeklyWithdrawals * (0.85 + rand() * 0.3)));
  // Daily (roughly 1/7 of weekly with variance)
  m.newSubscribersToday = Math.max(1, Math.round(m.newSubscribersThisWeek / (5 + rand() * 4)));
  m.prevNewSubscribersToday = Math.max(1, Math.round(m.newSubscribersToday * (0.7 + rand() * 0.5)));
  m.dailyContributions = Math.round(m.weeklyContributions / (5 + rand() * 4));
  m.prevDailyContributions = Math.max(1, Math.round(m.dailyContributions * (0.75 + rand() * 0.4)));
  m.dailyWithdrawals = Math.round(m.weeklyWithdrawals / (5 + rand() * 4));
  m.prevDailyWithdrawals = Math.max(1, Math.round(m.dailyWithdrawals * (0.75 + rand() * 0.4)));
  finalizeRates(m);
  agent.metrics = m;
  // Derive performance and rating from actual metrics so they correlate
  agent.performance = Math.min(100, Math.round(
    m.activeRate * 0.4 + Math.min(m.totalSubscribers / 20, 1) * 30 + randInt(15, 30)
  ));
  agent.rating = Math.min(5, Math.round((agent.performance / 22 + rand() * 0.4) * 10) / 10);
});

// Roll up: branch ← agents
Object.values(BRANCHES).forEach((branch) => {
  const m = emptyMetrics();
  Object.values(AGENTS).filter((a) => a.parentId === branch.id).forEach((a) => addMetrics(m, a.metrics));
  finalizeRates(m);
  branch.metrics = m;
});

// ─── BRANCH HEALTH SCORE + RANK ──────────────────────────────────────────────
// Same formula as BranchHealthScore.jsx — compute once, share across dashboards
function computeBranchScore(branch) {
  const m = branch.metrics;
  const totalSubs = m.totalSubscribers || 1;
  const retentionRate = (m.activeSubscribers / totalSubs) * 100;

  const agents = Object.values(AGENTS).filter(a => a.parentId === branch.id);
  const totalContrib = agents.reduce((s, a) => s + (a.metrics?.totalContributions || 0), 0);
  const avgPerSub = totalContrib / totalSubs;
  const avgContribScore = Math.min(100, (avgPerSub / 500_000) * 100);

  const totalAgents = agents.length || 1;
  const activeAgents = agents.filter(a => a.status === 'active').length;
  const agentActivity = (activeAgents / totalAgents) * 100;

  const mc = m.monthlyContributions || [];
  let growthSum = 0, growthCount = 0;
  for (let i = 1; i < mc.length; i++) {
    if (mc[i - 1] > 0) { growthSum += ((mc[i] - mc[i - 1]) / mc[i - 1]) * 100; growthCount++; }
  }
  const avgGrowth = growthCount > 0 ? growthSum / growthCount : 0;
  const growthScore = Math.min(100, Math.max(0, (avgGrowth / 5) * 50 + 50));

  return Math.min(100, Math.max(0, Math.round(
    retentionRate * 0.30 + avgContribScore * 0.25 + agentActivity * 0.25 + growthScore * 0.20
  )));
}

// Compute score for every branch
Object.values(BRANCHES).forEach((branch) => {
  branch.score = computeBranchScore(branch);
});

// Rank globally (1 = best)
const branchesByScore = Object.values(BRANCHES).sort((a, b) => b.score - a.score);
branchesByScore.forEach((branch, i) => { branch.rank = i + 1; });

// Rank within each district
const branchesByDistrict = {};
Object.values(BRANCHES).forEach((b) => {
  if (!branchesByDistrict[b.parentId]) branchesByDistrict[b.parentId] = [];
  branchesByDistrict[b.parentId].push(b);
});
Object.values(branchesByDistrict).forEach((arr) => {
  arr.sort((a, b) => b.score - a.score);
  arr.forEach((b, i) => { b.districtRank = i + 1; b.districtBranchCount = arr.length; });
});

// Roll up: district ← branches
Object.values(DISTRICTS).forEach((district) => {
  const m = emptyMetrics();
  const distBranches = Object.values(BRANCHES).filter((b) => b.parentId === district.id);
  distBranches.forEach((b) => addMetrics(m, b.metrics));
  m.totalBranches = distBranches.length;
  finalizeRates(m);
  district.metrics = m;
});

// Roll up: region ← districts
Object.values(REGIONS).forEach((region) => {
  const m = emptyMetrics();
  const regionDistricts = Object.values(DISTRICTS).filter((d) => d.parentId === region.id);
  regionDistricts.forEach((d) => addMetrics(m, d.metrics));
  m.totalBranches = regionDistricts.reduce((sum, d) => sum + (d.metrics?.totalBranches || 0), 0);
  finalizeRates(m);
  region.metrics = m;
});

// Roll up: country ← regions
{
  const m = emptyMetrics();
  Object.values(REGIONS).forEach((r) => addMetrics(m, r.metrics));
  m.totalBranches = Object.keys(BRANCHES).length;
  finalizeRates(m);
  COUNTRY.metrics = m;
}

// ─── COMMISSIONS ────────────────────────────────────────────────────────────
// Commission rate paid per onboarded subscriber. Phase 2 of the commission
// simplification collapsed the lifecycle to two states: `due → paid`.
//
// Status enum:
//   due   — earned, not yet settled
//   paid  — distributor settled it (a settlement batch flipped it to paid)
export const COMMISSION_CONFIG = {
  ratePerSubscriber: 5000,        // UGX per subscriber
};

// Window boundary used only to keep a realistic mix of due/paid in the demo
// data: commissions whose due date already passed are mostly settled (`paid`);
// recent / future ones are still outstanding (`due`).
const _settledBefore = new Date(2026, 3, 1); // 2026-04-01

// Generate commission records tied to agents + subscribers
// A commission is created when a subscriber makes their first contribution.
// We derive "first contribution date" from registeredDate + a small offset.
export const COMMISSIONS = {};
let commissionCounter = 0;

Object.values(AGENTS).forEach((agent) => {
  const agentSubs = subsByAgent[agent.id] || [];
  agentSubs.forEach((sub) => {
    // Only subscribers with contributions get a commission
    if (sub.totalContributions <= 0) return;

    commissionCounter++;
    const id = `c-${String(commissionCounter).padStart(5, '0')}`;

    // First contribution date = registered date + 1-30 days
    const regParts = sub.registeredDate.split('-').map(Number);
    const regDate = new Date(regParts[0], regParts[1] - 1, regParts[2]);
    const firstContribOffset = randInt(1, 30);
    const firstContribDate = new Date(regDate.getTime() + firstContribOffset * 86400000);
    const firstContribStr = `${firstContribDate.getFullYear()}-${String(firstContribDate.getMonth() + 1).padStart(2, '0')}-${String(firstContribDate.getDate()).padStart(2, '0')}`;

    // Due date = first contribution date + 30 days
    const dueDate = new Date(firstContribDate.getTime() + 30 * 86400000);
    const dueDateStr = `${dueDate.getFullYear()}-${String(dueDate.getMonth() + 1).padStart(2, '0')}-${String(dueDate.getDate()).padStart(2, '0')}`;

    const amount = COMMISSION_CONFIG.ratePerSubscriber;
    const statusRoll = rand();
    let status = 'due';
    let paidDate = null;
    let txnRef = null;
    let paidAmount = null;

    // Older lines (due date before the settled-before boundary) are mostly
    // already settled; ~12% remain `due` so a backlog is always visible.
    // Newer lines are mostly still `due`, with a small slice settled early so
    // every branch/agent shows some paid history.
    const isSettled = dueDate < _settledBefore ? statusRoll < 0.88 : statusRoll < 0.15;
    if (isSettled) {
      status = 'paid';
      txnRef = `MM-${String(commissionCounter).padStart(7, '0')}`;
      paidAmount = amount;
      const paidOffset = randInt(1, 6);
      const pd = new Date(dueDate.getTime() + paidOffset * 86400000);
      paidDate = `${pd.getFullYear()}-${String(pd.getMonth() + 1).padStart(2, '0')}-${String(pd.getDate()).padStart(2, '0')}`;
    }

    COMMISSIONS[id] = {
      id,
      agentId: agent.id,
      branchId: agent.parentId,
      subscriberId: sub.id,
      subscriberName: sub.name,
      amount,
      status,
      firstContributionDate: firstContribStr,
      dueDate: dueDateStr,
      paidDate,
      txnRef,
      paidAmount,
    };
  });
});

// Pre-index commissions by agent for O(1) lookups
export const commissionsByAgent = {};
Object.values(COMMISSIONS).forEach((c) => {
  if (!commissionsByAgent[c.agentId]) commissionsByAgent[c.agentId] = [];
  commissionsByAgent[c.agentId].push(c);
});

// Pre-index commissions by branch
export const commissionsByBranch = {};
Object.values(COMMISSIONS).forEach((c) => {
  if (!commissionsByBranch[c.branchId]) commissionsByBranch[c.branchId] = [];
  commissionsByBranch[c.branchId].push(c);
});

// ─── SETTLEMENT BATCHES ──────────────────────────────────────────────────────
// A settlement batch records one distributor "pay this agent's due slice"
// action: it stamps a chunk of an agent's `due` commissions `paid`. Seeded
// batches are consistent with the paid commissions generated above (a couple
// of demo agents whose history already shows a prior settlement). The
// commissions service clones this array into a session-mutable store; new
// settlements push onto that clone.
//
// Shape: { id, agentId, branchId, pendingTotal, paidAmount, txnRef, paidDate,
//          lineCount, createdAt }
export const SETTLEMENT_BATCHES = [
  {
    id: 'sb-seed-0001',
    agentId: 'a-001',
    branchId: AGENTS['a-001']?.parentId || null,
    pendingTotal: 25000,
    paidAmount: 25000,
    txnRef: 'MM-SEED-0001',
    paidDate: '2026-04-05',
    lineCount: 5,
    createdAt: '2026-04-05T09:12:00.000Z',
  },
  {
    id: 'sb-seed-0002',
    agentId: 'a-002',
    branchId: AGENTS['a-002']?.parentId || null,
    pendingTotal: 15000,
    paidAmount: 15000,
    txnRef: 'MM-SEED-0002',
    paidDate: '2026-04-12',
    lineCount: 3,
    createdAt: '2026-04-12T14:30:00.000Z',
  },
];

// ─── NOTIFICATIONS ───────────────────────────────────────────────────────────
// Seed feed so Phase 3's notification panel is non-empty in mock mode. Targets
// a couple of seeded agents plus their branches. recipientId = agentId for
// 'agent' rows, branchId for 'branch' rows. Some left unread.
//
// Shape: { id, recipientRole: 'agent'|'branch', recipientId, type,
//          title, body, amount, refId, isRead, createdAt }
export const NOTIFICATIONS = [
  {
    id: 'ntf-seed-0001',
    recipientRole: 'agent',
    recipientId: 'a-001',
    type: 'commission_settled',
    title: 'Commission settled',
    body: 'UGX 25,000 paid for 5 commissions.',
    amount: 25000,
    refId: 'sb-seed-0001',
    isRead: false,
    createdAt: '2026-04-05T09:12:00.000Z',
  },
  {
    id: 'ntf-seed-0002',
    recipientRole: 'branch',
    recipientId: AGENTS['a-001']?.parentId || null,
    type: 'commission_settled',
    title: 'Commission settled',
    body: 'UGX 25,000 paid for 5 commissions.',
    amount: 25000,
    refId: 'sb-seed-0001',
    isRead: true,
    createdAt: '2026-04-05T09:12:00.000Z',
  },
  {
    id: 'ntf-seed-0003',
    recipientRole: 'agent',
    recipientId: 'a-002',
    type: 'commission_settled',
    title: 'Commission settled',
    body: 'UGX 15,000 paid for 3 commissions.',
    amount: 15000,
    refId: 'sb-seed-0002',
    isRead: false,
    createdAt: '2026-04-12T14:30:00.000Z',
  },
  {
    id: 'ntf-seed-0004',
    recipientRole: 'branch',
    recipientId: AGENTS['a-002']?.parentId || null,
    type: 'commission_settled',
    title: 'Commission settled',
    body: 'UGX 15,000 paid for 3 commissions.',
    amount: 15000,
    refId: 'sb-seed-0002',
    isRead: false,
    createdAt: '2026-04-12T14:30:00.000Z',
  },
];

// ─── LEVEL CONSTANTS & LOOKUP MAPS ───────────────────────────────────────────
export const LEVELS = { COUNTRY: 'country', REGION: 'region', DISTRICT: 'district', BRANCH: 'branch', AGENT: 'agent', SUBSCRIBER: 'subscriber', DISTRIBUTOR: 'distributor' };

const LEVEL_MAP = {
  [LEVELS.COUNTRY]: { ug: COUNTRY },
  [LEVELS.REGION]: REGIONS,
  [LEVELS.DISTRICT]: DISTRICTS,
  [LEVELS.BRANCH]: BRANCHES,
  [LEVELS.AGENT]: AGENTS,
  [LEVELS.SUBSCRIBER]: SUBSCRIBERS,
  [LEVELS.DISTRIBUTOR]: DISTRIBUTORS,
};

// Note: distributors sit *outside* the geographic hierarchy
// (country → region → district → branch → agent → subscriber). The single
// distributor row is keyed off the country sentinel `ug`, but does NOT
// participate in the drill-down child-walk used by Distributor/Branch dashboards.
const CHILD_LEVEL = {
  [LEVELS.COUNTRY]: LEVELS.REGION,
  [LEVELS.REGION]: LEVELS.DISTRICT,
  [LEVELS.DISTRICT]: LEVELS.BRANCH,
  [LEVELS.BRANCH]: LEVELS.AGENT,
  [LEVELS.AGENT]: LEVELS.SUBSCRIBER,
};

// ─── Helper functions ────────────────────────────────────────────────────────

/** Get all child entities of a given parent at the next hierarchy level */
export function getChildEntities(level, parentId) {
  const childLevel = CHILD_LEVEL[level];
  if (!childLevel) return [];
  const map = LEVEL_MAP[childLevel];
  return Object.values(map).filter((e) => e.parentId === parentId);
}

/** Look up any entity by level + id */
export function getEntityById(level, id) {
  return LEVEL_MAP[level]?.[id] ?? null;
}

/** Build a breadcrumb path from selectedIds map, e.g. { region: 'r-central', district: 'd-kampala' } */
export function getBreadcrumbPath(currentLevel, selectedIds) {
  const crumbs = [{ level: LEVELS.COUNTRY, id: 'ug', name: COUNTRY.name }];
  const order = [LEVELS.REGION, LEVELS.DISTRICT, LEVELS.BRANCH, LEVELS.AGENT, LEVELS.SUBSCRIBER];
  for (const lvl of order) {
    const id = selectedIds[lvl];
    if (!id) break;
    const entity = getEntityById(lvl, id);
    if (entity) crumbs.push({ level: lvl, id, name: entity.name });
    if (lvl === currentLevel) break;
  }
  return crumbs;
}

// formatUGX is in src/utils/finance.js — single source of truth

/** Get all entities at a given level */
export function getAllEntities(level) {
  return Object.values(LEVEL_MAP[level] || {});
}

/** Get parent entity of a given entity */
export function getParentEntity(level, id) {
  const entity = getEntityById(level, id);
  if (!entity?.parentId) return null;
  // Distributors live off the country sentinel and have no children in the
  // geographic tree — short-circuit so the country roll-up is the parent.
  if (level === LEVELS.DISTRIBUTOR) return COUNTRY;
  const order = [LEVELS.COUNTRY, LEVELS.REGION, LEVELS.DISTRICT, LEVELS.BRANCH, LEVELS.AGENT];
  const idx = order.indexOf(level);
  return idx > 0 ? getEntityById(order[idx - 1], entity.parentId) : COUNTRY;
}

/** Get top performing branch by monthly contribution within an entity's scope */
export function getTopBranch(level, parentId) {
  let branches = [];
  if (level === 'country') {
    branches = Object.values(BRANCHES);
  } else if (level === 'region') {
    const regionDistricts = Object.values(DISTRICTS).filter((d) => d.parentId === parentId);
    regionDistricts.forEach((d) => {
      branches.push(...Object.values(BRANCHES).filter((b) => b.parentId === d.id));
    });
  } else if (level === 'district') {
    branches = Object.values(BRANCHES).filter((b) => b.parentId === parentId);
  } else {
    return null;
  }
  if (branches.length === 0) return null;
  let top = branches[0];
  let topVal = top.metrics?.monthlyContributions?.[11] || 0;
  for (const b of branches) {
    const val = b.metrics?.monthlyContributions?.[11] || 0;
    if (val > topVal) { topVal = val; top = b; }
  }
  return { name: top.name, contribution: topVal };
}
