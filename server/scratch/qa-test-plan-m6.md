# VOY-2196 — QA Test Plan — M6 Infra Fixes Deployment

## Pre-requisite
**VOY-2195 must complete** — deploy applied to production, voyonder-api container restarted with M6 fixes.

---

## Test Suite

### 1. Health Endpoint
- **Path**: `GET https://voyonder.com/api/health`
- **Expected**: 200 `{"status":"ok","timestamp":"..."}`
- **Note**: Already verified working in previous recovery probe. Re-verify after deploy.

### 2. Background Jobs API
> **⚠️ Path correction**: Issue description says `/api/background-jobs`. Actual routes are `/background-jobs` (no /api prefix, via Traefik).

| Test | Path | Expected | Notes |
|------|------|----------|-------|
| List jobs | `GET /background-jobs` | 401 (unauthenticated) or 200 (authenticated) | Previously returned 500 — needs investigation |
| Get job by ID | `GET /background-jobs/:id` | 401 or 200 | Uses `assertVoyonderAuth` |
| Job events | `GET /background-jobs/events` | 401 or 200 | SSE endpoint |

**Known issue (pre-M6)**: `GET /background-jobs` returns 500 instead of 401 when unauthenticated. Likely an error-handling gap in the route's auth middleware. Needs verification after deploy — if the M6 fixes include the error-handler fix, this should now return 401.

### 3. Research Endpoints
> **⚠️ Path corrections**: Issue says `/api/research/autoAssess` → actual is `/research/auto-assess` (kebab-case, no /api prefix). Issue says `/api/research/search` → actual is `/research/search` (no /api prefix).

#### 3a. Auto-Assess
- **Path**: `POST https://voyonder.com/research/auto-assess`
- **Auth**: Required (Voyonder JWT)
- **Expected (unauthenticated)**: 401
- **Expected (authenticated)**: 202 Accepted (fire-and-forget, returns job ID)
- **Body**: `{"url": "https://example.com/article"}`
- **Verify**: Background job is created and processes

#### 3b. Search
- **Path**: `GET https://voyonder.com/research/search`
- **Auth**: Required (Voyonder JWT)
- **Expected (unauthenticated)**: 401
- **Expected (authenticated)**: 200 with results
- **Query**: `?q=test+query&limit=10`
- **Note**: Should support keyword-first search with optional SSE for semantic upgrade

### 4. Export Endpoints
> **⚠️ Path corrections**: Actual routes likely under `/exports/` (no /api prefix).

| Test | Path | Expected | Notes |
|------|------|----------|-------|
| PDF export | `POST /exports/pdf` | 401 or 200 | Need trip ID in body |
| ICS export | `POST /exports/ics` | 401 or 200 | Previously returned 400 (validation active) |

### 5. Frontend Routing
- **Path**: `GET https://voyonder.com/`
- **Expected**: 200, serves Next.js frontend (Voyonder travel app)
- **Note**: Already verified working. Re-verify after deploy.

### 6. TLS
- **URL**: `https://voyonder.com`
- **Expected**: Valid Let's Encrypt certificate, CN=voyonder.com, no cert errors
- **Note**: Already verified valid (Jul 27–Oct 25 2026). Re-verify after deploy.

---

## Auth Tokens for Testing
To test authenticated endpoints, we need a valid Voyonder JWT. Options:
- Use browser cookies imported from a logged-in user session
- Generate a test token with known credentials
- Use the Auth0 test flow

---

## Test Order (Recommended)
1. TLS → Health → Frontend (quick smoke, no auth needed)
2. Background jobs (unauthenticated) — verify 401 replaces 500
3. Export endpoints (unauthenticated) — verify 401
4. Research endpoints (unauthenticated) — verify 401
5. Auth-required tests — full flow with JWT

---

## Rollback Criteria
If any of the following fail, flag CTO immediately:
- `/api/health` returns non-200
- TLS certificate error
- Frontend returns 404 or nginx default page
- `GET /background-jobs` continues returning 500 (should be 401)