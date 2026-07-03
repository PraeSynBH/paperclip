#!/usr/bin/env python3
"""Verify pre-wave rollback re-permit manifests (RAM-159 §4.3/§4.4 / RAM-210)."""

from __future__ import annotations

import argparse
import hashlib
import json
import re
import sys
from copy import deepcopy
from datetime import datetime
from pathlib import Path
from typing import Any, Dict, Iterable, List, Optional, Sequence, Tuple

import yaml
from uuid import UUID


ALLOWED_RE_PERMIT_CLASSES = {
    "BENIGN",
    "LOW_BLAST",
    "MEDIUM_BLAST",
    "HIGH_BLAST",
    "PRIVACY",
    "REGULATED",
}

BLAST_RADIUS_CLASSIFICATIONS = {"none", "low", "medium", "high"}

VERDICT_PATTERN = re.compile(r"^[A-Z_]+$")

REQUIRED_ROLES_BY_CLASS = {
    "PRIVACY": {"privacy-lead"},
    "REGULATED": {"compliance-lead"},
}

REQUIRED_TOP_LEVEL_KEYS = {
    "schema_version",
    "wave",
    "rollback_bundle_policy_id",
    "active_bundle_policy_id",
    "invariant_check",
    "re_permits",
    "dual_control_signatures",
    "audit_chain",
}

REQUIRED_WAVE_KEYS = {"number", "earliest", "population", "projects"}
REQUIRED_INVARIANT_CHECK_KEYS = {"verdict", "evidence_run_id", "verified_at", "verified_by"}
REQUIRED_RE_PERMIT_KEYS = {
    "id",
    "class",
    "surface",
    "active_threshold",
    "rollback_threshold",
    "re_permit_reason",
    "compensating_control",
    "blast_radius_classification",
    "affects_tenants",
    "author",
    "approver",
}
OPTIONAL_RE_PERMIT_KEYS = {"v1_floor_cite"}
REQUIRED_SIGNATURE_KEYS = {"signer", "signer_id", "signature_hex", "signed_at", "required_for_classes"}
REQUIRED_AUDIT_CHAIN_KEYS = {"worm_record_id", "manifest_policy_id"}


class ManifestValidationError(RuntimeError):
    """Raised when a manifest violates the schema or policy guardrails."""


def load_yaml(path: Path) -> Dict[str, Any]:
    if not path.exists():
        raise ManifestValidationError(f"manifest path does not exist: {path}")
    with path.open("r", encoding="utf-8") as manifest_file:
        content = yaml.safe_load(manifest_file)
    if not isinstance(content, dict):
        raise ManifestValidationError("manifest must be a YAML map/dictionary")
    return content


def parse_iso_datetime(value: str, label: str) -> datetime:
    if not isinstance(value, str):
        raise ManifestValidationError(f"{label} must be an ISO 8601 string")
    candidate = value
    if candidate.endswith("Z"):
        candidate = candidate[:-1] + "+00:00"
    try:
        return datetime.fromisoformat(candidate)
    except ValueError as exc:
        raise ManifestValidationError(f"{label} is not ISO 8601: {value}") from exc


def ensure_uuid(value: str, label: str) -> None:
    if not isinstance(value, str):
        raise ManifestValidationError(f"{label} must be a UUID string")
    try:
        UUID(value)
    except ValueError as exc:
        raise ManifestValidationError(f"{label} is not a valid UUID: {value}") from exc


def ensure_hex(value: str, length: Optional[int], label: str) -> None:
    if not isinstance(value, str):
        raise ManifestValidationError(f"{label} must be a hexadecimal string")
    if length and len(value) != length:
        raise ManifestValidationError(f"{label} must be {length} hex chars: {value}")
    if not re.fullmatch(r"[0-9a-fA-F]+", value):
        raise ManifestValidationError(f"{label} is not hex: {value}")


def compute_content_address(manifest: Dict[str, Any]) -> Tuple[str, Optional[str]]:
    manifest_copy = deepcopy(manifest)
    audit_chain = manifest_copy.get("audit_chain")
    recorded = None
    if isinstance(audit_chain, dict) and "manifest_policy_id" in audit_chain:
        recorded = audit_chain.pop("manifest_policy_id")
    canonical = json.dumps(manifest_copy, sort_keys=True, separators=(",",":"), ensure_ascii=False)
    digest = hashlib.sha256(canonical.encode("utf-8")).hexdigest()
    return digest, recorded


def validate_wave(wave: Dict[str, Any]) -> None:
    if set(wave.keys()) != REQUIRED_WAVE_KEYS:
        missing = REQUIRED_WAVE_KEYS - set(wave.keys())
        extra = set(wave.keys()) - REQUIRED_WAVE_KEYS
        raise ManifestValidationError(
            f"wave block must contain {REQUIRED_WAVE_KEYS}; missing={missing} extra={extra}"
        )
    number = wave["number"]
    if not isinstance(number, int) or number < 0:
        raise ManifestValidationError("wave.number must be a non-negative integer")
    parse_iso_datetime(wave["earliest"], "wave.earliest")
    if not isinstance(wave["population"], str) or not wave["population"].strip():
        raise ManifestValidationError("wave.population must be a non-empty string")
    projects = wave["projects"]
    if not isinstance(projects, list):
        raise ManifestValidationError("wave.projects must be a list")


def validate_invariant_check(invariant: Dict[str, Any]) -> None:
    missing = REQUIRED_INVARIANT_CHECK_KEYS - set(invariant.keys())
    if missing:
        raise ManifestValidationError(f"invariant_check missing keys: {missing}")
    verdict = invariant["verdict"]
    if not isinstance(verdict, str) or not VERDICT_PATTERN.fullmatch(verdict):
        raise ManifestValidationError("invariant_check.verdict must be an uppercase identifier")
    ensure_uuid(invariant["evidence_run_id"], "invariant_check.evidence_run_id")
    parse_iso_datetime(invariant["verified_at"], "invariant_check.verified_at")
    if not isinstance(invariant["verified_by"], str) or not invariant["verified_by"].strip():
        raise ManifestValidationError("invariant_check.verified_by must be a non-empty string")


def validate_re_permit(entry: Dict[str, Any], signers: List[Dict[str, Any]]) -> None:
    missing = REQUIRED_RE_PERMIT_KEYS - set(entry.keys())
    if missing:
        raise ManifestValidationError(f"re_permit {entry.get('id')} missing keys: {missing}")
    extra = set(entry.keys()) - (REQUIRED_RE_PERMIT_KEYS | OPTIONAL_RE_PERMIT_KEYS)
    if extra:
        raise ManifestValidationError(f"re_permit {entry.get('id')} has unexpected keys: {extra}")
    class_name = entry["class"].upper()
    if class_name not in ALLOWED_RE_PERMIT_CLASSES:
        raise ManifestValidationError(f"unsupported re_permit class: {entry['class']}")
    active = entry["active_threshold"]
    rollback = entry["rollback_threshold"]
    if not (isinstance(active, (int, float)) and isinstance(rollback, (int, float))):
        raise ManifestValidationError("thresholds must be numeric")
    if not (0 <= active <= 1 and 0 <= rollback <= 1):
        raise ManifestValidationError("threshold values must live in [0, 1]")
    if rollback <= active:
        raise ManifestValidationError("rollback_threshold must be greater than active_threshold")
    if not isinstance(entry["surface"], str) or not entry["surface"].strip():
        raise ManifestValidationError("re_permit.surface must be a non-empty string")
    if not isinstance(entry["re_permit_reason"], str) or not entry["re_permit_reason"].strip():
        raise ManifestValidationError("re_permit_reason must be a non-empty string")
    ensures_str = ["compensating_control", "author", "approver"]
    for key in ensures_str:
        if not isinstance(entry[key], str) or not entry[key].strip():
            raise ManifestValidationError(f"re_permit {key} must be a non-empty string")
    if entry["author"] == entry["approver"] and class_name != "BENIGN":
        raise ManifestValidationError(
            f"re_permit {entry['id']} class {class_name} requires separate author and approver"
        )
    blast = entry["blast_radius_classification"].lower()
    if blast not in BLAST_RADIUS_CLASSIFICATIONS:
        raise ManifestValidationError("blast_radius_classification must be low, medium, high or none")
    affects = entry["affects_tenants"]
    if not isinstance(affects, list):
        raise ManifestValidationError("affects_tenants must be a list of tenant IDs")
    for tenant in affects:
        if not isinstance(tenant, str) or not tenant.strip():
            raise ManifestValidationError("tenant IDs in affects_tenants must be strings")
    if "v1_floor_cite" in entry and (not isinstance(entry["v1_floor_cite"], str) or not entry["v1_floor_cite"].strip()):
        raise ManifestValidationError("v1_floor_cite, if present, must be a non-empty string")
    if class_name in REQUIRED_ROLES_BY_CLASS:
        signer_names = {s["signer"] for s in signers}
        required = REQUIRED_ROLES_BY_CLASS[class_name]
        missing = required - signer_names
        if missing:
            raise ManifestValidationError(
                f"re_permit {entry['id']} class {class_name} missing dual control signers: {missing}"
            )


def validate_dual_control_signatures(signatures: Sequence[Dict[str, Any]], re_permit_classes: Iterable[str]) -> None:
    if not signatures:
        raise ManifestValidationError("dual_control_signatures must list at least one signer")
    signers_by_class: Dict[str, List[str]] = {}
    for sig in signatures:
        missing = REQUIRED_SIGNATURE_KEYS - set(sig.keys())
        if missing:
            raise ManifestValidationError(f"signature entry missing keys: {missing}")
        signature_hex = sig["signature_hex"]
        ensure_hex(signature_hex, 64, "dual_control_signatures.signature_hex")
        parse_iso_datetime(sig["signed_at"], "dual_control_signatures.signed_at")
        if not isinstance(sig["signer"], str) or not sig["signer"].strip():
            raise ManifestValidationError("dual_control_signatures.signer must be non-empty")
        classes = sig["required_for_classes"]
        if not isinstance(classes, list) or not classes:
            raise ManifestValidationError("required_for_classes must be a non-empty list")
        for class_name in classes:
            class_name = class_name.upper()
            if class_name not in ALLOWED_RE_PERMIT_CLASSES:
                raise ManifestValidationError(
                    f"dual_control_signatures references unknown class: {class_name}"
                )
            signers_by_class.setdefault(class_name, []).append(sig["signer"])
    for class_name in re_permit_classes:
        if class_name not in signers_by_class:
            raise ManifestValidationError(
                f"no signature claims responsibility for re_permit class {class_name}"
            )


def validate_manifest(manifest: Dict[str, Any]) -> str:
    missing = REQUIRED_TOP_LEVEL_KEYS - set(manifest.keys())
    if missing:
        raise ManifestValidationError(f"manifest is missing top-level keys: {missing}")
    if manifest["schema_version"] != 1:
        raise ManifestValidationError("schema_version must equal 1")
    validate_wave(manifest["wave"])
    ensure_hex(manifest["rollback_bundle_policy_id"], 64, "rollback_bundle_policy_id")
    ensure_hex(manifest["active_bundle_policy_id"], 64, "active_bundle_policy_id")
    validate_invariant_check(manifest["invariant_check"])
    re_permits = manifest["re_permits"]
    if not isinstance(re_permits, list) or not re_permits:
        raise ManifestValidationError("re_permits must be a non-empty list")
    signatures = manifest["dual_control_signatures"]
    if not isinstance(signatures, list):
        raise ManifestValidationError("dual_control_signatures must be a list")
    re_permit_classes = []
    for entry in re_permits:
        if not isinstance(entry, dict):
            raise ManifestValidationError("each re_permit entry must be a mapping")
        validate_re_permit(entry, signatures)
        re_permit_classes.append(entry["class"].upper())
    validate_dual_control_signatures(signatures, re_permit_classes)
    audit_chain = manifest["audit_chain"]
    if not isinstance(audit_chain, dict):
        raise ManifestValidationError("audit_chain must be a mapping")
    missing_audit = REQUIRED_AUDIT_CHAIN_KEYS - set(audit_chain.keys())
    if missing_audit:
        raise ManifestValidationError(f"audit_chain missing keys: {missing_audit}")
    ensure_uuid(audit_chain["worm_record_id"], "audit_chain.worm_record_id")
    ensure_hex(audit_chain["manifest_policy_id"], 64, "audit_chain.manifest_policy_id")
    computed, recorded = compute_content_address(manifest)
    if recorded is None:
        raise ManifestValidationError("audit_chain.manifest_policy_id must be populated")
    if recorded != computed:
        raise ManifestValidationError(
            "manifest_policy_id does not match the content address of the manifest"
        )
    return computed


def main(argv: Optional[Sequence[str]] = None) -> int:
    parser = argparse.ArgumentParser(
        description="Verify rollback manifests using the RAM-159 schema and invariants."
    )
    parser.add_argument("manifests", nargs="+", type=Path, help="manifest file(s) to verify")
    parser.add_argument(
        "--template",
        type=Path,
        default=Path("security/rollback_manifests/template/v1.yaml"),
        help="canonical template used to document the schema",
    )
    args = parser.parse_args(argv)
    template: Optional[Dict[str, Any]] = None
    if args.template.exists():
        template = load_yaml(args.template)
    errors = False
    for manifest_path in args.manifests:
        try:
            manifest = load_yaml(manifest_path)
            if template:
                manifest_keys = set(manifest.keys())
                template_keys = set(template.keys())
                if not REQUIRED_TOP_LEVEL_KEYS.issubset(template_keys):
                    raise ManifestValidationError(
                        "template is missing required top-level keys; please regenerate it"
                    )
            computed_hash = validate_manifest(manifest)
        except ManifestValidationError as exc:
            print(f"[FAIL] {manifest_path}: {exc}", file=sys.stderr)
            errors = True
            continue
        print(f"[PASS] {manifest_path} (content address {computed_hash})")
    return 1 if errors else 0


if __name__ == "__main__":
    raise SystemExit(main())
