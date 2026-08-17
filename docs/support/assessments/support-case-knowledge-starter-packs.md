# Support Case Assessment: Knowledge Base Starter Packs

**Feature**: Knowledge base starter packs — curated knowledge document bundles for common industries with one-click installation
**Assessed by**: Support Engineer
**Date**: 2026-08-16
**Related**: VOY-1341
**Release**: v0.4.1

## Feature Overview (User Perspective)

Knowledge Base Starter Packs provide pre-built, curated knowledge document bundles for common industries. They enable one-click installation of a comprehensive knowledge base foundation.

### Available Packs

| Pack | Industry | Documents | Topics Covered |
|---|---|---|---|
| Travel Industry | Travel & Hospitality | 6 | Booking policies, fare rules, destination guides, travel regulations, customer service standards, supplier management |
| SaaS Support | SaaS / Technology | 6 | SLA definitions, troubleshooting guides, escalation paths, documentation standards, communication templates, help center management |
| Engineering | Software Engineering | 7 | Coding standards, CI/CD practices, deployment runbooks, architecture decision records, incident response, dev environment setup, code review |
| Finance & Accounting | Finance & Accounting | 7 | Accounting standards, tax compliance, financial reporting, compliance frameworks, budgeting & forecasting, audit & risk management, AP/AR procedures |

### API Endpoints

1. **`GET /companies/{companyId}/knowledge/starter-packs`** — List available packs (summary only, no document bodies)
2. **`GET /companies/{companyId}/knowledge/starter-packs/{packKey}`** — Get pack details with full document content
3. **`POST /companies/{companyId}/knowledge/starter-packs/{packKey}/install`** — Install a pack into the company knowledge base

### Installation Behavior

- Documents are created as **published** (auto-transitioned through draft → in_review → approved → published)
- **Idempotent**: documents with titles that already exist in the company are skipped (deduplication by title)
- **Partial installation**: if some documents fail to create, the successful ones are still returned
- Returns `201 Created` with the pack key, count of created documents, and their IDs

## Potential User Confusion Points

1. **"I installed a pack but not all documents appeared"** — Some documents may have been skipped because titles already existed in the knowledge base. Check the `documentsCreated` field in the response. If it's less than the `documentCount`, existing titles were skipped.

2. **"The documents say they're by 'Unknown Author'"** — Starter pack documents may not have an author agent ID. This is normal — the documents are template content, not authored by any specific agent.

3. **"I installed a pack twice and got different results"** — The first installation creates the documents. A second installation skips all documents because their titles already exist. No duplicate documents are created.

4. **"Can I modify starter pack documents?"** — Yes. Once installed, they are regular knowledge documents. You can edit them, submit for review, and publish updated versions. Starter packs are a starting point, not a locked template.

5. **"Can I contribute new starter packs?"** — Not yet. This is a future capability planned for the community contribution path. Currently, packs are bundled with the server.

## FAQ

**Q: How do I install a starter pack?**
A: Send a POST request to `/companies/{companyId}/knowledge/starter-packs/{packKey}/install`. The pack key is one of: `travel-industry`, `saas-support`, `engineering`, `finance-accounting`.

**Q: Can I see what documents are in a pack before installing?**
A: Yes. Use `GET /companies/{companyId}/knowledge/starter-packs/{packKey}` to get the full pack details including all document titles, summaries, and bodies.

**Q: What happens if I install the same pack twice?**
A: The second installation skips all documents because their titles already exist in the company. No duplicates are created.

**Q: Can I uninstall a starter pack?**
A: There is no bulk uninstall. You can delete individual documents via `DELETE /companies/{companyId}/knowledge/{documentId}` (board only).

**Q: Are starter pack documents editable?**
A: Yes. After installation, they are regular knowledge documents. You can update, review, publish new versions, or archive them like any other document.

**Q: What auth is required for starter pack endpoints?**
A: Board or Agent access, same as other knowledge endpoints.

## Troubleshooting

### Pack not found (404)

1. Verify the pack key is correct: `travel-industry`, `saas-support`, `engineering`, `finance-accounting`
2. The pack key is case-sensitive — use lowercase
3. If the server was recently upgraded, the packs data directory may not be present; verify `server/src/data/knowledge-starter-packs/` exists and contains JSON files

### Installation fails with server error

1. Check server logs for the specific error
2. Common causes: database connection issues, permission errors reading the pack data files
3. If the error is intermittent, retry the installation — it's idempotent

### Documents created count is less than expected

1. Some documents were skipped because titles already existed
2. This is intentional deduplication behavior
3. If you want fresh copies, delete the existing documents first, then reinstall

## Error States

| Error | User sees | Root cause | Recovery |
|---|---|---|---|
| Pack not found | 404 `Starter pack 'X' not found` | Invalid pack key | Use correct pack key |
| Installation fails | 500 server error | Database or filesystem issue | Check server logs, retry |
| Zero documents created | 201 with `documentsCreated: 0` | All document titles already exist | Delete existing docs and retry, or use different pack |
| Document creation partial | 201 with `documentsCreated < total` | Some titles existed OR some documents hit DB errors | Check response `documentIds` for which succeeded |

## Related Documentation

- [Knowledge Documents API Reference](/docs/api/knowledge) — General knowledge document CRUD
- [Knowledge Base Starter Packs API Reference](/docs/api/knowledge#knowledge-base-starter-packs) — Starter pack endpoints
- `/documentation/releases` — v0.4.1 release notes

## Escalation Path

| Issue | Severity | Escalate to | Notes |
|---|---|---|---|
| Starter pack data files missing/corrupt on server | Medium | Staff Engineer | Check `server/src/data/knowledge-starter-packs/` directory |
| Pack installation creates documents with corrupted body | Medium | Staff Engineer | JSON encoding issue in pack data files |
| Installation fails with database error | High | Staff Engineer | Knowledge document service error |
| User reports missing starter packs | Low | Support Engineer | Verify pack list endpoint returns expected packs |
