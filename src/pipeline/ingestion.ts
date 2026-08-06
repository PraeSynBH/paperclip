import type { DrataControl, DrataEvidence, DrataMonitoringTest } from "../drata/types.js";
import { DrataClient } from "../drata/client.js";
import { evidenceCollectedAt, evidenceControlIds, evidenceRenewalDate } from "../drata/helpers.js";

/**
 * Drata v2 monitoring tests no longer carry a flat `controlId`; the linked
 * controls come back under `expand[]=controls`. Fall back to the legacy field
 * so older cached payloads still resolve.
 */
function resolveTestControlId(test: DrataMonitoringTest): number | null {
  if (typeof test.controlId === "number") return test.controlId;
  const first = test.controls?.[0];
  return typeof first?.id === "number" ? first.id : null;
}


export interface EvidenceRecord {
  id: string;
  source: "drata";
  sourceId: number;
  controlId: number;
  controlName: string;
  evidenceType: "monitoring_test" | "uploaded_evidence" | "policy_acknowledgment" | "device_compliance";
  status: "active" | "expiring" | "expired";
  collectedAt: string | null;
  renewalDate: string | null;
  rawData: Record<string, unknown>;
}

export interface IngestionBatch {
  id: string;
  startedAt: string;
  completedAt: string | null;
  records: EvidenceRecord[];
  stats: {
    total: number;
    active: number;
    expiring30d: number;
    expired: number;
    controlsCovered: number;
  };
}

export class EvidenceIngestionPipeline {
  private client: DrataClient;

  constructor(apiKey?: string) {
    this.client = new DrataClient(undefined, apiKey);
  }

  async run(): Promise<IngestionBatch> {
    const batchId = `batch-${Date.now()}`;
    const batch: IngestionBatch = {
      id: batchId,
      startedAt: new Date().toISOString(),
      completedAt: null,
      records: [],
      stats: { total: 0, active: 0, expiring30d: 0, expired: 0, controlsCovered: 0 },
    };

    const [controls, tests, evidence] = await Promise.all([
      this.client.getAllControls(),
      this.client.getAllMonitoringTests(),
      this.client.getAllEvidence(),
    ]);

    const controlMap = new Map<number, DrataControl>();
    for (const c of controls) controlMap.set(c.id, c);

    const coveredControls = new Set<number>();

    for (const test of tests) {
      const controlId = resolveTestControlId(test);
      const control = controlId !== null ? controlMap.get(controlId) : undefined;
      const record = this.monitoringTestToRecord(test, control);
      batch.records.push(record);
      if (control) coveredControls.add(control.id);
    }

    for (const ev of evidence) {
      const record = this.evidenceToRecord(ev, controlMap);
      batch.records.push(record);
      for (const controlId of evidenceControlIds(ev)) {
        if (controlMap.has(controlId)) coveredControls.add(controlId);
      }
    }

    batch.stats.total = batch.records.length;
    batch.stats.active = batch.records.filter((r) => r.status === "active").length;

    const now = new Date();
    const thirtyDaysFromNow = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
    batch.stats.expiring30d = batch.records.filter((r) => {
      if (!r.renewalDate) return false;
      const renewal = new Date(r.renewalDate);
      return renewal <= thirtyDaysFromNow && r.status !== "expired";
    }).length;

    batch.stats.expired = batch.records.filter((r) => r.status === "expired").length;
    batch.stats.controlsCovered = coveredControls.size;
    batch.completedAt = new Date().toISOString();

    return batch;
  }

  private monitoringTestToRecord(
    test: DrataMonitoringTest,
    control?: DrataControl
  ): EvidenceRecord {
    const collectedAt = test.lastTestedAt ?? test.lastPassedAt ?? null;
    const renewalDate = test.nextTestAt ?? null;
    const status = this.determineStatus(collectedAt, renewalDate);
    const controlId = resolveTestControlId(test);
    return {
      id: `drata-monitor-${test.id}`,
      source: "drata",
      sourceId: test.id,
      controlId: controlId ?? 0,
      controlName:
        control?.name ??
        (controlId !== null ? `Control #${controlId}` : "Unmapped control"),
      evidenceType: "monitoring_test",
      status,
      collectedAt,
      renewalDate,
      rawData: test as unknown as Record<string, unknown>,
    };
  }

  private evidenceToRecord(
    ev: DrataEvidence,
    controlMap: Map<number, DrataControl>
  ): EvidenceRecord {
    const collectedAt = evidenceCollectedAt(ev);
    const renewalDate = evidenceRenewalDate(ev);
    const status = this.determineStatus(collectedAt, renewalDate);
    // `expand[]=controls` returns every control the entry is linked to; the
    // flat record carries the first one and `run()` credits all of them.
    const [primaryControlId] = evidenceControlIds(ev);
    const control =
      primaryControlId !== undefined ? controlMap.get(primaryControlId) : undefined;
    return {
      id: `drata-evidence-${ev.id}`,
      source: "drata",
      sourceId: ev.id,
      controlId: primaryControlId ?? 0,
      controlName:
        control?.name ??
        ev.controls?.[0]?.name ??
        (primaryControlId !== undefined
          ? `Control #${primaryControlId}`
          : "Unmapped control"),
      evidenceType: "uploaded_evidence",
      status,
      collectedAt,
      renewalDate,
      rawData: ev as unknown as Record<string, unknown>,
    };
  }

  private determineStatus(
    collectedAt: string | null,
    renewalDate: string | null
  ): "active" | "expiring" | "expired" {
    if (!renewalDate) return "active";

    const now = new Date();
    const renewal = new Date(renewalDate);

    if (renewal < now) return "expired";

    const thirtyDays = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
    if (renewal <= thirtyDays) return "expiring";

    return "active";
  }

  generateSummary(batch: IngestionBatch): string {
    const lines = [
      `## Evidence Ingestion Summary`,
      `Batch: ${batch.id}`,
      `Started: ${batch.startedAt}`,
      `Completed: ${batch.completedAt}`,
      ``,
      `| Metric | Value |`,
      `|--------|-------|`,
      `| Total records | ${batch.stats.total} |`,
      `| Active | ${batch.stats.active} |`,
      `| Expiring (30d) | ${batch.stats.expiring30d} |`,
      `| Expired | ${batch.stats.expired} |`,
      `| Controls covered | ${batch.stats.controlsCovered} |`,
    ];

    if (batch.stats.expiring30d > 0 || batch.stats.expired > 0) {
      lines.push(``, `### Attention Required`);
      if (batch.stats.expired > 0) {
        lines.push(``);
        lines.push(`${batch.stats.expired} evidence record(s) have expired and need immediate renewal.`);
      }
      if (batch.stats.expiring30d > 0) {
        lines.push(``);
        lines.push(`${batch.stats.expiring30d} evidence record(s) expire within 30 days.`);
      }
    }

    return lines.join("\n");
  }
}