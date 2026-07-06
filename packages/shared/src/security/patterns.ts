// Canonical PII / secrets redaction patterns per RAM-311 §3.2.
// Applied in order so the most specific patterns match first.

export interface RedactionPattern {
  class: string;
  pattern: RegExp;
  replacement: string;
  validate?: (match: string) => boolean;
}

export const REDACTION_PATTERNS: readonly RedactionPattern[] = [
  { class: "aws_access_key", pattern: /AKIA[0-9A-Z]{16}/gi, replacement: "[REDACTED:aws_access_key]" },
  { class: "aws_secret", pattern: /aws(.{0,20})?(secret|sk)[^A-Za-z0-9]{0,3}([A-Za-z0-9/+=]{40})/gi, replacement: "[REDACTED:aws_secret]" },
  { class: "gcp_sa", pattern: /"type"\s*:\s*"service_account"[\s\S]*?"private_key"/gi, replacement: "[REDACTED:gcp_sa]" },
  { class: "private_key", pattern: /-----BEGIN (RSA |EC |DSA |OPENSSH |PGP )?PRIVATE KEY-----[\s\S]+?-----END (RSA |EC |DSA |OPENSSH |PGP )?PRIVATE KEY-----/gi, replacement: "[REDACTED:private_key]" },
  { class: "github_pat", pattern: /ghp_[A-Za-z0-9]{36}/gi, replacement: "[REDACTED:github_pat]" },
  { class: "github_oauth", pattern: /gho_[A-Za-z0-9]{36}/gi, replacement: "[REDACTED:github_oauth]" },
  { class: "slack_token", pattern: /xox[baprs]-[A-Za-z0-9-]{10,}/gi, replacement: "[REDACTED:slack_token]" },
  { class: "stripe_live", pattern: /sk_live_[A-Za-z0-9]{24,}/gi, replacement: "[REDACTED:stripe_live]" },
  { class: "stripe_test", pattern: /sk_test_[A-Za-z0-9]{24,}/gi, replacement: "[REDACTED:stripe_test]" },
  // JWT before bearer — JWT is more specific; bearer would otherwise consume it
  { class: "jwt", pattern: /eyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/gi, replacement: "[REDACTED:jwt]" },
  { class: "bearer", pattern: /bearer\s+[A-Za-z0-9._\-+/=]{8,}/gi, replacement: "[REDACTED:bearer]" },
  { class: "basic_auth", pattern: /basic\s+[A-Za-z0-9+/=]{4,}/gi, replacement: "[REDACTED:basic_auth]" },
  { class: "email", pattern: /[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}/gi, replacement: "[REDACTED:email]" },
  { class: "ipv4", pattern: /(?<!\d)(?:(?:25[0-5]|2[0-4]\d|1\d{2}|[1-9]?\d)\.){3}(?:25[0-5]|2[0-4]\d|1\d{2}|[1-9]?\d)(?!\d)/gi, replacement: "[REDACTED:ipv4]" },
  { class: "ipv6", pattern: /(?<![A-Fa-f0-9:])(?:(?:[0-9A-Fa-f]{1,4}:){7}[0-9A-Fa-f]{1,4}|(?:[0-9A-Fa-f]{1,4}:)*:(?:[0-9A-Fa-f]{1,4}:)*[0-9A-Fa-f]{1,4})(?![A-Fa-f0-9:])/g, replacement: "[REDACTED:ipv6]" },
  { class: "phone", pattern: /\+\d{8,15}/g, replacement: "[REDACTED:phone]" },
  { class: "iban", pattern: /\b[A-Z]{2}\d{2}[A-Z0-9]{11,30}\b/g, replacement: "[REDACTED:iban]" },
  { class: "ssn", pattern: /\b\d{3}-\d{2}-\d{4}\b/g, replacement: "[REDACTED:ssn]" },
  { class: "ein", pattern: /\b\d{2}-\d{7}\b/g, replacement: "[REDACTED:ein]" },
  { class: "pan", pattern: /\b(?:\d[ -]?){13,19}\b/g, replacement: "[REDACTED:pan]", validate: luhnCheck },
];

export function luhnCheck(input: string): boolean {
  const digits = input.replace(/[\s-]/g, "");
  if (!/^\d{13,19}$/.test(digits)) return false;
  let sum = 0;
  let alternate = false;
  for (let i = digits.length - 1; i >= 0; i--) {
    let n = parseInt(digits[i]!, 10);
    if (alternate) { n *= 2; if (n > 9) n -= 9; }
    sum += n;
    alternate = !alternate;
  }
  return sum % 10 === 0;
}