ALTER TABLE "return_inspection_media"
  ADD COLUMN IF NOT EXISTS "original_file_name" text;

ALTER TABLE "return_inspection_media"
  ADD COLUMN IF NOT EXISTS "uploaded_by_email" text;

CREATE TABLE IF NOT EXISTS "return_activity_events" (
  "id" serial PRIMARY KEY,
  "return_id" integer NOT NULL REFERENCES "returns"("id") ON DELETE cascade,
  "shipment_id" integer REFERENCES "shipments"("id") ON DELETE set null,
  "event_type" text NOT NULL,
  "status" text,
  "detail" text,
  "actor_type" text DEFAULT 'system' NOT NULL,
  "actor_email" text,
  "event_at" timestamp with time zone DEFAULT now() NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "return_activity_events_return_time_idx"
  ON "return_activity_events" ("return_id", "event_at" DESC);

CREATE INDEX IF NOT EXISTS "return_activity_events_shipment_idx"
  ON "return_activity_events" ("shipment_id");

INSERT INTO "return_activity_events" (
  "return_id", "event_type", "status", "actor_type", "actor_email", "event_at"
)
SELECT
  r.id,
  'return_requested',
  'requested',
  CASE WHEN r.initiated_by = 'client' THEN 'client' ELSE 'operator' END,
  r.initiated_by_email,
  r.requested_at
FROM "returns" r
WHERE NOT EXISTS (
  SELECT 1
  FROM "return_activity_events" e
  WHERE e.return_id = r.id AND e.event_type = 'return_requested'
);

INSERT INTO "return_activity_events" (
  "return_id", "shipment_id", "event_type", "status", "detail", "event_at"
)
SELECT
  r.id,
  r.return_shipment_id,
  CASE r.status
    WHEN 'label_created' THEN 'label_created'
    WHEN 'label_failed' THEN 'label_failed'
    WHEN 'in_transit' THEN 'tracking_status_changed'
    WHEN 'closed' THEN 'return_closed'
    WHEN 'cancelled' THEN 'return_cancelled'
  END,
  r.status,
  CASE WHEN r.status = 'label_failed' THEN r.delivery_error ELSE NULL END,
  r.updated_at
FROM "returns" r
WHERE r.status IN ('label_created', 'label_failed', 'in_transit', 'closed', 'cancelled')
  AND NOT EXISTS (
    SELECT 1
    FROM "return_activity_events" e
    WHERE e.return_id = r.id AND e.event_type = CASE r.status
      WHEN 'label_created' THEN 'label_created'
      WHEN 'label_failed' THEN 'label_failed'
      WHEN 'in_transit' THEN 'tracking_status_changed'
      WHEN 'closed' THEN 'return_closed'
      WHEN 'cancelled' THEN 'return_cancelled'
    END
  );
