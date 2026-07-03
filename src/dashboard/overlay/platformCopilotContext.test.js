// platformCopilotContext — the derive is a pure function tolerant of the two
// shapes the two roles feed it (admin: get_platform_overview; distributor:
// country agent-tree rollup), and the responder must answer truthfully from the
// derived ctx (never invent numbers, never call the server).

import { describe, it, expect } from 'vitest';
import { buildPlatformCopilotContext, PLATFORM_COPILOT_SUGGESTIONS } from './platformCopilotContext';
import { getPlatformChatResponse } from '../../services/chat';

// Admin source: get_platform_overview() shape (explicit active/inactive counts,
// distributor/employer counts, per-channel acquisition split).
const platformOverview = {
  totalSubscribers: 5017,
  activeSubscribers: 3800,
  inactiveSubscribers: 1217,
  distributors: 1,
  employers: 7,
  branches: 316,
  agents: 2049,
  aum: 1660000000,
  totalContributions: 1660000000,
  totalWithdrawals: 40000000,
  subscribersViaDistributor: 5000,
  subscribersViaEmployer: 16,
  subscribersDirect: 1,
};

// Distributor source: useEntityMetrics('country','ug') shape (activeRate %,
// totalAgents/totalBranches naming, no distributor/employer/channel concept).
const countryRollup = {
  totalSubscribers: 5000,
  activeRate: 70,
  totalAgents: 2049,
  totalBranches: 316,
  aum: 1500000000,
  totalContributions: 1500000000,
  totalWithdrawals: 30000000,
};

describe('buildPlatformCopilotContext', () => {
  it('derives platform figures from the admin get_platform_overview shape', () => {
    const ctx = buildPlatformCopilotContext({ scope: 'admin', overview: platformOverview });
    expect(ctx.scope).toBe('admin');
    expect(ctx.networkName).toBe('the platform');
    expect(ctx.totalSubscribers).toBe(5017);
    expect(ctx.activeSubscribers).toBe(3800);
    expect(ctx.dormant).toBe(1217);
    expect(ctx.activeRate).toBe(76); // round(3800 / 5017 * 100)
    expect(ctx.agents).toBe(2049);
    expect(ctx.branches).toBe(316);
    expect(ctx.distributors).toBe(1);
    expect(ctx.employers).toBe(7);
    expect(ctx.aum).toBe(1660000000);
    // Strongest acquisition channel.
    expect(ctx.topChannelLabel).toBe('distributors');
    expect(ctx.topChannelCount).toBe(5000);
  });

  it('derives network figures from the distributor country-rollup shape (activeRate %)', () => {
    const ctx = buildPlatformCopilotContext({ scope: 'distributor', overview: countryRollup });
    expect(ctx.scope).toBe('distributor');
    expect(ctx.networkName).toBe('your network');
    expect(ctx.totalSubscribers).toBe(5000);
    expect(ctx.activeSubscribers).toBe(3500); // round(5000 * 70 / 100)
    expect(ctx.dormant).toBe(1500); // exact complement
    expect(ctx.activeRate).toBe(70);
    expect(ctx.agents).toBe(2049); // read from totalAgents
    expect(ctx.branches).toBe(316); // read from totalBranches
    // No distributor/employer/channel concept for a single-network view.
    expect(ctx.distributors).toBeNull();
    expect(ctx.employers).toBeNull();
    expect(ctx.topChannelLabel).toBeNull();
  });

  it('honours an entityName override', () => {
    const ctx = buildPlatformCopilotContext({ scope: 'distributor', overview: countryRollup, entityName: 'Acme Network' });
    expect(ctx.networkName).toBe('Acme Network');
  });

  it('exposes 5 starter suggestions', () => {
    expect(PLATFORM_COPILOT_SUGGESTIONS).toHaveLength(5);
  });
});

describe('getPlatformChatResponse (client-side, truthful from ctx)', () => {
  const adminCtx = buildPlatformCopilotContext({ scope: 'admin', overview: platformOverview });
  const distCtx = buildPlatformCopilotContext({ scope: 'distributor', overview: countryRollup });

  it('answers AUM from the ctx figure', async () => {
    const reply = await getPlatformChatResponse("What's our total AUM?", adminCtx);
    expect(reply).toContain('UGX 1.66B');
    expect(reply).toContain('5,017');
  });

  it('answers dormant subscribers with the real count', async () => {
    const reply = await getPlatformChatResponse('How many subscribers are dormant?', adminCtx);
    expect(reply).toContain('1,217');
    expect(reply.toLowerCase()).toContain('dormant');
  });

  it('answers agents + branches from the country-rollup ctx', async () => {
    const reply = await getPlatformChatResponse('How many agents do we have?', distCtx);
    expect(reply).toContain('2,049');
    expect(reply.toLowerCase()).toContain('agent');
  });

  it('answers the acquisition-channel question with the top channel', async () => {
    const reply = await getPlatformChatResponse('Where do most subscribers come from?', adminCtx);
    expect(reply.toLowerCase()).toContain('distributors');
    expect(reply).toContain('5,000');
  });

  it('declines employer questions honestly for a single-network distributor', async () => {
    const reply = await getPlatformChatResponse('How many employers are there?', distCtx);
    expect(reply.toLowerCase()).toContain('head office');
  });

  it('falls back to a capability summary for unmatched questions', async () => {
    const reply = await getPlatformChatResponse('tell me a joke', adminCtx);
    expect(reply).toContain('I can answer about');
  });
});
