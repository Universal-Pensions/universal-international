// Unit tests for the `useEmployer` family of hooks (audit §7b.5 / §7b.7).
//
// Strategy mirrors useEntity.test.js: mock the service module (`../../services/
// employer`) so we test the React-Query wiring — query enablement/gating, cache
// keys + staleTime honoring, and mutation invalidation — without touching
// Supabase (the service layer itself is covered in employer.test.js).
//
// Priority hooks (per the audit): the admin mutations (useCreateEmployer),
// useRunContribution, useCreateInvite, useCancelInvite, useUpdateEmployerProfile
// (optimistic + rollback), plus the admin read useAllEmployersMetrics.

import React from 'react';
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

vi.mock('../../services/employer', () => ({
  getEmployer: vi.fn(),
  getEmployees: vi.fn(),
  getEmployee: vi.fn(),
  getContributionRuns: vi.fn(),
  getContributionRun: vi.fn(),
  getEmployeeContributions: vi.fn(),
  getEmployerMetrics: vi.fn(),
  getEmployerLeaderboard: vi.fn(),
  updateEmployerProfile: vi.fn(),
  listPendingInvites: vi.fn(),
  createEmployerInvite: vi.fn(),
  bulkCreateEmployerInvites: vi.fn(),
  cancelEmployerInvite: vi.fn(),
  applyGroupInsurance: vi.fn(),
  removeEmployee: vi.fn(),
  submitContributionRun: vi.fn(),
  updateMemberCompensation: vi.fn(),
  getAllEmployersMetrics: vi.fn(),
  createEmployer: vi.fn(),
  setEmployerStatus: vi.fn(),
}));

const employer = await import('../../services/employer');
const {
  useEmployer,
  useEmployees,
  usePendingInvites,
  useEmployerMetrics,
  useCreateInvite,
  useBulkCreateInvites,
  useCancelInvite,
  useRunContribution,
  useRemoveEmployee,
  useUpdateMemberCompensation,
  useUpdateEmployerProfile,
  useAllEmployersMetrics,
  useCreateEmployer,
  useSetEmployerStatus,
} = await import('../useEmployer');

function makeWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false, staleTime: 5 * 60 * 1000 },
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
});

afterEach(() => {
  vi.resetAllMocks();
});

describe('useEmployer hooks — queries', () => {
  it('useEmployer is disabled without an employerId', async () => {
    const { Wrapper } = makeWrapper();
    const { result } = renderHook(() => useEmployer(null), { wrapper: Wrapper });
    expect(result.current.fetchStatus).toBe('idle');
    expect(employer.getEmployer).not.toHaveBeenCalled();
  });

  it('useEmployer fetches and returns data when an id is present', async () => {
    employer.getEmployer.mockResolvedValue({ id: 'emp-001', name: 'Acme' });
    const { Wrapper } = makeWrapper();
    const { result } = renderHook(() => useEmployer('emp-001'), { wrapper: Wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual({ id: 'emp-001', name: 'Acme' });
    expect(employer.getEmployer).toHaveBeenCalledWith('emp-001');
  });

  it('useEmployees caches by queryKey — remount within staleTime does not re-call', async () => {
    employer.getEmployees.mockResolvedValue([{ id: 's-1' }]);
    const { Wrapper } = makeWrapper();
    const { result, unmount } = renderHook(() => useEmployees('emp-001'), { wrapper: Wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    unmount();
    const { result: result2 } = renderHook(() => useEmployees('emp-001'), { wrapper: Wrapper });
    expect(result2.current.data).toEqual([{ id: 's-1' }]);
    expect(employer.getEmployees).toHaveBeenCalledTimes(1);
  });

  it('usePendingInvites is disabled without an employerId', async () => {
    const { Wrapper } = makeWrapper();
    const { result } = renderHook(() => usePendingInvites(undefined), { wrapper: Wrapper });
    expect(result.current.fetchStatus).toBe('idle');
    expect(employer.listPendingInvites).not.toHaveBeenCalled();
  });

  it('useEmployerMetrics threads employerId into the service call (A14-001)', async () => {
    // getEmployerMetrics now needs employerId to recompute the run-linked
    // contribution totals (see employer.test.js) — a regression back to the
    // no-arg call would silently zero those figures out again.
    employer.getEmployerMetrics.mockResolvedValue({ headcount: 16, active: 14 });
    const { Wrapper } = makeWrapper();
    const { result } = renderHook(() => useEmployerMetrics('emp-001'), { wrapper: Wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toMatchObject({ headcount: 16 });
    expect(employer.getEmployerMetrics).toHaveBeenCalledTimes(1);
    expect(employer.getEmployerMetrics).toHaveBeenCalledWith('emp-001');
  });

  it('useAllEmployersMetrics (admin) fetches the platform-wide rollup', async () => {
    employer.getAllEmployersMetrics.mockResolvedValue([{ id: 'emp-001', headcount: 16 }]);
    const { Wrapper } = makeWrapper();
    const { result } = renderHook(() => useAllEmployersMetrics(), { wrapper: Wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual([{ id: 'emp-001', headcount: 16 }]);
    expect(employer.getAllEmployersMetrics).toHaveBeenCalledTimes(1);
  });
});

describe('useEmployer hooks — mutations + invalidation', () => {
  it('useCreateInvite invalidates the pending-invites list on success', async () => {
    // collectSchedule is a KYC-DEPTH flag and is a constant TRUE since 0092 (how
    // complete a record an invite collects, never who pays). The hook only cares
    // about the invalidation, but the fixture should still be a value the service
    // can actually return.
    employer.createEmployerInvite.mockResolvedValue({ token: 'inv-1', collectSchedule: true });
    const { queryClient, Wrapper } = makeWrapper();
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');
    const { result } = renderHook(() => useCreateInvite('emp-001'), { wrapper: Wrapper });

    await act(async () => {
      await result.current.mutateAsync({ fullName: 'Jane', phone: '700100099' });
    });

    expect(employer.createEmployerInvite).toHaveBeenCalledWith({ fullName: 'Jane', phone: '700100099' });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['pendingInvites', 'emp-001'] });
  });

  it('useBulkCreateInvites invalidates the pending-invites list on success', async () => {
    employer.bulkCreateEmployerInvites.mockResolvedValue({ created: 2, failed: 0, total: 2 });
    const { queryClient, Wrapper } = makeWrapper();
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');
    const { result } = renderHook(() => useBulkCreateInvites('emp-001'), { wrapper: Wrapper });

    await act(async () => {
      await result.current.mutateAsync([{ fullName: 'A' }, { fullName: 'B' }]);
    });

    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['pendingInvites', 'emp-001'] });
  });

  it('useCancelInvite passes the token through and invalidates the pending list', async () => {
    employer.cancelEmployerInvite.mockResolvedValue(undefined);
    const { queryClient, Wrapper } = makeWrapper();
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');
    const { result } = renderHook(() => useCancelInvite('emp-001'), { wrapper: Wrapper });

    await act(async () => {
      await result.current.mutateAsync('inv-1');
    });

    expect(employer.cancelEmployerInvite).toHaveBeenCalledWith('inv-1');
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['pendingInvites', 'emp-001'] });
  });

  it('useRunContribution invalidates every read the run could move', async () => {
    employer.submitContributionRun.mockResolvedValue({ runId: 'run-1', linesCreated: 14 });
    const { queryClient, Wrapper } = makeWrapper();
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');
    const { result } = renderHook(() => useRunContribution('emp-001'), { wrapper: Wrapper });

    await act(async () => {
      await result.current.mutateAsync({ periodLabel: 'May 2026', method: 'Bank transfer', nonce: 'n-1' });
    });

    expect(employer.submitContributionRun).toHaveBeenCalledWith('emp-001', {
      periodLabel: 'May 2026', method: 'Bank transfer', nonce: 'n-1',
    });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['employees', 'emp-001'] });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['contributionRuns', 'emp-001'] });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['employerMetrics', 'emp-001'] });
  });

  it('useRemoveEmployee invalidates the roster + metrics + open employee detail', async () => {
    employer.removeEmployee.mockResolvedValue({ id: 's-1', removed: true });
    const { queryClient, Wrapper } = makeWrapper();
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');
    const { result } = renderHook(() => useRemoveEmployee('emp-001'), { wrapper: Wrapper });

    await act(async () => {
      await result.current.mutateAsync({ employeeId: 's-1' });
    });

    expect(employer.removeEmployee).toHaveBeenCalledWith('emp-001', 's-1');
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['employees', 'emp-001'] });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['employee'] });
  });

  it('useUpdateMemberCompensation (v2, 0062) passes (employerId, employeeId, compensation) and invalidates the roster + metrics + open detail', async () => {
    employer.updateMemberCompensation.mockResolvedValue({ id: 's-1', compensation: 1500000, updated: 1 });
    const { queryClient, Wrapper } = makeWrapper();
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');
    const { result } = renderHook(() => useUpdateMemberCompensation('emp-001'), { wrapper: Wrapper });

    await act(async () => {
      await result.current.mutateAsync({ employeeId: 's-1', compensation: 1500000 });
    });

    expect(employer.updateMemberCompensation).toHaveBeenCalledWith('emp-001', 's-1', 1500000);
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['employees', 'emp-001'] });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['employerMetrics', 'emp-001'] });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['employee'] });
  });

  it('useCreateEmployer (admin) invalidates the admin roster rollup on success', async () => {
    employer.createEmployer.mockResolvedValue({ id: 'emp-new-1', name: 'New Co' });
    const { queryClient, Wrapper } = makeWrapper();
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');
    const { result } = renderHook(() => useCreateEmployer(), { wrapper: Wrapper });

    await act(async () => {
      await result.current.mutateAsync({ name: 'New Co' });
    });

    // The hook passes the bare service fn as mutationFn, so React Query invokes
    // it as (variables, context) — assert on the first positional arg only.
    expect(employer.createEmployer.mock.calls[0][0]).toEqual({ name: 'New Co' });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['allEmployersMetrics'] });
    // Symmetric with useCreateDistributor — the platform overview counts employers.
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['platformOverview'] });
  });
});

describe('useUpdateEmployerProfile — optimistic patch + rollback', () => {
  it('optimistically patches the cached employer (stripping insurance-control keys)', async () => {
    let resolveUpdate;
    employer.updateEmployerProfile.mockReturnValue(new Promise((res) => { resolveUpdate = res; }));
    const { queryClient, Wrapper } = makeWrapper();
    queryClient.setQueryData(['employer', 'emp-001'], { id: 'emp-001', name: 'Old Co' });

    const { result } = renderHook(() => useUpdateEmployerProfile('emp-001'), { wrapper: Wrapper });
    act(() => {
      // insuranceEnabled / groupCover must NOT leak into the cached employer.
      result.current.mutate({ name: 'New Co', insuranceEnabled: true, groupCover: 5000000 });
    });

    await waitFor(() => {
      expect(queryClient.getQueryData(['employer', 'emp-001'])).toEqual({ id: 'emp-001', name: 'New Co' });
    });

    await act(async () => { resolveUpdate({ id: 'emp-001', name: 'New Co' }); });
  });

  it('rolls the cache back to the pre-mutation snapshot on error', async () => {
    employer.updateEmployerProfile.mockRejectedValue(new Error('permission denied'));
    const { queryClient, Wrapper } = makeWrapper();
    queryClient.setQueryData(['employer', 'emp-001'], { id: 'emp-001', name: 'Old Co' });

    const { result } = renderHook(() => useUpdateEmployerProfile('emp-001'), { wrapper: Wrapper });
    await act(async () => {
      try {
        await result.current.mutateAsync({ name: 'New Co' });
      } catch {
        // Expected — the mutation rejects.
      }
    });

    expect(queryClient.getQueryData(['employer', 'emp-001'])).toEqual({ id: 'emp-001', name: 'Old Co' });
  });
});

describe('useSetEmployerStatus — optimistic patch + rollback + invalidation', () => {
  it('optimistically flips status on the rendered admin rollup (allEmployersMetrics) before settle', async () => {
    let resolveSet;
    employer.setEmployerStatus.mockReturnValue(new Promise((res) => { resolveSet = res; }));
    const { queryClient, Wrapper } = makeWrapper();
    // The status pill renders off useAllEmployersMetrics = ['allEmployersMetrics'].
    queryClient.setQueryData(['allEmployersMetrics'], [
      { id: 'emp-001', name: 'Acme', status: 'active' },
      { id: 'emp-002', name: 'Other', status: 'active' },
    ]);

    const { result } = renderHook(() => useSetEmployerStatus(), { wrapper: Wrapper });
    act(() => {
      result.current.mutate({ id: 'emp-001', status: 'inactive' });
    });

    await waitFor(() => {
      expect(queryClient.getQueryData(['allEmployersMetrics'])).toEqual([
        { id: 'emp-001', name: 'Acme', status: 'inactive' },
        { id: 'emp-002', name: 'Other', status: 'active' },
      ]);
    });

    await act(async () => {
      resolveSet({ id: 'emp-001', status: 'inactive' });
    });
  });

  it('rolls the rollup back to the pre-mutation snapshot on error', async () => {
    employer.setEmployerStatus.mockRejectedValue(new Error('rls denied'));
    const { queryClient, Wrapper } = makeWrapper();
    queryClient.setQueryData(['allEmployersMetrics'], [
      { id: 'emp-001', name: 'Acme', status: 'active' },
    ]);

    const { result } = renderHook(() => useSetEmployerStatus(), { wrapper: Wrapper });
    await act(async () => {
      try {
        await result.current.mutateAsync({ id: 'emp-001', status: 'inactive' });
      } catch {
        // Expected — the mutation rejects.
      }
    });

    expect(queryClient.getQueryData(['allEmployersMetrics'])).toEqual([
      { id: 'emp-001', name: 'Acme', status: 'active' },
    ]);
  });

  it('invalidates every employer + platform read the detach moves on settle', async () => {
    employer.setEmployerStatus.mockResolvedValue({ id: 'emp-001', status: 'inactive' });
    const { queryClient, Wrapper } = makeWrapper();
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');
    const { result } = renderHook(() => useSetEmployerStatus(), { wrapper: Wrapper });

    await act(async () => {
      await result.current.mutateAsync({ id: 'emp-001', status: 'inactive' });
    });

    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['allEmployersMetrics'] });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['platformOverview'] });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['employees', 'emp-001'] });
  });
});
