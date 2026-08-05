import type { ContentFilterResult, ContentCategory } from "./types.js";

export interface OutputValidationConfig {
  maxResponseTokens?: number;
  blockedPatterns?: RegExp[];
  htmlSanitization?: boolean;
  scriptSanitization?: boolean;
  schemaValidation?: boolean;
  hallucinationDetection?: boolean;
}

const DEFAULT_MAX_RESPONSE_TOKENS = 65536;

const HALLUCINATION_MARKERS: RegExp[] = [
  /as an (?:AI|artificial intelligence) language model/i,
  /I (?:am|'m) (?:sorry|unable|cannot|not able)/i,
  /I don't have (?:the ability|access|the capability)/i,
  /I (?:do not|don't) (?:have|possess) (?:personal|conscious|subjective)/i,
  /as a (?:large )?language model/i,
  /I cannot (?:browse|search|access) the (?:internet|web)/i,
];

const SCRIPT_INJECTION_PATTERNS: RegExp[] = [
  /<script[\s>]/i,
  /javascript\s*:/i,
  /on\w+\s*=\s*["']/i,
  /<iframe[\s>]/i,
  /<object[\s>]/i,
  /<embed[\s>]/i,
  /data\s*:\s*text\/html/i,
  /eval\s*\(/i,
  /Function\s*\(/i,
  /setTimeout\s*\(\s*["'\`]/i,
  /setInterval\s*\(\s*["'\`]/i,
  /process\.(?:env|cwd|exit|kill)/i,
  /require\s*\(/i,
  /import\s*\(/i,
  /child_process/i,
  /os\.(?:exec|system|popen)/i,
  /\bexec\s*\(/i,
  /\bspawn\s*\(/i,
  /\b(?:rm\s+-rf|sudo\s+|chmod\s+777)/i,
  /\bcurl\s+/i,
  /\bwget\s+/i,
];

export class OutputValidator {
  constructor(
    private readonly config: OutputValidationConfig = {},
  ) {}

  validate(
    content: string,
    agentId: string,
    _projectId: string,
  ): OutputValidationResult {
    const findings: OutputValidationFinding[] = [];

    if (this.config.hallucinationDetection !== false) {
      const hallucinationFinding = this.detectHallucination(content);
      if (hallucinationFinding) findings.push(hallucinationFinding);
    }

    if (this.config.scriptSanitization !== false) {
      const injectionFinding = this.detectScriptInjection(content);
      if (injectionFinding) findings.push(injectionFinding);
    }

    if (this.config.blockedPatterns) {
      for (const pattern of this.config.blockedPatterns) {
        if (pattern.test(content)) {
          findings.push({
            type: "blocked_pattern",
            severity: "high",
            description: `Output matched blocked pattern: ${pattern.source}`,
            sanitized: false,
          });
        }
      }
    }

    const maxTokens = this.config.maxResponseTokens ?? DEFAULT_MAX_RESPONSE_TOKENS;
    if (content.length > maxTokens) {
      findings.push({
        type: "size_exceeded",
        severity: "low",
        description: `Response size (${content.length}) exceeds max (${maxTokens})`,
        sanitized: false,
      });
    }

    const sanitized = findings.length > 0 ? this.sanitize(content, findings) : content;
    const blocked = findings.some(f => f.severity === "high" && !f.sanitized);

    return {
      allowed: !blocked,
      findings,
      sanitizedContent: blocked ? null : sanitized,
      originalContent: content,
      agentId,
    };
  }

  validateSchema<T extends Record<string, unknown>>(
    content: string,
    schema: OutputSchema<T>,
  ): SchemaValidationResult<T> {
    try {
      const parsed = JSON.parse(content) as T;
      const errors: string[] = [];

      if (schema.type) {
        const validators: Record<string, (v: unknown, path: string) => void> = {
          object: (v, p) => {
            if (typeof v !== "object" || v === null || Array.isArray(v)) {
              errors.push(`${p}: expected object, got ${typeof v}`);
            }
          },
          array: (v, p) => {
            if (!Array.isArray(v)) {
              errors.push(`${p}: expected array, got ${typeof v}`);
            }
          },
          string: (v, p) => {
            if (typeof v !== "string") {
              errors.push(`${p}: expected string, got ${typeof v}`);
            }
          },
          number: (v, p) => {
            if (typeof v !== "number") {
              errors.push(`${p}: expected number, got ${typeof v}`);
            }
          },
          boolean: (v, p) => {
            if (typeof v !== "boolean") {
              errors.push(`${p}: expected boolean, got ${typeof v}`);
            }
          },
        };

        const validate = validators[schema.type];
        if (validate) validate(parsed, "root");
      }

      if (schema.required && typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) {
        for (const field of schema.required) {
          if (!(field in parsed)) {
            errors.push(`root: missing required field '${field}'`);
          }
        }
      }

      if (schema.properties && typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) {
        for (const [key, propSchema] of Object.entries(schema.properties)) {
          const value = (parsed as Record<string, unknown>)[key];
          if (value !== undefined && propSchema.type) {
            if (propSchema.type === "string" && typeof value !== "string") {
              errors.push(`root.${key}: expected string, got ${typeof value}`);
            }
            if (propSchema.type === "number" && typeof value !== "number") {
              errors.push(`root.${key}: expected number, got ${typeof value}`);
            }
            if (propSchema.type === "boolean" && typeof value !== "boolean") {
              errors.push(`root.${key}: expected boolean, got ${typeof value}`);
            }
            if (propSchema.type === "object" && (typeof value !== "object" || value === null || Array.isArray(value))) {
              errors.push(`root.${key}: expected object, got ${typeof value}`);
            }
            if (propSchema.type === "array" && !Array.isArray(value)) {
              errors.push(`root.${key}: expected array, got ${typeof value}`);
            }
          }
        }
      }

      return {
        valid: errors.length === 0,
        parsed: errors.length === 0 ? parsed : null,
        errors,
      };
    } catch {
      return {
        valid: false,
        parsed: null,
        errors: ["Output is not valid JSON"],
      };
    }
  }

  private detectHallucination(content: string): OutputValidationFinding | null {
    for (const pattern of HALLUCINATION_MARKERS) {
      if (pattern.test(content)) {
        return {
          type: "hallucination_marker",
          severity: "medium",
          description: "Response contains AI self-reference — may indicate hallucination or refusal",
          sanitized: false,
        };
      }
    }
    return null;
  }

  private detectScriptInjection(content: string): OutputValidationFinding | null {
    for (const pattern of SCRIPT_INJECTION_PATTERNS) {
      if (pattern.test(content)) {
        return {
          type: "script_injection",
          severity: "high",
          description: `Output contains potentially dangerous content matching: ${pattern.source}`,
          sanitized: true,
        };
      }
    }

    const hasHtmlEncoding = /&lt;script|&#x3C;script|&#60;script/i;
    if (hasHtmlEncoding.test(content)) {
      return {
        type: "script_injection",
        severity: "medium",
        description: "Output contains HTML-encoded script tags",
        sanitized: true,
      };
    }

    return null;
  }

  private sanitize(content: string, findings: OutputValidationFinding[]): string {
    let sanitized = content;

    for (const finding of findings) {
      if (!finding.sanitized) continue;
      if (finding.type === "script_injection") {
        sanitized = sanitized
          .replace(/<script[\s>]/gi, "&lt;script ")
          .replace(/<\/script>/gi, "&lt;/script&gt;")
          .replace(/javascript\s*:/gi, "javascript-blocked:")
          .replace(/on\w+\s*=\s*["'\`]/gi, "data-on-blocked=")
          .replace(/<iframe[\s>]/gi, "&lt;iframe ")
          .replace(/eval\s*\(/gi, "eval_blocked(");
      }
    }

    return sanitized;
  }
}

export interface OutputSchema<T extends Record<string, unknown> = Record<string, unknown>> {
  type: "object" | "array" | "string" | "number" | "boolean";
  required?: string[];
  properties?: Record<string, { type: string; description?: string }>;
}

export interface OutputValidationFinding {
  type: string;
  severity: "low" | "medium" | "high" | "critical";
  description: string;
  sanitized: boolean;
}

export interface OutputValidationResult {
  allowed: boolean;
  findings: OutputValidationFinding[];
  sanitizedContent: string | null;
  originalContent: string;
  agentId: string;
}

export interface SchemaValidationResult<T extends Record<string, unknown>> {
  valid: boolean;
  parsed: T | null;
  errors: string[];
}