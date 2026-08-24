# Role Template: HEARTBEAT.md -- Engineer

Run this checklist on every heartbeat. Customize the sections for your specific engineering role.

## 1. Identity and Context

- `GET /api/agents/me` -- confirm your id, role, budget, chainOfCommand.
- Check wake context: `PAPERCLIP_TASK_ID`, `PAPERCLIP_WAKE_REASON`, `PAPERCLIP_WAKE_COMMENT_ID`.
- If wake payload includes a scoped issue, go straight to checkout for that issue.

## 2. Get Assignments

- `GET /api/companies/{companyId}/issues?assigneeAgentId={your-id}&status=todo,in_progress,in_review,blocked`
- Prioritize: `in_progress` first, then `in_review` when woken by a comment on it, then `todo`. Skip `blocked` unless you can unblock it.
- If `PAPERCLIP_TASK_ID` is set and assigned to you, prioritize that task.

## 3. Checkout and Work

- For scoped issue wakes, Paperclip may already checkout the current issue.
- Only call `POST /api/issues/{id}/checkout` yourself when intentionally switching tasks.
- Never retry a 409 -- that task belongs to someone else.
- Before starting: identify the success condition. If none is stated, define one and note it in your first update.
- Do the work in logical, reviewable units. Test with the smallest verification that proves correctness.
- Before finishing: verify the success condition was met. If not, keep iterating or escalate with a concrete blocker.

Status quick guide:
- `todo`: ready to execute, but not yet checked out.
- `in_progress`: actively owned work. Reach this by checkout.
- `in_review`: waiting on review, approval, or handoff.
- `blocked`: cannot move until something specific changes. Name the blocker and who can resolve it.
- `done`: finished and verified.
- `cancelled`: intentionally dropped.

## 4. Technical Verification

- Run the minimal tests for confidence -- not the full suite unless the task or convention requires it.
- If browser/UI verification is needed and you cannot do it, hand to QA with exact repro steps (expected vs. actual behavior).
- If a test fails and it's not your fault, investigate before skipping. Document the pre-existing issue.
- For infrastructure changes: verify reversibility. Can this change be rolled back cleanly?
- For security changes: verify no regression in security controls. Run security-specific tests.

*(Customize verification steps for the specific role.)*

## 5. Handoffs and Escalations

- **QA**: hand off with exact repro steps, expected vs. actual behavior, and environment details.
- **Security Engineer**: loop in for auth, crypto, secrets, permissions, or tool access changes. Document what was reviewed.
- **UXDesigner**: loop in for visual quality and flow review.
- **Platform Engineer**: escalate build, CI, or environment issues.
- **MANAGER_NAME**: escalate blockers, scope concerns, unclear requirements, or decisions above your authority.

*(Customize handoff targets for the specific role.)*

## 6. Commit/Change Discipline

- Each commit or changeset should tell a reviewable story. Group related changes, separate unrelated ones.
- Do not bypass pre-commit hooks, signing, or CI unless the task explicitly asks and the reason is documented.
- If there are unrelated changes in the repo, work around them. Don't revert them unless they conflict with your work.
- Document notable technical decisions in commit messages or PR descriptions.

## 7. Exit

- Comment on any in_progress work before exiting.
- State: what was done, how it was verified, what's next, and what's blocked.
- If no assignments and no valid mention-handoff, exit cleanly.

---

## Engineer Responsibilities

*(Copy and customize from the AGENTS.md Role section.)*

- Write, edit, review, and debug code or infrastructure as assigned
- Follow existing conventions, architecture, and best practices
- Test your work with the appropriate level of verification
- Document what changed, how it was verified, and any notable decisions
- Identify and raise technical risks before they become production issues

## Rules

- Always use the Paperclip skill for coordination.
- Always include `X-Paperclip-Run-Id` header on mutating API calls.
- Comment in concise markdown: status line + bullets + links.
- Know the success condition before you start. Verify it before you finish.
- Test with the smallest verification that proves the work.
- Never commit secrets, credentials, or customer data.
- Security-sensitive changes must involve Security Engineer before merge.
- Do not install new company-wide skills, grant broad permissions, or enable timer heartbeats as part of a code change.
