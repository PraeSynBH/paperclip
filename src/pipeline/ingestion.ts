import type { DrataControl, DrataEvidence, DrataMonitoringTest } from "../drata/types.js";
import { DrataClient } from "../drata/client.js";

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
      const control = controlMap.get(test.controlId);
      const record = this.monitoringTestToRecord(test, control);
      batch.records.push(record);
      if (control) coveredControls.add(control.id);
    }

    for (const ev of evidence) {
      const record = this.evidenceToRecord(ev);
      batch.records.push(record);
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
    const status = this.determineStatus(test.lastTestedAt, test.nextTestAt);
    return {
      id: `drata-monitor-${test.id}`,
      source: "drata",
      sourceId: test.id,
      controlId: test.controlId,
      controlName: control?.name ?? `Control #${test.controlId}`,
      evidenceType: "monitoring_test",
      status,
      collectedAt: test.lastTestedAt,
      renewalDate: test.nextTestAt,
      rawData: test as unknown as Record<string, unknown>,
    };
  }

  private evidenceToRecord(ev: DrataEvidence): EvidenceRecord {
    const status = this.determineStatus(ev.lastCollectedAt, ev.renewalDate);
    return {
      id: `drata-evidence-${ev.id}`,
      source: "drata",
      sourceId: ev.id,
      controlId: 0,
      controlName: "Unknown",
      evidenceType: "uploaded_evidence",
      status,
      collectedAt: ev.lastCollectedAt,
      renewalDate: ev.renewalDate,
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