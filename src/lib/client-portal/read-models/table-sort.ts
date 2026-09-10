import { sql, type SQL, type SQLWrapper } from 'drizzle-orm';

export type SortInput = { sortBy?: string | null; sortDir?: string | null };

/** Only owner-supplied expressions enter ORDER BY. Nulls stay last in either direction. */
export function tableOrderBy(
  input: SortInput,
  fields: Readonly<Record<string, SQLWrapper | undefined>>,
  fallback: SQL[],
  identity: SQLWrapper,
): SQL[] {
  const expression = input.sortBy && Object.hasOwn(fields, input.sortBy) ? fields[input.sortBy] : undefined;
  if (!expression) return fallback;
  return [
    input.sortDir === 'desc' ? sql`${expression} desc nulls last` : sql`${expression} asc nulls last`,
    sql`${identity} asc`,
  ];
}

/** Natural reference order (SKU-2 before SKU-10), without lossy numeric casts. */
export function referenceOrder(value: SQLWrapper): SQL {
  return sql`(select array_agg(
    case when part[1] ~ '^[0-9]+$' then
      '0' || lpad(length(ltrim(part[1], '0'))::text, 10, '0') || ltrim(part[1], '0')
    else '1' || lower(part[1]) end order by position
  ) from regexp_matches(${value}, '([0-9]+|[^0-9]+)', 'g') with ordinality as tokens(part, position))`;
}
