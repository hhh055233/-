const fs = require("node:fs");
const MIN_IDENTIFICATION_CONFIDENCE = 0.92;
function normalize(value) {
  return String(value || "").trim().toLowerCase().replace(/[^a-z0-9]/g, "");
}
function isValidIdentification(value) {
  return Boolean(value && typeof value === "object" &&
    typeof value.brand === "string" && value.brand.trim() &&
    typeof value.modelNumber === "string" && value.modelNumber.trim() &&
    typeof value.confidence === "number" && Number.isFinite(value.confidence) &&
    value.confidence >= MIN_IDENTIFICATION_CONFIDENCE &&
    ["indoor_unit", "label"].includes(value.deviceType));
}
function findMatchedRemote(catalog, identification) {
  if (!isValidIdentification(identification)) return null;
  const remotes = Array.isArray(catalog?.remotes) ? catalog.remotes : [];
  return remotes.find((remote) =>
    remote.verified === true &&
    typeof remote.brand === "string" &&
    typeof remote.modelNumber === "string" &&
    normalize(remote.brand) === normalize(identification.brand) &&
    normalize(remote.modelNumber) === normalize(identification.modelNumber)
  ) || null;
}
function publicRemoteProfile(remote) {
  if (!remote) return null;
  return {
    id: remote.id, brand: remote.brand, model: remote.model, verified: true,
    imageUrl: remote.imageUrl || null, layout: remote.layout || null
  };
}
function readCatalog({ envCatalogJson, envExtraCandidatesJson, catalogPath }) {
  const catalog = envCatalogJson
    ? JSON.parse(envCatalogJson)
    : JSON.parse(fs.readFileSync(catalogPath, "utf8"));
  if (!catalog || typeof catalog !== "object" || !Array.isArray(catalog.remotes)) {
    throw new Error("SHALAT catalog is invalid: remotes must be an array.");
  }
  if (!Array.isArray(catalog.updates)) catalog.updates = [];
  if (envExtraCandidatesJson) {
    const extra = JSON.parse(envExtraCandidatesJson);
    const mergeUnique = (base, additions) => {
      const result = Array.isArray(base) ? [...base] : [];
      const ids = new Set(result.map((item) => item.id));
      for (const item of Array.isArray(additions) ? additions : []) {
        if (item && item.id && !ids.has(item.id)) {
          result.push(item);
          ids.add(item.id);
        }
      }
      return result;
    };
    catalog.researchCandidates = mergeUnique(catalog.researchCandidates, extra.researchCandidates);
    catalog.universalRemoteCodeSets = mergeUnique(catalog.universalRemoteCodeSets, extra.universalRemoteCodeSets);
    catalog.version = Math.max(Number(catalog.version) || 0, Number(extra.version) || 0);
    catalog.updatedAt = extra.updatedAt || catalog.updatedAt;
    catalog.updates = [...(Array.isArray(extra.updates) ? extra.updates : []), ...catalog.updates]
      .filter((item, index, all) => all.findIndex((other) => other.id === item.id) === index)
      .sort((a, b) => String(b.publishedAt || "").localeCompare(String(a.publishedAt || "")));
  }
  return catalog;
}
module.exports = { normalize, isValidIdentification, findMatchedRemote, publicRemoteProfile, readCatalog };
