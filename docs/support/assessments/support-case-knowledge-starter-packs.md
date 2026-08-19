---
title: Support Case Assessment — Knowledge Starter Packs (v0.5.0)
summary: Pre-curated knowledge document bundles for common industries — installed automatically with company templates
version: v0.5.0
commit: fc416b1486
last_updated: 2026-08-19
---

# Support Case Assessment: Knowledge Starter Packs (v0.5.0)

## Feature Overview

Knowledge Starter Packs are curated bundles of pre-written knowledge documents for common industries. They provide a company's agents with an instant knowledge base covering the key topics relevant to their domain — without requiring manual document creation.

### What it does

- **Automatic installation** — Starter packs are installed as part of company template deployment (when the template specifies a `starterPackKey`). No separate API call is needed.
- **Pre-reviewed content** — Starter pack documents skip the draft → review → publish workflow. Since the content is pre-curated, each document is created directly as **published** and immediately searchable.
- **Title-based deduplication** — If a document with the same title already exists in the company's knowledge base, it is skipped. This prevents duplicate content when a starter pack is re-applied.
- **Graceful degradation** — Individual document failures (e.g., a document with the same title already existing) do not block the rest of the pack installation. Warnings are logged and returned in the deploy response.

### What it does NOT do

- **No standalone API** — Starter packs cannot be installed independently. They are always installed as part of a company template deployment. There is no `POST /knowledge/starter-packs/install` endpoint.
- **No pack management** — Packs are loaded from JSON files on the server (`server/src/knowledge-starter-packs-data/`). There is no UI or API for creating, editing, deleting, or publishing starter packs. Only the server operator can add or modify packs.
- **No industry-packs relationship enforcement** — The server does not validate that a starter pack's industry matches the template's industry. A Travel Concierge template could technically reference an `engineering` starter pack.
- **Not used in self-service onboarding** — The `POST /api/start` onboarding endpoint does not install knowledge starter packs. See the [Onboarding Support Case Assessment](support-case-v0.5.0-onboarding.md) for details.

## How It Works

### Pack Structure

Each starter pack is a JSON file in `server/src/knowledge-starter-packs-data/` with the following structure:

```json
{
  "key": "travel-industry",
  "name": "Travel Industry Knowledge Pack",
  "description": "Essential knowledge for a travel concierge company",
  "industry": "Travel & Hospitality",
  "icon": "✈️",
  "documentCount": 5,
  "documents": [
    {
      "title": "Destination Research Guide",
      "summary": "How to research and recommend travel destinations",
      "body": "# Destination Research\n\n## Key Factors\n... (full markdown body)"
    }
  ]
}
```

### Installation Flow

When a company template with a `starterPackKey` is deployed:

1. The server loads the pack JSON file from disk
2. For each document in the pack:
   a. Checks if a document with the same title already exists in the company
   b. If not, creates the document as a **draft**
   c. Submits it for review (auto-approved — starter packs are pre-curated)
   d. Publishes it immediately
3. If any document fails, a warning is logged and the installation continues
4. The deploy response includes a `warnings` array with details of any failures

## Known Limitations

| Limitation | Description | Workaround |
|---|---|---|
| Data directory may be empty | If `knowledge-starter-packs-data/` does not exist or is empty, the pack list is empty. The server boots fine — this is handled gracefully with a startup warning. | Create the data directory and add pack JSON files. The service logs a warning: "Knowledge starter packs data directory unavailable; serving empty pack list" |
| Title-based dedup only | Deduplication is by exact title match (case-insensitive). Two documents with different titles but identical content will both be created. | Manually review and remove duplicates from the knowledge base after deployment |
| No rollback | Starter pack installation is not wrapped in a single transaction. If the deployment fails mid-way, some documents may have been created and others not. | Check the `warnings` array in the deploy response. Manually create any missing documents. |
| Published status | All starter pack documents are created as **published**. There is no draft stage for review. | If the content needs modification, edit the published document via the Knowledge API or UI. |
| No per-document error detail in deploy response | The `warnings` array includes a generic message per failed document but not per-field validation errors. | Check the server logs for detailed error messages when a document creation fails. |

## Troubleshooting

### Problem: Starter pack documents did not appear in the knowledge base

1. Verify the company template has a `starterPackKey` in its JSON definition (e.g., `"starterPackKey": "travel-industry"`)
2. Check the server logs for startup warnings about the starter packs data directory
3. Verify the pack JSON file exists in `server/src/knowledge-starter-packs-data/`
4. Check the deploy response's `warnings` array for any document creation failures
5. Look for server logs at the `info` level: "Starter pack installed" — this confirms installation completed

### Problem: "Starter pack not found" error on deploy

1. The `starterPackKey` in the template does not match any pack key in the data directory
2. Verify available pack keys by checking files in `knowledge-starter-packs-data/`
3. Pack keys are case-sensitive — ensure `starterPackKey` matches exactly

### Problem: Duplicate documents appearing after re-deploy

1. Title-based dedup prevents creating documents with the same title
2. If the same title exists, the document is skipped (logged at `info` level: "Skipping existing knowledge document (title already exists)")
3. If you need to re-install, delete the existing documents first, then re-deploy
4. If documents with different titles but the same content exist, they are NOT detected as duplicates

### Problem: Knowledge base shows documents but content looks wrong

1. Starter pack documents are created from the JSON content on disk at deploy time
2. Check the pack JSON file for content accuracy
3. If the pack content is incorrect, the server operator must update the JSON file
4. Already-created documents are not updated when the pack JSON changes — delete and re-create

## Available Starter Packs

| Pack Key | Industry | Used By Template |
|---|---|---|
| `travel-industry` | Travel & Hospitality | Travel Concierge |
| `saas-support` | SaaS & Customer Support | Support Ops |
| `engineering` | Software Engineering | Engineering Team |
| `finance-accounting` | Accounting & Tax | CPA Firm |

Note: The actual availability of these packs depends on the JSON files present in `knowledge-starter-packs-data/` on the server. The server operator controls which packs are available.

## Support Escalation Path

| Issue | Severity | Action |
|---|---|---|
| Starter pack data directory missing | Low | Check server startup logs; verify `knowledge-starter-packs-data/` exists. Server operator creates the directory and adds pack JSON files. |
| Pack installation failure on deploy | Medium | Check the warnings array and server logs. Individual document failures are non-fatal. |
| Documents created with incorrect content | Medium | Content is read from the pack JSON file at deploy time. Server operator must fix the JSON source. |
| Title-based dedup not catching near-duplicates | Low | Dedup is exact title match only. Manually clean up duplicate documents in the knowledge base. |
| Pack key not found | Low | Verify the template's `starterPackKey` matches a pack key in the data directory. |

## Related Documentation

- [Company Templates Support Case Assessment](support-case-company-templates.md) — templates use starter packs during deployment
- [Self-Service Onboarding Support Case Assessment](support-case-v0.5.0-onboarding.md) — onboarding does not install starter packs
- [Knowledge Documents API Reference](/api/knowledge) — managing individual knowledge documents post-install
- [Company Templates API Reference](/api/company-templates) — template deployment with starter pack support

## Version History

| Version | Date | Changes |
|---|---|---|
| v0.5.0 | 2026-08-19 | Initial assessment — service exists as internal dependency of company templates; no standalone API |
