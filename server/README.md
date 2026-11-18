# SHALAT API

Node.js API deployed separately from the Expo mobile app.

## Endpoints
- `GET /` — service information
- `GET /health` — health check
- `GET /api/catalog` — current remote catalog
- `GET /api/updates` — catalog version for app update checks
- `POST /api/identify` — photo identification; multipart form field: `photo`

## Render
- Runtime: Node
- Build command: `cd server && npm install`
- Start command: `cd server && npm start`
- Add `GEMINI_API_KEY` as a secret environment variable in Render.
- Optional: `GEMINI_MODEL` (defaults to `gemini-2.5-flash`).

The catalog currently contains no verified remote profiles. Identification does not imply control compatibility. Add only tested profiles and mark them `verified: true` after real-device validation.
