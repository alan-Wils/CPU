-- One-time normalization: legacy API/UI defaults were America/New_York + 17:00.
-- NexBatch product defaults are America/Denver + 11:16. Only rewrite rows that still
-- match the exact legacy pair (custom schedules unchanged).
UPDATE "CompanyMembership"
SET "cashLogEodPrefs" =
  jsonb_set(
    jsonb_set("cashLogEodPrefs"::jsonb, '{timezone}', '"America/Denver"', true),
    '{sendTime}',
    '"11:16"',
    true
  )::json
WHERE "cashLogEodPrefs" IS NOT NULL
  AND COALESCE("cashLogEodPrefs"::jsonb ->> 'timezone', '') = 'America/New_York'
  AND COALESCE("cashLogEodPrefs"::jsonb ->> 'sendTime', '') = '17:00';
