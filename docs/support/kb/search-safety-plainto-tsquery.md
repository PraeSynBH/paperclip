---
title: Support KB — Search Safety fix (plainto_tsquery)
summary: Knowledge search and memory warm-up now use plainto_tsquery which safely handles punctuation and special characters in user queries (75c6c27a41)
version: v0.4.0
commit: 75c6c27a41
---

# Support KB: Search Safety — Special Character Handling (plainto_tsquery)

**Applies to:** Paperclip v0.4.0+ (commit `75c6c27a41`)
**Tag:** `plainto_tsquery` search safety fix
**Related:** C-3, VOY-1299, VOY-1313
**Date:** 2026-08-17

---

## Summary

Knowledge document search and memory warm-up previously constructed tsquery strings by hand, splitting user input on whitespace and appending `:*` wildcards. Special characters — punctuation like `!@#$%^&*()`, operators, or other non-word characters — were embedded directly into the query, causing PostgreSQL's `to_tsquery` to reject the query with a 400 error.

**Both server search paths now use `plainto_tsquery('english', query)`, which safely strips punctuation, operators, and special characters** from user input before building the tsquery. Invalid lexemes no longer crash search.

## Affected Paths

| Path | File | Before | After |
|---|---|---|---|
| Knowledge document search | `server/src/services/knowledge-documents.ts` | Manual `split.map(w=>`${w}:*`).join(' & ')` → `to_tsquery(tsQuery)` | `plainto_tsquery('english', query)` — safe natural-language input |
| Memory warm-up (context injection) | `server/src/services/memory-context-injection.ts` | Manual sanitize + wildcard join → `to_tsquery(tsQuery)` | `plainto_tsquery('english', searchQuery)` — same safe behavior |

## Old Behavior

- A user query containing punctuation, operators (`!`, `@`, `#`, `$`, `%`, `^`, `&`, `*`, dash, etc.), or other non-word characters caused PostgreSQL to throw, resulting in a **500 Internal Server Error** on the search endpoint.
- The memory warm-up path had a character-sanitization pass (`w.replace(/[^\w\-']/g, '')`) that worked for most cases but still failed on edge cases like standalone operators or empty sanitized results.

## New Behavior

- `plainto_tsquery` tokenizes the input as **natural language**, stripping punctuation and unquoting special characters automatically.
- Queries like `"Why isn't the payment processing?!"` are treated as `"Why isn't the payment processing"` — safe and searchable.
- An empty or whitespace-only query after stripping returns an empty result set immediately (no DB round-trip).

## Troubleshooting

### "Knowledge search returns 500 errors"
**Likely cause:** Query contains characters that `to_tsquery` rejects. **Fix:** The server should already be running at commit `75c6c27a41` or later, which uses `plainto_tsquery`. If the server is on an older version, upgrade to get the fix. This is a server-side fix — no client-side escaping is needed.

### "Memory seems worse after upgrade"
**Unlikely to be related.** The `plainto_tsquery` change only affects how query strings are tokenized, not the retrieval pipeline itself. If memory recall quality dropped, check the query wording (plainto_tsquery treats `not` and `and` as word tokens, not query operators — this is intentional for natural-language search).

### "Search still errors with complex queries"
If a query still errors on a server at commit `75c6c27a41` or later, the issue is likely in a different path (e.g., a misconfigured index, a different code path that still uses `to_tsquery` directly). Escalate to Staff Engineer.

## Verification

- Query knowledge search with: `"Why isn't the payment @ processing?!"` — should return results without error
- Query with leading special chars: `!!!hello world` — should return results for "hello world"
- Query with standalone punctuation: `!@#$%` — should return empty results (no match), not an error
- Memory warm-up (automatic context injection before agent runs) also benefits from the same fix on the memory-context-injection path.

## Related Documentation

- [Memory & Knowledge Support Assessment](../assessments/support-case-v0.4.0-memory-knowledge.md)
- [v0.4.0-alpha release notes](../releases/v0.4.0-alpha-deep-planning.md)
- [Knowledge Documents API Reference](/docs/api/knowledge)