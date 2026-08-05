import type { ContentFilterResult, ContentCategory } from "./types.js";

export interface AnomalyDetectorConfig {
  minEntropy: number;
  maxEntropy: number;
  anomalyScoreThreshold: number;
  tokenSimilarityWeight: number;
  entropyWeight: number;
  ngramWeight: number;
  structuralWeight: number;
  minTokensForAnalysis: number;
  bigramWindowSize: number;
}

export interface AnomalyDetectionResult {
  anomalyScore: number;
  isAnomalous: boolean;
  signals: AnomalySignal[];
  details: {
    entropy: number;
    tokenSimilarity: number;
    ngramAnomalyScore: number;
    structuralAnomalyScore: number;
    tokenCount: number;
    uniqueTokenRatio: number;
  };
}

export interface AnomalySignal {
  name: string;
  score: number;
  threshold: number;
  exceeded: boolean;
  description: string;
}

export interface BaselineStats {
  avgEntropy: number;
  stdEntropy: number;
  avgUniqueTokenRatio: number;
  stdUniqueTokenRatio: number;
  avgTokenCount: number;
  stdTokenCount: number;
  unigramFrequencies: Map<string, number>;
  bigramFrequencies: Map<string, number>;
  sampleCount: number;
  totalTokens: number;
}

const DEFAULT_CONFIG: AnomalyDetectorConfig = {
  minEntropy: 0.5,
  maxEntropy: 6.5,
  anomalyScoreThreshold: 0.50,
  tokenSimilarityWeight: 0.30,
  entropyWeight: 0.20,
  ngramWeight: 0.35,
  structuralWeight: 0.15,
  minTokensForAnalysis: 3,
  bigramWindowSize: 2,
};

const INJECTION_KEYWORDS = new Set([
  "ignore", "forget", "disregard", "bypass", "override", "pretend", "act",
  "system", "prompt", "instruction", "instructions", "rules", "guidelines",
  "jailbreak", "uncensored", "unfiltered", "unrestricted", "developer",
  "sudo", "execute", "hack", "exploit", "inject", "payload", "obfuscate",
  "decode", "encode", "cipher", "rot13", "base64", "hex", "unicode",
]);

const INJECTION_MARKER_PATTERNS: RegExp[] = [
  /\[system\]/i,
  /\[\/system\]/i,
  /\[\\system\]/i,
  /\[\\\/system\]/i,
  /#system/i,
  /\{system\}/i,
  /\{\/system\}/i,
  /<\|im_start\|>/i,
  /<\|im_end\|>/i,
  /\[INST\]/i,
  /\[\/INST\]/i,
  /<<SYS>>/i,
  /<<\/SYS>>/i,
  /\[META\]/i,
  /\[\/META\]/i,
  /## system ##/i,
  /## \/system ##/i,
  /role:\s*system/i,
  /OOC:/i,
];

const ANOMALOUS_DELIMITER_PATTERNS = [
  /[<{[|]{2,}.*[>}\]|]{2,}/,
  /[<>{}[\]|]{3,}/,
  /\\[xXuU][0-9a-fA-F]{2,}/,
  /%[0-9a-fA-F]{2}(?:%[0-9a-fA-F]{2})+/,
  /\u0000/,
  /[\u200B-\u200D\uFEFF]/,
  /[\u0001-\u0008\u000B-\u000C\u000E-\u001F]/,
  /[^\x20-\x7E\u00A0-\u00FF]{2,}/,
  /\[system\]/i,
  /\[\/system\]/i,
  /\[\\system\]/i,
  /\[\\\/system\]/i,
  /#system/i,
  /\{system\}/i,
  /\{\/system\}/i,
];

export class AnomalyDetector {
  private baseline: BaselineStats | null = null;
  private readonly config: AnomalyDetectorConfig;

  constructor(config: Partial<AnomalyDetectorConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  tokenize(text: string): string[] {
    return text
      .toLowerCase()
      .replace(/[^\w\s'-]/g, " ")
      .split(/\s+/)
      .filter(t => t.length > 0);
  }

  train(benignPrompts: string[]): BaselineStats {
    const allTokens: string[] = [];
    const unigramFreq = new Map<string, number>();
    const bigramFreq = new Map<string, number>();
    const entropies: number[] = [];
    const uniqueRatios: number[] = [];
    const tokenCounts: number[] = [];

    for (const prompt of benignPrompts) {
      const tokens = this.tokenize(prompt);
      if (tokens.length === 0) continue;

      tokenCounts.push(tokens.length);
      uniqueRatios.push(new Set(tokens).size / tokens.length);

      for (const token of tokens) {
        unigramFreq.set(token, (unigramFreq.get(token) || 0) + 1);
        allTokens.push(token);
      }

      for (let i = 0; i < tokens.length - 1; i++) {
        const bigram = `${tokens[i]}|${tokens[i + 1]}`;
        bigramFreq.set(bigram, (bigramFreq.get(bigram) || 0) + 1);
      }

      entropies.push(this.calculateEntropy(tokens));
    }

    this.baseline = {
      avgEntropy: this.mean(entropies),
      stdEntropy: this.std(entropies, this.mean(entropies)),
      avgUniqueTokenRatio: this.mean(uniqueRatios),
      stdUniqueTokenRatio: this.std(uniqueRatios, this.mean(uniqueRatios)),
      avgTokenCount: this.mean(tokenCounts),
      stdTokenCount: this.std(tokenCounts, this.mean(tokenCounts)),
      unigramFrequencies: unigramFreq,
      bigramFrequencies: bigramFreq,
      sampleCount: benignPrompts.length,
      totalTokens: allTokens.length,
    };

    return this.baseline;
  }

  detect(prompt: string): AnomalyDetectionResult {
    const tokens = this.tokenize(prompt);
    const details = {
      entropy: this.calculateEntropy(tokens),
      tokenSimilarity: 0,
      ngramAnomalyScore: 0,
      structuralAnomalyScore: 0,
      tokenCount: tokens.length,
      uniqueTokenRatio: tokens.length > 0 ? new Set(tokens).size / tokens.length : 0,
    };

    if (tokens.length < this.config.minTokensForAnalysis) {
      return {
        anomalyScore: 0,
        isAnomalous: false,
        signals: [{
          name: "InsufficientTokens",
          score: 0,
          threshold: this.config.minTokensForAnalysis,
          exceeded: false,
          description: `Too few tokens for analysis (${tokens.length} < ${this.config.minTokensForAnalysis})`,
        }],
        details,
      };
    }

    const entropyScore = this.computeEntropyScore(details.entropy);
    const tokenSimScore = this.computeTokenSimilarityScore(tokens);
    const ngramScore = this.computeNgramAnomalyScore(tokens);
    const structuralScore = this.computeStructuralAnomalyScore(prompt, tokens);

    details.tokenSimilarity = tokenSimScore;
    details.ngramAnomalyScore = ngramScore;
    details.structuralAnomalyScore = structuralScore;

    const anomalyScore =
      tokenSimScore * this.config.tokenSimilarityWeight +
      entropyScore * this.config.entropyWeight +
      ngramScore * this.config.ngramWeight +
      structuralScore * this.config.structuralWeight;

    const signals: AnomalySignal[] = [
      {
        name: "TokenSimilarity",
        score: tokenSimScore,
        threshold: 0.5,
        exceeded: tokenSimScore > 0.5,
        description: tokenSimScore > 0.5
          ? `Low token similarity to benign baseline (${(tokenSimScore * 100).toFixed(0)}%)`
          : "Token similarity within normal range",
      },
      {
        name: "Entropy",
        score: entropyScore,
        threshold: 0.5,
        exceeded: entropyScore > 0.5,
        description: entropyScore > 0.5
          ? `Unusual entropy distribution (score: ${(entropyScore * 100).toFixed(0)}%)`
          : "Entropy within normal range",
      },
      {
        name: "NgramAnomaly",
        score: ngramScore,
        threshold: 0.5,
        exceeded: ngramScore > 0.5,
        description: ngramScore > 0.5
          ? `Unusual token sequences detected (${(ngramScore * 100).toFixed(0)}%)`
          : "Token sequences within normal range",
      },
      {
        name: "StructuralAnomaly",
        score: structuralScore,
        threshold: 0.5,
        exceeded: structuralScore > 0.5,
        description: structuralScore > 0.5
          ? `Unusual prompt structure detected (${(structuralScore * 100).toFixed(0)}%)`
          : "Prompt structure within normal range",
      },
    ];

    return {
      anomalyScore: Math.min(1, Math.max(0, anomalyScore)),
      isAnomalous: anomalyScore >= this.config.anomalyScoreThreshold,
      signals,
      details,
    };
  }

  detectWithFilter(
    prompt: string,
    agentId: string,
    projectId: string,
  ): ContentFilterResult {
    const result = this.detect(prompt);
    const categories: ContentCategory[] = result.signals.map(s => ({
      name: `ml_anomaly:${s.name}`,
      matched: s.exceeded,
      confidence: s.score,
    }));

    if (result.isAnomalous) {
      return {
        allowed: false,
        blockedRule: "ml-anomaly-detection",
        sanitizedContent: null,
        riskScore: result.anomalyScore,
        categories: [
          ...categories,
          {
            name: "ML Anomaly Detection — Prompt Injection",
            matched: true,
            confidence: result.anomalyScore,
          },
        ],
      };
    }

    return {
      allowed: true,
      blockedRule: null,
      sanitizedContent: null,
      riskScore: result.anomalyScore,
      categories,
    };
  }

  getBaseline(): BaselineStats | null {
    return this.baseline;
  }

  isTrained(): boolean {
    return this.baseline !== null;
  }

  private calculateEntropy(tokens: string[]): number {
    if (tokens.length === 0) return 0;
    const freq = new Map<string, number>();
    for (const t of tokens) {
      freq.set(t, (freq.get(t) || 0) + 1);
    }
    let entropy = 0;
    for (const count of freq.values()) {
      const p = count / tokens.length;
      entropy -= p * Math.log2(p);
    }
    return entropy;
  }

  private computeEntropyScore(entropy: number): number {
    if (!this.baseline) return 0;
    const deviation = Math.abs(entropy - this.baseline.avgEntropy);
    const maxDev = Math.max(this.baseline.stdEntropy * 3, 0.5);
    return Math.min(1, deviation / maxDev);
  }

  private computeTokenSimilarityScore(tokens: string[]): number {
    if (!this.baseline || this.baseline.totalTokens === 0) {
      const suspiciousCount = tokens.filter(t => INJECTION_KEYWORDS.has(t)).length;
      return suspiciousCount / Math.max(1, tokens.length);
    }

    const totalTokens = this.baseline.totalTokens;
    let unfamiliarScore = 0;

    for (const token of tokens) {
      const freq = this.baseline.unigramFrequencies.get(token) || 0;
      const tf = freq / totalTokens;
      if (tf < 1e-6) {
        unfamiliarScore += 1;
      } else if (tf < 1e-5) {
        unfamiliarScore += 0.5;
      }
    }

    const injectionKeywordCount = tokens.filter(t => INJECTION_KEYWORDS.has(t)).length;
    const injectionKeywordRatio = injectionKeywordCount / Math.max(1, tokens.length);

    const unfamiliarRatio = unfamiliarScore / Math.max(1, tokens.length);

    return Math.min(1, unfamiliarRatio * 0.5 + injectionKeywordRatio * 0.5);
  }

  private computeNgramAnomalyScore(tokens: string[]): number {
    if (!this.baseline || this.baseline.bigramFrequencies.size === 0) return 0;
    if (tokens.length < 2) return 0;

    let unseenBigrams = 0;
    let totalBigrams = 0;

    for (let i = 0; i < tokens.length - 1; i++) {
      const bigram = `${tokens[i]}|${tokens[i + 1]}`;
      totalBigrams++;
      if (!this.baseline.bigramFrequencies.has(bigram)) {
        unseenBigrams++;
      }
    }

    return unseenBigrams / Math.max(1, totalBigrams);
  }

  private computeStructuralAnomalyScore(prompt: string, tokens: string[]): number {
    let score = 0;
    let signals = 0;

    for (const pattern of ANOMALOUS_DELIMITER_PATTERNS) {
      if (pattern.test(prompt)) {
        score += 0.3;
        signals++;
      }
    }

    for (const pattern of INJECTION_MARKER_PATTERNS) {
      if (pattern.test(prompt)) {
        score += 0.35;
        signals++;
        break;
      }
    }

    const nonAsciiRatio = (prompt.match(/[^\x00-\x7F]/g) || []).length / Math.max(1, prompt.length);
    if (nonAsciiRatio > 0.05) {
      score += 0.3;
      signals++;
    }

    const specialCharRatio = (prompt.match(/[^a-zA-Z0-9\s.,!?;:'"()-]/g) || []).length / Math.max(1, prompt.length);
    if (specialCharRatio > 0.15) {
      score += 0.2;
      signals++;
    }

    const uppercaseRatio = (prompt.match(/[A-Z]/g) || []).length / Math.max(1, prompt.length);
    if (uppercaseRatio > 0.3) {
      score += 0.15;
      signals++;
    }

    const newlineCount = (prompt.match(/\n/g) || []).length;
    if (newlineCount > 3 && tokens.length > 10) {
      score += 0.2;
      signals++;
    }

    if (newlineCount > 10) {
      score += 0.3;
      signals++;
    }

    const repeatedDelimiter = /(.)\1{4,}/;
    if (repeatedDelimiter.test(prompt.replace(/\s/g, ""))) {
      score += 0.2;
      signals++;
    }

    if (prompt.length > 5000) {
      score += 0.15;
      signals++;
    }

    if (prompt.length > 20000) {
      score += 0.25;
      signals++;
    }

    return Math.min(1, score / Math.max(1, signals));
  }

  private mean(values: number[]): number {
    if (values.length === 0) return 0;
    return values.reduce((sum, v) => sum + v, 0) / values.length;
  }

  private std(values: number[], mean: number): number {
    if (values.length < 2) return 0;
    const variance = values.reduce((sum, v) => sum + (v - mean) ** 2, 0) / (values.length - 1);
    return Math.sqrt(variance);
  }
}

export const BENIGN_BASELINE_PROMPTS: string[] = [
  "What is the ISO 27001 standard for access control?",
  "Please review this function for security vulnerabilities.",
  "Can you help me draft a compliance report?",
  "What are the requirements for SOC 2 Type II certification?",
  "Explain the difference between authentication and authorization.",
  "How do I configure OAuth 2.0 with PKCE?",
  "Summarize the NIST CSF framework categories.",
  "What is the best practice for secret management in cloud environments?",
  "Generate a summary of the latest security audit findings.",
  "Help me write a policy for acceptable use of AI tools.",
  "Explain the shared responsibility model in cloud security.",
  "What are the OWASP Top 10 vulnerabilities for 2021?",
  "How should I handle PII data in logs?",
  "Describe the principle of least privilege with examples.",
  "What is the difference between symmetric and asymmetric encryption?",
  "Help me create a threat model for a web application.",
  "What controls does ISO 27001 Annex A.8 require?",
  "How do I implement defense in depth for a microservices architecture?",
  "Explain zero trust architecture and its key components.",
  "What is the purpose of a security information and event management system?",
  "How often should penetration testing be conducted?",
  "What are the key differences between SAST and DAST?",
  "Describe the incident response lifecycle phases.",
  "What is a data classification policy and why is it important?",
  "How do I set up monitoring for unauthorized access attempts?",
  "Explain the concept of fail securely with examples.",
  "What are the GDPR requirements for data processing?",
  "How should I implement role-based access control?",
  "What is the purpose of a security architecture review?",
  "Can you explain how TLS 1.3 improves on previous versions?",
  "What are the key metrics for measuring security program effectiveness?",
  "How do I conduct a vendor security risk assessment?",
  "Explain the CIA triad and its importance in information security.",
  "What is the difference between a vulnerability and a threat?",
  "How should I implement secure coding practices?",
  "What are the best practices for API security?",
  "Explain how to implement a secure SDLC pipeline.",
  "What is the role of a security champion in development teams?",
  "How do I assess the security posture of a third-party service?",
  "What are the requirements for HIPAA security rule compliance?",
  "Explain the concept of security by design.",
  "How do I create an effective security awareness training program?",
  "What is container security and what are the key considerations?",
  "How should I manage cryptographic keys in production?",
  "What are the common security misconfigurations in cloud environments?",
  "Explain the importance of network segmentation for security.",
  "How do I implement secure logging and monitoring?",
  "What is the purpose of a business continuity plan?",
  "How should I handle security exceptions and risk acceptance?",
  "What are the key components of a security operations center?",
];