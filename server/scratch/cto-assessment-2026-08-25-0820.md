# CTO Assessment — 2026-08-25 ~08:20 UTC

## Disposition: YELLOW — All services green, but vps-1 CPU steal regression is ACTIVE (86-90%)

## Live verification (this heartbeat, ~08:09-08:15 UTC)
- All 8 services HTTP 200/expected: praesyn.com, travel.praesyn.com/api/health, voyonder.com/api/health,
  southeastaksupply.com, crm.praesyn.com, conn.praesyn.com (404 expected — headscale), status.praesyn.com (302),
  Paperclip API macbook.praesyn.int:3100 (200)
- vps-1 (72.60.29.178): up 47d, load 2.00/3.41/2.73, disk 31% (67G free), mem 5.9G avail
- **CPU steal: 86-90% CONFIRMED LIVE** (top: `86.7-90.0 st`) — the Aug 24 "0%" was a temporary lull.
  This is the Hostinger hypervisor overcommit issue; unfixable in-VM. Migration is the correct path.
- 12 containers, 14 images (5.3GB), 11 volumes (1.5GB)

## Work done this heartbeat
1. **PRA-1637 (vps-1 → Hetzner CX32 migration)**: full inventory captured; runbook document written to the issue
   (`cto-vps1-hetzner-runbook-2026-08-25`) — container→compose mapping, volumes, Traefik hosts, DNS table,
   6-phase migration plan, risk notes. Migration phases 2-6 are agent-executable within hours of CX32 existing.
2. **PRA-1647 created** (child of PRA-1637, assigned to Ben, critical): create Hetzner Cloud account + API token —
   the only missing input. Exact steps + cost + alternative documented.
3. **PRA-1645 (07:20 heartbeat issue)**: left unassigned in todo — its assignment run was cancelled earlier
   ("issue assignee changed"). Not PATCHable from this run context.

## Constraint (documented): timer heartbeat runs cannot cross-issue write
- PATCH status / POST comments on ANY issue (including same-run-created children) → 403
  `cross_issue_influence_run_context_required` (requires the run to be attributed to that issue).
- Allowed from timer runs: create issues (PRA-1647 ✓), write issue documents (runbook ✓).
- Sanctioned flow per prior heartbeats: timer run creates heartbeat issue assigned to self;
  an assignment run finalizes it (PRA-1583 pattern). PRA-1645's assignment run was cancelled, so it remains todo.

## Needed (human / other agents)
- Ben: PRA-1647 (Hetzner account + API token) → then CTO executes migration phases 2-6
- CEO: aware of active 86-90% CPU steal regression; migration is the resolution
- Healthcare PRA-277: still blocked on Ben SEP screening (day 10+) — not CTO