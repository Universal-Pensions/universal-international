import { useParams } from 'react-router-dom';
import ViewSubscribers from '../../dashboard/subscriber/ViewSubscribers';

/**
 * AgentSubscribersMobile — agent-scoped subscriber list on the BRANCH PHONE
 * shell — /dashboard/agents/:agentId/subscribers (AUDIT A12-005).
 *
 * Mirrors the desktop route's BranchAgentSubscribers.jsx exactly: the branch
 * shell is fully routed (its own <Routes>), so the id comes straight off the
 * route param rather than DashboardNavContext's parsed path, and hands it to
 * the same shared ViewSubscribers panel (which already carries mobile-width
 * CSS for its slide-in `.panel` form — see ViewSubscribers.module.css's
 * `@media (max-width: 768px)` block). `fullPage` renders it as a static block
 * inside the mobile shell's scrollable <main> rather than a fixed drawer.
 *
 * A branch admin's RLS already limits them to their own branch; this narrows
 * further to ONE of their agents, matching AgentDetailMobile's "View
 * subscribers" link and the desktop drill-down it mirrors.
 */
export default function AgentSubscribersMobile() {
  const { agentId } = useParams();
  return <ViewSubscribers fullPage scope={agentId ? { agentId } : null} />;
}
