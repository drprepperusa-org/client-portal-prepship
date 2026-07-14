ALTER TABLE "return_inspections"
  ADD COLUMN IF NOT EXISTS "inspector_type" text DEFAULT 'operator' NOT NULL;
