# Company config HTTP transfer audit (NexBatch / Neon)

## Where `GET /api/config` is implemented

- **Router:** `apps/api/src/modules/config/routes.ts` (mounted under `/api/config` in the Railway `@cpu/api` app).
- **Persistence:** `CompanyConfig` rows keyed by string (`company`, `cultivation`, `extraction`, `sales`, …); `ConfigService.list` → `mergeConfigRowsToMap` builds one merged object.
- **Legacy row excluded from all merged HTTP payloads:** `legacy_frontend_store` (see `LEGACY_COMPANY_STORE_CONFIG_KEY` in `apps/api/src/repositories/configRepository.ts`). That snapshot belongs on `GET /api/store`, not config.

## Before (production symptom)

- **~1.5 MB** per `GET /api/config` was consistent with merging **every** config row into one JSON response, including very large buckets and the legacy JSON store row.
- Repeated SPA calls (Nav + timezone + notifications + pages) multiplied Neon **public** egress.

## Top-level keys (typical merged map)

Largest contributors are usually:

| Key | Role |
| --- | --- |
| `company` | Facility-wide settings, METRC, climate/Autogrow, branding-related settings, rewards settings, notifications, timezone, etc. |
| `cultivation` | Rooms/bays/tables, strains (sometimes duplicated under `strains`), schedules, custom tasks, climate alerts, etc. |
| `extraction` / `packaging` | Product types, tasks, label calibration, blend name history, etc. |
| `sales` / `products` | LeafLink label overrides, print/header logo sizing, merchandising notes |
| `edibles` | Kitchen / recipes / gummy config |
| `strains` | Top-level strain list (legacy/alternate shape vs nested under `cultivation`) |

## Field classification

### Needed globally (nav / shell / timestamps / light feature gates)

- **Company id/name/slug**, **service flags** (`CompanyServiceSettings`), **trimmed `sales`** (header/inventory logo URLs + max dimensions), **minimal `products`**, **`company.settings.displayTimezone`**, **live task/order notification toggles**, **rewards.enabled + full rewards object** (Nav + rewards flows; still far smaller than full `company`).
- **Permissions summary** comes from JWT (`GET /api/config/permissions`), not from merged DB config.

### Company Config (admin) only

- Full `company` (every subsection), full `cultivation` / `extraction` / `packaging` / `edibles` / `sales` / `products` as stored — **use `GET /api/config/full` or legacy `GET /api/config`**.

### Page-specific (workflow UIs)

- **Cultivation:** `GET /api/config/cultivation` — full `cultivation` + `strains` + METRC on/off + labor breaks + timezone + rewards + cross-workflow `customTasks` slices for reward defs.
- **Extraction:** `GET /api/config/extraction` — full `extraction` + `customTasks` from cultivation/packaging + timezone/rewards in `company.settings`.
- **Packaging:** `GET /api/config/packaging` — full `packaging` + same `customTasks` + timezone/rewards.
- **Rewards:** `GET /api/config/rewards` — rewards settings + all three `customTasks` lists.
- **Edibles:** `GET /api/config/edibles` — `edibles` bucket only.
- **Integrations overview:** `GET /api/config/integrations` — METRC/Autogrow **metadata + `has*` booleans** + LeafLink safe DTO fields (no raw API keys).

### Sensitive (must not appear in JSON)

- METRC vendor/user API keys, Autogrow API keys, LeafLink API keys (LeafLink is a separate `CompanyConfig` row; safe read DTO is used for integration metadata), SMTP passwords, Resend keys, S3/R2 secrets, JWT secrets, DB URLs, etc.
- **Behavior:** `scrubMergedConfigForHttp` clears METRC/Autogrow secret fields and adds `hasMetrcVendorApiKey`, `hasMetrcUserApiKey`, `hasAutogrowApiKey`. **PUT** merges blank masked fields with existing DB values so saves do not wipe secrets (`mergeCompanyValuePreserveMaskedSecrets`).

## New / changed endpoints

| Method | Path | Cache-Control | Notes |
| --- | --- | --- | --- |
| GET | `/api/config/version` | `private, max-age=5` | `checksum`, `updatedAt`, `companyId`, `keyCount` |
| GET | `/api/config/permissions` | `private, max-age=15` | JWT-derived |
| GET | `/api/config/basic` | `private, max-age=15` | Slim shell payload |
| GET | `/api/config/cultivation` | `private, max-age=15` | Cultivation UI |
| GET | `/api/config/extraction` | `private, max-age=15` | Extraction UI |
| GET | `/api/config/packaging` | `private, max-age=15` | Packaging UI |
| GET | `/api/config/edibles` | `private, max-age=15` | Edibles UI |
| GET | `/api/config/rewards` | `private, max-age=15` | Rewards UI |
| GET | `/api/config/integrations` | `private, no-store` | Booleans + METRC display metadata + LeafLink flags |
| GET | `/api/config/full` | `private, no-store` | Full scrubbed merged map (admin) |
| GET | `/api/config` | `private, no-store` | **Deprecated:** same as `/full` for backward compatibility |
| PUT | `/api/config` | — | Returns **scrubbed** merged keys that were written |

## Dev-only logging

- `logConfigTopLevelSizesDev` in `apps/api/src/lib/configHttpPayload.ts` logs **only key names and byte sizes** per top-level key when `NODE_ENV === "development"`.

## Frontend transfer reduction

- Shared client: `lib/configClient.ts` — **in-flight dedupe**, **per-tenant + per-path memory cache**, **`/api/config/version` short-circuit** when checksum unchanged, **no refetch when `document.hidden`** if cached data exists.
- Cache cleared on **company switch** (`setSelectedCompanyId`) and **logout** (`clearAuthSession`); invalidated after **admin config load/save** and **extraction config writes**.

### Pages updated to sliced endpoints

- `components/Nav.tsx`, `components/CompanyTimezoneSync.tsx`, `components/TaskLiveNotificationHost.tsx` → `/api/config/basic`
- `app/cultivation/page.tsx` → `/api/config/cultivation`
- `app/extraction/page.tsx` → `/api/config/extraction` (+ cache invalidation after PUT)
- `app/packaging/page.tsx` → `/api/config/packaging`
- `app/rewards/page.tsx` → `/api/config/rewards`
- `app/inventory/page.tsx` → `/api/config/basic` (via `fetchCachedCompanyConfig`)
- `app/analytics/CultivationStrainMetricsCharts.tsx` → `/api/config/cultivation`
- `app/admin/config/page.tsx` → **`/api/config/full`** only

## Estimated response sizes (after migration, order of magnitude)

| Endpoint | Typical size |
| --- | --- |
| `/api/config/version` | **&lt; 500 B** |
| `/api/config/permissions` | **&lt; 1 KB** |
| `/api/config/basic` | **low tens of KB** (dominated by `settings.rewards` + sales logos metadata) |
| `/api/config/cultivation` | **100 KB–800 KB+** depending on rooms/strain tables (largest remaining slice) |
| `/api/config/extraction` / `packaging` | **10–200 KB** typical |
| `/api/config/rewards` | **10–80 KB** typical |
| `/api/config/full` | **still largest** (full scrubbed merged map minus legacy store row) — **admin only** |

_Previous_ `GET /api/config` single response: **~1.5 MB** observed on Railway.

## Remaining follow-ups

1. **Cultivation slice** can still be large (rooms/bays/tables/strain arrays). Consider a future `GET /api/config/cultivation/rooms` split if room JSON dominates.
2. **`/api/config/basic`** still embeds full `settings.rewards` for Nav/rewards compatibility; if that grows, add a tiny `/api/config/rewards-summary` (`enabled` only) for the shell.
3. **Integrations:** tenant outbound email / object-storage “configured” flags are mostly **API env / vendor** concerns today; extend `/api/config/integrations` if the UI needs explicit tenant-level booleans beyond LeafLink/METRC/Autogrow.

## Acceptance checklist (implementation)

- [x] Legacy `GET /api/config` kept; equals scrubbed `/full`.
- [x] Sliced GET routes + cache headers.
- [x] No raw METRC/Autogrow keys over the wire; masked placeholders + server merge on save.
- [x] Frontend dedupe + version gate + hidden-tab behavior.
- [x] `npm run build` (`@cpu/api`), `npm run build:platform`, `npm run test` passing locally.
