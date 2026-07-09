ALTER TABLE "returns" ADD COLUMN IF NOT EXISTS "return_reference" text;
CREATE INDEX IF NOT EXISTS "returns_reference_idx" ON "returns" ("return_reference");
