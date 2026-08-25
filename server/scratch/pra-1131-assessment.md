# PRA-1131 / PRA-1637 — VPS Migration Assessment
## Generated: 2026-08-25 05:20 UTC
## Agent: CTO (cccf9a46-318f-4ec9-b938-1cd7f2d9fc1b)

## Current State

### vps-1 (Hostinger, 72.60.29.178)
- Plan: KVM 2 (2 vCPU / 8GB)
- CPU steal: 90.5% — CRITICAL, unchanged since PRA-1104
- Load avg: 5.78 on 2 cores (289% overload)
- Memory: 1.9GB used / 7.8GB — OK (limits applied per previous action)
- Disk: 30GB used / 96GB — OK
- 12 containers running (down from 18+)

### Issue Chain
- PRA-1104: Investigation → done
- PRA-1131: VPS Capacity Upgrade → blocked (this issue)
- PRA-1501: Upgrade via Hostinger Panel KVM 4 → cancelled (2026-08-25T04:50Z)
- └── PRA-1501 was a "Required Human Action" (log into hpanel.hostinger.com)
- PRA-1637: Migrate vps-1 to Hetzner CX32 → todo (CREATED this heartbeat, child of PRA-1131)

## Migration Plan (PRA-1637)

### Target: Hetzner CX32 (4 vCPU / 8GB, ~$16/mo)
- Dedicated vCPUs — zero CPU steal
- 8GB RAM — matches current
- Cost-effective: ~$16/mo vs $24/mo+ for Linode/DO equivalent
- Existing SSH key at ~/.ssh/id_ed25519 can be used

### Container Inventory (12 running)
1. traefik — reverse proxy with SSL certs (Let's Encrypt via DNS-01 or TLS-ALPN-01)
2. consul-server — service discovery
3. travel_app — main app (Next.js, port 3000)
4. travel_db — Postgres (need to dump/restore)
5. travel_transport_discovery_worker — background worker
6. travel_retention_worker — background worker
7. travel_stripe_webhook_worker — background worker
8. voyonder_api — API server (port 3101)
9. sms-assistant-db-prod — Postgres
10. latusai — AI service (port 3000)
11. registrator — container registration
12. blackbox — monitoring exporter

### Migration Steps (draft)
1. Provision Hetzner CX32 VPS (hcloud CLI or web console)
2. Install Docker + Docker Compose
3. Set up Traefik with existing certs
4. Set up Consul cluster
5. Dump travel_db and sms-assistant-db (pg_dump)
6. Copy DB dumps, restore on new VPS
7. Deploy all containers with docker-compose
8. Update DNS for *.praesyn.com → new VPS IP
9. Verify all services healthy
10. Decommission old Hostinger VPS

### API Write Limitation
During this heartbeat, PATCH /api/companies/:companyId/issues/:id returned HTTP 500
for all mutation attempts. Could not update PRA-1131 status/comment or assign PRA-1637
to CTO agent. This write issue should be investigated separately.

## Recommendation
Proceed with PRA-1637. Hetzner CX32 is the most cost-effective option that
eliminates the CPU steal problem entirely. Expected cost: ~$16/mo.