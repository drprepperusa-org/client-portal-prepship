WITH ranked_returns AS (
  SELECT
    r.id,
    regexp_replace(
      coalesce(nullif(trim(o.order_number), ''), r.order_id::text),
      '\s+',
      '-',
      'g'
    ) || '-RETURN' AS base_reference,
    row_number() OVER (
      PARTITION BY r.order_id
      ORDER BY r.created_at, r.id
    ) AS return_sequence
  FROM returns r
  LEFT JOIN orders o ON o.id = r.order_id
)
UPDATE returns r
SET return_reference = ranked.base_reference ||
  CASE
    WHEN ranked.return_sequence > 1 THEN '-' || ranked.return_sequence::text
    ELSE ''
  END
FROM ranked_returns ranked
WHERE r.id = ranked.id
  AND nullif(trim(r.return_reference), '') IS NULL;
