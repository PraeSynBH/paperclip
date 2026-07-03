"""Unit tests for verification of rollback manifests."""

from copy import deepcopy
from uuid import uuid4
import unittest

from tools.verify_rollback_manifest import (
    ManifestValidationError,
    compute_content_address,
    validate_manifest,
)


class ManifestVerifierTests(unittest.TestCase):
    def _build_base_manifest(self):
        return {
            "schema_version": 1,
            "wave": {
                "number": 1,
                "earliest": "2026-07-15",
                "population": "low-risk existing",
                "projects": ["proj-123"],
            },
            "rollback_bundle_policy_id": "1" * 64,
            "active_bundle_policy_id": "2" * 64,
            "invariant_check": {
                "verdict": "ALLOW",
                "evidence_run_id": str(uuid4()),
                "verified_at": "2026-07-02T22:00:00Z",
                "verified_by": "security-engineering",
            },
            "re_permits": [
                {
                    "id": "RR-W1-001",
                    "class": "PRIVACY",
                    "surface": "phi:export",
                    "active_threshold": 0.0,
                    "rollback_threshold": 0.5,
                    "re_permit_reason": "example reason",
                    "compensating_control": "v1_floor",
                    "blast_radius_classification": "medium",
                    "affects_tenants": [],
                    "author": "ciso",
                    "approver": "privacy-lead",
                },
                {
                    "id": "RR-W1-002",
                    "class": "REGULATED",
                    "surface": "financial:export",
                    "active_threshold": 0.0,
                    "rollback_threshold": 0.25,
                    "re_permit_reason": "example reason 2",
                    "compensating_control": "capability_kill",
                    "blast_radius_classification": "high",
                    "affects_tenants": [],
                    "author": "security-engineering",
                    "approver": "ciso",
                },
            ],
            "dual_control_signatures": [
                {
                    "signer": "ciso",
                    "signer_id": "ciso-01",
                    "signature_hex": "0" * 64,
                    "signed_at": "2026-07-02T22:30:00Z",
                    "required_for_classes": ["PRIVACY", "REGULATED", "HIGH_BLAST"],
                },
                {
                    "signer": "privacy-lead",
                    "signer_id": "privacy-01",
                    "signature_hex": "1" * 64,
                    "signed_at": "2026-07-02T22:30:00Z",
                    "required_for_classes": ["PRIVACY"],
                },
                {
                    "signer": "compliance-lead",
                    "signer_id": "compliance-01",
                    "signature_hex": "2" * 64,
                    "signed_at": "2026-07-02T22:30:00Z",
                    "required_for_classes": ["REGULATED"],
                },
            ],
            "audit_chain": {
                "worm_record_id": str(uuid4()),
            },
        }

    def _manifest(self):
        manifest = deepcopy(self._build_base_manifest())
        manifest_id, _ = compute_content_address(manifest)
        manifest["audit_chain"]["manifest_policy_id"] = manifest_id
        return manifest

    def test_valid_manifest(self):
        manifest = self._manifest()
        computed = validate_manifest(manifest)
        # Should match the manifest policy ID already written into the manifest
        self.assertEqual(manifest["audit_chain"]["manifest_policy_id"], computed)

    def test_author_and_approver_must_differ_for_non_benign(self):
        manifest = self._manifest()
        manifest["re_permits"][1]["author"] = manifest["re_permits"][1]["approver"]
        manifest["audit_chain"]["manifest_policy_id"] = compute_content_address(manifest)[0]
        with self.assertRaises(ManifestValidationError):
            validate_manifest(manifest)

    def test_requires_compliance_lead_for_regulated(self):
        manifest = self._manifest()
        manifest["re_permits"][1]["class"] = "REGULATED"
        manifest["dual_control_signatures"] = [manifest["dual_control_signatures"][0]]
        manifest["audit_chain"]["manifest_policy_id"] = compute_content_address(manifest)[0]
        with self.assertRaises(ManifestValidationError):
            validate_manifest(manifest)

    def test_manifest_policy_id_mismatch_is_rejected(self):
        manifest = self._manifest()
        manifest["audit_chain"]["manifest_policy_id"] = "deadbeef" * 8
        with self.assertRaises(ManifestValidationError):
            validate_manifest(manifest)


if __name__ == "__main__":
    unittest.main()
