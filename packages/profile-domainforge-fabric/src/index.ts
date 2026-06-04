import type { ProjectProfile } from "@evopilot/core";

export const domainforgeFabricProfile: ProjectProfile = {
  id: "domainforge-fabric",
  name: "domainforge-fabric",
  description: "从 domainforge-fabric-self-evolution 演化出的第一个 EvoPilot 项目画像。",
  policy: {
    protectedPaths: [
      "domains/**",
      "secrets/**",
      "production.yaml"
    ],
    weights: {
      performance: 0.15,
      reliability: 0.25,
      userExperience: 0.20,
      maintainability: 0.20,
      documentation: 0.05,
      cost: 0.15
    },
    requireUserConfirmation: true,
    blockReleaseOnCiFailure: true,
    requirePostReleaseVerification: true
  },
  templates: {
    architectureReview: "templates/architecture-review.md",
    productEvolutionReview: "templates/product-evolution-review.md",
    releaseReadinessReview: "templates/release-readiness-review.md"
  }
};

export const domainforgeFabricRules = {
  requireLlmTraceForProductionProof: true,
  planPreviewIsNotEffectProof: true,
  businessAssetsAreProfileOwned: true,
  protectedBusinessAssetRoot: "domains/"
};
