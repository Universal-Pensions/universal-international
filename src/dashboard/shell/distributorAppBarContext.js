import { createContext, useContext } from 'react';

/**
 * distributorAppBarContext — lets a routed distributor mobile page override the
 * app bar's back button (for in-page sub-views that should step back before
 * leaving the route) and open the Ask-AI (Network Copilot) surface. Mirrors the
 * branch/employer mobile app-bar contexts.
 */
export const DistributorAppBarContext = createContext({
  backRef: { current: null },
  registerBack: () => () => {},
  openAskAI: () => {},
});

export function useDistributorAppBar() {
  return useContext(DistributorAppBarContext);
}
