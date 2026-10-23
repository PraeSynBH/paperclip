import { unprocessable } from "../errors.js";

/** Identifier tokens look like `PRA-6493` — a company prefix, then the issue number. */
const ISSUE_IDENTIFIER_TOKEN = /^[A-Za-z0-9][A-Za-z0-9_-]*-\d+$/;

/**
 * Normalizes an identifier filter (`?identifier=PRA-6493`, `?identifier=a-1,b-2`,
 * or repeated `identifier` parameters) to a de-duplicated list of canonical
 * upper-case identifiers.
 *
 * Throws instead of ignoring malformed input: a silently dropped filter is what
 * makes a caller trust a query that was never filtered.
 */
export function parseIssueIdentifierFilter(
  input: string | readonly string[] | undefined,
): string[] {
  if (input === undefined || input === null) return [];
  const entries = (Array.isArray(input) ? input : [input])
    .flatMap((entry) => (typeof entry === "string" ? entry.split(",") : []))
    .map((entry) => entry.trim())
    .filter(Boolean);
  const identifiers: string[] = [];
  for (const entry of entries) {
    if (!ISSUE_IDENTIFIER_TOKEN.test(entry)) {
      throw unprocessable(
        "identifier must look like PRA-1234 (one or more comma-separated values)",
      );
    }
    const canonical = entry.toUpperCase();
    if (!identifiers.includes(canonical)) identifiers.push(canonical);
  }
  return identifiers;
}
