import type { ContentFilterResult, ContentCategory, ContentFilterRule, DataClassificationRule, SessionContext, SessionMessage, ObfuscationResult, ObfuscationType } from "./types.js";
import type { OpenAiMessage } from "./format-adapter.js";

export const CONTENT_FILTER_RULES: ContentFilterRule[] = [
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
  /let['']s play a game/i,
  /pretend (you are|to be)/i,
  /act as (if )?(you are|a|an)/i,
  /\[INST\].*\[\\INST\]/i,
  /<\|.*\|>/,
  /you are (DAN|jailbroken|uncensored|unfiltered|unrestricted)/i,
  /developer mode/i,
  /story mode/i,
  /narrative mode/i,
  /disregard (all )?(prior |previous )?(safety |ethical )?(constraints|guidelines|rules)/i,
  /bypass (your |the )?(content )?(filter|safety|restrictions|limitations)/i,
  /\\\\n\\\\n(set|inject|insert|append).*instruction/i,
  /\\\\n\\\n(user|assistant|system|human):\\s/i,
  /\\\\u000a.*(system|instruction|prompt)/i,
  /\\\\x0a.*(system|instruction|prompt)/i,
  /\\\\u202e/i,
  /\\\\u202d/i,
  /rep(?:eat|lay) (?:the |your )?(?:first |original )?(?:prompt|instructions|message)/i,
  /translate.*(prompt|instructions|rules)/i,
  /output (the |your )?(?:complete |full )?(?:system )?(?:prompt|instructions|base_prompt)/i,
  /OOC:/i,
  /(?:\|\s*)?system\|/i,
];

const INDIRECT_INJECTION_PATTERNS: RegExp[] = [
  /\x00/,
  /\x1a/,
  /\x04/,
  /(?:\b|^)ping\s+\/dev\/tcp\b/i,
  /(?:\b|^)`cat\s/i,
  /(?:\b|^)\$\([^)]+\)/,
  /(?:\b|^)`[^`]+`/,
];

const MULTI_STEP_INJECTION_PATTERNS: RegExp[] = [
  /\[META\].*\[\/META\]/i,
  /{system}.*{\/system}/i,
  /<<INSTRUCT>>.*<<\/INSTRUCT>>/i,
  /## system ##.*## \/system ##/i,
  /#{3,}.*SYSTEM.*#{3,}/i,
];

const OBFUSCATION_PATTERNS: Record<ObfuscationType, RegExp[]> = {
  base64: [
    /(?:[A-Za-z0-9+/]{20,}={0,2}(?:\s*[A-Za-z0-9+/]{20,}={0,2})*)/,
    /(?:^|\s)(?:[A-Za-z0-9+/]{4}){6,}(?:={0,2})(?:\s|$)/m,
    /[A-Za-z0-9+/]{40,}={0,2}/,
  ],
  rot13: [
    /(?:\b[GURZNA]{4,}\b)/,
    /obfuscate|rot13|rot_13/i,
  ],
  leetspeak: [
    /(?:\b[a-z@]+[1!|3]+\w*)/i,
    /(?:@\w+|\w+@)/,
    /[4@][a-z]*[3!]/i,
    /(?:\b[a-z]+)[048](?:[a-z]+)[1!|3](?:\w*)\b/i,
    /(?:\b[a-z]*)[1!|3](?:[a-z]+)[048](?:\w*)\b/i,
  ],
  unicode_normalization: [
    /[\u200B-\u200D\uFEFF]/,
    /[\u0300-\u036F\u1AB0-\u1AFF\u20D0-\u20FF\uFE20-\uFE2F]/,
    /[\u2028\u2029\u0000-\u0008\u000B-\u000C\u000E-\u001F]/,
  ],
  url_encoding: [
    /%[0-9A-Fa-f]{2}(?:%[0-9A-Fa-f]{2}){2,}/,
    /(?:\+|%20){3,}/i,
    /\\u[0-9A-Fa-f]{4}(?:\\u[0-9A-Fa-f]{4})+/,
    /\\x[0-9A-Fa-f]{2}(?:\\x[0-9A-Fa-f]{2})+/,
  ],
};

const MULTI_TURN_INJECTION_PATTERNS: RegExp[] = [
  /ignore (?:the )?above/i,
  /(?:referring|responding) to (?:the )?(?:previous|earlier|above|last) (?:message|instruction|prompt)/i,
  /continue from (?:where|the )?(?:you|we) (?:left|stopped)/i,
  /as (?:I|we) (?:said|mentioned|wrote) (?:above|earlier|before)/i,
  /override (?:the |all )?(?:previous|prior|earlier|above) (?:context|instructions|rules|guardrails)/i,
  /(?:now|let['']s) (?:switch|change|flip) (?:the )?(?:topic|context|role|persona)/i,
  /from now on/i,
  /new (?:rule|instruction|directive)/i,
];

interface RedactionResult {
  sanitized: string;
  categories: string[];
}

export class ContentGuardrails {
  private readonly sessionStore: Map<string, SessionMessage[]> = new Map();

  constructor(
    private readonly filterRules: ContentFilterRule[] = CONTENT_FILTER_RULES,
    private readonly dataRules: DataClassificationRule[] = DATA_CLASSIFICATION_RULES,
    private readonly injectionPatterns: RegExp[] = PROMPT_INJECTION_PATTERNS,
    private readonly indirectInjectionPatterns: RegExp[] = INDIRECT_INJECTION_PATTERNS,
    private readonly multiStepInjectionPatterns: RegExp[] = MULTI_STEP_INJECTION_PATTERNS,
    private readonly multiTurnPatterns: RegExp[] = MULTI_TURN_INJECTION_PATTERNS,
    private readonly obfuscationPatterns: Record<ObfuscationType, RegExp[]> = OBFUSCATION_PATTERNS,
    private readonly defaultWindowSize: number = 10,
  ) {}

  normalizeContent(content: string): string {
    let normalized = content
      .normalize("NFKC")
      .replace(/[\u200B-\u200D\uFEFF]/g, "")
      .replace(/[\u2028\u2029]/g, "\n")
      .replace(/[\u0000-\u0008\u000B-\u000C\u000E-\u001F]/g, "");

    normalized = normalized.replace(/([a-zA-Z])[\\u00](0{0,3})([0-9A-Fa-f]{2})/g, (_, prefix, _zeros, hex) => {
      const code = parseInt(hex, 16);
      if (code >= 32 && code <= 126) {
        return prefix + String.fromCharCode(code);
      }
      return prefix;
    });

    return normalized;
  }

  detectObfuscation(content: string): ObfuscationResult {
    const detected: ObfuscationType[] = [];

    if (!content || content.trim().length === 0) {
      return { detected: false, types: [], normalizedContent: null };
    }

    const normalized = this.normalizeContent(content);

    for (const [type, patterns] of Object.entries(this.obfuscationPatterns)) {
      if (patterns.some(p => p.test(content))) {
        detected.push(type as ObfuscationType);
      }
    }

    const hasLeet = /[a-z]*[1!|3@4]{2,}[a-z]*/i;
    if (hasLeet.test(content) && !detected.includes("leetspeak")) {
      const leetRatio = (content.match(/[1!|3@4]/g) || []).length / Math.max(1, content.length);
      if (leetRatio > 0.1) {
        detected.push("leetspeak");
      }
    }

    return {
      detected: detected.length > 0,
      types: detected,
      normalizedContent: detected.length > 0 ? normalized : null,
    };
  }

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

    const { sanitized, categories: redactedCategories } = this.applyRedactions(content);
    for (const classification of redactedCategories) {
      categories.push({ name: `data:redacted:${classification}`, matched: true, confidence: 0.85 });
    }
    const riskScore = categories.filter(c => c.matched).length / Math.max(1, this.filterRules.length);
    return {
      allowed: true,
      blockedRule: null,
      sanitizedContent: sanitized !== content ? sanitized : null,
      riskScore,
      categories,
    };
  }

  filterPrompt(prompt: string, agentId: string, projectId: string): ContentFilterResult {
    const categories: ContentCategory[] = [];

    const obfuscation = this.detectObfuscation(prompt);
    if (obfuscation.detected) {
      categories.push({
        name: `Obfuscation (${obfuscation.types.join(", ")})`,
        matched: true,
        confidence: 0.85,
      });

      if (obfuscation.normalizedContent) {
        const normalized = obfuscation.normalizedContent;
        const directInjectionDetected = this.injectionPatterns.some(p => p.test(normalized));
        const indirectInjectionDetected = this.indirectInjectionPatterns.some(p => p.test(normalized));
        const multiStepDetected = this.multiStepInjectionPatterns.some(p => p.test(normalized));

        if (directInjectionDetected || indirectInjectionDetected || multiStepDetected) {
          const details: string[] = [];
          if (directInjectionDetected) details.push("direct");
          if (indirectInjectionDetected) details.push("indirect");
          if (multiStepDetected) details.push("multi-step");

          return {
            allowed: false,
            blockedRule: "cfr-003",
            sanitizedContent: null,
            riskScore: 1.0,
            categories: [
              ...categories,
              { name: `Prompt Injection (${details.join(", ")}) — decoded from ${obfuscation.types.join(", ")}`, matched: true, confidence: 0.95 },
            ],
          };
        }
      }

      return {
        allowed: false,
        blockedRule: "cfr-003",
        sanitizedContent: null,
        riskScore: 1.0,
        categories,
      };
    }

    const directInjectionDetected = this.injectionPatterns.some(p => p.test(prompt));
    const indirectInjectionDetected = this.indirectInjectionPatterns.some(p => p.test(prompt));
    const multiStepDetected = this.multiStepInjectionPatterns.some(p => p.test(prompt));

    const injectionDetected = directInjectionDetected || indirectInjectionDetected || multiStepDetected;

    if (injectionDetected) {
      const details: string[] = [];
      if (directInjectionDetected) details.push("direct");
      if (indirectInjectionDetected) details.push("indirect (control chars/command injection)");
      if (multiStepDetected) details.push("multi-step (delimited injection)");

      categories.push({
        name: `Prompt Injection (${details.join(", ")})`,
        matched: true,
        confidence: 0.95,
      });
      return { allowed: false, blockedRule: "cfr-003", sanitizedContent: null, riskScore: 1.0, categories };
    }

    return this.filterContent(prompt, agentId, projectId);
  }

  sanitizeMessages(messages: OpenAiMessage[]): { sanitizedMessages: OpenAiMessage[]; redactions: string[] } {
    const sanitizedMessages: OpenAiMessage[] = [];
    const redactions: string[] = [];

    for (const msg of messages) {
      if (!msg.content) {
        sanitizedMessages.push({ ...msg });
        continue;
      }

      const { sanitized, categories } = this.applyRedactions(msg.content);
      if (categories.length > 0) {
        redactions.push(...categories);
      }

      if (sanitized === msg.content) {
        sanitizedMessages.push({ ...msg });
        continue;
      }

      sanitizedMessages.push({ ...msg, content: sanitized });
    }

    return { sanitizedMessages, redactions };
  }

  filterMultiTurn(
    currentPrompt: string,
    session: SessionContext,
    agentId: string,
    projectId: string,
  ): ContentFilterResult {
    const categories: ContentCategory[] = [];

    if (session.messages.length > 0 && this.multiTurnPatterns.some(p => p.test(currentPrompt))) {
      const lastMessages = session.messages.slice(-3);

      for (const msg of lastMessages) {
        if (msg.role === "assistant" && msg.content.length > 100) {
          const contentMatch = (this.injectionPatterns.some(p => p.test(msg.content))
            || this.indirectInjectionPatterns.some(p => p.test(msg.content))
            || this.multiStepInjectionPatterns.some(p => p.test(msg.content)));
          if (contentMatch) {
            categories.push({
              name: "Multi-Turn Injection (reference to prior injected content)",
              matched: true,
              confidence: 0.90,
            });
            return { allowed: false, blockedRule: "cfr-003", sanitizedContent: null, riskScore: 1.0, categories };
          }
        }
      }
    }

    const combinedContent = [...session.messages, { role: "user" as const, content: currentPrompt, timestamp: Date.now() }]
      .slice(-this.defaultWindowSize)
      .map(m => m.content)
      .join("\n");

    for (const pattern of this.injectionPatterns) {
      const matches = pattern.test(combinedContent);
      if (matches) {
        const alreadyBlocked = pattern.test(currentPrompt);
        if (!alreadyBlocked) {
          const chunks: string[] = [];
          for (let i = 0; i < combinedContent.length; i += 500) {
            chunks.push(combinedContent.slice(i, i + 500));
          }
          for (const chunk of chunks) {
            if (pattern.test(chunk) && !pattern.test(currentPrompt)) {
              categories.push({
                name: "Multi-Turn Injection (distributed across messages)",
                matched: true,
                confidence: 0.88,
              });
              return { allowed: false, blockedRule: "cfr-003", sanitizedContent: null, riskScore: 1.0, categories };
            }
          }
          break;
        }
        break;
      }
    }

    return this.filterPrompt(currentPrompt, agentId, projectId);
  }

  private applyRedactions(content: string): RedactionResult {
    let sanitized = content;
    const categories: string[] = [];

    for (const rule of this.dataRules) {
      if (rule.action !== "redact") continue;
      const regex = new RegExp(rule.pattern, "g");
      if (!regex.test(sanitized)) continue;
      sanitized = sanitized.replace(regex, `[REDACTED:${rule.classification}]`);
      categories.push(rule.classification);
    }

    return { sanitized, categories };
  }

  updateSession(sessionId: string, message: SessionMessage): void {
    const messages = this.sessionStore.get(sessionId) || [];
    messages.push(message);
    while (messages.length > this.defaultWindowSize) {
      messages.shift();
    }
    this.sessionStore.set(sessionId, messages);
  }

  getSession(sessionId: string): SessionContext {
    return {
      sessionId,
      messages: this.sessionStore.get(sessionId) || [],
      maxWindowSize: this.defaultWindowSize,
    };
  }

  clearSession(sessionId: string): void {
    this.sessionStore.delete(sessionId);
  }

  filterResponse(response: string, agentId: string, projectId: string): ContentFilterResult {
    for (const rule of this.dataRules) {
      if (rule.action === "block" && new RegExp(rule.pattern).test(response)) {
        return {
          allowed: false,
          blockedRule: `data:${rule.classification}`,
          sanitizedContent: null,
          riskScore: 1.0,
          categories: [{ name: `data:${rule.classification}`, matched: true, confidence: 1.0 }],
        };
      }
    }

    let sanitized = response;
    for (const rule of this.dataRules) {
      if (rule.action === "redact") {
        sanitized = sanitized.replace(new RegExp(rule.pattern, "g"), "[REDACTED]");
      }
    }

    const result = this.filterContent(sanitized, agentId, projectId);
    if (!result.allowed) return result;

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
        return /(?:sudo\b|execute arbitrary|delete all|format\b|WITH GRANT OPTION|DROP TABLE|DELETE\s+FROM|TRUNCATE|ALTER\s+TABLE|CREATE\s+USER|GRANT\s+|REVOKE\s+|chmod\s+777|setuid\b)/i.test(content);
      case "cfr-005":
        return /(?:exploit|malware|ransomware|phishing kit|CVE-\d{4}-\d{4,})/i.test(content);
      default:
        return false;
    }
  }
}
