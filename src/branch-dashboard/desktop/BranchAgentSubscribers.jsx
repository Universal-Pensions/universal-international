import { useParams } from 'react-router-dom';
import ViewSubscribers from '../../dashboard/subscriber/ViewSubscribers';

/**
 * Agent-scoped subscriber list inside the BRANCH shell —
 * /dashboard/agents/:agentId/subscribers.
 *
 * The branch shell is fully routed (its own <Routes>), so unlike the distributor
 * shell it can't read the scope off DashboardNavContext's parsed path. It takes
 * the id straight from the route param instead and hands it to the same shared
 * ViewSubscribers panel, which pushes the filter down to PostgREST
 * (entities.getAllAtLevel('subscriber', { agentId })).
 *
 * A branch admin's RLS already limits them to their own branch; this narrows
 * further to ONE of their agents, which is what the drill-down promises.
 */
export default function BranchAgentSubscribers() {
  const { agentId } = useParams();
  return <ViewSubscribers fullPage scope={agentId ? { agentId } : null} />;
}
