// A23 — READ-ONLY probe.
//  (a) Render the same subscriber transaction list under two viewer timezones
//      and diff the calendar days shown.
//  (b) Capture how each engine renders en-UG / en-GB / en-US for a fixed
//      number, date and time, to make the "locale drift" impact concrete.
// No writes: navigation + text reads only.
import { chromium, webkit } from '@playwright/test';

const BASE = 'http://localhost:5173';
const STATE = '/Users/shubhang/Desktop/Projects/uganda-dashboard/e2e/.auth/subscriber.json';
const ROUTE = '/dashboard/reports/all-transactions';

const LOCALE_SNIPPET = () => {
  const n = 1234567.5;
  const d = new Date('2026-08-09T00:00:00Z');
  const short = { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' };
  const long = { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' };
  const out = {};
  for (const L of ['en-UG', 'en-GB', 'en-US']) {
    out[L] = {
      grouped: n.toLocaleString(L),
      twoDp: n.toLocaleString(L, { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
      shortDate: d.toLocaleDateString(L, short),
      longDate: d.toLocaleDateString(L, long),
      monthShort: d.toLocaleString(L, { month: 'short', timeZone: 'UTC' }),
      time: d.toLocaleTimeString(L, { hour: '2-digit', minute: '2-digit', timeZone: 'UTC' }),
      resolved: new Intl.DateTimeFormat(L).resolvedOptions().locale,
    };
  }
  return out;
};

async function datesUnder(engine, tz) {
  const browser = await engine.launch();
  const ctx = await browser.newContext({ storageState: STATE, timezoneId: tz, viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  await page.goto(BASE + ROUTE, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(4000);
  // Grab every table cell that looks like a rendered short date ("9 Aug 2026").
  const cells = await page.locator('td, th, li, span, div').allTextContents();
  const dates = cells
    .map((t) => t.trim())
    .filter((t) => /^\d{1,2} [A-Z][a-z]{2} \d{4}$/.test(t));
  await browser.close();
  return dates.slice(0, 12);
}

for (const [name, engine] of [['chromium', chromium], ['webkit', webkit]]) {
  const b = await engine.launch();
  const p = await b.newPage();
  const locales = await p.evaluate(LOCALE_SNIPPET);
  console.log(`\n### ${name} Intl rendering`);
  for (const [L, v] of Object.entries(locales)) {
    console.log(`${L.padEnd(6)} resolved=${v.resolved.padEnd(6)} grouped=${v.grouped}  2dp=${v.twoDp}  short=${v.shortDate}  long=${v.longDate}  monthShort=${v.monthShort}  time=${v.time}`);
  }
  await b.close();
}

console.log('\n### Same page, two viewer timezones (chromium)');
const kla = await datesUnder(chromium, 'Africa/Kampala');
const nyc = await datesUnder(chromium, 'America/New_York');
console.log('Africa/Kampala  :', JSON.stringify(kla));
console.log('America/New_York:', JSON.stringify(nyc));
console.log('identical       :', JSON.stringify(kla) === JSON.stringify(nyc));
