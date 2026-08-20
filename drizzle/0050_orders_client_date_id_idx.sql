-- Client Portal Orders list: "All" tab with a client scope + date window.
--
-- listPortalOrders (src/lib/client-portal/read-models/orders.ts) accepts an
-- optional window on orders.order_date (orderDateWindow predicate) and always
-- sorts ORDER BY order_date DESC, id DESC. Status-filtered tabs are covered by
-- orders_client_status_date_id_idx, but the All tab has no order_status
-- predicate: that index wedges order_status between client_id and order_date,
-- and orders_dashboard_sales_client_date_idx is partial on
-- order_status <> 'cancelled' while the All tab includes cancelled rows. With
-- no covering index, both the page SELECT and its mirrored count(*) pay the
-- scan.
--
-- Additive only: one new partial index, no data mutation, no drops.
-- Prod note: on the live orders table, prefer applying as
-- CREATE INDEX CONCURRENTLY (outside a transaction) so writes are not blocked.

CREATE INDEX IF NOT EXISTS "orders_client_date_id_idx"
  ON "orders" ("client_id", "order_date" DESC, "id" DESC)
  WHERE "client_id" IS NOT NULL;

ANALYZE "orders";
