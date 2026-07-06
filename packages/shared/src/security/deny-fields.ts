// Default-deny field paths per RAM-311 §3.1.
// These field paths are NEVER shipped to a vendor.

export const DENY_FIELDS: readonly string[] = [
  "request.body", "request.body.*",
  "request.headers.authorization", "request.headers.cookie", "request.headers.set-cookie",
  "request.headers.x-api-key",
  "user.ip_address", "client_ip",
  "user.email", "user.phone", "user.ssn", "user.tax_id", "user.passport", "user.drivers_license",
  "user.password", "user.passwd",
  "user.credit_card",
  "process.env", "process.env.*",
  "contexts.runtime.env", "contexts.runtime.env.*",
  "breadcrumbs.*.data.request.body", "breadcrumbs.*.data.response.body",
];

export const ALLOWLIST_TOP_KEYS: ReadonlySet<string> = new Set([
  "request_method", "request_url", "request.status_code", "request_status_code",
  "status_code", "statusCode", "method", "url",
  "duration", "ttfb", "dns", "connect", "tls", "response_time", "responseTime",
  "tenant_id", "tenantId",
]);

export const ALLOWLIST_HEADERS: ReadonlyMap<string, number> = new Map([
  ["user-agent", 256], ["accept-language", 64],
]);

export const API_KEY_HEADER_PATTERNS: readonly RegExp[] = [/api.*key/i, /x-api/i];

export function isDenyField(path: string): boolean {
  if (DENY_FIELDS.includes(path)) return true;
  for (const deny of DENY_FIELDS) {
    if (deny.endsWith(".*") && path.startsWith(deny.slice(0, -2) + ".")) return true;
  }
  const headerMatch = path.match(/^(?:request\.)?headers\.(.+)$/i);
  if (headerMatch && API_KEY_HEADER_PATTERNS.some((p) => p.test(headerMatch[1]!))) return true;
  const leaf = path.split(".").pop()?.toLowerCase() ?? "";
  if (leaf === "password" || leaf === "passwd" || leaf === "card_number" || leaf === "cvv" || leaf === "cvc") return true;
  if (leaf === "secret" || leaf === "client_secret" || leaf === "clientsecret") return true;
  if (leaf === "access_token" || leaf === "accesstoken" || leaf === "refresh_token" || leaf === "refreshtoken" || leaf === "id_token" || leaf === "idtoken") return true;
  if (leaf === "api_key" || leaf === "apikey" || leaf === "auth_token" || leaf === "authtoken" || leaf === "session_token" || leaf === "sessiontoken") return true;
  if (leaf === "private_key" || leaf === "privatekey") return true; /**/
  return false;
}

export function isAllowlistPath(_path: string): boolean { return false; }