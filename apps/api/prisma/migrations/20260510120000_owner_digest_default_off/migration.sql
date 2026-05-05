-- Application Owner accounts: digest email off unless they opt back in (Admin checkbox or schedule modal).
-- Only touch rows that already have a structured prefs object (skip empty/invalid JSON).
UPDATE "CompanyMembership" AS m
SET "cashLogEodPrefs" = jsonb_set(m."cashLogEodPrefs"::jsonb, '{enabled}', 'false', true)
FROM "User" AS u
WHERE m."userId" = u."id"
  AND u."role" = 'OWNER'
  AND m."cashLogEodPrefs" IS NOT NULL
  AND m."cashLogEodPrefs"::jsonb ? 'weekdays';
