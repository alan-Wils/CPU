# NexBatch / Neon public network transfer audit

**Date:** 2026-05-15  
**Scope:** Frontend polling, API response shape, Prisma read patterns, and egress-heavy routes between the browser and `@cpu/api` (and thus Neon for DB-backed routes).

## Executive summary

The largest sustained transfer drivers were:

1. **Repeated full `GET /api/store`** (entire company JSON snapshot) on **5s timers** on cultivation, extraction, packaging, and Data Hub — often combined with **`GET /api/logs` returning up to 2000 rows** each cycle.
2. **Data Hub edibles widget** polling **`GET /api/data-hub`** every 12s, which runs **multiple `findMany` queries across the whole tenant** when only the **edibles analytics object** was needed.
3. **`GET /api/analytics/cultivation-strain-metrics`** loading **`storeService.load()`** (same full company JSON as `/api/store`) **plus** `cultivationBatch.findMany` with **`take: 3500`** and **full row objects**.
4. **Global pollers** (`TaskLiveNotificationHost` 4s, `PeerNotificationsContext` 2.2s) continuing while the tab was **hidden**, still hitting the API.
5. **No HTTP compression** on Express API responses (JSON payloads sent uncompressed to clients).

## Endpoint inventory

| Path | Called from | Poll / trigger | Est. size (order of magnitude) | Hidden tab? | Nested / heavy? | Pagination | Recommended fix |
|------|-------------|----------------|--------------------------------|-------------|-----------------|-------------|-----------------|
| `GET /api/store` | `loadBackendStore` → cultivation, extraction, packaging, Data Hub, fallbacks | **5s** on workflow + Data Hub | **Very large** (full JSON blob) | **Often no** until this work | Entire snapshot | N/A | **Version check** (`/api/store/version`) before full GET; **skip fetch** when `updatedAt` unchanged; **slow interval**; **pause when `document.hidden`**. |
| `GET /api/store/version` | (new) same callers when using stale-avoidance | Per poll before store | Tiny | — | N/A | N/A | Use as gate for full store. |
| `GET /api/logs` | `hydrateTaskLogsFromApi`, Data Hub `loadSharedData` | With store on same intervals | **Large** (was up to **2000** rows × task payload) | Mixed | Full task rows | **Was implicit cap 2000** | **`take` query param** (default **800**, max **2000**); callers use **~900** for hydrates. |
| `GET /api/data-hub` | Data Hub initial load / refresh | Was **12s** for edibles-only poll | **Large** (all cultivation batches + labor + trim + FF + edibles) | Edibles poll: yes | Multiple collections | N/A | **Edibles strip:** poll **`GET /api/edibles/analytics`** instead. **Main hub:** slower refresh + hidden + in-flight guard. |
| `GET /api/edibles/analytics` | (new) Data Hub edibles metrics poll | **12s** | Small–medium (aggregates; still reads batches server-side) | Yes | Summary metrics | N/A | Prefer over full data-hub for widget-only refresh. |
| `GET /api/analytics/overview` | `app/analytics/page.tsx` | **15s** silent refresh | Medium–large (many aggregates) | **Yes** (skip when hidden) | Heavy server work | N/A | **Slow silent refresh** to **45s** to cut duplicate overview work. |
| `GET /api/analytics/live-operations` | `app/analytics/live-operations/page.tsx` | **15s** | Medium (250 tasks + labor + …) | **Yes** | Card `items` arrays | Partial server `take` | **45s** interval; consider future `summary` + lazy card detail. |
| `GET /api/analytics/cultivation-strain-metrics` | `CultivationStrainMetricsCharts` via `lib/analyticsApi.ts` | On demand / range change | Was **very large** (full store + 3500 batches) | N/A | Full store JSON | N/A | **Postgres JSON slice** for dry/source/production/completed only; **narrow Prisma `select`** on cultivation rows. |
| `GET /api/dashboard/overview` | Dashboard pages / services | Mostly load | Medium | varies | `company` object + workflow lists | N/A | Monitor; compression helps. |
| `GET /api/activity/all` | Activity UI (grep consumers) | Usually load | Medium (500 merged items) | — | Summaries only | **Capped at 500** server-side | OK; ensure callers don’t poll aggressively. |
| `GET /api/activity/version` | (if used) | — | Tiny | — | — | N/A | Prefer for diff polling if added client-side. |
| `POST /api/orders/...` sync + list | `app/orders/page.tsx` | Light **15s**; full sync **120s** | List size varies | **Yes** | — | List endpoint dependent | Already skips when hidden; OK. |
| `GET /api/logs/latest-live` + orders latest | `TaskLiveNotificationHost` | **4s** | Small | **Yes** (no fetch when hidden) | Compact DTO | N/A | **Skip `syncAll` when hidden**; compression. |
| Peer notify inbox | `PeerNotificationsContext` | **~5.5s** | Small–medium | **Yes** | — | N/A | **Skip when hidden**; slower interval. |
| Messaging | `MessagingPanel` | **6s** | Medium per tick | **Yes** | Thread reload | limit 60 | OK pattern. |
| Admin usage / costs | `app/portal/page.tsx` `UsageCostsModal` | **Load + manual refresh** | Medium | N/A | — | Log **35** lines | No continuous poll (good). |

## Implemented mitigations (this change set)

- **gzip** (`compression` middleware, threshold 1KB) on `@cpu/api`.
- **`loadBackendStore({ skipFullStoreIfUnchanged })`:** `GET /api/store/version` before full snapshot; per-tenant cache; **cleared on tenant switch**; **updated after successful `PUT /api/store`**.
- **Data Hub:** hidden guard, **single-flight** main loader, **30s** refresh (was 5s), **visibility** refetch; edibles widget uses **`GET /api/edibles/analytics`** (not full data-hub); **`getLogs(..., { take: 1200 })`** for merge; store uses **skip gate**.
- **Cultivation / extraction / packaging:** **hidden** guard, **15s** poll (was 5s), **visibility** refetch, **`skipFullStoreIfUnchanged`** (cultivation also **`omitCultivation`**).
- **Analytics main + live-operations:** **45s** silent refresh (was 15s).
- **Task live + peer inbox:** **no API work while tab hidden**; peer interval **~5.5s** (was 2.2s).
- **`GET /api/logs`:** **`take` / `limit`** (default **800**, max **2000**); **`Cache-Control: private, no-store`**.
- **`GET /api/analytics/cultivation-strain-metrics`:** Postgres **JSON slice** for four store arrays; cultivation **`select`** + **take 2500**.
- **Cache headers:** store + data-hub **`private, no-store`**; store version **`private, max-age=5`**; dashboard overview **`private, max-age=8`**.
- **Instrumentation:** `API_TRANSFER_METRICS=1` → sampled logs + rolling **top-10** summary every 120 samples; dev logs JSON **≥ ~20KB** (`api_response_size_dev`).

## Follow-ups (not done in this pass)

- Split **`GET /api/analytics/overview`** into a **lightweight checksum** endpoint for silent refresh (larger refactor).
- **Paginate** `GET /api/data-hub` or add **`?sections=`** to avoid full snapshot when only subsets are needed on first paint.
- **HTTP ETags** for immutable-ish reads (store version already acts as a light checksum client-side).
- **Reduce `ediblesService.analyticsSnapshot`** DB work (aggregate-only instead of loading all edible batches).
