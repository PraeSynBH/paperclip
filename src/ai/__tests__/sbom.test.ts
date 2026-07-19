import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

const PROJECT_DIR = resolve(import.meta.dirname, "..", "..", "..");
const SBOM_PATH = resolve(PROJECT_DIR, "sbom.cdx.json");

interface CycloneDXComponent {
  name: string;
  version: string;
  purl?: string;
  type?: string;
  properties?: { name: string; value: string }[];
  externalReferences?: unknown[];
}

interface CycloneDXSBOM {
  bomFormat: string;
  specVersion: string;
  components: CycloneDXComponent[];
}

function loadSBOM(): CycloneDXSBOM {
  assert.ok(
    existsSync(SBOM_PATH),
    `SBOM file not found at ${SBOM_PATH}. Run 'npm run sbom' first.`
  );
  return JSON.parse(readFileSync(SBOM_PATH, "utf-8")) as CycloneDXSBOM;
}

describe("SBOM (CycloneDX)", () => {
  let sbom: CycloneDXSBOM;

  before(() => {
    sbom = loadSBOM();
  });

  it("generates a CycloneDX JSON SBOM", () => {
    assert.equal(sbom.bomFormat, "CycloneDX");
    assert.ok(sbom.specVersion, "Must have specVersion");
  });

  it("contains npm dependency components", () => {
    const npmComps = sbom.components.filter(
      (c) => c.purl?.startsWith("pkg:npm/")
    );
    assert.ok(npmComps.length >= 2, `Must have at least 2 npm components, got ${npmComps.length}`);

    const requiredPurls = [
      "%40aws-sdk/client-secrets-manager",
      "dotenv"
    ];
    for (const purlFragment of requiredPurls) {
      const found = npmComps.find((c) => c.purl?.includes(purlFragment));
      assert.ok(found, `Must include npm component matching: ${purlFragment}`);
    }
  });

  it("contains implicit API dependency: Google Generative Language API", () => {
    const gemini = sbom.components.find(
      (c) => c.purl === "pkg:generic/google-generative-language-api@v1beta"
    );
    assert.ok(gemini, "Must include Google Generative Language API");
    assert.equal(gemini.type, "application");

    const props = Object.fromEntries(
      (gemini.properties ?? []).map((p) => [p.name, p.value])
    );
    assert.ok(props.auth_method, "Must document auth_method");
    assert.ok(props.transport, "Must document transport");
    assert.ok(props.code_path?.includes("gemini-client.ts"), "Must reference gemini-client.ts");
    assert.ok(props.models_used?.includes("gemini-2.5"), "Must list models used");
  });

  it("contains implicit API dependency: OpenRouter API", () => {
    const openrouter = sbom.components.find(
      (c) => c.purl === "pkg:generic/openrouter-api@v1"
    );
    assert.ok(openrouter, "Must include OpenRouter API");

    const props = Object.fromEntries(
      (openrouter.properties ?? []).map((p) => [p.name, p.value])
    );
    assert.ok(props.status?.includes("REFERENCED"), "Must indicate referenced status");
    assert.ok(props.code_path?.includes("config.ts"), "Must reference config.ts");
    assert.ok(props.code_path?.includes("types.ts"), "Must reference types.ts");
  });

  it("contains implicit API dependency: AWS Secrets Manager", () => {
    const aws = sbom.components.find(
      (c) => c.purl === "pkg:generic/aws-secrets-manager@2017-10-17"
    );
    assert.ok(aws, "Must include AWS Secrets Manager");

    const props = Object.fromEntries(
      (aws.properties ?? []).map((p) => [p.name, p.value])
    );
    assert.ok(
      props.stored_secrets?.includes("GEMINI_API_KEY"),
      "Must list GEMINI_API_KEY as stored secret"
    );
    assert.ok(
      props.stored_secrets?.includes("OPENROUTER_API_KEY"),
      "Must list OPENROUTER_API_KEY as stored secret"
    );
  });

  it("does not leak API keys or secrets in SBOM", () => {
    const sbomStr = JSON.stringify(sbom);

    if (/AIza[0-9A-Za-z\-_]{35}/.test(sbomStr)) {
      assert.fail("SBOM must not contain Gemini API key pattern (AIza...)");
    }
    if (/sk-or-[a-zA-Z0-9]{32,}/.test(sbomStr)) {
      assert.fail("SBOM must not contain OpenRouter API key pattern (sk-or-...)");
    }
    if (/AKIA[0-9A-Z]{16}/.test(sbomStr)) {
      assert.fail("SBOM must not contain AWS access key pattern (AKIA...)");
    }

    assert.ok(true, "No secrets leaked in SBOM");
  });

  it("all implicit API deps have externalReferences", () => {
    const implicit = sbom.components.filter(
      (c) => c.purl?.startsWith("pkg:generic/")
    );

    assert.equal(implicit.length, 3, `Must have exactly 3 implicit API deps, got ${implicit.length}`);

    for (const comp of implicit) {
      assert.ok(
        (comp.externalReferences ?? []).length > 0,
        `${comp.name}: must have externalReferences for supply chain auditing`
      );
    }
  });

  it("all components have non-empty version identifiers", () => {
    for (const comp of sbom.components) {
      assert.ok(comp.version, `${comp.name}: must have a version`);
      assert.ok(
        comp.version.trim().length > 0,
        `${comp.name}: version must not be empty`
      );
    }
  });

  it("SBOM component count is within expected bounds", () => {
    assert.ok(
      sbom.components.length >= 28,
      `Expected >= 28 components, got ${sbom.components.length}`
    );
    assert.ok(
      sbom.components.length <= 200,
      `Expected <= 200 components, got ${sbom.components.length}`
    );
  });
});