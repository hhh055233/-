# SHALAT API

Private server-side catalog and photo identification API.

## Public endpoints
- `GET /` — service status
- `GET /health` — health check
- `GET /api/updates` — catalog version only
- `POST /api/identify` — image identification; multipart field: `photo`

## Private catalog
The catalog is stored in `catalog.json` on the server. There is intentionally no public catalog-list endpoint. The app can receive only one sanitized remote profile after a successful scan.

A match requires all of the following:
- A readable exact model number in the photo
- AI confidence of at least 0.92 for the exact brand and model number
- An exact brand and model-number match in the catalog
- The catalog profile marked `verified: true`

Do not mark a remote profile verified until its compatibility is tested with the exact AC model on real hardware. Do not add guessed remote codes or claim that a visual remote mockup controls an AC.

## Render
- Build command: `cd server && npm install`
- Start command: `cd server && npm start`
- Required secret: `GEMINI_API_KEY`
- Optional: `GEMINI_MODEL` (server default: `gemini-3.5-flash-lite`)
