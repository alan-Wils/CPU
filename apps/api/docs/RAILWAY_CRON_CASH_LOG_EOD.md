# Railway Cron — cash log EOD digest

The financial **cash log digest email** runs the same logic as the in-process API scheduler (`CASH_LOG_EOD_INTERNAL_SCHEDULER`). For production, **Railway Cron** should `POST` to the API on a fixed cadence so digests still fire if the dyno restarts often or sleeps.

## Endpoint

| | |
|---|---|
| **Method** | `POST` |
| **Path** | `/api/internal/jobs/cash-log-eod` |
| **Full URL** | `https://<YOUR_RAILWAY_API_DOMAIN>/api/internal/jobs/cash-log-eod` |

Examples of `<YOUR_RAILWAY_API_DOMAIN>`:

- Railway service public URL → `your-api.up.railway.app`
- Custom domain pointed at the API service → `api.example.com`

## Authentication (required)

The handler checks:

```http
Authorization: Bearer <CRON_SECRET>
```

- `CRON_SECRET` must match the **Railway Variable** set on the **API** service exactly (literal string after `Bearer `).
- If `CRON_SECRET` is unset, the endpoint responds **503** and the body explains that cron is disabled.
- If the header is wrong, the endpoint responds **401**.

## Recommended schedule

Trigger **every 10 minutes** or **every 15 minutes**.

Digest emails only send during each member’s configured **local send window** (`sendTime` through `sendTime + CASH_LOG_EOD_SEND_WINDOW_MINUTES`, default **25** minutes). Frequent cron ensures a hit inside that narrow window without relying on a long-lived `setInterval`.

**Idempotency:** `CompanyMembership.cashLogEodLastSentAt` is updated **only after** Resend/SMTP reports success for that digest. Ticks outside the window, disabled digests, or failed mail sends **do not** write this field, so they never block a later in-window attempt the same calendar day.

**Same-day duplicate suppression** uses `cashLogEodScheduleGeneration` and `cashLogEodDigestSentScheduleGeneration`: saving digest prefs (`PUT /api/cash-log/eod-prefs` or toggling digest in Admin) **increments the generation** and **clears** the digest success generation, so you can switch from **11:00 → 17:00** local send time **the same calendar day** and still receive the new-slot digest.

**Aggregation keys** (see `job.skipReasons`): `outside_send_window`, `already_sent_today`, `digest_disabled`, `no_recipient`, `prefs_invalid`, `wrong_weekday`, and **`email_send_failed`** (attempted send that threw — not counted in `skipped`).

Cron expression examples (cron syntax depends on Railway’s cron UI):

- Every **10 minutes:** `*/10 * * * *` (standard 5-field)
- Every **15 minutes:** `*/15 * * * *`

## Environment variables (API service on Railway)

| Variable | Required for cron | Notes |
|----------|-------------------|--------|
| `CRON_SECRET` | **Yes** | Strong random string, **≥ 16 characters**. Same value used in the `Authorization: Bearer …` header. |
| `CASH_LOG_EOD_SEND_WINDOW_MINUTES` | No | Default `25`. Width of the send window after `sendTime` (per member timezone). |
| `CASH_LOG_EOD_INTERNAL_SCHEDULER` | No | Default `true`. Leave enabled as a backup, or set `false` if you want **only** Railway Cron to drive the job. |

## Railway Cron setup (short)

1. Open your **API** service on Railway → **Variables** → add `CRON_SECRET` (generate e.g. 32 hex bytes).
2. Redeploy the API so env is applied.
3. Add **Cron** (or Scheduled Job) pointing at **`POST`** your public API URL **`/api/internal/jobs/cash-log-eod`**.
4. Add header **`Authorization: Bearer <same CRON_SECRET>`** (Railway Cron often has a **Custom Headers** or **HTTP Headers** field).
5. Schedule every **10** or **15** minutes.

## Response JSON

Success (**200**) after Bearer auth:

```json
{
  "ok": true,
  "summary": "skipped",
  "message": "...",
  "job": {
    "trigger": "cron",
    "utcNow": "...",
    "slackMinutes": 25,
    "examined": 2,
    "sent": 0,
    "skipped": 2,
    "skipReasons": { "outside_send_window": 2, ... },
    "errors": [],
    "memberships": [ ... ]
  }
}
```

- **`summary`**: `"idle"` | `"skipped"` | `"sent"` | `"partial"` | `"error"`
- **`ok`**: `false` if any membership failed to send (see `job.errors`)

## Operational logs

Every run emits **`[cash_log_eod] membership_eval`** once per membership with **`localDate`** (today in that TZ), **`lastSuccessDigestLocalDate`** (marker’s calendar day, if any), **`alreadySentToday`** (those two dates match — means a digest already **succeeded** earlier, not “this skipped tick burned the day”), **`evalHint`** (plain-language tie-break), **`outcome`**, and **`skipReason`**. **`outside_send_window`** only describes *this poll*; **`alreadySentToday`** can still be **true** if an earlier successful send landed today. **`[cash_log_eod] job_complete`** summarizes **`skipReasons`** and **`errors`**.
