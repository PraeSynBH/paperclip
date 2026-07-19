#!/usr/bin/env bash
# generate-sbom.sh — Generate combined CycloneDX SBOM for Aira
# Includes npm dependencies AND implicit API dependencies (Gemini REST, OpenRouter REST)
# OWASP LLM05: Supply Chain Vulnerabilities — SBOM for AI SDK dependencies

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
OUTPUT_FILE="${1:-$PROJECT_DIR/sbom.cdx.json}"

echo "=== Aira SBOM Generator ==="
echo "Output: $OUTPUT_FILE"

# Step 1: Generate npm SBOM via cyclonedx-npm
echo "[1/3] Generating npm SBOM via cyclonedx-npm..."
cd "$PROJECT_DIR"
npx --yes @cyclonedx/cyclonedx-npm@latest \
  --output-file "$OUTPUT_FILE" \
  --output-format JSON \
  --package-lock-only

# Step 2: Augment with implicit API dependencies
echo "[2/3] Augmenting SBOM with implicit API dependencies..."

python3 - "$OUTPUT_FILE" "$PROJECT_DIR" << 'PYEOF'
import json, sys, hashlib, pathlib

outfile = sys.argv[1]
project_dir = sys.argv[2]

with open(outfile) as f:
    sbom = json.load(f)

# Implicit API dependencies — not tracked by npm because they're raw fetch() calls
# These are hard security dependencies: if the API changes or is compromised,
# the entire AI governance pipeline is affected.

implicit_deps = [
    {
        "type": "application",
        "name": "google-generative-language-api",
        "version": "v1beta",
        "description": "Google Generative Language API (Gemini) — implicit REST dependency. Used via raw fetch() in src/ai/gemini-client.ts. Not an npm package. API key auth via x-goog-api-key header.",
        "purl": "pkg:generic/google-generative-language-api@v1beta",
        "externalReferences": [
            {"type": "documentation", "url": "https://ai.google.dev/gemini-api/docs"},
            {"type": "website", "url": "https://generativelanguage.googleapis.com/v1beta"},
            {"type": "security-contact", "url": "https://cloud.google.com/security"},
            {"type": "certification", "comment": "ISO 27001, SOC 2, SOC 3 — Google Cloud compliance"}
        ],
        "hashes": [
            {"alg": "SHA-256", "content": hashlib.sha256(b"google-generative-language-api/v1beta/2024-06").hexdigest()}
        ],
        "properties": [
            {"name": "auth_method", "value": "API key (x-goog-api-key header)"},
            {"name": "transport", "value": "HTTPS (TLS 1.3)"},
            {"name": "endpoint_base", "value": "https://generativelanguage.googleapis.com/v1beta"},
            {"name": "models_used", "value": "gemini-2.5-pro, gemini-2.5-flash"},
            {"name": "code_path", "value": "src/ai/gemini-client.ts"},
            {"name": "config_path", "value": "src/config.ts (googleAi)"}
        ]
    },
    {
        "type": "application",
        "name": "openrouter-api",
        "version": "v1",
        "description": "OpenRouter REST API — implicit dependency. Referenced in src/config.ts as a fallback provider. API key auth via Bearer token. Currently referenced but not actively called in the codebase.",
        "purl": "pkg:generic/openrouter-api@v1",
        "externalReferences": [
            {"type": "documentation", "url": "https://openrouter.ai/docs"},
            {"type": "website", "url": "https://openrouter.ai/api/v1"},
            {"type": "security-contact", "url": "mailto:support@openrouter.ai"}
        ],
        "hashes": [
            {"alg": "SHA-256", "content": hashlib.sha256(b"openrouter-api/v1/2025-01").hexdigest()}
        ],
        "properties": [
            {"name": "auth_method", "value": "Bearer token (Authorization header)"},
            {"name": "transport", "value": "HTTPS (TLS 1.3)"},
            {"name": "endpoint_base", "value": "https://openrouter.ai/api/v1"},
            {"name": "models_mapped", "value": "deepseek/deepseek-v4-pro → gemini-2.5-pro, minimax/minimax-m3 → gemini-2.5-flash, moonshotai/kimi-k2.7-code → gemini-2.5-pro, openai/gpt-5.5 → gemini-2.5-pro"},
            {"name": "code_path", "value": "src/config.ts (openrouter), src/ai/types.ts (mappings)"},
            {"name": "status", "value": "REFERENCED — not actively called. Pending migration from OpenRouter to Gemini via src/ai/adapter.ts MigrationAdapter."}
        ]
    },
    {
        "type": "application",
        "name": "aws-secrets-manager-api",
        "version": "2017-10-17",
        "description": "AWS Secrets Manager REST API — used via @aws-sdk/client-secrets-manager npm package. Stores API keys for Gemini and OpenRouter. Credentials via AWS IAM.",
        "purl": "pkg:generic/aws-secrets-manager@2017-10-17",
        "externalReferences": [
            {"type": "documentation", "url": "https://docs.aws.amazon.com/secretsmanager/"},
            {"type": "website", "url": "https://secretsmanager.us-east-1.amazonaws.com"},
            {"type": "certification", "comment": "SOC 1/2/3, ISO 27001, PCI DSS — AWS compliance"}
        ],
        "hashes": [
            {"alg": "SHA-256", "content": hashlib.sha256(b"aws-secrets-manager/2017-10-17").hexdigest()}
        ],
        "properties": [
            {"name": "auth_method", "value": "AWS IAM (SigV4)"},
            {"name": "transport", "value": "HTTPS (TLS 1.3)"},
            {"name": "config_path", "value": "src/config.ts (aws), src/secrets/aws.ts"},
            {"name": "stored_secrets", "value": "GEMINI_API_KEY, OPENROUTER_API_KEY, DRATA_API_KEY, GCP_PROJECT_ID, GCP_ORGANIZATION_ID"},
            {"name": "npm_package", "value": "@aws-sdk/client-secrets-manager@^3.1083.0"}
        ]
    }
]

sbom["components"].extend(implicit_deps)

# Update metadata
sbom.setdefault("metadata", {})
if "component" not in sbom["metadata"]:
    sbom["metadata"]["component"] = {
        "type": "application",
        "name": "aira",
        "version": "0.1.0"
    }

# Add tool info
if "tools" not in sbom:
    sbom["tools"] = []
sbom["tools"].append({
    "vendor": "cyclonedx",
    "name": "cyclonedx-npm",
    "version": "latest"
})
sbom["tools"].append({
    "vendor": "aira",
    "name": "generate-sbom.sh",
    "version": "1.0.0",
    "description": "Combined SBOM generator adding implicit API dependencies to npm SBOM"
})

with open(outfile, 'w') as f:
    json.dump(sbom, f, indent=2)

print(f"Added {len(implicit_deps)} implicit API dependencies")
print(f"Total components: {len(sbom['components'])}")

PYEOF

# Step 3: Validate the SBOM
echo "[3/3] Validating SBOM..."
python3 - "$OUTPUT_FILE" << 'PYEOF'
import json, sys

with open(sys.argv[1]) as f:
    sbom = json.load(f)

req_fields = ["bomFormat", "specVersion", "components"]
for field in req_fields:
    assert field in sbom, f"Missing required field: {field}"

components = sbom["components"]
print(f"SBOM valid: {len(components)} components")

# Find implicit deps
implicit = [c for c in components if c.get("purl", "").startswith("pkg:generic/")]
for c in implicit:
    name = c["name"]
    ver = c["version"]
    props = {p["name"]: p["value"] for p in c.get("properties", [])}
    print(f"  IMPLICIT: {name}@{ver} → {props.get('code_path', 'N/A')}")

# Security: verify no secrets leaked
sbom_str = json.dumps(sbom)
danger = ["AIza", "sk-or-", "sk-ant-"]
for d in danger:
    if d in sbom_str:
        print(f"  ERROR: Potential secret found matching '{d}'")
        sys.exit(1)

print("SBOM validation PASSED")
PYEOF

echo ""
echo "=== SBOM generation complete ==="
echo "Output: $OUTPUT_FILE"
echo "Components: $(python3 -c "import json; print(len(json.load(open('$OUTPUT_FILE'))['components']))")"
