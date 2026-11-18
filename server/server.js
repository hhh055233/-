const express = require("express");
const cors = require("cors");
const multer = require("multer");
const fs = require("node:fs");
const path = require("node:path");
const { readCatalog, findMatchedRemote, publicRemoteProfile } = require("./catalog-utils");

const app = express();
app.set("trust proxy", 1);
const PORT = Number(process.env.PORT || 10000);
const catalogPath = path.join(__dirname, "catalog.json");
const protocolCatalogPath = path.join(__dirname, "ir-protocol-catalog.json");
const wifiIntegrationCatalogPath = path.join(__dirname, "wifi-integration-catalog.json");
const protocolCatalog = JSON.parse(fs.readFileSync(protocolCatalogPath, "utf8"));
const wifiIntegrationCatalog = JSON.parse(fs.readFileSync(wifiIntegrationCatalogPath, "utf8"));
if (!Array.isArray(wifiIntegrationCatalog.providers)) {
  throw new Error("Wi-Fi integration catalog is missing or invalid.");
}
if (!Array.isArray(protocolCatalog.entries) || !protocolCatalog.entries.length) {
  throw new Error("IR protocol catalog is missing or invalid.");
}
console.log("SHALAT IR protocol inventory loaded: " + protocolCatalog.entries.length + " families across " + protocolCatalog.brands.length + " brands.");
const IDENTIFY_WINDOW_MS = 60 * 1000;
const IDENTIFY_MAX_REQUESTS = 12;
const identifyRequests = new Map();

app.use(cors());
app.use(express.json({ limit: "1mb" }));

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 8 * 1024 * 1024, files: 2 },
  fileFilter: (_req, file, cb) => {
    if (!["image/jpeg", "image/png", "image/webp"].includes(file.mimetype)) {
      return cb(new Error("Unsupported image type. Use JPEG, PNG or WebP."));
    }
    cb(null, true);
  }
});

let cachedCatalog = null;
function getCatalog() {
  if (!cachedCatalog) {
    cachedCatalog = readCatalog({
      envCatalogJson: process.env.SHALAT_CATALOG_JSON,
      envExtraCandidatesJson: process.env.SHALAT_EXTRA_CANDIDATES_JSON,
      catalogPath
    });
  }
  return cachedCatalog;
}
try {
  const startupCatalog = getCatalog();
  console.log("SHALAT private catalog loaded: version " + startupCatalog.version +
    ", " + (startupCatalog.researchCandidates || []).length + " research candidates, " +
    startupCatalog.remotes.filter((remote) => remote.verified === true).length + " verified remote profiles.");
} catch (error) {
  console.error("SHALAT private catalog configuration is invalid:", error.message);
  process.exit(1);
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
  const catalog = getCatalog();
  res.json({
    version: catalog.version,
    updatedAt: catalog.updatedAt,
    updates: Array.isArray(catalog.updates) ? catalog.updates : [],
    protocolInventory: {
      familyCount: protocolCatalog.entries.length,
      brandCount: protocolCatalog.brands.length,
      sourceUpdated: protocolCatalog.sourceUpdated
    },
    wifiIntegrations: wifiIntegrationCatalog.providers.map((provider) => ({
      id: provider.id,
      brand: provider.brand,
      connectionType: provider.connectionType,
      officialApps: provider.officialApps,
      shalatStatus: provider.shalatStatus,
      apiStatus: provider.apiStatus,
      nextRequirement: provider.nextRequirement
    }))
  });
});

app.post("/api/identify", (req, res, next) => {
  const now = Date.now();
  const key = req.ip || req.socket.remoteAddress || "unknown";
  const current = identifyRequests.get(key) || { startedAt: now, count: 0 };
  if (now - current.startedAt > IDENTIFY_WINDOW_MS) { current.startedAt = now; current.count = 0; }
  current.count += 1;
  identifyRequests.set(key, current);
  if (identifyRequests.size > 2000) {
    for (const [ip, entry] of identifyRequests) {
      if (now - entry.startedAt > IDENTIFY_WINDOW_MS) identifyRequests.delete(ip);
    }
  }
  if (current.count > IDENTIFY_MAX_REQUESTS) return res.status(429).json({ error: "Too many scan requests. Please wait a minute and try again." });
  next();
}, upload.fields([{ name: "photo", maxCount: 1 }, { name: "labelPhoto", maxCount: 1 }]), async (req, res) => {
  const photoFile = req.files?.photo?.[0];
  const labelFile = req.files?.labelPhoto?.[0];
  if (!photoFile) {
    return res.status(400).json({ error: "Please upload one photo using the 'photo' field." });
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return res.status(503).json({
      error: "AI recognition is not configured yet.",
      code: "GEMINI_API_KEY_MISSING"
    });
  }

  const model = process.env.GEMINI_MODEL || "gemini-3.5-flash";
  const prompt = [
    "Identify the exact air-conditioner indoor unit from this photo.",
    "Return only valid JSON with this exact shape:",
    '{"brand":string|null,"model":string|null,"modelNumber":string|null,"deviceType":"indoor_unit"|"label"|"outdoor_unit"|"remote"|"unknown","confidence":number,"evidence":string[],"needsMorePhotos":boolean}',
    "Never infer or invent a model number. modelNumber must be explicitly readable in at least one attached image; otherwise return null.",
    "If no model-label image is attached and the exact model number is not readable, set modelNumber to null and needsMorePhotos to true. If a model-label image is attached but unreadable, also request another label photo.",
    labelFile ? "A second image of the manufacturer model label is also attached. Read the exact model number from that label if legible." : "If the model number is not clearly readable, request a second photo of the manufacturer model label.",
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
        signal: AbortSignal.timeout(45000),
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ parts: [
            { text: prompt },
            { inline_data: { mime_type: photoFile.mimetype, data: photoFile.buffer.toString("base64") } },
            ...(labelFile ? [{ text: "Second image: model label." }, { inline_data: { mime_type: labelFile.mimetype, data: labelFile.buffer.toString("base64") } }] : [])
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

    const catalog = getCatalog();
    const matchedRemote = findMatchedRemote(catalog, identification);

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
    if (error.name === "TimeoutError" || error.name === "AbortError") {
      return res.status(504).json({ error: "Recognition took too long. Please try again." });
    }
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
