# METRC verification: `POST /plantbatches/v2/packages/frommotherplant`

**Verified:** 2026-05-27  
**Agent:** Documentation Agent (METRC API)  
**Primary sources:** METRC Web API PrintableList (Oregon host; schema is shared across state API hosts), METRC Getting Started docs, METRC operational guidance, NexBatch local implementation.

---

## 1. Exact endpoint path

| Item | Value |
|------|--------|
| **Method** | `POST` |
| **Path** | `/plantbatches/v2/packages/frommotherplant` |
| **Query parameter** | `licenseNumber` — facility license for the operation |
| **Full example** | `POST /plantbatches/v2/packages/frommotherplant?licenseNumber=123-ABC` |
| **Request body** | JSON **array** of objects (`Content-Type: application/json`) |
| **V1 equivalent** | `POST /plantbatches/v1/create/packages/frommotherplant` |

**Description (official):** “Creates packages from mother plants at the specified Facility.”

**Sources:**

- [METRC PrintableList — Oregon](https://api-or.metrc.com/Documentation/PrintableList) — section `POST /plantbatches/v2/packages/frommotherplant`
- [METRC demo documentation index](https://api-demo.metrc.com/documentation) — same route listed under Plant Batches v2
- Local: `apps/api/src/services/metrcPlantBatchMotherPackageService.ts` (`MOTHER_PLANT_PACKAGE_ENDPOINT`)

**State base URL:** Use the host for the facility’s state (e.g. `https://api-or.metrc.com`, `https://api-demo.metrc.com`). Path and body are not state-specific in published docs; permissions and facility rules may still vary by jurisdiction.

---

## 2. Exact required permissions

METRC documents these **user permissions** for this endpoint (all are required for a successful authorized call):

| Permission |
|------------|
| **View Immature Plants** |
| **Manage Immature Plants Inventory** |
| **View Packages** |
| **Create/Submit/Discontinue Packages** |

**Not listed** for this endpoint (contrast with `POST /plants/v2/plantbatch/packages`, which additionally requires **View Veg/Flower Plants** and **Manage Veg/Flower Plants Inventory**):

- View Veg/Flower Plants  
- Manage Veg/Flower Plants Inventory  

**Authentication (all METRC POSTs):**

- HTTP Basic: `integrator_api_key:user_api_key` in `Authorization`
- Effective permissions = permissions of the **user** whose API key is used

**Source:** [METRC PrintableList — `frommotherplant` permissions table](https://api-or.metrc.com/Documentation/PrintableList)

**Local note:** `metrcPlantBatchMotherPackageService.ts` surfaces HTTP 401/403 as credential/permission failures (`METRC_AUTH_PERMISSION_MESSAGE`).

---

## 3. Request body fields (required vs optional)

### Documented by METRC

The PrintableList entry for `frommotherplant` provides **example requests only**. It does **not** publish a per-field required/optional matrix (no `required` / `optional` labels on body properties).

The **example body is identical** to `POST /plantbatches/v2/packages` (same property names and sample values).

### Body object properties (from official examples)

| Field | In official examples | Confirmed semantics |
|-------|----------------------|---------------------|
| `Id` | `null` or integer (e.g. `5`) | **Mutually exclusive with `PlantBatch` in examples:** use `Id` + `PlantBatch: null`, or `Id: null` + `PlantBatch` string. Matches METRC “Record Matching” (reference by ID or name). |
| `PlantBatch` | string or `null` | When `Id` is null, set to a **plant batch name** (example: `"Demo Plant Batch 1"`). Case-insensitive name match per global API rules. |
| `Count` | integer | Package plant count. |
| `Tag` | string | **New package tag** (RFID label), not the mother plant tag. |
| `Item` | string | METRC item name (e.g. `"Immature Plants"`). |
| `Location` | string or `null` | Package location name. |
| `Sublocation` | string or `null` | Package sublocation. |
| `PatientLicenseNumber` | string or `null` | Patient license when applicable. |
| `Note` | string (may be `""`) | Free-text note. |
| `IsTradeSample` | boolean | Example: `false` / `true`. |
| `IsDonation` | boolean | Example: `false`. |
| `ActualDate` | date string | Example: `"2015-12-15"` (ISO date; API accepts ISO date/time per Getting Started). |
| `ExpirationDate` | date string | Present in examples. |
| `SellByDate` | date string | Present in examples. |
| `UseByDate` | date string | Present in examples. |

### Inferred required fields (not explicitly labeled by METRC)

For a **create** row (`Id: null`), treat as **required in practice** (omission likely yields 400):

- `PlantBatch` **or** a non-null `Id` (one identifier for the source)
- `Count`, `Tag`, `Item`, `ActualDate`
- `IsTradeSample`, `IsDonation` (always shown as booleans in examples)

Treat as **optional / nullable** (examples use `null` or omit only where shown):

- `Location`, `Sublocation`, `PatientLicenseNumber`
- `ExpirationDate`, `SellByDate`, `UseByDate`
- `Note` (can be empty string)

**Uncertainty:** METRC does not state whether date fields (`ExpirationDate`, etc.) are required for all states or item categories. Confirm against sandbox and state rules.

**Source:** [METRC PrintableList — example request](https://api-or.metrc.com/Documentation/PrintableList); [Record Matching](https://api-or.metrc.com/Documentation/PrintableList) (Getting Started).

---

## 4. What should `PlantBatch` be?

### Confirmed from official API documentation

- Field name is **`PlantBatch`** (not `PlantLabel`, `MotherPlant`, etc.) on this endpoint.
- Official examples use a **plant batch name** (`"Demo Plant Batch 1"`) when `Id` is `null`.
- Alternative in examples: **`Id`** = plant batch database ID with **`PlantBatch: null`**.
- Global rule: plant batches may be referenced by **unique ID or name** (case-insensitive).

**Conclusion (docs-only):** `PlantBatch` is documented as the **immature plant batch name** (or use `Id` for the batch), **not** as a field labeled “mother plant tag.”

### Operational / product context (METRC.com, not OpenAPI)

- [Metrc: Planting records from mother plant to immature batch](https://www.metrc.com/metrc-planting-records-from-mother-plant-to-immature-batch/) states clones must link to a **tagged source plant** and are turned into inventory via an **immature plant package**.
- That article does not define the JSON property name for `frommotherplant`.

### Related endpoint that uses plant tags explicitly

`POST /plants/v2/plantbatch/packages` uses **`PlantLabel`** (e.g. `"ABCDEF012345670000000011"`) for the source plant, plus `PackageTag`, `PlantBatchType`, etc. Different route, different schema, extra veg/flower permissions.

**Source:** [METRC PrintableList — `POST /plants/v2/plantbatch/packages`](https://api-or.metrc.com/Documentation/PrintableList)

### Uncertain: mother plant RFID label in `PlantBatch`

| Approach | Status |
|----------|--------|
| Plant batch **name** in `PlantBatch` | **Confirmed** (official examples) |
| Plant batch **`Id`** with `PlantBatch: null` | **Confirmed** (official examples) |
| **Mother plant tag/label** in `PlantBatch` | **Not confirmed** in METRC published examples |

**NexBatch local behavior (implementation assumption, not METRC doc proof):**

- `buildMetrcMotherPlantPackageBody()` sets `PlantBatch` to `sourcePlantLabel` (synced veg/flower **plant label**).
- UI copy: use a veg/flower plant label, not an immature batch name (`app/admin/integrations/metrc-sandbox/page.tsx`).
- Unit test: `metrcPlantBatchMotherPackageBodies.test.ts`.

**Recommendation:** Validate mother-plant-label-in-`PlantBatch` in **METRC sandbox** for your state. If rejected, use official batch name/`Id`, or evaluate `POST /plants/v2/plantbatch/packages` with `PlantLabel`.

---

## 5. Should `Id`, `Sublocation`, and `PatientLicenseNumber` be omitted when null?

### Confirmed

- Official examples **include** these keys with JSON **`null`** (e.g. `"Id": null`, `"Sublocation": null`, `"PatientLicenseNumber": null`).
- Second example row: `"PlantBatch": null` when `Id` is set — null is used, not omission.
- METRC requires JSON bodies for POST/PUT with `Content-Type: application/json`; examples consistently use explicit nulls for unused optional values.

### Not documented

- METRC does **not** state that omitting null-valued keys is equivalent to sending `null`.
- No official guidance says “omit when null” for this endpoint.

### Practical guidance

| Practice | Verdict |
|----------|---------|
| Send `"Id": null` on create | **Matches official examples**; NexBatch does this |
| Send `"Sublocation": null` when no sublocation | **Matches official examples** |
| Send `"PatientLicenseNumber": null` when N/A | **Matches official examples**; NexBatch does this |
| Omit keys entirely when null | **Uncertain** — not shown in examples; avoid unless sandbox proves equivalence |

**NexBatch (sandbox evaluation):** `buildMetrcMotherPlantPackageBody()` **omits** `Id`, `Sublocation`, and `PatientLicenseNumber` when unused (clean payload test per Generic Evaluation Plant Batches Step 2). Official METRC samples still use explicit `null`.

---

## Example request (official)

```http
POST /plantbatches/v2/packages/frommotherplant?licenseNumber=123-ABC
Content-Type: application/json
```

```json
[
  {
    "Id": null,
    "PlantBatch": "Demo Plant Batch 1",
    "Count": 10,
    "Location": null,
    "Sublocation": null,
    "Item": "Immature Plants",
    "Tag": "ABCDEF012345670000020201",
    "PatientLicenseNumber": "P00001",
    "Note": "This is a note.",
    "IsTradeSample": false,
    "IsDonation": false,
    "ActualDate": "2015-12-15",
    "ExpirationDate": "2016-09-15",
    "SellByDate": "2016-09-15",
    "UseByDate": "2016-09-15"
  },
  {
    "Id": 5,
    "PlantBatch": null,
    "Count": 10,
    "Location": null,
    "Sublocation": null,
    "Item": "Immature Plants",
    "Tag": "ABCDEF012345670000020202",
    "PatientLicenseNumber": "P00002",
    "Note": "",
    "IsTradeSample": true,
    "IsDonation": false,
    "ActualDate": "2015-12-15",
    "ExpirationDate": "2016-09-15",
    "SellByDate": "2016-09-15",
    "UseByDate": "2016-09-15"
  }
]
```

## Example response (official)

```json
{
  "Ids": [1, 2],
  "Warnings": null
}
```

---

## Summary table (answers to verification questions)

| # | Question | Answer |
|---|----------|--------|
| 1 | Exact path | `POST /plantbatches/v2/packages/frommotherplant?licenseNumber={license}` |
| 2 | Permissions | View Immature Plants; Manage Immature Plants Inventory; View Packages; Create/Submit/Discontinue Packages |
| 3 | Body fields | Array of objects; see §3 — no official required/optional matrix; infer from examples |
| 4 | `PlantBatch` meaning | **Documented:** plant batch **name** or use **`Id`**; **not documented:** mother plant label (NexBatch uses label — verify in sandbox) |
| 5 | Omit nulls? | **Not required to omit**; official examples send **`null`**; prefer explicit nulls |

---

## Local repository references

| File | Relevance |
|------|-----------|
| `apps/api/src/services/metrcPlantBatchMotherPackageService.ts` | Endpoint constant, permission error handling, sandbox-only guard |
| `apps/api/src/lib/metrcPlantBatchMotherPackageBodies.ts` | Request payload builder (`Id`/`PlantBatch`/null fields) |
| `apps/api/src/lib/metrcPlantBatchMotherPackageBodies.test.ts` | Expected payload with plant label as `PlantBatch` |
| `apps/api/src/lib/metrcPlantBatchPackageBodies.ts` | Regular batch packages (no `Id`; batch **name** only) |
| `app/admin/integrations/metrc-sandbox/page.tsx` | Sandbox UI for mother-plant package creation |

No other `docs/*.md` files in this repo previously documented this endpoint.

---

## Source index

1. [https://api-or.metrc.com/Documentation/PrintableList](https://api-or.metrc.com/Documentation/PrintableList) — authoritative endpoint text, permissions, examples (also mirrored at `api-demo`, `api-oh`, `api-ma`, etc.)
2. [https://api-demo.metrc.com/documentation](https://api-demo.metrc.com/documentation) — endpoint index
3. [https://www.metrc.com/metrc-planting-records-from-mother-plant-to-immature-batch/](https://www.metrc.com/metrc-planting-records-from-mother-plant-to-immature-batch/) — mother plant / immature package workflow (non-API schema)
4. NexBatch codebase paths listed above
