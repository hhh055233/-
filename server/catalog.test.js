const test = require("node:test");
const assert = require("node:assert/strict");
const { normalize, isValidIdentification, findMatchedRemote, publicRemoteProfile, readCatalog } = require("./catalog-utils");
const profile = {
  id: "electra-model-a", brand: "Electra", model: "RC Verified",
  modelNumber: "ABC-123", verified: true,
  irCodes: { power: "PRIVATE_POWER_CODE" }, wifiToken: "PRIVATE_WIFI_TOKEN",
  layout: { buttons: ["Power", "Mode"] }
};
const valid = { brand: "ELECTRA", modelNumber: "ABC123", confidence: 0.95, deviceType: "label" };

test("normalizes punctuation and case", () => assert.equal(normalize("ABC-123 / X"), "abc123x"));
test("accepts exact label identification at confidence threshold", () =>
  assert.equal(isValidIdentification({ ...valid, confidence: 0.92 }), true));
test("rejects low confidence, missing model number and unsupported image types", () => {
  assert.equal(isValidIdentification({ ...valid, confidence: 0.919 }), false);
  assert.equal(isValidIdentification({ ...valid, modelNumber: "" }), false);
  assert.equal(isValidIdentification({ ...valid, deviceType: "remote" }), false);
});
test("matches only exact brand/model on a verified profile", () => {
  assert.equal(findMatchedRemote({ remotes: [profile] }, valid), profile);
  assert.equal(findMatchedRemote({ remotes: [profile] }, { ...valid, modelNumber: "ABC124" }), null);
  assert.equal(findMatchedRemote({ remotes: [{ ...profile, verified: false }] }, valid), null);
  assert.equal(findMatchedRemote({ remotes: [profile] }, { ...valid, brand: "Tadiran" }), null);
});
test("public profile strips private control data", () => {
  const safe = publicRemoteProfile(profile);
  assert.deepEqual(safe, {
    id: "electra-model-a", brand: "Electra", model: "RC Verified",
    verified: true, imageUrl: null, layout: { buttons: ["Power", "Mode"] }
  });
  assert.equal(JSON.stringify(safe).includes("PRIVATE_POWER_CODE"), false);
  assert.equal(JSON.stringify(safe).includes("PRIVATE_WIFI_TOKEN"), false);
});
test("loads the private catalog from environment JSON", () => {
  const catalog = readCatalog({ envCatalogJson: JSON.stringify({ version: 9, remotes: [], updates: [] }), catalogPath: "unused" });
  assert.equal(catalog.version, 9);
  assert.deepEqual(catalog.remotes, []);
});

test("merges extra private research candidates without exposing them through matching", () => {
  const catalog = readCatalog({
    envCatalogJson: JSON.stringify({ version: 5, remotes: [], researchCandidates: [{ id: "old" }], updates: [] }),
    envExtraCandidatesJson: JSON.stringify({ version: 6, researchCandidates: [{ id: "new" }, { id: "old" }], updates: [{ id: "v6" }] }),
    catalogPath: "unused"
  });
  assert.equal(catalog.version, 6);
  assert.deepEqual(catalog.researchCandidates.map((item) => item.id), ["old", "new"]);
  assert.equal(catalog.updates[0].id, "v6");
  assert.equal(findMatchedRemote(catalog, valid), null);
});
