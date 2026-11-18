const express = require("express");
const cors = require("cors");
const multer = require("multer");
const fs = require("node:fs");
const path = require("node:path");

const app = express();
const PORT = Number(process.env.PORT || 10000);
const catalogPath = path.join(__dirname, "catalog.json");
const MIN_IDENTIFICATION_CONFIDENCE = 0.92;

app.use(cors());
app.use(express.json({ limit: "1mb" }));

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 8 * 1024 * 1024, files: 1 },
  fileFilter: (_req, file, cb) => {
    if (!["image/jpeg", "image/png", "image/webp"].includes(file.mimetype)) {
      return cb(new Error("Unsupported image type. Use JPEG, PNG or WebP."));
    }
    cb(null, true);
  }
});

function readCatalog() {
  return JSON.parse(fs.readFileSync(catalogPath, "utf8"));
}

function normalize(value) {
  return String(value || "").trim().toLowerCase().replace(/[^a-z0-9]/g, "");
}

function isValidIdentification(value) {
  return value &&
    typeof value === "object" &&
    typeof value.brand === "string" &&
    typeof value.modelNumber === "string" &&
    typeof value.confidence === "number" &&
    value.confidence >= MIN_IDENTIFICATION_CONFIDENCE &&
    ["indoor_unit", "label"].includes(value.deviceType);
}

function publicRemoteProfile(remote) {
  // Never send the private catalog record or IR/Wi-Fi control data to the app.
  return {
    id: remote.id,
    brand: remote.brand,
    model: remote.model,
    verified: true,
    imageUrl: remote.imageUrl || null,
    layout: remote.layout || null
  };
}

app.get("/", (_req, res) => {
  res.json({ name: "SHALAT API", status: "running" });
});

app.get("/health", (_req, res) => {
  res.json({ ok: true, service: "shalat-api", timestamp: new Date().toISOString() });
});

// The catalog is deliberately private. Only the identification endpoint can
// retrieve one exact, verified profile after a successful photo scan.
app.get("/api/updates", (_req, res) => {
  const catalog = readCatalog();
  res.json({ version: catalog.version, updatedAt: catalog.updatedAt, updates: Array.isArray(catalog.updates) ? catalog.updates : [] });
});

app.post("/api/identify", upload.single("photo"), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: "Please upload one photo using the 'photo' field." });
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return res.status(503).json({
      error: "AI recognition is not configured yet.",
      code: "GEMINI_API_KEY_MISSING"
    });
  }

  const model = process.env.GEMINI_MODEL || "gemini-3.5-flash-lite";
  const prompt = [
    "Identify the exact air-conditioner indoor unit from this photo.",
    "Return only valid JSON with this exact shape:",
    '{"brand":string|null,"model":string|null,"modelNumber":string|null,"deviceType":"indoor_unit"|"label"|"outdoor_unit"|"remote"|"unknown","confidence":number,"evidence":string[],"needsMorePhotos":boolean}',
    "Never infer or invent a model number. modelNumber must be explicitly readable in the photo; otherwise return null.",
    "If the photo shows only the general appearance and not a readable exact model number, set modelNumber to null and needsMorePhotos to true.",
    "confidence must reflect certainty in the exact brand AND exact model number, not just the brand.",
    "If the image is not an air conditioner or its model label, use deviceType unknown.",
    "Do not recommend or invent a remote."
  ].join("\n");

  try {
    const response = await fetch(
      "https://generativelanguage.googleapis.com/v1beta/models/" +
        encodeURIComponent(model) + ":generateContent?key=" + encodeURIComponent(apiKey),
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ parts: [
            { text: prompt },
            { inline_data: { mime_type: req.file.mimetype, data: req.file.buffer.toString("base64") } }
          ] }],
          generationConfig: { responseMimeType: "application/json", temperature: 0 }
        })
      }
    );

    const payload = await response.json();
    if (!response.ok) {
      console.error("Gemini API error:", response.status, payload?.error?.message || "unknown");
      return res.status(502).json({ error: "The image recognition provider could not complete the request." });
    }

    const rawText = payload?.candidates?.[0]?.content?.parts?.map((part) => part.text || "").join("");
    if (!rawText) return res.status(502).json({ error: "The AI returned an empty identification result." });

    let identification;
    try { identification = JSON.parse(rawText); }
    catch { return res.status(502).json({ error: "The AI response was not valid JSON." }); }

    const catalog = readCatalog();
    let matchedRemote = null;

    if (isValidIdentification(identification)) {
      matchedRemote = catalog.remotes.find((remote) =>
        remote.verified === true &&
        remote.modelNumber &&
        normalize(remote.brand) === normalize(identification.brand) &&
        normalize(remote.modelNumber) === normalize(identification.modelNumber)
      ) || null;
    }

    return res.json({
      identification: {
        brand: identification.brand || null,
        model: identification.model || null,
        modelNumber: identification.modelNumber || null,
        confidence: Number(identification.confidence) || 0,
        needsMorePhotos: identification.needsMorePhotos === true
      },
      matchedRemote: matchedRemote ? publicRemoteProfile(matchedRemote) : null,
      catalogVersion: catalog.version,
      controlReady: Boolean(matchedRemote)
    });
  } catch (error) {
    console.error("Identification request failed:", error.message);
    return res.status(500).json({ error: "Image identification failed unexpectedly." });
  }
});

app.use((error, _req, res, _next) => {
  if (error instanceof multer.MulterError && error.code === "LIMIT_FILE_SIZE") {
    return res.status(413).json({ error: "Image is too large. Maximum size is 8 MB." });
  }
  return res.status(400).json({ error: error.message || "Invalid request." });
});

app.listen(PORT, "0.0.0.0", () => {
  console.log("SHALAT API listening on port " + PORT);
});
