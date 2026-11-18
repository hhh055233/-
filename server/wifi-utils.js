function publicWifiProvider(provider) {
  if (!provider || typeof provider !== "object") return null;
  const officialApps = (Array.isArray(provider.officialApps) ? provider.officialApps : [])
    .filter((item) => item && typeof item.name === "string")
    .map((item) => ({
      name: item.name,
      models: typeof item.models === "string" ? item.models : "",
      sourceUrl: typeof item.sourceUrl === "string" ? item.sourceUrl : null
    }));
  const community = provider.communityIntegration && typeof provider.communityIntegration === "object"
    ? {
        repositoryUrl: typeof provider.communityIntegration.repositoryUrl === "string" ? provider.communityIntegration.repositoryUrl : null,
        baseLibraryUrl: typeof provider.communityIntegration.baseLibraryUrl === "string" ? provider.communityIntegration.baseLibraryUrl : null,
        protocol: typeof provider.communityIntegration.protocol === "string" ? provider.communityIntegration.protocol : null,
        authentication: typeof provider.communityIntegration.authentication === "string" ? provider.communityIntegration.authentication : null,
        testedModelEvidence: typeof provider.communityIntegration.testedModelEvidence === "string" ? provider.communityIntegration.testedModelEvidence : null,
        testedModels: Array.isArray(provider.communityIntegration.testedModels) ? provider.communityIntegration.testedModels.filter((x) => typeof x === "string") : [],
        controls: Array.isArray(provider.communityIntegration.controls) ? provider.communityIntegration.controls.filter((x) => typeof x === "string") : [],
        integrationLicense: typeof provider.communityIntegration.integrationLicense === "string" ? provider.communityIntegration.integrationLicense : null,
        limitations: typeof provider.communityIntegration.limitations === "string" ? provider.communityIntegration.limitations : null
      }
    : null;
  return {
    id: String(provider.id || ""),
    brand: String(provider.brand || ""),
    brandAliases: Array.isArray(provider.brandAliases) ? provider.brandAliases.filter((x) => typeof x === "string") : [],
    connectionType: typeof provider.connectionType === "string" ? provider.connectionType : "unknown",
    officialApps,
    shalatStatus: typeof provider.shalatStatus === "string" ? provider.shalatStatus : "not_connected",
    apiStatus: typeof provider.apiStatus === "string" ? provider.apiStatus : "unknown",
    nextRequirement: typeof provider.nextRequirement === "string" ? provider.nextRequirement : "",
    researchEvidence: typeof provider.researchEvidence === "string" ? provider.researchEvidence : null,
    sourceUrls: Array.isArray(provider.sourceUrls) ? provider.sourceUrls.filter((x) => typeof x === "string") : [],
    communityIntegration: community
  };
}

function publicWifiProviders(catalog) {
  return (Array.isArray(catalog?.providers) ? catalog.providers : [])
    .map(publicWifiProvider)
    .filter((provider) => provider && provider.id && provider.brand);
}

module.exports = { publicWifiProvider, publicWifiProviders };
