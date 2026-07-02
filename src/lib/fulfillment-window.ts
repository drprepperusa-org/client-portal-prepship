/**
 * Fulfillment-shift window math (extracted verbatim from routes/orders.ts).
 *
 * Order timestamps are stored as ShipStation wall-clock values stamped in UTC,
 * so keep the query bounds as naive UTC noon values for the Pacific dates.
 */
export const FULFILLMENT_TIME_ZONE = 'America/Los_Angeles';

export function getFulfillmentDateParts(now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: FULFILLMENT_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(now);
  const get = (type: string) => parts.find((part) => part.type === type)?.value ?? '';
  return {
    year: Number(get('year')),
    month: Number(get('month')),
    day: Number(get('day')),
    hour: Number(get('hour')),
  };
}

export function addCalendarDaysUtc(year: number, month: number, day: number, days: number) {
  const date = new Date(Date.UTC(year, month - 1, day + days, 0, 0, 0));
  return {
    year: date.getUTCFullYear(),
    month: date.getUTCMonth() + 1,
    day: date.getUTCDate(),
  };
}

export function naiveNoonUtcForFulfillmentDate(year: number, month: number, day: number) {
  // NB: returns *literal* noon-UTC, not noon-PT. Reason: orders are migrated
  // from v2's SQLite (which stored PT-local ISO strings) and the migration
  // labeled those PT clock values with `Z` rather than re-interpreting them
  // as PT moments. So `orders.order_date` in this database is PT-clock-time
  // wrapped in a UTC label. Comparing it against a PT-clock-as-UTC window
  // (this function) preserves the v2 semantic. Switching to true noon-PT-UTC
  // would shift the comparison off by 7-8 hours.
  return new Date(Date.UTC(year, month - 1, day, 12, 0, 0));
}

export function computeFulfillmentShiftWindow(now = new Date()): { from: Date; to: Date } {
  const ptNow = getFulfillmentDateParts(now);
  const dow = new Date(Date.UTC(ptNow.year, ptNow.month - 1, ptNow.day)).getUTCDay();
  const isAfterRollover = ptNow.hour >= 18;
  let startCalendarDate: { year: number; month: number; day: number };
  let endCalendarDate: { year: number; month: number; day: number };

  if (dow === 6) {
    startCalendarDate = addCalendarDaysUtc(ptNow.year, ptNow.month, ptNow.day, -1);
    endCalendarDate = addCalendarDaysUtc(ptNow.year, ptNow.month, ptNow.day, 2);
  } else if (dow === 0) {
    startCalendarDate = addCalendarDaysUtc(ptNow.year, ptNow.month, ptNow.day, -2);
    endCalendarDate = addCalendarDaysUtc(ptNow.year, ptNow.month, ptNow.day, 1);
  } else if (dow === 1 && !isAfterRollover) {
    startCalendarDate = addCalendarDaysUtc(ptNow.year, ptNow.month, ptNow.day, -3);
    endCalendarDate = addCalendarDaysUtc(ptNow.year, ptNow.month, ptNow.day, 0);
  } else if (dow === 5 && isAfterRollover) {
    startCalendarDate = addCalendarDaysUtc(ptNow.year, ptNow.month, ptNow.day, 0);
    endCalendarDate = addCalendarDaysUtc(ptNow.year, ptNow.month, ptNow.day, 3);
  } else if (isAfterRollover) {
    startCalendarDate = addCalendarDaysUtc(ptNow.year, ptNow.month, ptNow.day, 0);
    endCalendarDate = addCalendarDaysUtc(ptNow.year, ptNow.month, ptNow.day, 1);
  } else {
    startCalendarDate = addCalendarDaysUtc(ptNow.year, ptNow.month, ptNow.day, -1);
    endCalendarDate = addCalendarDaysUtc(ptNow.year, ptNow.month, ptNow.day, 0);
  }

  return {
    from: naiveNoonUtcForFulfillmentDate(
      startCalendarDate.year,
      startCalendarDate.month,
      startCalendarDate.day
    ),
    to: naiveNoonUtcForFulfillmentDate(
      endCalendarDate.year,
      endCalendarDate.month,
      endCalendarDate.day
    ),
  };
}

// v2-parity label — "Apr 21, 12pm PT" (comma, lowercase am/pm, no space).
// Formats with `timeZone: 'UTC'` because `naiveNoonUtcForFulfillmentDate`
// returns a Date whose UTC clock reads the desired PT clock value (see the
// comment on that function for why). Reading the same UTC clock back gives
// the right label.
export function formatPtLabel(d: Date): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'UTC',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    hour12: false,
  }).formatToParts(d);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
  const month = get('month');
  const day = get('day');
  const hour24 = Number(get('hour'));
  const hour12 = hour24 % 12 || 12;
  const suffix = hour24 >= 12 ? 'pm' : 'am';
  return `${month} ${day}, ${hour12}${suffix} PT`;
}
