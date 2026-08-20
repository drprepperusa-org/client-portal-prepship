// Single source of truth for standard-vs-expedited service classification in
// the Client Portal. Mirrors prepship-v4 REPORTING_EXPEDITED_SERVICES
// (src/services/reporting-projection.ts, PS-418) — the canonical upstream
// owner. If that list changes, this one must change with it; the CP-060 guard
// pins the contents so drift is loud.
//
// v2-parity: exact list from apps/api/src/common/prepship-config.ts.
// v4 previously used a broad regex `(priority|express|overnight|expedited|...)`
// which over-matched `usps_priority_mail` as expedited. v2 treats USPS priority
// as standard; only priority_mail_express is expedited. The regex was inflating
// AnalysisView "expedited" counts for every USPS priority shipment.
import { sql } from 'drizzle-orm';

export const EXPEDITED_SERVICES = [
  'ups_2nd_day_air', 'ups_2nd_day_air_am',
  'ups_next_day_air', 'ups_next_day_air_saver', 'ups_next_day_air_early_am',
  'ups_3_day_select',
  'usps_priority_mail_express',
  'fedex_2day', 'fedex_2day_am',
  'fedex_express_saver',
  'fedex_priority_overnight', 'fedex_standard_overnight', 'fedex_first_overnight',
] as const;

export const EXPEDITED_SERVICES_SQL = sql`ARRAY[${sql.join(
  EXPEDITED_SERVICES.map((s) => sql`${s}`),
  sql`, `
)}]::text[]`;
