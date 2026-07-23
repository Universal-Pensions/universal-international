import { createContext, useContext } from 'react';

/**
 * adminAppBarContext — lets a routed admin mobile page override the app bar's
 * back button and open the Ask-AI (Platform Copilot) surface. Mirrors the
 * distributor mobile app-bar context.
 */
export const AdminAppBarContext = createContext({
  backRef: { current: null },
  registerBack: () => () => {},
  openAskAI: () => {},
});

export function useAdminAppBar() {
  return useContext(AdminAppBarContext);
}
