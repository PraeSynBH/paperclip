import json, os, sys, requests

api = os.environ.get('PAPERCLIP_API_URL', '').rstrip('/')
if not api.endswith('/api'):
    api += '/api'
key = os.environ['PAPERCLIP_API_KEY']
run_id = os.environ['PAPERCLIP_RUN_ID']

headers = {
    'Authorization': f'Bearer {key}',
    'X-Paperclip-Run-Id': run_id,
    'Content-Type': 'application/json',
}

company_id = 'ce49ee2f-48ea-43f1-99c3-fd78c119f32e'
goal_id = '0ba7ac9e-f969-4e71-aef0-1e376366894a'
parent_id = '93a9a8fa-0eab-4078-86ff-e6cd4c09860c'

# 1. Code Review (Staff Engineer)
review = {
    'companyId': company_id,
    'title': 'Code Review: M5 A/B Pricing Experiment',
    'description': '''## Code Review: M5 A/B Pricing Experiment

**Parent:** VOY-1685
**Branch:** `found/vo/vo--voyonder-code-separation-shared-contract-types`
**Commit:** `48e74146b9`

### Files to review
- `server/src/services/pricing-experiment.ts` (new — 241 lines)
- `server/src/services/billing.ts` (modified — experiment integration)
- `server/src/routes/billing.ts` (modified — experiment endpoints)
- `packages/db/src/schema/companies.ts` (modified — experiment columns)
- `packages/db/src/migrations/0230_pricing_experiment_columns.sql` (new)
- `packages/db/src/migrations/meta/_journal.json` (modified)
- `server/src/__tests__/pricing-experiment.test.ts` (new — 14 tests)

### Key areas for review
1. Deterministic assignment algorithm and hash stability
2. Stripe metadata propagation in checkout sessions
3. Edge cases: experiment disabled, config parsing failure, concurrent variant assignment
4. Test coverage adequacy
''',
    'parentId': parent_id,
    'assigneeAgentId': 'eee825c7-6509-485f-b25f-f6f057c50d6b',  # Staff Engineer
    'priority': 'low',
    'workMode': 'standard',
    'goalId': goal_id,
}

r = requests.post(f'{api}/issues', headers=headers, json=review)
print(f'Review issue: {r.status_code} {r.json().get("id", r.text[:200])}')
review_id = r.json().get('id', '')

# 2. Release (Release Engineer) — blocked on code review
release = {
    'companyId': company_id,
    'title': 'Release: M5 A/B Pricing Experiment',
    'description': f'''## Release: M5 A/B Pricing Experiment

**Parent:** VOY-1685
**Blocked on:** {review_id} (Code Review)

### Scope
- Deploy pricing experiment migration and code to staging
- Verify experiment works in staging
- Deploy to production

### Migration
0230_pricing_experiment_columns.sql — adds pricing_experiment_variant and pricing_experiment_enrolled_at columns to companies table (idempotent ALTER TABLE ... ADD COLUMN IF NOT EXISTS)

### Env var
Set `PRICING_EXPERIMENT_CONFIG` to `{{"enabled":true}}` to activate the experiment.
''',
    'parentId': parent_id,
    'assigneeAgentId': '7a2a259f-06ef-470c-8a06-a77e2c8b8833',  # Release Engineer
    'blockedByIssueIds': [review_id],
    'priority': 'low',
    'workMode': 'standard',
    'goalId': goal_id,
}

r = requests.post(f'{api}/issues', headers=headers, json=release)
print(f'Release issue: {r.status_code} {r.json().get("id", r.text[:200])}')
release_id = r.json().get('id', '')

# 3. QA Verification (QA Engineer) — blocked on release
qa = {
    'companyId': company_id,
    'title': 'QA: M5 A/B Pricing Experiment',
    'description': f'''## QA Verification: M5 A/B Pricing Experiment

**Parent:** VOY-1685
**Blocked on:** {release_id} (Release)

### Verification checklist
1. [ ] Variant assignment works (A/B split visible in experiment-variant endpoint)
2. [ ] Stripe checkout metadata includes pricingExperimentVariant
3. [ ] Tier pricing varies correctly between variants
4. [ ] Experiment disabled → all companies see control pricing
5. [ ] Deterministic assignment: same company always gets same variant
6. [ ] Migration runs safely on existing data (backward compatible)
''',
    'parentId': parent_id,
    'assigneeAgentId': 'c3bdfe58-5d2e-4190-b499-1779cb9a5484',  # QA Engineer
    'blockedByIssueIds': [release_id],
    'priority': 'low',
    'workMode': 'standard',
    'goalId': goal_id,
}

r = requests.post(f'{api}/issues', headers=headers, json=qa)
print(f'QA issue: {r.status_code} {r.json().get("id", r.text[:200])}')
qa_id = r.json().get('id', '')
