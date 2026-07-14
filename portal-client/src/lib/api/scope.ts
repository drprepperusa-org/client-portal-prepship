import type {
  Paginated,
  PortalDateRange,
} from '@client-portal-contracts/common';
import { apiGet, type QueryValue } from './transport';

export function defaultRange(days = 30) {
  const to = new Date();
  const from = new Date();
  from.setDate(to.getDate() - days);
  const day = (date: Date) => date.toISOString().slice(0, 10);
  return { from: day(from), to: day(to) };
}

export function rangeToTimestamps(range = defaultRange()) {
  return {
    dateFrom: `${range.from}T00:00:00.000Z`,
    dateTo: `${range.to}T23:59:59.999Z`,
  };
}

export function billingRangeParams(range = defaultRange()) {
  return { dateFrom: range.from, dateTo: range.to };
}

export function dashboardRangeParams(range: PortalDateRange) {
  return rangeToTimestamps({ from: range.dateFrom, to: range.dateTo });
}

export function dailyRangeParams(range: PortalDateRange) {
  return { from: range.dateFrom, to: range.dateTo };
}

export function billingRangeFromPortal(range: PortalDateRange) {
  return billingRangeParams({ from: range.dateFrom, to: range.dateTo });
}

/** The backend owns JWT scope and whole-set pagination; clientId can only narrow it. */
export function scopedList<T>(
  token: string,
  path: string,
  params: Record<string, QueryValue>,
): Promise<Paginated<T>> {
  return apiGet<Paginated<T>>(token, path, params);
}
