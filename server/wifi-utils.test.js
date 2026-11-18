const test = require("node:test");
const assert = require("node:assert/strict");
const { publicWifiProvider, publicWifiProviders } = require("./wifi-utils");

test("publishes documented provider research without leaking arbitrary credential fields", () => {
  const provider = {
    id: "spectra",
    brand: "Spectra",
    brandAliases: ["SPECTRA"],
    shalatStatus: "not_connected",
    apiStatus: "no_spectra_specific_cloud_api_verified",
    nextRequirement: "Verify exact model",
    officialApps: [{ name: "MY TADIRAN", models: "model-specific", sourceUrl: "https://example.com/manual" }],
    communityIntegration: null,
    password: "must-never-leak",
    accessToken: "must-never-leak"
  };
  const result = publicWifiProvider(provider);
  assert.equal(result.brand, "Spectra");
  assert.equal(result.officialApps[0].name, "MY TADIRAN");
  assert.equal("password" in result, false);
  assert.equal("accessToken" in result, false);
});

test("preserves community integration evidence but does not mark it connected", () => {
  const result = publicWifiProvider({
    id: "tornado",
    brand: "Tornado",
    shalatStatus: "not_connected",
    apiStatus: "unofficial_reverse_engineered_cloud_integration_available",
    officialApps: [],
    communityIntegration: {
      repositoryUrl: "https://github.com/example/repo",
      controls: ["power", "temperature"],
      limitations: "Unofficial and untested by SHALAT",
      refreshToken: "secret"
    }
  });
  assert.equal(result.shalatStatus, "not_connected");
  assert.deepEqual(result.communityIntegration.controls, ["power", "temperature"]);
  assert.equal("refreshToken" in result.communityIntegration, false);
});

test("returns only valid provider records", () => {
  assert.deepEqual(publicWifiProviders({ providers: [null, {}, { id: "x", brand: "X" }] }).map((x) => x.id), ["x"]);
  assert.deepEqual(publicWifiProviders({ providers: "invalid" }), []);
});
