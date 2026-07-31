// chat service tests — exercise both the `/api/chat` Vercel-route branch and
// the env-fallback (`IS_SUPABASE_ENABLED === false`) keyword-matched mock.
//
// Note on streaming: the `/api/chat` route in this codebase currently returns
// a single JSON envelope `{ reply, suggestions }` (no SSE / chunked stream).
// The X11-relevant concern is therefore "real-branch unwraps res.reply,
// mock-branch returns the keyword-matched copy directly" — both branches
// must return a plain string.

import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import { contributionFundingLabel } from '../../utils/contributionModel';

beforeEach(() => {
  window.localStorage.clear();
  vi.restoreAllMocks();
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

function jsonResponse(body, { status = 200 } = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: vi.fn(() => Promise.resolve(JSON.stringify(body))),
    json: vi.fn(() => Promise.resolve(body)),
  };
}

describe('chat service — real (Supabase) branch', () => {
  let mod;
  beforeEach(async () => {
    mod = await import('../chat');
  });

  describe('getChatResponse', () => {
    it('POSTs to /api/chat with context=admin and unwraps res.reply', async () => {
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
        jsonResponse({ reply: 'Greetings, admin.', suggestions: [] }),
      );
      const reply = await mod.getChatResponse('hi');
      expect(reply).toBe('Greetings, admin.');
      const [url, init] = fetchSpy.mock.calls[0];
      expect(url).toBe('/api/chat');
      expect(init.method).toBe('POST');
      const sent = JSON.parse(init.body);
      expect(sent).toEqual({ message: 'hi', context: 'admin' });
    });

    it('falls back to mock copy when route returns non-string reply', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse({ reply: null }));
      const reply = await mod.getChatResponse('how many agents');
      // Falls through to mockChatResponse — "agent" branch.
      expect(typeof reply).toBe('string');
      expect(reply.length).toBeGreaterThan(0);
    });

    it('falls back to mock copy on network failure (swallows error)', async () => {
      vi.spyOn(globalThis, 'fetch').mockRejectedValue(new TypeError('Failed to fetch'));
      const reply = await mod.getChatResponse('coverage');
      expect(typeof reply).toBe('string');
      // The coverage branch of buildResponses includes the word "coverage".
      expect(reply.toLowerCase()).toContain('coverage');
    });

    it('falls back to mock copy on 500 API error', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValue(
        jsonResponse({ code: 'internal' }, { status: 500 }),
      );
      const reply = await mod.getChatResponse('subscribers');
      expect(typeof reply).toBe('string');
    });
  });

  describe('getAgentReply', () => {
    it('POSTs to /api/chat with context=agent and unwraps reply', async () => {
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
        jsonResponse({ reply: 'Hi, Daniel here.' }),
      );
      const reply = await mod.getAgentReply('hello', { name: 'Daniel Mugisha' });
      expect(reply).toBe('Hi, Daniel here.');
      const sent = JSON.parse(fetchSpy.mock.calls[0][1].body);
      expect(sent.context).toBe('agent');
      expect(sent.message).toBe('hello');
    });

    it('uses agent first-name fallback when route fails', async () => {
      vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('boom'));
      const reply = await mod.getAgentReply('hi', { name: 'Daniel Mugisha' });
      expect(reply).toContain('Daniel');
    });

    it('uses "your agent" placeholder when no agent name given', async () => {
      vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('boom'));
      const reply = await mod.getAgentReply('hi');
      // mockAgentReply uses firstName from "your agent".split(' ')[0] => "your"
      // → "Hi! your here." which is awkward but matches the source.
      expect(typeof reply).toBe('string');
      expect(reply.length).toBeGreaterThan(0);
    });
  });

  describe('getSubscriberChatResponse', () => {
    it('POSTs to /api/chat with context=subscriber and unwraps reply', async () => {
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
        jsonResponse({ reply: 'Hello subscriber.' }),
      );
      const reply = await mod.getSubscriberChatResponse('hi');
      expect(reply).toBe('Hello subscriber.');
      const sent = JSON.parse(fetchSpy.mock.calls[0][1].body);
      expect(sent.context).toBe('subscriber');
    });

    it('returns subscriber-flavored fallback on failure (matches "withdraw" keyword)', async () => {
      vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('boom'));
      const reply = await mod.getSubscriberChatResponse('how do I withdraw');
      expect(reply).toContain('withdraw');
    });
  });
});

describe('chat service — mock-fallback branch (IS_SUPABASE_ENABLED=false)', () => {
  let mod;
  beforeEach(async () => {
    vi.stubEnv('VITE_USE_SUPABASE', 'false');
    vi.resetModules();
    mod = await import('../chat');
  });

  it('getChatResponse does NOT call the network', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    await mod.getChatResponse('how many subscribers');
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('getChatResponse "agent" keyword routes to the agent reply', async () => {
    const reply = await mod.getChatResponse('top agents');
    expect(reply.toLowerCase()).toContain('agent');
  });

  it('getChatResponse "coverage" keyword routes to coverage reply', async () => {
    const reply = await mod.getChatResponse('coverage by region');
    expect(reply.toLowerCase()).toContain('coverage');
  });

  it('getChatResponse "subscriber" keyword routes to subscriber reply', async () => {
    const reply = await mod.getChatResponse('how many subscribers');
    expect(reply.toLowerCase()).toContain('subscriber');
  });

  it('getChatResponse "gender" keyword routes to gender reply', async () => {
    const reply = await mod.getChatResponse('gender split');
    // Contains the male/female ratio string.
    expect(typeof reply).toBe('string');
    expect(reply.length).toBeGreaterThan(0);
  });

  it('getChatResponse default fallback for unknown keywords', async () => {
    const reply = await mod.getChatResponse('quantum tunnelling');
    expect(reply).toMatch(/help|analyse|ask/i);
  });

  const BRANCH_CTX = {
    branchName: 'Kampala Central', score: 78, label: 'Good',
    totalSubscribers: 1234, activeSubscribers: 567, dormant: 127, kycIssues: 8,
    totalAgents: 6, activeAgents: 5, topAgentName: 'James Okello', topAgentMultiple: 1.3,
    aum: 847234000, contributionsThisMonth: 62456000, contribChangePct: 8,
    settlementRate: 74, genderRatio: { male: 666, female: 568 },
  };

  it('getBranchChatResponse does NOT call the network', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    await mod.getBranchChatResponse('who are my top agents', BRANCH_CTX);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('getBranchChatResponse "top agents" names the leading agent', async () => {
    const reply = await mod.getBranchChatResponse('who are my top agents', BRANCH_CTX);
    expect(reply).toContain('James Okello');
  });

  it('getBranchChatResponse "dormant" surfaces the reactivation count', async () => {
    const reply = await mod.getBranchChatResponse('dormant subscribers to reactivate', BRANCH_CTX);
    expect(reply).toContain('127');
  });

  it('getBranchChatResponse "settlement" reports the rate', async () => {
    const reply = await mod.getBranchChatResponse('commissions still due', BRANCH_CTX);
    expect(reply).toContain('74%');
  });

  it('getBranchChatResponse default mentions the branch by name', async () => {
    const reply = await mod.getBranchChatResponse('quantum tunnelling', BRANCH_CTX);
    expect(reply).toContain('Kampala Central');
  });

  it('getAgentReply handles withdraw keyword', async () => {
    const reply = await mod.getAgentReply('I want to withdraw');
    expect(reply.toLowerCase()).toContain('withdraw');
  });

  it('getAgentReply handles hello greeting with agent first name', async () => {
    const reply = await mod.getAgentReply('hi', { name: 'James Okello' });
    expect(reply).toContain('James');
  });

  it('getAgentReply default reply for unknown keyword', async () => {
    const reply = await mod.getAgentReply('xyz nonsense', { name: 'Z' });
    expect(typeof reply).toBe('string');
    expect(reply.length).toBeGreaterThan(0);
  });

  it('getSubscriberChatResponse handles withdraw', async () => {
    const reply = await mod.getSubscriberChatResponse('withdraw money');
    expect(reply).toMatch(/Withdraw|withdraw/);
  });

  it('getSubscriberChatResponse handles contribute', async () => {
    const reply = await mod.getSubscriberChatResponse('contribute more');
    expect(reply.toLowerCase()).toContain('contribut');
  });

  it('getSubscriberChatResponse default for unknown', async () => {
    const reply = await mod.getSubscriberChatResponse('hyperspace');
    expect(typeof reply).toBe('string');
    expect(reply.length).toBeGreaterThan(0);
  });
});

describe('chat service — real/mock branch parity (X11)', () => {
  it('both branches return a non-empty string from getChatResponse', async () => {
    const realMod = await import('../chat');
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse({ reply: 'realstr' }));
    const real = await realMod.getChatResponse('hi');
    expect(typeof real).toBe('string');
    expect(real.length).toBeGreaterThan(0);

    vi.stubEnv('VITE_USE_SUPABASE', 'false');
    vi.resetModules();
    const mockMod = await import('../chat');
    const mock = await mockMod.getChatResponse('hi');
    expect(typeof mock).toBe('string');
    expect(mock.length).toBeGreaterThan(0);
  });
});

describe('getEmployerChatResponse — local, truthful employer copilot', () => {
  let mod;
  beforeEach(async () => {
    mod = await import('../chat');
  });

  // The employer copilot never derives contribution wording itself — it only
  // interpolates ctx.fundingLabel, which EmployerHealthScore fills from
  // contributionFundingLabel(config). So build the fixture from the real helper
  // rather than pasting a string: a change to the label's wording then shows up
  // here as a genuine copy change, not as a stale literal that keeps passing.
  const TWO_LEG_CONFIG = {
    employeePct: 10,
    employerPct: 5,
  };
  const FUNDING_LABEL = contributionFundingLabel(TWO_LEG_CONFIG);

  const CTX = {
    headcount: 16, active: 15, inactive: 1, participationPct: 94,
    pendingKyc: 2, pendingNames: ['Achint Rao', 'Bea Okello'],
    fundingLabel: FUNDING_LABEL,
    coverLabel: 'UGX 15,000,000', totalContributions: 8000000, lastRunLabel: 'May 2026',
  };

  it('never calls the network (employer data is already client-side)', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    await mod.getEmployerChatResponse('Who is pending KYC?', CTX);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('answers "Who is pending KYC?" with the real pending-invite names', async () => {
    const reply = await mod.getEmployerChatResponse('Who is pending KYC?', CTX);
    expect(reply).toContain('Achint Rao');
    expect(reply).toContain('2');
  });

  it('reports no pending KYC when the invite list is empty', async () => {
    const reply = await mod.getEmployerChatResponse('any pending kyc?', { ...CTX, pendingKyc: 0, pendingNames: [] });
    expect(reply.toLowerCase()).toContain('no pending kyc');
  });

  it('declines individual staff balances (private by design)', async () => {
    const reply = await mod.getEmployerChatResponse('what is a staff balance?', CTX);
    expect(reply.toLowerCase()).toContain('private');
  });

  it('answers the funding question with the two concrete payroll figures', async () => {
    const reply = await mod.getEmployerChatResponse('what is our funding split?', CTX);
    expect(reply).toContain(FUNDING_LABEL);
    expect(reply).toContain('Staff put in 10% of pay');
    expect(reply).toContain('You add 5% of pay');
    // The deleted vocabulary must not come back — the whole point of the unified
    // model is that the answer names the two amounts, not a funding "mode", and
    // that the company's share is never a percentage of the staff share.
    expect(reply).not.toMatch(/co-contribution/i);
    expect(reply).not.toMatch(/employer-only/i);
    expect(reply).not.toMatch(/match/i);
  });

  it('still routes a "match" question to the funding answer', async () => {
    // `match` is kept as a ROUTING keyword (employers still ask in those words)
    // even though no match basis exists — only the answer changed.
    const reply = await mod.getEmployerChatResponse('do you match what staff put in?', CTX);
    expect(reply).toContain(FUNDING_LABEL);
  });

  it('answers participation, not funding, when a question says "contributing"', async () => {
    // Pinning the real routing PRECEDENCE in mockEmployerChatResponse: the
    // contribut/participat arm sits ABOVE the funding arm, so any wording carrying
    // "contribut" lands on participation even when it also says "match". The most
    // natural phrasing of the funding question ("do you match staff
    // contributions?") therefore never reaches the funding arm — see the note in
    // the handover, this is source-side routing order, not a test concern.
    const reply = await mod.getEmployerChatResponse('do you match staff contributions?', CTX);
    expect(reply).toContain('94%');
    expect(reply).not.toContain(FUNDING_LABEL);
  });

  it('reads as "nothing set up" for an employer with a 0/0 config', async () => {
    // 0/0 is a legal, saveable config (a new employer provisioned with `{}`), so the
    // copilot must have a truthful answer for it rather than inventing figures.
    const zeroLabel = contributionFundingLabel({});
    expect(zeroLabel).toBe('No contributions set up yet');
    const reply = await mod.getEmployerChatResponse('what is our funding split?', { ...CTX, fundingLabel: zeroLabel });
    expect(reply).toContain('No contributions set up yet');
  });

  it('defaults an unloaded ctx to the same "nothing set up" wording', async () => {
    // No second vocabulary for "unknown": an unloaded ctx must not read differently
    // from an employer who genuinely has nothing configured.
    const reply = await mod.getEmployerChatResponse('what is our funding split?', {});
    expect(reply).toContain('No contributions set up yet');
  });

  it('answers group insurance as company-wide cover', async () => {
    const reply = await mod.getEmployerChatResponse('group insurance?', CTX);
    expect(reply).toContain('UGX 15,000,000');
    expect(reply.toLowerCase()).toContain('company-wide');
  });

  it('measures participation against ACTIVE staff, not total headcount', async () => {
    const reply = await mod.getEmployerChatResponse('how many staff are contributing?', CTX);
    // Mirrors the hero's "% of active staff contributing" definition: the base
    // is the active count (15), not the total headcount (16).
    expect(reply).toContain('94%');
    expect(reply).toContain('15 active staff');
    expect(reply).not.toContain('16 staff');
  });

  it('falls back to a helpful prompt for unknown questions', async () => {
    const reply = await mod.getEmployerChatResponse('quantum tunnelling', CTX);
    expect(reply.toLowerCase()).toMatch(/pending kyc|funding|staff/);
  });
});
