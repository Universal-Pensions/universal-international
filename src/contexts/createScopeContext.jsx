import { createContext, useContext, useMemo } from 'react';

// Factory for the per-role "scope" contexts (Agent / Branch / Employer). Each
// provides a single scope id (`agentId` / `branchId` / `employerId`) to
// descendants so deeply nested, lazy-loaded panels and report views can read
// scope without threading props through every layer. When a tree is NOT wrapped
// by its provider, consumers read the id as null and fall back to network-wide
// data.
//
// Returns { ScopeProvider, useScope } bound to `keyName`. The provider accepts
// the id under a prop named `keyName` (e.g. <AgentScopeProvider agentId={…}>)
// and exposes it on the context value under the same key. Replaces three
// previously verbatim-cloned context modules (audit DUP-8 / SL-5 / ARCH-5).
export function createScopeContext(keyName) {
  const ScopeContext = createContext({ [keyName]: null });

  function ScopeProvider({ children, [keyName]: id = null }) {
    // `?? null` (not `|| null`) so a legitimately falsy id like 0 isn't coerced
    // to null — only null/undefined mean "no scope".
    const value = useMemo(() => ({ [keyName]: id ?? null }), [id]);
    return <ScopeContext value={value}>{children}</ScopeContext>;
  }

  function useScope() {
    return useContext(ScopeContext);
  }

  return { ScopeProvider, useScope };
}
