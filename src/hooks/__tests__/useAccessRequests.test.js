// Unit tests for the admin access-request mutations (A22-005): approving or
// denying a request must invalidate the admin "Needs attention" card, not
// just the request list / platform / entity reads it already invalidated.
//
// Strategy mirrors useTickets.test.js: mock the accessRequests + adminAttention
// SERVICE modules so no real store/RPC is touched, but mount the REAL
// useAdminAttention() hook (not a mock of it) alongside the mutation under
// test. That is the point of these tests — a queryKey typo in the fix would
// invalidate a key nothing is listening on, and the refetch-count assertions
// below would catch it, whereas asserting `invalidateQueries` was "called
// with a string" would pass even with a typo'd key (docs/audits/2026-08-23/
// findings.json A22-005 calls this out explicitly). `usePublishNav`
// (useNav.js) already invalidates ['adminAttention']/['adminAttentionRows']
// correctly on the NAV-publish path — this is the same fix applied here.

import React from 'react';
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

vi.mock('../../services/accessRequests', () => ({
  listAccessRequests: vi.fn(),
  approveAccessRequest: vi.fn(),
  denyAccessRequest: vi.fn(),
}));

vi.mock('../../services/adminAttention', () => ({
  getAdminAttention: vi.fn(),
  getAdminAttentionRows: vi.fn(),
}));

const accessRequestsSvc = await import('../../services/accessRequests');
const adminAttentionSvc = await import('../../services/adminAttention');
const { useApproveAccessRequest, useDenyAccessRequest } = await import('../useAccessRequests');
// The REAL hook — not re-declared or mocked — so its actual queryKey
// (['adminAttention'], defined in useAdminAttention.js) is what gets exercised.
const { useAdminAttention } = await import('../useAdminAttention');

function makeWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });
  const Wrapper = ({ children }) => (
    React.createElement(QueryClientProvider, { client: queryClient }, children)
  );
  return { queryClient, Wrapper };
}

beforeEach(() => {
  vi.clearAllMocks();
  adminAttentionSvc.getAdminAttention.mockResolvedValue({ pendingAccessRequests: 4 });
  accessRequestsSvc.approveAccessRequest.mockResolvedValue({ id: 'ar-1', status: 'approved' });
  accessRequestsSvc.denyAccessRequest.mockResolvedValue({ id: 'ar-1', status: 'denied' });
});

afterEach(() => {
  vi.resetAllMocks();
});

describe('useApproveAccessRequest / useDenyAccessRequest — admin Needs-attention invalidation (A22-005)', () => {
  it('approve refetches the REAL useAdminAttention() query', async () => {
    const { Wrapper } = makeWrapper();

    // Mount the real admin-attention hook — the actual ['adminAttention'] key
    // registered by useAdminAttention.js — alongside the mutation, exactly as
    // the admin home + Access-requests screen do together in the running app.
    const { result: attention } = renderHook(() => useAdminAttention(), { wrapper: Wrapper });
    await waitFor(() => expect(attention.current.isSuccess).toBe(true));
    expect(adminAttentionSvc.getAdminAttention).toHaveBeenCalledTimes(1);

    const { result: approve } = renderHook(() => useApproveAccessRequest(), { wrapper: Wrapper });
    await act(async () => {
      await approve.current.mutateAsync('ar-1');
    });

    // If useAccessRequests.js invalidated a mistyped key (e.g. 'adminAttentions'
    // or 'admin-attention'), this call count would still read 1 forever — that
    // is exactly the failure this test exists to catch.
    await waitFor(() => expect(adminAttentionSvc.getAdminAttention).toHaveBeenCalledTimes(2));
  });

  it('deny also refetches the REAL useAdminAttention() query', async () => {
    const { Wrapper } = makeWrapper();
    const { result: attention } = renderHook(() => useAdminAttention(), { wrapper: Wrapper });
    await waitFor(() => expect(attention.current.isSuccess).toBe(true));
    expect(adminAttentionSvc.getAdminAttention).toHaveBeenCalledTimes(1);

    const { result: deny } = renderHook(() => useDenyAccessRequest(), { wrapper: Wrapper });
    await act(async () => {
      await deny.current.mutateAsync('ar-1');
    });

    await waitFor(() => expect(adminAttentionSvc.getAdminAttention).toHaveBeenCalledTimes(2));
  });

  it('approve still invalidates every pre-existing key too (no regression from the fix)', async () => {
    const { Wrapper, queryClient } = makeWrapper();
    const spy = vi.spyOn(queryClient, 'invalidateQueries');

    const { result } = renderHook(() => useApproveAccessRequest(), { wrapper: Wrapper });
    await act(async () => {
      await result.current.mutateAsync('ar-1');
    });

    const invalidatedRoots = spy.mock.calls.map((call) => call[0]?.queryKey?.[0]);
    expect(invalidatedRoots).toEqual(
      expect.arrayContaining([
        'accessRequests',
        'platformOverview',
        'entities',
        'entitiesMap',
        'allEmployersMetrics',
        'adminAttention',
        'adminAttentionRows',
      ]),
    );
  });

  it('deny still invalidates accessRequests too (no regression from the fix)', async () => {
    const { Wrapper, queryClient } = makeWrapper();
    const spy = vi.spyOn(queryClient, 'invalidateQueries');

    const { result } = renderHook(() => useDenyAccessRequest(), { wrapper: Wrapper });
    await act(async () => {
      await result.current.mutateAsync('ar-1');
    });

    const invalidatedRoots = spy.mock.calls.map((call) => call[0]?.queryKey?.[0]);
    expect(invalidatedRoots).toEqual(
      expect.arrayContaining(['accessRequests', 'adminAttention', 'adminAttentionRows']),
    );
  });
});
