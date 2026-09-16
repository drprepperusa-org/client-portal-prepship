import { sql, type SQL } from 'drizzle-orm';

export interface AnalysisPageInput {
  page: number;
  pageSize: number;
  search?: string;
  sortKey?: string;
  sortDir?: string;
}

export interface AnalysisPagination {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

export type AnalysisPageEnvelope<T> = {
  rows: T[];
  top_rows: T[];
  total_skus: number;
  pagination: AnalysisPagination;
};

/** Page an already scoped canonical read model, without changing its aggregates.
 * Search is a literal substring of the grouped SKU/name; counts and the top five
 * chart rows come from the same database statement, before page selection.
 */
export function analysisPageSql(source: SQL, input: AnalysisPageInput, kind: 'skus' | 'orders'): SQL {
  const page = Math.max(1, Math.min(1_000_000, Math.trunc(input.page) || 1));
  const pageSize = Math.max(1, Math.min(500, Math.trunc(input.pageSize) || 50));
  const search = (input.search ?? '').trim().slice(0, 200);
  const columns: Record<string, SQL> = {
    name: sql`name`, sku: sql`sku`, client: sql`client_name`, orders: sql`orders`,
    pending: sql`pending`, totalQty: sql`total_qty`, revenue: sql`total_revenue::numeric`,
    avgPrice: sql`total_revenue::numeric / nullif(total_qty, 0)`,
  };
  const sortColumn = Object.hasOwn(columns, input.sortKey ?? '') ? columns[input.sortKey!] : columns.totalQty;
  const direction = input.sortDir === 'asc' ? sql`asc` : sql`desc`;
  const order = kind === 'orders' ? sql`order_date desc nulls last, order_id desc, sku_key asc`
    : sql`${sortColumn} ${direction} nulls last, sku asc`;
  const matching = kind === 'skus' && search
    ? sql`where position(lower(${search}) in lower(concat_ws(' ', sku, name))) > 0` : sql``;
  return sql`
    with all_rows as (${source}), matching_rows as (select * from all_rows ${matching}),
    counts as (select count(*)::int as total from matching_rows),
    paging as (
      select total, greatest(1, ceil(total::numeric / ${pageSize})::int) as total_pages,
        least(${page}, greatest(1, ceil(total::numeric / ${pageSize})::int)) as page
      from counts
    )
    select
      coalesce((select json_agg(r) from (
        select * from matching_rows order by ${order}
        limit ${pageSize} offset (select (page - 1) * ${pageSize} from paging)
      ) r), '[]'::json) as rows,
      ${kind === 'skus' ? sql`coalesce((select json_agg(t) from (
        select * from all_rows order by total_qty desc, sku asc limit 5
      ) t), '[]'::json)` : sql`'[]'::json`} as top_rows,
      (select count(*)::int from all_rows) as total_skus,
      json_build_object('page', page, 'pageSize', ${pageSize}::int, 'total', total,
        'totalPages', total_pages) as pagination
    from paging
  `;
}
