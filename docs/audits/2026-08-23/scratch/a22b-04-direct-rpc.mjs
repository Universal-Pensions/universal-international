// A22 throwaway — hit the RPCs directly (no browser) to isolate backend vs client.
import { mint } from './a22-lib.mjs';
import fs from 'node:fs';
const env = {};
for (const line of fs.readFileSync('.env.local', 'utf8').split('\n')) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
  if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, '');
}
const URL = env.VITE_SUPABASE_URL.replace(/\/+$/, '') + '/rest/v1';
const tok = await mint('admin');
const H = { apikey: env.VITE_SUPABASE_ANON_KEY, Authorization: `Bearer ${tok}`, 'Content-Type': 'application/json' };
const RPCS = ['get_platform_overview', 'get_admin_attention', 'get_employer_geo_rollup', 'get_top_entities'];

console.log('--- SEQUENTIAL (one at a time) ---');
for (let i = 0; i < 3; i++) {
  for (const r of RPCS) {
    const t0 = Date.now();
    const body = r === 'get_top_entities' ? { p_level: 'branch', p_sort_key: null, p_limit: 6 } : {};
    const res = await fetch(`${URL}/rpc/${r}`, { method: 'POST', headers: H, body: JSON.stringify(body) });
    const txt = (await res.text()).slice(0, 120);
    console.log(`${res.status} ${String(Date.now()-t0).padStart(6)}ms ${r} ${res.status >= 400 ? ':: ' + txt : ''}`);
  }
}
console.log('--- PARALLEL (all 4 at once, x3) ---');
for (let i = 0; i < 3; i++) {
  const t0 = Date.now();
  const out = await Promise.all(RPCS.map(async (r) => {
    const body = r === 'get_top_entities' ? { p_level: 'branch', p_sort_key: null, p_limit: 6 } : {};
    const res = await fetch(`${URL}/rpc/${r}`, { method: 'POST', headers: H, body: JSON.stringify(body) });
    const txt = (await res.text()).slice(0, 120);
    return `${res.status} ${r}${res.status >= 400 ? ' :: ' + txt : ''}`;
  }));
  console.log(`batch ${i} (${Date.now()-t0}ms): ` + out.join(' | '));
}
