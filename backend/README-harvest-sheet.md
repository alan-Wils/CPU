# Harvest sheet uploads & AI extraction

The Cultivation page can **upload a photo** of a handwritten harvest log and optionally **extract tag/weight rows** via OpenAI vision.

## Environment

- `OPENAI_API_KEY` — required for `POST /api/harvest-sheet/extract`. If unset, extraction returns `503` and operators can still type weights manually.
- `OPENAI_MODEL` — defaults to `gpt-4o-mini` (must support image input).
- `OPENAI_BASE_URL` — optional; defaults to `https://api.openai.com/v1`.

## Storage

Images are written under `backend/uploads/harvest-sheets/{companyId}/` and served at `GET /uploads/...` from the same server. This is suitable for local/dev; for production, consider a durable object store and signed URLs.

## Privacy

Photos are sent to your configured OpenAI endpoint. Do not upload regulated data your policies disallow sharing with the model provider. Operators should review extracted rows before saving.
