import fs from "node:fs/promises";

const DEFAULT_AGENT_BUNDLE_FILES = {
  default: ["AGENTS.md"],
  ceo: ["AGENTS.md", "HEARTBEAT.md", "SOUL.md", "TOOLS.md"],
  coo: ["AGENTS.md", "HEARTBEAT.md", "SOUL.md", "TOOLS.md"],
  cto: ["AGENTS.md", "HEARTBEAT.md", "SOUL.md", "TOOLS.md"],
  cpa: ["AGENTS.md", "HEARTBEAT.md", "SOUL.md", "TOOLS.md"],
  "hr-manager": ["AGENTS.md", "HEARTBEAT.md", "SOUL.md", "TOOLS.md"],
  "chief-marketing-officer": ["AGENTS.md", "HEARTBEAT.md", "SOUL.md", "TOOLS.md"],
  uxdesigner: ["AGENTS.md", "HEARTBEAT.md", "SOUL.md", "TOOLS.md"],
  content: ["AGENTS.md", "HEARTBEAT.md", "SOUL.md", "TOOLS.md"],
  coder: ["AGENTS.md", "HEARTBEAT.md", "SOUL.md", "TOOLS.md"],
  platformengineer: ["AGENTS.md", "HEARTBEAT.md", "SOUL.md", "TOOLS.md"],
  "security-engineer": ["AGENTS.md", "HEARTBEAT.md", "SOUL.md", "TOOLS.md"],
  qa: ["AGENTS.md", "HEARTBEAT.md", "SOUL.md", "TOOLS.md"],
} as const;

type DefaultAgentBundleRole = keyof typeof DEFAULT_AGENT_BUNDLE_FILES;

function resolveDefaultAgentBundleUrl(role: DefaultAgentBundleRole, fileName: string) {
  return new URL(`../onboarding-assets/${role}/${fileName}`, import.meta.url);
}

export async function loadDefaultAgentInstructionsBundle(role: DefaultAgentBundleRole): Promise<Record<string, string>> {
  const fileNames = DEFAULT_AGENT_BUNDLE_FILES[role];
  const entries = await Promise.all(
    fileNames.map(async (fileName) => {
      const content = await fs.readFile(resolveDefaultAgentBundleUrl(role, fileName), "utf8");
      return [fileName, content] as const;
    }),
  );
  return Object.fromEntries(entries);
}

/**
 * Resolve the default instructions bundle role for an agent.
 *
 * Resolution order:
 * 1. Normalized agent name (lowercase, spaces→dashes) — enables per-agent bundles
 * 2. Agent role — enables per-role bundles
 * 3. "default" fallback — generic AGENTS.md only
 *
 * This allows agents sharing a role (e.g. COO, CPA, HR Manager all have role=cfo)
 * to receive distinct bundle content via their name/urlKey.
 */
export function resolveDefaultAgentInstructionsBundleRole(agent: { name?: string; role?: string }): DefaultAgentBundleRole {
  // Try normalized agent name first (e.g. "HR Manager" => "hr-manager", "COO" => "coo")
  const nameKey = (agent.name ?? "").toLowerCase().trim().replace(/\s+/g, "-");
  if (nameKey && nameKey in DEFAULT_AGENT_BUNDLE_FILES) return nameKey as DefaultAgentBundleRole;

  // Fallback to role (e.g. "ceo" => "ceo", "cto" => "cto")
  const role = (agent.role ?? "").toLowerCase().trim();
  if (role in DEFAULT_AGENT_BUNDLE_FILES) return role as DefaultAgentBundleRole;

  return "default";
}
