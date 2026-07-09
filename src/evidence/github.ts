import * as fs from "node:fs";
import * as path from "node:path";
import type { EvidenceItem } from "./types.js";

const A8_SDLC_CONTROLS: Array<{ id: string; title: string }> = [
  { id: "A.8.3", title: "Information access restriction" },
  { id: "A.8.4", title: "Access to source code" },
  { id: "A.8.8", title: "Management of technical vulnerabilities" },
  { id: "A.8.9", title: "Configuration management" },
  { id: "A.8.25", title: "Secure development life cycle" },
  { id: "A.8.26", title: "Application security requirements" },
  { id: "A.8.27", title: "Secure system architecture and engineering principles" },
  { id: "A.8.28", title: "Secure coding" },
  { id: "A.8.29", title: "Security testing in development and acceptance" },
  { id: "A.8.30", title: "Outsourced development" },
  { id: "A.8.31", title: "Separation of development, test, and production environments" },
  { id: "A.8.32", title: "Change management" },
  { id: "A.8.33", title: "Test information" },
  { id: "A.8.34", title: "Protection of information systems during audit testing" },
];

function fileExists(filePath: string): boolean {
  try {
    fs.accessSync(filePath, fs.constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

function readFileIfExists(filePath: string): string | null {
  try {
    return fs.readFileSync(filePath, "utf-8");
  } catch {
    return null;
  }
}

export async function collectGitHubEvidence(repoRoot: string): Promise<EvidenceItem[]> {
  const items: EvidenceItem[] = [];
  const githubDir = path.join(repoRoot, ".github");
  const ghDirExists = fileExists(githubDir);

  const collectedAt = new Date().toISOString();

  items.push({
    id: "GH-BRANCH-PROTECTION",
    isoControlId: "A.8.4",
    isoControlTitle: "Access to source code",
    category: "A.8",
    source: "github",
    evidenceType: "config",
    collectionMethod: "Branch protection rules documented in .github/BRANCH-PROTECTION.md",
    collectedAt,
    validUntil: new Date(Date.now() + 90 * 24 * 60 * 60 * 1000).toISOString(),
    status: ghDirExists && fileExists(path.join(githubDir, "BRANCH-PROTECTION.md")) ? "ready" : "pending",
    artifactRef: ".github/BRANCH-PROTECTION.md",
    metadata: {
      requires: ["PR reviews (1 approval)", "Signed commits", "Status checks", "No force pushes", "No branch deletion", "Conversation resolution"],
      applied: "Requires GitHub org admin to apply via Settings > Branches",
    },
  });

  items.push({
    id: "GH-CODEOWNERS",
    isoControlId: "A.8.3",
    isoControlTitle: "Information access restriction",
    category: "A.8",
    source: "github",
    evidenceType: "config",
    collectionMethod: "CODEOWNERS file enforces mandatory code review assignments",
    collectedAt,
    validUntil: new Date(Date.now() + 90 * 24 * 60 * 60 * 1000).toISOString(),
    status: ghDirExists && fileExists(path.join(githubDir, "CODEOWNERS")) ? "ready" : "pending",
    artifactRef: ".github/CODEOWNERS",
    metadata: {
      paths: {
        global: "@rambur/ciso + @rambur/security-engineering",
        "src/ai/": "@rambur/security-engineering",
        "src/drata/": "@rambur/security-engineering",
        ".github/workflows/": "@rambur/security-engineering",
        "policies/": "@rambur/ciso",
        "training/": "@rambur/ciso",
      },
    },
  });

  items.push({
    id: "GH-CI-SECURITY",
    isoControlId: "A.8.25",
    isoControlTitle: "Secure development life cycle",
    category: "A.8",
    source: "github",
    evidenceType: "config",
    collectionMethod: "CI pipeline enforces npm audit, typecheck, gitleaks, build on every push/PR",
    collectedAt,
    validUntil: new Date(Date.now() + 90 * 24 * 60 * 60 * 1000).toISOString(),
    status: ghDirExists && fileExists(path.join(githubDir, "workflows", "security.yml")) ? "ready" : "pending",
    artifactRef: ".github/workflows/security.yml",
    metadata: {
      checks: ["npm audit (--audit-level=high)", "TypeScript typecheck", "gitleaks secret scan", "Build"],
      triggers: ["push to main", "pull_request to main", "schedule daily 09:00 UTC"],
    },
  });

  items.push({
    id: "GH-DEPENDABOT",
    isoControlId: "A.8.8",
    isoControlTitle: "Management of technical vulnerabilities",
    category: "A.8",
    source: "github",
    evidenceType: "config",
    collectionMethod: "Dependabot configured for weekly npm and GitHub Actions updates",
    collectedAt,
    validUntil: new Date(Date.now() + 90 * 24 * 60 * 60 * 1000).toISOString(),
    status: ghDirExists && fileExists(path.join(githubDir, "dependabot.yml")) ? "ready" : "pending",
    artifactRef: ".github/dependabot.yml",
    metadata: {
      npm: { interval: "weekly", day: "monday", grouped: true },
      github_actions: { interval: "weekly", day: "monday" },
      labels: ["dependencies", "security"],
    },
  });

  const securityMd = readFileIfExists(path.join(githubDir, "SECURITY.md"));
  if (securityMd) {
    items.push({
      id: "GH-SECURITY-POLICY",
      isoControlId: "A.8.26",
      isoControlTitle: "Application security requirements",
      category: "A.8",
      source: "github",
      evidenceType: "policy",
      collectionMethod: "SECURITY.md documents vulnerability disclosure and security controls",
      collectedAt,
      validUntil: new Date(Date.now() + 90 * 24 * 60 * 60 * 1000).toISOString(),
      status: "ready",
      artifactRef: ".github/SECURITY.md",
      metadata: {
        reporting: "security@rambur.com",
        ackTime: "48 hours",
        triageTime: "5 business days",
        safeHarbor: true,
      },
    });
  }

  const prTemplate = readFileIfExists(path.join(githubDir, "pull_request_template.md"));
  if (prTemplate) {
    items.push({
      id: "GH-PR-TEMPLATE",
      isoControlId: "A.8.32",
      isoControlTitle: "Change management",
      category: "A.8",
      source: "github",
      evidenceType: "config",
      collectionMethod: "PR template includes security checklist and ISO 27001 impact assessment",
      collectedAt,
      validUntil: new Date(Date.now() + 90 * 24 * 60 * 60 * 1000).toISOString(),
      status: "ready",
      artifactRef: ".github/pull_request_template.md",
      metadata: {
        sections: ["Security checklist", "ISO 27001 impact assessment", "Related Jira issues"],
      },
    });
  }

  items.push({
    id: "GH-GITLEAKS",
    isoControlId: "A.8.28",
    isoControlTitle: "Secure coding",
    category: "A.8",
    source: "github",
    evidenceType: "config",
    collectionMethod: "Gitleaks secret scanning configured for Drata, AWS, GitHub, Google, OpenRouter keys",
    collectedAt,
    validUntil: new Date(Date.now() + 90 * 24 * 60 * 60 * 1000).toISOString(),
    status: fileExists(path.join(repoRoot, ".gitleaks.toml")) ? "ready" : "pending",
    artifactRef: ".gitleaks.toml",
    metadata: {
      customRules: ["Drata API keys", "AWS keys", "GitHub tokens", "Google/Gemini API keys", "OpenRouter API keys"],
      allowlistPaths: ["docs/supplier-risk-assessment-aws-github-phase0.md", "src/ai/guardrails.ts"],
    },
  });

  const codeqlWorkflow = fileExists(path.join(githubDir, "workflows", "codeql.yml"));
  if (codeqlWorkflow) {
    items.push({
      id: "GH-CODEQL",
      isoControlId: "A.8.28",
      isoControlTitle: "Secure coding",
      category: "A.8",
      source: "github",
      evidenceType: "scan_result",
      collectionMethod: "CodeQL SAST analysis on push, PR, and weekly schedule — generates GitHub code scanning alerts",
      collectedAt,
      validUntil: new Date(Date.now() + 90 * 24 * 60 * 60 * 1000).toISOString(),
      status: "ready",
      artifactRef: ".github/workflows/codeql.yml",
      metadata: {
        language: "javascript-typescript",
        triggers: ["push to main", "pull_request to main", "schedule weekly Wednesday 06:30 UTC"],
        permissions: "security-events: write",
      },
    });
  }

  const configMgmtExists =
    fileExists(path.join(githubDir, "dependabot.yml")) &&
    fileExists(path.join(githubDir, "BRANCH-PROTECTION.md"));
  if (configMgmtExists) {
    items.push({
      id: "GH-CONFIG-MGMT",
      isoControlId: "A.8.9",
      isoControlTitle: "Configuration management",
      category: "A.8",
      source: "github",
      evidenceType: "config",
      collectionMethod: "Combined: Dependabot (automated updates) + BRANCH-PROTECTION.md (documented config baseline)",
      collectedAt,
      validUntil: new Date(Date.now() + 90 * 24 * 60 * 60 * 1000).toISOString(),
      status: "ready",
      artifactRef: ".github/dependabot.yml, .github/BRANCH-PROTECTION.md",
      metadata: {
        dependabot: { ecosystems: ["npm", "github-actions"], interval: "weekly" },
        branchProtection: { prRequired: true, signedCommits: true, statusChecks: ["npm-audit", "typecheck", "gitleaks", "build", "codeql"] },
      },
    });
  }

  items.push({
    id: "GH-AUDIT-TESTING",
    isoControlId: "A.8.34",
    isoControlTitle: "Protection of information systems during audit testing",
    category: "A.8",
    source: "github",
    evidenceType: "config",
    collectionMethod: "GitHub repository permissions restrict audit scope via CODEOWNERS + branch protection read-only for auditors",
    collectedAt,
    validUntil: new Date(Date.now() + 90 * 24 * 60 * 60 * 1000).toISOString(),
    status: "ready",
    artifactRef: ".github/CODEOWNERS, .github/BRANCH-PROTECTION.md",
    metadata: {
      protections: ["CODEOWNERS restricts who can review/approve", "Branch protection prevents unreviewed merges", "Audit read-only access via repo collaborator permissions"],
      auditScope: "Auditors granted read access to relevant repos; security team retains write approval gate",
    },
  });

  items.push({
    id: "GH-SECURITY-ARCHITECTURE",
    isoControlId: "A.8.27",
    isoControlTitle: "Secure system architecture and engineering principles",
    category: "A.8",
    source: "github",
    evidenceType: "document",
    collectionMethod: "docs/SECRETS.md documents secrets management architecture with AWS Secrets Manager + environment fallback",
    collectedAt,
    validUntil: new Date(Date.now() + 90 * 24 * 60 * 60 * 1000).toISOString(),
    status: fileExists(path.join(repoRoot, "docs", "SECRETS.md")) ? "ready" : "pending",
    artifactRef: "docs/SECRETS.md",
    metadata: {
      architecture: ["AWS Secrets Manager (primary)", "Environment variables (fallback)", "GitHub Actions secrets (CI/CD)"],
      secretTypes: ["DRATA_API_KEY", "GEMINI_API_KEY", "OPENROUTER_API_KEY"],
    },
  });

  items.push({
    id: "GH-CONTENT-GUARDRAILS",
    isoControlId: "A.8.29",
    isoControlTitle: "Security testing in development and acceptance",
    category: "A.8",
    source: "github",
    evidenceType: "config",
    collectionMethod: "AI ContentGuardrails module includes PII detection, API key leakage, prompt injection, excessive agency checks",
    collectedAt,
    validUntil: new Date(Date.now() + 90 * 24 * 60 * 60 * 1000).toISOString(),
    status: fileExists(path.join(repoRoot, "src", "ai", "guardrails.ts")) ? "ready" : "pending",
    artifactRef: "src/ai/guardrails.ts",
    metadata: {
      rules: ["PII Detection", "API Key Leakage", "System Prompt Extraction", "Excessive Agency", "Harmful Content", "ISO Scope Boundary", "Cross-Project Data Leakage", "Bulk Data Exfiltration"],
      classifications: { SSN: "redact", email: "redact", credit_card: "block", api_key: "block", aws_key: "block", jwt: "block", hex_hash: "warn" },
    },
  });

  items.push({
    id: "GH-ENV-SEPARATION",
    isoControlId: "A.8.31",
    isoControlTitle: "Separation of development, test, and production environments",
    category: "A.8",
    source: "github",
    evidenceType: "document",
    collectionMethod: "Environment separation enforced via AWS Secrets Manager (prod) vs .env (dev) config resolution",
    collectedAt,
    validUntil: new Date(Date.now() + 90 * 24 * 60 * 60 * 1000).toISOString(),
    status: "ready",
    artifactRef: "src/config.ts",
    metadata: {
      environments: { dev: ".env file", prod: "AWS Secrets Manager (aira/secrets)" },
      resolution: "AWS Secrets Manager → Environment variable → Sync fallback",
    },
  });

  items.push({
    id: "GH-TEST-DATA",
    isoControlId: "A.8.33",
    isoControlTitle: "Test information",
    category: "A.8",
    source: "github",
    evidenceType: "config",
    collectionMethod: ".gitignore excludes data/, dist/, .env to prevent test/production data leakage",
    collectedAt,
    validUntil: new Date(Date.now() + 90 * 24 * 60 * 60 * 1000).toISOString(),
    status: fileExists(path.join(repoRoot, ".gitignore")) ? "ready" : "pending",
    artifactRef: ".gitignore",
    metadata: {
      excludedPaths: ["node_modules", "dist", "data", ".env", ".gitleaks-report", ".gstack"],
    },
  });

  items.push({
    id: "GH-POLICIES",
    isoControlId: "A.8.32",
    isoControlTitle: "Change management",
    category: "A.8",
    source: "github",
    evidenceType: "policy",
    collectionMethod: "8 ISMS policies in policies/iso27001/ cover 31 of 82 applicable controls",
    collectedAt,
    validUntil: new Date(Date.now() + 90 * 24 * 60 * 60 * 1000).toISOString(),
    status: fileExists(path.join(repoRoot, "policies", "iso27001", "POLICY-INDEX.md")) ? "ready" : "pending",
    artifactRef: "policies/iso27001/POLICY-INDEX.md",
    metadata: {
      policyCount: 8,
      coverageCount: 31,
      totalApplicable: 82,
      deferredCount: 8,
    },
  });

  const coverageGapControls = A8_SDLC_CONTROLS.filter(
    (c) => !items.some((i) => i.isoControlId === c.id)
  );

  for (const control of coverageGapControls) {
    items.push({
      id: `GH-${control.id.replace(".", "-")}-GAP`,
      isoControlId: control.id,
      isoControlTitle: control.title,
      category: "A.8",
      source: "github",
      evidenceType: "config",
      collectionMethod: "No automated evidence collection configured — requires manual or external evidence",
      collectedAt,
      validUntil: null,
      status: "not_available",
      artifactRef: null,
      metadata: { reason: "Evidence not yet available from GitHub configuration or project source" },
    });
  }

  return items.sort((a, b) => a.isoControlId.localeCompare(b.isoControlId));
}