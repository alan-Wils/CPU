# Railway Cron — cash log EOD digest

The financial **cash log digest email** can run from the in-process API scheduler (`CASH_LOG_EOD_INTERNAL_SCHEDULER`) and/or **Railway Cron** `POST` (see send-window defaults below). For production, Railway Cron on a fixed cadence helps if the dyno restarts often or sleeps.

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
- If the header is wrong, the endpoint responds **401`.

## Recommended schedule

Trigger **every 5 minutes** (or **every 10 minutes**) so at least one poll lands inside the default strict send window.

### Default behavior: **`strict_slack`** (unset `CASH_LOG_EOD_SEND_WINDOW_MODE`)

- Mail is only attempted when local time is in **`[sendTime … sendTime + slack]`** (inclusive end minute; see `isWithinSendWindow`).
- **Default `slack`** is **10 minutes** when env is unset (`CASH_LOG_EOD_SEND_WINDOW_MINUTES`). Override with that variable (1–120).
- **At most one successful send per local calendar day** per membership **for the current schedule revision** (`cashLogEodScheduleGeneration` matches `cashLogEodDigestSentScheduleGeneration`). Saving digest settings (including send time) increments generation and **clears** `cashLogEodDigestSentScheduleGeneration`, which **resets** the same-day cap so the new window can deliver once more today.

### Legacy: **`eod_local_day`**

Set **`CASH_LOG_EOD_SEND_WINDOW_MODE=eod_local_day`** (alias `eod`) for the old behavior: from local **send time through end of day**, **every** eligible tick may send again (no same-day cap).

**Last-sent marker:** `CompanyMembership.cashLogEodLastSentAt` and `cashLogEodDigestSentScheduleGeneration` are updated **only after** Resend/SMTP reports success. In **strict** mode they participate in duplicate suppression; in **eod_local_day** they are mainly for auditing.

**Aggregation keys** (see `job.skipReasons`): `outside_send_window`, `digest_disabled`, `no_recipient`, `prefs_invalid`, `wrong_weekday`, **`already_sent_today`** (strict mode), **`email_send_failed`**.

Cron expression examples (cron syntax depends on Railway’s cron UI):

- Every **5 minutes:** `*/5 * * * *` (standard 5-field)
- Every **10 minutes:** `*/10 * * * *`

## Environment variables (API service on Railway)

| Variable | Required for cron | Notes |
|----------|-------------------|-------|
| `CRON_SECRET` | **Yes** | Strong random string, **≥ 16 characters**. Same value used in the `Authorization: Bearer …` header. |
| `CASH_LOG_EOD_SEND_WINDOW_MINUTES` | No | Default **10** in **`strict_slack`** when unset; **25** in **`eod_local_day`**. Inclusive end minute (see code). Max 120. |
| `CASH_LOG_EOD_SEND_WINDOW_MODE` | No | **`eod_local_day`** (aliases: `eod`) = legacy all-day window, no same-day cap. **`strict`** / **`strict_slack`** = narrow window + one send per day per schedule revision. **Unset:** **`strict_slack`**. |
| `CASH_LOG_EOD_INTERNAL_SCHEDULER` | No | Default `true`. Leave enabled as a backup, or set `false` if you want **only** Railway Cron to drive the job. |

## Railway Cron setup (short)

1. Open your **API** service on Railway → **Variables** → add `CRON_SECRET` (generate e.g. 32 hex bytes).
2. Redeploy the API so env is applied.
3. Add **Cron** (or Scheduled Job) pointing at **`POST`** your public API URL **`/api/internal/jobs/cash-log-eod`**.
4. Add header **`Authorization: Bearer <same CRON_SECRET>`** (Railway Cron often has a **Custom Headers** or **HTTP Headers** field).
5. Schedule every **5** or **10** minutes.

## Response JSON

Success (**200**) after Bearer auth:

```json
{
  "ok": true,
  "summary": "skipped",
  "message": "...",
  "job": {
    "trigger": "cron",
    "sendWindowMode": "strict_slack",
    "utcNow": "...",
    "slackMinutes": 10,
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

Every run emits **`[cash_log_eod] membership_eval`** once per membership with **`localDate`** (today in that TZ), **`lastSuccessDigestLocalDate`**, **`alreadySentToday`**, **`skipPrimaryCause`**, **`evalHint`**, **`outcome`**, and **`skipReason`**. **`[cash_log_eod] job_complete`** summarizes **`skipReasons`** and **`errors`**.

### Multiple recipients (Admin vs Financial logs)

The job sends **one digest per enabled `CompanyMembership`** (that user's email). **OWNER** can save **only** the digest checkbox on their own account from Admin; other profile fields still require another OWNER or ADMIN.
