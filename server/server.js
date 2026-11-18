const express = require("express");
const cors = require("cors");
const multer = require("multer");
const fs = require("node:fs");
const path = require("node:path");

const app = express();
const PORT = Number(process.env.PORT || 10000);
const catalogPath = path.join(__dirname, "catalog.json");

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

app.get("/", (_req, res) => {
  res.json({ name: "SHALAT API", status: "running", docs: ["/health", "/api/catalog", "/api/updates"] });
});

app.get("/health", (_req, res) => {
  res.json({ ok: true, service: "shalat-api", timestamp: new Date().toISOString() });
});

app.get("/api/catalog", (_req, res) => {
  res.json(readCatalog());
});

app.get("/api/updates", (_req, res) => {
  const catalog = readCatalog();
  res.json({
    version: catalog.version,
    updatedAt: catalog.updatedAt,
    remoteCount: catalog.remotes.length
  });
});

app.post("/api/identify", upload.single("photo"), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: "Please upload one photo using the 'photo' field." });
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return res.status(503).json({
      error: "AI recognition is not configured yet.",
      code: "GEMINI_API_KEY_MISSING",
      nextStep: "Add GEMINI_API_KEY in the Render service environment variables."
    });
  }

  const model = process.env.GEMINI_MODEL || "gemini-3.5-flash-lite";
  const imageBase64 = req.file.buffer.toString("base64");
  const prompt = [
    "You identify air conditioners from user-provided photos.",
    "Return only valid JSON with this exact shape:",
    '{"brand":string|null,"model":string|null,"modelNumber":string|null,"deviceType":"indoor_unit"|"outdoor_unit"|"remote"|"label"|"unknown","confidence":number,"candidates":[{"brand":string,"model":string|null,"confidence":number}],"evidence":string[],"needsMorePhotos":boolean}',
    "Do not guess a model number that is not visible. If uncertain, use null and explain what photo or label is needed.",
    "Only identify the air conditioner; do not claim that a compatible remote exists."
  ].join("\n");

  try {
    const response = await fetch(
      "https://generativelanguage.googleapis.com/v1beta/models/" +
        encodeURIComponent(model) + ":generateContent?key=" + encodeURIComponent(apiKey),
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{
            parts: [
              { text: prompt },
              { inline_data: { mime_type: req.file.mimetype, data: imageBase64 } }
            ]
          }],
          generationConfig: { responseMimeType: "application/json", temperature: 0.1 }
        })
      }
    );

    const payload = await response.json();
    if (!response.ok) {
      console.error("Gemini API error:", response.status, payload?.error?.message || "unknown");
      return res.status(502).json({
        error: "The image recognition provider could not complete the request.",
        providerStatus: response.status
      });
    }

    const rawText = payload?.candidates?.[0]?.content?.parts?.map((p) => p.text || "").join("");
    if (!rawText) {
      return res.status(502).json({ error: "The AI returned an empty identification result." });
    }

    let identification;
    try {
      identification = JSON.parse(rawText);
    } catch {
      return res.status(502).json({ error: "The AI response was not valid JSON." });
    }

    const catalog = readCatalog();
    const normalize = (value) => String(value || "").trim().toLowerCase().replace(/[^a-z0-9א-ת]/g, "");
    const matchedRemote = catalog.remotes.find((remote) =>
      normalize(remote.brand) === normalize(identification.brand) &&
      normalize(remote.model) === normalize(identification.model) &&
      remote.verified === true
    ) || null;

    res.json({
      identification,
      matchedRemote,
      catalogVersion: catalog.version,
      controlReady: Boolean(matchedRemote && matchedRemote.verified)
    });
  } catch (error) {
    console.error("Identification request failed:", error.message);
    res.status(500).json({ error: "Image identification failed unexpectedly." });
  }
});

app.use((error, _req, res, _next) => {
  if (error instanceof multer.MulterError && error.code === "LIMIT_FILE_SIZE") {
    return res.status(413).json({ error: "Image is too large. Maximum size is 8 MB." });
  }
  res.status(400).json({ error: error.message || "Invalid request." });
});

app.listen(PORT, "0.0.0.0", () => {
  console.log("SHALAT API listening on port " + PORT);
});
