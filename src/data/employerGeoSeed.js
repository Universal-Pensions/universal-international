// Extra employer demo seed — GEOGRAPHIC SPREAD for the admin Platform Overview
// data-scope filter (Employers / All) + the district drill-down "Employers" tab.
//
// The employer ROLE dashboard logs in as the single `emp-001` (employerSeed.js)
// and depends on its exact roster, so this module is kept SEPARATE and ADDITIVE:
// these employers exist only to populate the admin map across regions/districts.
// They get an `employers` row + tagged `subscribers` (employer_id, agent_id NULL)
// + `subscriber_balances` — which is everything `get_employer_geo_rollup` and the
// employer slice of `get_platform_overview` read. No contribution runs / invites /
// per-employer mock service (not needed for the admin geo view).
//
// `district` MUST equal a real `districts.name` (the geo rollup joins on name).
// Like every src/data module this is mock data, reached only via the seed script
// or a service — never imported by a component (CLAUDE.md §4.1). Dates anchor to
// MOCK_NOW for demo stability.

import { MOCK_NOW } from './mockData';
import { deriveContributionLegs } from '../utils/contributionModel';

const DAY_MS = 86400000;
const UNIT_PRICE = 1000;
const round = (n) => Math.round(n);

function dateDaysAgo(days) {
  const d = new Date(MOCK_NOW.getTime() - days * DAY_MS);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function dobForAge(age) {
  return `${MOCK_NOW.getFullYear() - age}-06-15`;
}

// ONE company-wide contribution setup, shared by every geo employer — declared
// once here so the `employers` row's config and the member balances derived below
// can never drift apart (they did: the rows said "50% match" while the balances
// were computed from a capped 50% of the employee leg).
//
// UNIFIED TWO-LEG MODEL (migration 0092): staff put in 10% of pay, the company adds
// 5% of pay. Both legs are INDEPENDENT shares of compensation — the employer leg is
// never a function of the employee leg — and there is NO cap and NO minimum. These
// values are money-identical to the config they replace (10% + a 50% match of that
// leg == 5% of pay) with zero rounding divergence across all 37 members, so a
// reseed leaves every geo balance untouched.
const GEO_CONTRIBUTION_CONFIG = Object.freeze({
  employeePct: 10,
  employerPct: 5,
  insuranceEnabled: false,
});

// Each company's staff are real subscribers tagged with employer_id (agent_id
// NULL). Historical balance = (employee leg + employer leg) × monthsActive, both
// legs derived from `compensation` by the shared `deriveContributionLegs`, split
// 80/20 retirement/emergency. `p.monthly` is the AUTHORED monthly saving these
// members were originally written with; compensation = monthly × 10 keeps that
// number as the employee leg under a 10%-of-pay setup (mirroring the migration
// 0062 backfill). The old greatest(…, 500000) floor is gone with the caps — the
// lowest authored monthly is 55,000 → 550,000 compensation, so it never bound.
function makeMember(employer, p, idx) {
  const monthly = p.monthly ?? 0;
  const months = p.monthsActive ?? 12;
  const compensation = round(monthly * 10);
  const { employeeLeg, employerLeg } = deriveContributionLegs(GEO_CONTRIBUTION_CONFIG, compensation);
  const own = round(employeeLeg * months);
  const company = round(employerLeg * months);
  const net = own + company;
  const retirement = round(net * 0.8);
  const seq = String(idx + 1).padStart(2, '0');
  return {
    id: `${employer.id}-e${seq}`,
    compensation,
    name: p.name,
    email: null,
    phone: p.phone,
    gender: p.gender ?? 'male',
    age: p.age ?? 32,
    dob: dobForAge(p.age ?? 32),
    nin: null,
    kycStatus: 'complete',
    occupation: p.occupation ?? null,
    employerId: employer.id,
    districtId: employer.districtId,
    isActive: p.status !== 'suspended' && p.status !== 'inactive',
    joinedDate: dateDaysAgo(p.daysAgo ?? 300),
    retirementBalance: retirement,
    emergencyBalance: net - retirement,
    netBalance: net,
    units: net / UNIT_PRICE,
  };
}

// ─── Employer catalog (spread across all 4 regions) ──────────────────────────
const EMPLOYER_DEFS = [
  {
    id: 'emp-002', name: 'Mbarara Dairy Co-op', sector: 'Agriculture',
    district: 'Mbarara', districtId: 'd-mbarara', regionId: 'r-western',
    contactName: 'Allan Atuhaire', contactPhone: '+256700000032', contactEmail: 'hr@mbararadairy.demo',
    staff: [
      { name: 'Allan Atuhaire', phone: '+256700200001', gender: 'male', age: 41, occupation: 'Operations Lead', monthly: 130000, monthsActive: 28, daysAgo: 840 },
      { name: 'Doreen Kemigisha', phone: '+256700200002', gender: 'female', age: 33, occupation: 'Accountant', monthly: 110000, monthsActive: 22, daysAgo: 660 },
      { name: 'Patrick Tumuhairwe', phone: '+256700200003', gender: 'male', age: 37, occupation: 'Field Supervisor', monthly: 95000, monthsActive: 18, daysAgo: 540 },
      { name: 'Ritah Ainomugisha', phone: '+256700200004', gender: 'female', age: 29, occupation: 'Lab Technician', monthly: 80000, monthsActive: 14, daysAgo: 420 },
      { name: 'Geofrey Byaruhanga', phone: '+256700200005', gender: 'male', age: 46, occupation: 'Logistics', monthly: 105000, monthsActive: 30, daysAgo: 900 },
      { name: 'Sarah Kyomuhendo', phone: '+256700200006', gender: 'female', age: 26, occupation: 'Admin', monthly: 60000, monthsActive: 8, status: 'inactive', daysAgo: 240 },
      { name: 'Moses Tusiime', phone: '+256700200007', gender: 'male', age: 52, occupation: 'Plant Hand', monthly: 70000, monthsActive: 24, daysAgo: 720 },
    ],
  },
  {
    id: 'emp-003', name: 'Gulu Traders Union', sector: 'Wholesale & Retail',
    district: 'Gulu', districtId: 'd-gulu', regionId: 'r-northern',
    contactName: 'Christine Lamwaka', contactPhone: '+256700000033', contactEmail: 'hr@gulutraders.demo',
    staff: [
      { name: 'Christine Lamwaka', phone: '+256700200011', gender: 'female', age: 39, occupation: 'Branch Lead', monthly: 100000, monthsActive: 26, daysAgo: 780 },
      { name: 'Denis Komakech', phone: '+256700200012', gender: 'male', age: 34, occupation: 'Stock Controller', monthly: 85000, monthsActive: 20, daysAgo: 600 },
      { name: 'Betty Akello', phone: '+256700200013', gender: 'female', age: 31, occupation: 'Cashier', monthly: 65000, monthsActive: 16, daysAgo: 480 },
      { name: 'Tony Ojara', phone: '+256700200014', gender: 'male', age: 28, occupation: 'Sales', monthly: 70000, monthsActive: 12, daysAgo: 360 },
      { name: 'Grace Aber', phone: '+256700200015', gender: 'female', age: 44, occupation: 'Procurement', monthly: 90000, monthsActive: 30, daysAgo: 900 },
      { name: 'Simon Odong', phone: '+256700200016', gender: 'male', age: 50, occupation: 'Warehouse', monthly: 60000, monthsActive: 22, status: 'suspended', daysAgo: 660 },
    ],
  },
  {
    id: 'emp-004', name: 'Jinja Steel Mills', sector: 'Manufacturing',
    district: 'Jinja', districtId: 'd-jinja', regionId: 'r-eastern',
    contactName: 'Hassan Mugabi', contactPhone: '+256700000034', contactEmail: 'hr@jinjasteel.demo',
    staff: [
      { name: 'Hassan Mugabi', phone: '+256700200021', gender: 'male', age: 43, occupation: 'Plant Manager', monthly: 180000, monthsActive: 32, daysAgo: 960 },
      { name: 'Irene Nabwire', phone: '+256700200022', gender: 'female', age: 35, occupation: 'HR Officer', monthly: 120000, monthsActive: 24, daysAgo: 720 },
      { name: 'Charles Waiswa', phone: '+256700200023', gender: 'male', age: 38, occupation: 'Foreman', monthly: 110000, monthsActive: 20, daysAgo: 600 },
      { name: 'Lydia Babirye', phone: '+256700200024', gender: 'female', age: 30, occupation: 'QA', monthly: 90000, monthsActive: 15, daysAgo: 450 },
      { name: 'Eric Isabirye', phone: '+256700200025', gender: 'male', age: 27, occupation: 'Operator', monthly: 80000, monthsActive: 10, daysAgo: 300 },
      { name: 'Joan Mukisa', phone: '+256700200026', gender: 'female', age: 33, occupation: 'Accounts', monthly: 100000, monthsActive: 22, daysAgo: 660 },
      { name: 'Ronald Kaweesi', phone: '+256700200027', gender: 'male', age: 48, occupation: 'Maintenance', monthly: 95000, monthsActive: 30, daysAgo: 900 },
      { name: 'Phoebe Namukose', phone: '+256700200028', gender: 'female', age: 25, occupation: 'Admin', monthly: 55000, monthsActive: 6, status: 'inactive', daysAgo: 180 },
    ],
  },
  {
    id: 'emp-005', name: 'Mbale Coffee Collective', sector: 'Agriculture',
    district: 'Mbale', districtId: 'd-mbale', regionId: 'r-eastern',
    contactName: 'Stella Nambozo', contactPhone: '+256700000035', contactEmail: 'hr@mbalecoffee.demo',
    staff: [
      { name: 'Stella Nambozo', phone: '+256700200031', gender: 'female', age: 40, occupation: 'Co-op Manager', monthly: 105000, monthsActive: 28, daysAgo: 840 },
      { name: 'Wilson Masaba', phone: '+256700200032', gender: 'male', age: 36, occupation: 'Buyer', monthly: 85000, monthsActive: 20, daysAgo: 600 },
      { name: 'Agnes Nandutu', phone: '+256700200033', gender: 'female', age: 32, occupation: 'Grader', monthly: 70000, monthsActive: 16, daysAgo: 480 },
      { name: 'Robert Wepukhulu', phone: '+256700200034', gender: 'male', age: 45, occupation: 'Store Keeper', monthly: 75000, monthsActive: 24, daysAgo: 720 },
      { name: 'Caroline Khaukha', phone: '+256700200035', gender: 'female', age: 28, occupation: 'Admin', monthly: 60000, monthsActive: 10, daysAgo: 300 },
    ],
  },
  {
    id: 'emp-006', name: 'Wakiso Agro Ltd', sector: 'Agriculture',
    district: 'Wakiso', districtId: 'd-wakiso', regionId: 'r-central',
    contactName: 'Julius Ssentongo', contactPhone: '+256700000036', contactEmail: 'hr@wakisoagro.demo',
    staff: [
      { name: 'Julius Ssentongo', phone: '+256700200041', gender: 'male', age: 42, occupation: 'Farm Manager', monthly: 125000, monthsActive: 26, daysAgo: 780 },
      { name: 'Harriet Nansubuga', phone: '+256700200042', gender: 'female', age: 34, occupation: 'Agronomist', monthly: 100000, monthsActive: 20, daysAgo: 600 },
      { name: 'Edward Kiggundu', phone: '+256700200043', gender: 'male', age: 39, occupation: 'Supervisor', monthly: 90000, monthsActive: 18, daysAgo: 540 },
      { name: 'Specioza Nalwoga', phone: '+256700200044', gender: 'female', age: 30, occupation: 'Accounts', monthly: 80000, monthsActive: 14, daysAgo: 420 },
      { name: 'Fred Lubega', phone: '+256700200045', gender: 'male', age: 47, occupation: 'Driver', monthly: 65000, monthsActive: 28, daysAgo: 840 },
      { name: 'Annet Nakimuli', phone: '+256700200046', gender: 'female', age: 26, occupation: 'Field Hand', monthly: 55000, monthsActive: 7, status: 'inactive', daysAgo: 210 },
    ],
  },
  {
    id: 'emp-007', name: 'Lira Cotton Ginnery', sector: 'Manufacturing',
    district: 'Lira', districtId: 'd-lira', regionId: 'r-northern',
    contactName: 'Bonny Ogwang', contactPhone: '+256700000037', contactEmail: 'hr@liracotton.demo',
    staff: [
      { name: 'Bonny Ogwang', phone: '+256700200051', gender: 'male', age: 44, occupation: 'Ginnery Manager', monthly: 115000, monthsActive: 30, daysAgo: 900 },
      { name: 'Florence Apio', phone: '+256700200052', gender: 'female', age: 37, occupation: 'Quality Lead', monthly: 95000, monthsActive: 22, daysAgo: 660 },
      { name: 'Patrick Ocen', phone: '+256700200053', gender: 'male', age: 33, occupation: 'Operator', monthly: 80000, monthsActive: 16, daysAgo: 480 },
      { name: 'Mercy Adong', phone: '+256700200054', gender: 'female', age: 29, occupation: 'Clerk', monthly: 65000, monthsActive: 12, daysAgo: 360 },
      { name: 'James Ebong', phone: '+256700200055', gender: 'male', age: 51, occupation: 'Loader', monthly: 60000, monthsActive: 24, daysAgo: 720 },
    ],
  },
];

// Employer rows for the `employers` table (camelCase mirrors EMPLOYER in employerSeed).
export const EXTRA_EMPLOYERS = Object.freeze(EMPLOYER_DEFS.map((e) => Object.freeze({
  id: e.id,
  name: e.name,
  sector: e.sector,
  registrationNo: `UG-REG-2021-${e.id.slice(-3)}`,
  contactName: e.contactName,
  contactPhone: e.contactPhone,
  contactEmail: e.contactEmail,
  district: e.district,
  districtId: e.districtId,
  regionId: e.regionId,
  payrollCadence: 'monthly',
  // The SAME object the balances above were derived from — see GEO_CONTRIBUTION_CONFIG.
  defaultContributionConfig: GEO_CONTRIBUTION_CONFIG,
})));

// Flat list of all extra members (tagged subscribers) across every employer.
export const EXTRA_MEMBERS = Object.freeze(
  EMPLOYER_DEFS.flatMap((e) => e.staff.map((p, i) => Object.freeze(makeMember(e, p, i)))),
);
