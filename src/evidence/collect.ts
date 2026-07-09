import * as fs from "node:fs";
import * as path from "node:path";
import { collectGitHubEvidence } from "./github.js";
import { collectGcpEvidence, generateGcpCollectionScript } from "./gcp.js";
import { collectMdmEvidence, generateMdmConfigurationGuide } from "./mdm.js";
import { buildManifest, generateMarkdownReport } from "./manifest.js";
import { ISO_27001_2022_ANNEX_A } from "../iso27001/annex-a.js";
import { DrataClient } from "../drata/client.js";
import { assertConfigSync } from "../config.js";

const REPO_ROOT = path.resolve(process.cwd());
const OUTPUT_DIR = path.join(REPO_ROOT, "data", "evidence");

async function main(): Promise<void> {
  console.log("=== Aira ISO 27001:2022 A.8 Evidence Collection ===\n");

  assertConfigSync();
  const drataClient = new DrataClient();

  const a8Controls = ISO_27001_2022_ANNEX_A
    .find((cat) => cat.id === "A.8")!
    .controls.map((c) => ({ id: c.id, title: c.title }));

  fs.mkdirSync(OUTPUT_DIR, { recursive: true });

  console.log("1/4 Collecting GitHub evidence...");
  const githubItems = await collectGitHubEvidence(REPO_ROOT);
  const githubReady = githubItems.filter((i) => i.status === "ready").length;
  console.log(`   ${githubItems.length} items (${githubReady} ready, ${githubItems.length - githubReady} pending)\n`);

  console.log("2/4 Collecting GCP evidence...");
  const gcpItems = await collectGcpEvidence();
  console.log(`   ${gcpItems.length} items (pending — requires gcloud CLI and GCP access)\n`);

  console.log("3/4 Collecting MDM/device evidence...");
  const mdmItems = await collectMdmEvidence({ client: drataClient, outputDir: OUTPUT_DIR });
  const mdmCollected = mdmItems.filter((i) => i.status === "collected").length;
  const mdmPending = mdmItems.filter((i) => i.status === "pending").length;
  console.log(`   ${mdmItems.length} items (${mdmCollected} collected, ${mdmPending} pending)\n`);

  const allItems = [...githubItems, ...gcpItems, ...mdmItems];

  console.log("4/4 Building evidence manifest...");
  const manifest = buildManifest(a8Controls, allItems);

  const manifestPath = path.join(OUTPUT_DIR, "evidence-manifest.json");
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
  console.log(`   Manifest: ${manifestPath}`);

  const reportPath = path.join(OUTPUT_DIR, "evidence-report.md");
  fs.writeFileSync(reportPath, generateMarkdownReport(manifest));
  console.log(`   Report: ${reportPath}\n`);

  console.log("=== Generating collection scripts ===\n");

  const gcpScriptPath = path.join(REPO_ROOT, "scripts", "collect-gcp-evidence.sh");
  fs.mkdirSync(path.dirname(gcpScriptPath), { recursive: true });
  fs.writeFileSync(gcpScriptPath, generateGcpCollectionScript());
  fs.chmodSync(gcpScriptPath, 0o755);
  console.log(`   GCP script: ${gcpScriptPath}`);

  const mdmGuidePath = path.join(OUTPUT_DIR, "mdm-configuration-guide.md");
  fs.writeFileSync(mdmGuidePath, generateMdmConfigurationGuide());
  console.log(`   MDM guide: ${mdmGuidePath}\n`);

  const { coverageSummary } = manifest;
  console.log("=== Coverage Summary ===");
  console.log(`Controls with evidence: ${coverageSummary.controlsWithEvidence}/${coverageSummary.totalEvidenceItems}`);
  console.log(`Without evidence: ${coverageSummary.controlsWithoutEvidence}`);
  console.log(`Total items: ${coverageSummary.totalEvidenceItems}`);
  console.log(`By source: ${JSON.stringify(coverageSummary.bySource)}`);
  console.log(`By status: ${JSON.stringify(coverageSummary.byStatus)}`);
  console.log("\nDone.");
}

main().catch((err) => {
  console.error("Evidence collection failed:", err);
  process.exit(1);
});