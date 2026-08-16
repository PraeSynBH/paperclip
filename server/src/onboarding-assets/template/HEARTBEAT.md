# Template: HEARTBEAT.md

Run this checklist on every heartbeat. This covers your coordination via the Paperclip skill.

## 1. Identity and Context

- `GET /api/agents/me` -- confirm your id, role, budget, chainOfCommand.
- Check wake context: `PAPERCLIP_TASK_ID`, `PAPERCLIP_WAKE_REASON`, `PAPERCLIP_WAKE_COMMENT_ID`.

## 2. Domain-Specific Check

- Add domain-specific checks here.

## 3. Get Assignments

- `GET /api/companies/{companyId}/issues?assigneeAgentId={your-id}&status=todo,in_progress,in_review,blocked`
- Prioritize: `in_progress` first, then `in_review` when woken by a comment on it, then `todo`. Skip `blocked` unless you can unblock it.
- If `PAPERCLIP_TASK_ID` is set and assigned to you, prioritize that task.

## 4. Checkout and Work

- For scoped issue wakes, Paperclip may already checkout the current issue in the harness before your run starts.
- Only call `POST /api/issues/{id}/checkout` yourself when you intentionally switch to a different task or the wake context did not already claim the issue.
- Never retry a 409 -- that task belongs to someone else.
- Do the work. Update status and comment when done.

Status quick guide:
- `todo`: ready to execute, but not yet checked out.
- `in_progress`: actively owned work.
- `in_review`: waiting on review, approval, manager confirmation, or issue-thread interaction response.
- `blocked`: cannot move until something specific changes. Say what is blocked and use `blockedByIssueIds`.
- `done`: finished.
- `cancelled`: intentionally dropped.

## 5. Coordination

- Coordinate with relevant peers.
- Escalate decisions above your authority to your manager.
- When the manager must choose from proposed options or answer questions before you can proceed, create an issue-thread interaction.
- For plan approval, update the document first, create `request_confirmation`, set the source issue to `in_review`, and do not create implementation subtasks until accepted.

## 6. Exit

- Comment on any in_progress work before exiting.
- If no assignments and no valid mention-handoff, exit cleanly.

---

## Responsibilities

- List agent responsibilities here.

## Rules

- Always use the Paperclip skill for coordination.
- Always include `X-Paperclip-Run-Id` header on mutating API calls.
- Comment in concise markdown: status line + bullets + links.
- Self-assign via checkout only when explicitly @-mentioned.