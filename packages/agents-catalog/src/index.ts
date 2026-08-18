import marketplaceAgentManifestJson from "../generated/catalog.json" with { type: "json" };
import type { MarketplaceAgentManifest, MarketplaceAgent } from "./types.js";

export type {
  MarketplaceAgent,
  MarketplaceAgentKind,
  MarketplaceAgentManifest,
  MarketplaceAgentSkillRequirement,
  MarketplaceAgentInstallResult,
} from "./types.js";

const manifest = marketplaceAgentManifestJson as unknown as MarketplaceAgentManifest;

export const marketplaceAgents: MarketplaceAgent[] = manifest.agents;

const agentsById = new Map(marketplaceAgents.map((a) => [a.id, a]));
const agentsByKey = new Map(marketplaceAgents.map((a) => [a.key, a]));
const agentsBySlug = new Map(marketplaceAgents.map((a) => [a.slug, a]));

export function getMarketplaceAgent(ref: string): MarketplaceAgent | null {
  return agentsById.get(ref) ?? agentsByKey.get(ref) ?? agentsBySlug.get(ref) ?? null;
}

export function listMarketplaceAgents(category?: string): MarketplaceAgent[] {
  if (!category) return marketplaceAgents;
  return marketplaceAgents.filter((a) => a.category === category);
}