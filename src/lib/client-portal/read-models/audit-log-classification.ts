import { inArray, sql, type SQL } from 'drizzle-orm';
import type { PortalAuditActivity, PortalAuditInvestigationFilters } from '../contracts/access';

// One vocabulary for the historical DTO classification and its SQL filter twin.
const BACKGROUND_EVENTS = ['portal.orders.awaiting_active_count', 'portal.me.view'];
const DATA_ACTIONS = ['view', 'list', 'detail', 'history', 'daily_counts', 'sku_orders', 'daily_shipments', 'reason_contract'];
const OUTCOMES = { denied: 'Denied', failed: 'Failed', requested: 'Requested', completed: 'Completed' } as const;

export function classifyPortalAuditEvent(event: string): Pick<PortalAuditActivity, 'category' | 'outcome'> {
  const action = event.split('.').pop() ?? '';
  if (Object.hasOwn(OUTCOMES, action)) return { category: 'Action', outcome: OUTCOMES[action as keyof typeof OUTCOMES] };
  if (event === 'portal.ui.click') return { category: 'Navigation', outcome: 'Reported' };
  if (BACKGROUND_EVENTS.includes(event)) return { category: 'Background check', outcome: 'Recorded' };
  return { category: DATA_ACTIONS.includes(action) ? 'Data request' : 'Action', outcome: 'Recorded' };
}

export function auditInvestigationPredicates(event: SQL, filters: PortalAuditInvestigationFilters): SQL[] {
  const action = sql`regexp_replace(${event}, '^.*[.]', '')`;
  const category = sql`case
    when ${inArray(action, Object.keys(OUTCOMES))} then 'Action'
    when ${event} = 'portal.ui.click' then 'Navigation'
    when ${inArray(event, BACKGROUND_EVENTS)} then 'Background check'
    when ${inArray(action, DATA_ACTIONS)} then 'Data request'
    else 'Action' end`;
  const predicates: SQL[] = [];
  if (filters.hideBackground) predicates.push(sql`${category} <> 'Background check'`);
  if (filters.activity === 'views') predicates.push(sql`${category} = 'Data request'`);
  if (filters.activity === 'navigation') predicates.push(sql`${category} = 'Navigation'`);
  if (filters.activity === 'actions') predicates.push(sql`${category} = 'Action' and ${action} not in ('failed', 'denied')`);
  if (filters.activity === 'failed' || filters.activity === 'denied') predicates.push(sql`${action} = ${filters.activity}`);
  return predicates;
}
