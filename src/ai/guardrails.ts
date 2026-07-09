import type { ContentFilterResult, ContentCategory, ContentFilterRule, DataClassificationRule } from "./types.js";

const CONTENT_FILTER_RULES: ContentFilterRule[] = [
  {
    id: "cfr-001",
    name: "PII Detection",
    category: "data_protection",
    description: "Blocks or redacts personally identifiable information from AI prompts and responses.",
    action: "block",
    priority: 1,
  },
  {
    id: "cfr-002",
    name: "API Key Leakage",
    category: "credential_protection",
    description: "Detects and blocks API keys, tokens, and credentials in AI content.",
    action: "block",
    priority: 1,
  },
  {
    id: "cfr-003",
    name: "System Prompt Extraction",
    category: "prompt_injection",
    description: "Detects attempts to extract system prompts or agent instructions.",
    action: "block",
    priority: 1,
  },
  {
    id: "cfr-004",
    name: "Excessive Agency",
    category: "agent_safety",
    description: "Detects requests that attempt to escalate agent privileges beyond their scope.",
    action: "block",
    priority: 2,
  },
  {
    id: "cfr-005",
    name: "Harmful Content",
    category: "safety",
    description: "Blocks generation of harmful, malicious, or dangerous content.",
    action: "block",
    priority: 3,
  },
  {
    id: "cfr-006",
    name: "ISO 27001 Scope Boundary",
    category: "compliance",
    description: "Ensures AI usage stays within the defined ISO 27001 scope and ISMS boundary.",
    action: "warn",
    priority: 4,
  },
  {
    id: "cfr-007",
    name: "Cross-Project Data Leakage",
    category: "isolation",
    description: "Detects and blocks cross-project data leakage in multi-tenant agent contexts.",
    action: "block",
    priority: 1,
  },
  {
    id: "cfr-008",
    name: "Bulk Data Exfiltration",
    category: "data_protection",
    description: "Detects large data transfers that may indicate exfiltration attempts.",
    action: "block",
    priority: 2,
  },
];

const DATA_CLASSIFICATION_RULES: DataClassificationRule[] = [
  { pattern: "\\b\\d{3}-\\d{2}-\\d{4}\\b", classification: "regulated", action: "redact" },
  { pattern: "\\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\\.[A-Za-z]{2,}\\b", classification: "confidential", action: "redact" },
  { pattern: "\\b(?:4[0-9]{12}(?:[0-9]{3})?|5[1-5][0-9]{14})\\b", classification: "regulated", action: "block" },
  { pattern: "\\b(sk-[a-zA-Z0-9]{32,})\\b", classification: "confidential", action: "block" },
  { pattern: "\\b(AKIA[0-9A-Z]{16})\\b", classification: "confidential", action: "block" },
  { pattern: "\\b([0-9a-fA-F]{40})\\b", classification: "confidential", action: "warn" },
  { pattern: "\\b(eyJ[a-zA-Z0-9_-]+\\.[a-zA-Z0-9_-]+\\.[a-zA-Z0-9_-]+)\\b", classification: "confidential", action: "block" },
];

const PROMPT_INJECTION_PATTERNS: RegExp[] = [
  /ignore (all )?(previous|prior|above) instructions/i,
  /forget (all )?(your |the )?(previous |prior )?instructions/i,
  /you are now .+(instead|rather than)/i,
  /system prompt/i,
  /print (your |the )?(system )?(prompt|instructions|rules)/i,
  /what (are|were) (your |the )?(initial )?instructions/i,
  /\[system\]/i,
  /<\|im_start\|>/i,
  /role:\s*system/i,
];

export class ContentGuardrails {
  constructor(
    private readonly filterRules: ContentFilterRule[] = CONTENT_FILTER_RULES,
    private readonly dataRules: DataClassificationRule[] = DATA_CLASSIFICATION_RULES,
    private readonly injectionPatterns: RegExp[] = PROMPT_INJECTION_PATTERNS,
  ) {}

  filterContent(content: string, agentId: string, projectId: string): ContentFilterResult {
    const categories: ContentCategory[] = [];

    for (const rule of this.filterRules.sort((a, b) => a.priority - b.priority)) {
      const matched = this.evaluateRule(rule, content, agentId, projectId);
      categories.push({ name: rule.name, matched, confidence: matched ? 1.0 : 0.0 });

      if (matched && rule.action === "block") {
        return { allowed: false, blockedRule: rule.id, sanitizedContent: null, riskScore: 1.0, categories };
      }
    }

    for (const rule of this.dataRules) {
      const regex = new RegExp(rule.pattern, "g");
      const match = regex.test(content);
      if (match) {
        categories.push({ name: `data:${rule.classification}`, matched: true, confidence: 0.9 });
        if (rule.action === "block") {
          return { allowed: false, blockedRule: `data:${rule.classification}`, sanitizedContent: null, riskScore: 1.0, categories };
        }
      }
    }

    const riskScore = categories.filter(c => c.matched).length / Math.max(1, this.filterRules.length);
    return { allowed: true, blockedRule: null, sanitizedContent: null, riskScore, categories };
  }

  filterPrompt(prompt: string, agentId: string, projectId: string): ContentFilterResult {
    const injectionDetected = this.injectionPatterns.some(p => p.test(prompt));
    const categories: ContentCategory[] = [];

    if (injectionDetected) {
      categories.push({ name: "Prompt Injection", matched: true, confidence: 1.0 });
      return { allowed: false, blockedRule: "cfr-003", sanitizedContent: null, riskScore: 1.0, categories };
    }

    return this.filterContent(prompt, agentId, projectId);
  }

  filterResponse(response: string, agentId: string, projectId: string): ContentFilterResult {
    const result = this.filterContent(response, agentId, projectId);
    if (!result.allowed) return result;

    let sanitized = response;
    for (const rule of this.dataRules) {
      if (rule.action === "redact") {
        sanitized = sanitized.replace(new RegExp(rule.pattern, "g"), "[REDACTED]");
      }
    }
    return { ...result, sanitizedContent: sanitized !== response ? sanitized : null };
  }

  private evaluateRule(rule: ContentFilterRule, content: string, _agentId: string, _projectId: string): boolean {
    switch (rule.id) {
      case "cfr-001":
        return /(?:\b\d{3}-\d{2}-\d{4}\b|\b\d{9}\b)/.test(content);
      case "cfr-002":
        return /(?:sk-[a-zA-Z0-9]{32,}|AKIA[0-9A-Z]{16}|eyJ[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+)/.test(content);
      case "cfr-003":
        return /(?:system prompt|ignore previous instructions|print your instructions|what are your instructions|<\|im_start\|>)/i.test(content);
      case "cfr-004":
        return /(?:sudo |execute arbitrary|delete all|format|WITH GRANT OPTION|DROP TABLE)/i.test(content);
      case "cfr-005":
        return /(?:exploit|malware|ransomware|phishing kit|CVE-\d{4}-\d{4,})/i.test(content);
      default:
        return false;
    }
  }
}
